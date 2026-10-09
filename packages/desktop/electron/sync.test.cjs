const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { createSync, syncUrl, syncToken, deviceName, newToken } = require("./sync.cjs");
const { createD1, workerFetch } = require("../tests/d1-shim.cjs");

const TOKEN = "synthetic-test-token-0123456789abcdef";
// Reversible stand-in for Windows credential protection.
const safeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from("enc:" + Buffer.from(value).toString("hex")),
  decryptString: (value) => Buffer.from(value.toString().slice(4), "hex").toString(),
};
const row = (client, input, cost) => ({
  client,
  modelId: "model-a",
  providerId: "provider-a",
  tokens: { input, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
  cost,
  messages: 1,
});
const graphOf = (days) => ({
  contributions: Object.entries(days).map(([date, clients]) => ({ date, clients })),
});
async function setup(t) {
  const worker = (await import("../sync-worker/worker.js")).default;
  const store = workerFetch(worker, { DB: createD1(), SYNC_TOKEN: TOKEN });
  const computer = async (name, days) => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tokscale-sync-test-"));
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const state = { days, statuses: [], fail: false };
    const make = () =>
      createSync({
        dir,
        safeStorage,
        hostname: name,
        fetchImpl: (...args) => (state.fail ? Promise.reject(new Error("offline")) : store.fetchImpl(...args)),
        getGraph: async () => graphOf(state.days),
        onStatus: (status, changed) => state.statuses.push({ ...status, changed }),
      });
    return { dir, state, make, sync: make() };
  };
  return { store, computer };
}

test("connection input is validated before anything is sent", () => {
  assert.equal(syncUrl(" https://sync.example.test/ "), "https://sync.example.test");
  assert.equal(syncUrl("https://example.test/sync/"), "https://example.test/sync");
  for (const bad of ["", "sync.example.test", "http://sync.example.test", "https://user:pw@sync.example.test", "https://sync.example.test/?a=1", "https://sync.example.test/#x", "file:///C:/x", 5, "https://" + "a".repeat(500)])
    assert.throws(() => syncUrl(bad));
  assert.equal(syncToken(` ${TOKEN} `), TOKEN);
  for (const bad of ["", "short", "has spaces in the token value 0123456789", "x".repeat(257), null]) assert.throws(() => syncToken(bad));
  assert.equal(deviceName("  Desk\tPC  "), "Desk PC");
  assert.equal(deviceName("n".repeat(200)).length, 80);
  for (const bad of ["", "   ", undefined]) assert.throws(() => deviceName(bad));
  assert.match(newToken(), /^[A-Za-z0-9_-]{43}$/);
  assert.equal(syncToken(newToken()).length, 43);
});

test("a wrong address or token is reported and never saved", async (t) => {
  const { store, computer } = await setup(t);
  const desk = await computer("Desk", {});
  await assert.rejects(desk.sync.connect({ url: store.origin, token: "wrong-token-wrong-token-wrong-token-0" }), /rejected this access token/);
  await assert.rejects(desk.sync.connect({ url: "https://elsewhere.example.test", token: TOKEN }), /Could not reach/);
  await assert.rejects(desk.sync.connect({ url: store.origin + "/nothing", token: TOKEN }), /Tokscale sync store/);
  await assert.rejects(
    createSync({ dir: desk.dir, safeStorage: { ...safeStorage, isEncryptionAvailable: () => false }, getGraph: async () => ({}), fetchImpl: store.fetchImpl })
      .connect({ url: store.origin, token: TOKEN }),
    /encryption is unavailable/,
  );
  assert.equal((await desk.sync.status()).connected, false);
  await assert.rejects(fs.stat(path.join(desk.dir, "sync-connection.json")), { code: "ENOENT" });
  assert.deepEqual(desk.sync.extra("all"), { includeLocal: true, days: {} });
  await assert.rejects(desk.sync.removeDevice("aaaaaaaa-bbbb"), /not connected/);
});

test("two computers see each other's days, with the token stored encrypted", async (t) => {
  const { store, computer } = await setup(t);
  const desk = await computer("Desk", { "2026-10-01": [row("claude", 100, 4)] });
  const laptop = await computer("Laptop", { "2026-10-01": [row("codex", 7, 1)], "2026-10-02": [row("codex", 9, 2)] });

  const first = await desk.sync.connect({ url: store.origin + "/", token: TOKEN });
  assert.equal(first.connected, true);
  assert.equal(first.error, null);
  assert.deepEqual(first.devices.map((d) => [d.name, d.self, d.days, d.lastDate]), [["Desk", true, 1, "2026-10-01"]]);
  const saved = await fs.readFile(path.join(desk.dir, "sync-connection.json"), "utf8");
  assert.equal(saved.includes(TOKEN), false);
  assert.equal(JSON.parse(saved).url, store.origin);
  // Alone, there is nothing to add to this computer's own reports.
  assert.deepEqual(desk.sync.extra("all"), { includeLocal: true, days: {} });

  const second = await laptop.sync.connect({ url: store.origin, token: TOKEN, name: "Travel laptop" });
  assert.deepEqual(second.devices.map((d) => [d.name, d.self, d.days]), [["Travel laptop", true, 2], ["Desk", false, 1]]);
  const deskId = second.devices[1].id, laptopId = second.devices[0].id;
  assert.deepEqual(laptop.sync.extra("all"), { includeLocal: true, days: { "2026-10-01": [row("claude", 100, 4)] } });
  assert.deepEqual(laptop.sync.extra(laptopId), { includeLocal: true, days: {} });
  assert.deepEqual(laptop.sync.extra(deskId), { includeLocal: false, days: { "2026-10-01": [row("claude", 100, 4)] } });
  assert.deepEqual(laptop.sync.extra("unknown-computer"), { includeLocal: false, days: {} });

  desk.state.statuses.length = 0;
  const third = await desk.sync.sync();
  assert.deepEqual(third.devices.map((d) => d.name), ["Desk", "Travel laptop"]);
  assert.equal(Object.keys(desk.sync.extra("all").days).length, 2);
  // Reports are told to redraw only when another computer's data changed.
  assert.deepEqual(desk.state.statuses.map((s) => [s.syncing, s.changed]), [[true, false], [false, true]]);

  // Nothing changed anywhere: one listing, no downloads, no upload.
  store.calls.length = 0;
  desk.state.statuses.length = 0;
  await desk.sync.sync();
  assert.deepEqual(store.calls, ["GET /v1/devices"]);
  assert.equal(desk.state.statuses.at(-1).changed, false);

  // New local usage uploads once and reaches the other computer.
  desk.state.days = { ...desk.state.days, "2026-10-03": [row("claude", 5, 0.5)] };
  store.calls.length = 0;
  await desk.sync.sync();
  assert.deepEqual(store.calls, ["GET /v1/devices", "PUT /v1/devices/" + deskId]);
  await laptop.sync.sync();
  assert.deepEqual(Object.keys(laptop.sync.extra(deskId).days), ["2026-10-01", "2026-10-03"]);
});

test("history survives deleted transcripts, a restart, being offline, and a cleared app folder", async (t) => {
  const { store, computer } = await setup(t);
  const desk = await computer("Desk", {
    "2026-09-01": [row("claude", 50, 5)],
    "2026-10-01": [row("claude", 100, 4), row("codex", 3, 1)],
  });
  const laptop = await computer("Laptop", { "2026-10-02": [row("codex", 9, 2)] });
  await desk.sync.connect({ url: store.origin, token: TOKEN });
  await laptop.sync.connect({ url: store.origin, token: TOKEN });
  await desk.sync.sync();
  const deskId = (await desk.sync.status()).device.id;

  // Claude removes its old transcripts; only Codex's day is still on disk.
  desk.state.days = { "2026-10-01": [row("codex", 3, 1)] };
  desk.state.statuses.length = 0;
  await desk.sync.sync();
  const archived = { "2026-09-01": [row("claude", 50, 5)], "2026-10-01": [row("claude", 100, 4)] };
  assert.deepEqual(desk.sync.extra(deskId), { includeLocal: true, days: archived });
  assert.equal(desk.state.statuses.at(-1).changed, true);
  assert.deepEqual(Object.keys(desk.sync.extra("all").days), ["2026-09-01", "2026-10-01", "2026-10-02"]);
  await laptop.sync.sync();
  assert.deepEqual(laptop.sync.extra(deskId).days, {
    "2026-09-01": [row("claude", 50, 5)],
    "2026-10-01": [row("codex", 3, 1), row("claude", 100, 4)],
  });

  // A restart reads the saved copy before any network request.
  desk.state.fail = true;
  const restarted = desk.make();
  const offline = await restarted.sync();
  assert.match(offline.error, /Could not reach/);
  assert.equal(offline.connected, true);
  assert.deepEqual(restarted.extra(deskId).days, archived);
  assert.deepEqual(Object.keys(restarted.extra("all").days), ["2026-09-01", "2026-10-01", "2026-10-02"]);
  desk.state.fail = false;
  assert.equal((await restarted.sync()).error, null);

  // The app's saved copy is lost but the computer keeps its identity: the
  // store's copy is read back rather than overwritten by the smaller scan.
  await fs.rm(path.join(desk.dir, "sync-cache.json"));
  const recovered = desk.make();
  await recovered.sync();
  assert.deepEqual(recovered.extra(deskId).days, archived);
  await laptop.sync.sync();
  assert.equal(Object.keys(laptop.sync.extra(deskId).days).length, 2);
});

test("renaming, removing a computer and disconnecting", async (t) => {
  const { store, computer } = await setup(t);
  const desk = await computer("Desk", { "2026-10-01": [row("claude", 100, 4)] });
  const laptop = await computer("Laptop", { "2026-10-02": [row("codex", 9, 2)] });
  await desk.sync.connect({ url: store.origin, token: TOKEN });
  await laptop.sync.connect({ url: store.origin, token: TOKEN });
  const renamed = await desk.sync.rename("Office desk");
  assert.equal(renamed.device.name, "Office desk");
  assert.deepEqual((await laptop.sync.sync()).devices.map((d) => d.name), ["Laptop", "Office desk"]);
  await assert.rejects(desk.sync.rename("  "), /name/);

  const deskId = renamed.device.id, laptopId = (await laptop.sync.status()).device.id;
  await assert.rejects(desk.sync.removeDevice(deskId), /Disconnect/);
  await assert.rejects(desk.sync.removeDevice("../" + laptopId), /Unknown computer/);
  const removed = await desk.sync.removeDevice(laptopId);
  assert.deepEqual(removed.devices.map((d) => d.name), ["Office desk"]);
  assert.deepEqual(desk.sync.extra("all").days, {});

  const off = await desk.sync.disconnect();
  assert.equal(off.connected, false);
  assert.deepEqual(off.devices, []);
  for (const file of ["sync-connection.json", "sync-cache.json"])
    await assert.rejects(fs.stat(path.join(desk.dir, file)), { code: "ENOENT" });
  store.calls.length = 0;
  await desk.sync.sync();
  assert.deepEqual(store.calls, []);
  // The computer keeps its identity for a later reconnect.
  assert.equal((await desk.make().status()).device.id, deskId);
});

test("a changed access token stops syncing with a clear error and keeps the saved copy", async (t) => {
  const worker = (await import("../sync-worker/worker.js")).default;
  const env = { DB: createD1(), SYNC_TOKEN: TOKEN };
  const store = workerFetch(worker, env);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tokscale-sync-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const sync = createSync({ dir, safeStorage, hostname: "Desk", fetchImpl: store.fetchImpl, getGraph: async () => graphOf({ "2026-10-01": [row("claude", 1, 1)] }) });
  await sync.connect({ url: store.origin, token: TOKEN });
  env.SYNC_TOKEN = "rotated-" + TOKEN;
  const status = await sync.sync();
  assert.match(status.error, /rejected this access token/);
  assert.equal(status.connected, true);
  assert.equal(status.devices[0].days, 1);
  // A failing engine never uploads an empty snapshot.
  env.SYNC_TOKEN = TOKEN;
  const broken = createSync({ dir, safeStorage, hostname: "Desk", fetchImpl: store.fetchImpl, getGraph: async () => { throw new Error("Graph export failed"); } });
  store.calls.length = 0;
  assert.match((await broken.sync()).error, /Graph export failed/);
  assert.equal(store.calls.some((call) => call.startsWith("PUT")), false);
});
