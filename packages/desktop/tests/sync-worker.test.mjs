import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import worker from "../sync-worker/worker.js";

const { createD1 } = createRequire(import.meta.url)("./d1-shim.cjs");
const TOKEN = "synthetic-test-token-0123456789abcdef";
const ID = "11111111-2222-3333-4444-555555555555";
const row = (client, input, cost) => ({
  client,
  modelId: "model-a",
  providerId: "provider-a",
  tokens: { input, output: 1, cacheRead: 2, cacheWrite: 3, reasoning: 4 },
  cost,
  messages: 2,
});
function store(env = {}) {
  const DB = createD1();
  const call = (method, path, body, token = TOKEN) =>
    worker.fetch(
      new Request("https://sync.example.test" + path, {
        method,
        headers: token === null ? {} : { Authorization: "Bearer " + token },
        ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
      }),
      { DB, SYNC_TOKEN: TOKEN, ...env },
    );
  return { DB, call };
}

test("every request needs the exact access token", async () => {
  const { call } = store();
  for (const token of [null, "", "wrong", TOKEN + "x", TOKEN.slice(0, -1), TOKEN.toUpperCase()]) {
    for (const [method, path] of [["GET", "/v1/devices"], ["GET", "/"], ["PUT", "/v1/devices/" + ID], ["DELETE", "/v1/devices/" + ID]]) {
      const response = await call(method, path, method === "PUT" ? { name: "x", days: {} } : undefined, token);
      assert.equal(response.status, 401, `${method} ${path} with ${token}`);
      assert.deepEqual(await response.json(), { error: "Unauthorized" });
    }
  }
  const basic = await worker.fetch(
    new Request("https://sync.example.test/v1/devices", { headers: { Authorization: "Basic " + TOKEN } }),
    { DB: createD1(), SYNC_TOKEN: TOKEN },
  );
  assert.equal(basic.status, 401);
  assert.equal((await call("GET", "/v1/devices")).status, 200);
});

test("a store without a real secret stays closed, even to an empty token", async () => {
  for (const SYNC_TOKEN of [undefined, "", "short"]) {
    const { call } = store({ SYNC_TOKEN });
    for (const token of [null, "", SYNC_TOKEN ?? ""]) {
      const response = await call("GET", "/v1/devices", undefined, token);
      assert.equal(response.status, 503);
    }
  }
});

test("a snapshot round-trips, lists by computer, and rewrites only the years that changed", async () => {
  const { DB, call } = store();
  assert.deepEqual(await (await call("GET", "/v1/devices")).json(), { devices: [] });
  assert.equal((await call("GET", "/v1/devices/" + ID)).status, 404);
  const days = {
    "2025-12-31": [row("claude", 10, 1.5)],
    "2026-01-01": [row("claude", 20, 2), row("codex", 30, 0.25)],
    "2026-01-02": [],
  };
  const saved = await call("PUT", "/v1/devices/" + ID, { name: "  Desk  ", days, ignored: true });
  assert.equal(saved.status, 200);
  assert.equal(saved.headers.get("cache-control"), "no-store");
  const { updatedAt } = await saved.json();
  assert.ok(Date.parse(updatedAt));
  const list = await (await call("GET", "/v1/devices")).json();
  assert.deepEqual(list, { devices: [{ id: ID, name: "Desk", updatedAt }] });
  const detail = await (await call("GET", "/v1/devices/" + ID)).json();
  // Empty days are dropped; everything else comes back as sent.
  assert.deepEqual(detail, { id: ID, name: "Desk", updatedAt, days: { "2025-12-31": days["2025-12-31"], "2026-01-01": days["2026-01-01"] } });

  const before = DB.writes;
  await call("PUT", "/v1/devices/" + ID, { name: "Desk", days: { ...days, "2026-01-03": [row("claude", 5, 1)] } });
  // The computer row and 2026; 2025 is unchanged and left alone.
  assert.equal(DB.writes - before, 2);
  await call("PUT", "/v1/devices/" + ID, { name: "Desk", days: { "2026-01-03": [row("claude", 5, 1)] } });
  assert.deepEqual(Object.keys((await (await call("GET", "/v1/devices/" + ID)).json()).days), ["2026-01-03"]);

  const other = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  await call("PUT", "/v1/devices/" + other, { name: "Laptop", days: {} });
  assert.deepEqual((await (await call("GET", "/v1/devices")).json()).devices.map((d) => d.name), ["Desk", "Laptop"]);
  assert.deepEqual(await (await call("DELETE", "/v1/devices/" + ID)).json(), { removed: ID });
  assert.deepEqual((await (await call("GET", "/v1/devices")).json()).devices.map((d) => d.id), [other]);
  assert.equal((await call("GET", "/v1/devices/" + ID)).status, 404);
});

test("malformed snapshots, ids, paths and methods are refused without storing anything", async () => {
  const { call } = store();
  const good = { name: "Desk", days: { "2026-01-01": [row("claude", 1, 1)] } };
  const bad = [
    "not json",
    [],
    { days: {} },
    { name: "   ", days: {} },
    { name: "Desk" },
    { name: "Desk", days: [] },
    { name: "Desk", days: { "2026-1-1": [] } },
    { name: "Desk", days: { "2026-01-01": {} } },
    { name: "Desk", days: { "2026-01-01": [{ ...row("claude", 1, 1), client: "" }] } },
    { name: "Desk", days: { "2026-01-01": [{ ...row("claude", 1, 1), cost: -1 }] } },
    { name: "Desk", days: { "2026-01-01": [{ ...row("claude", 1, 1), messages: "2" }] } },
    { name: "Desk", days: { "2026-01-01": [{ ...row("claude", 1, 1), tokens: { input: "5" } }] } },
    { name: "Desk", days: { "2026-01-01": [null] } },
    { name: "Desk", days: { "2026-01-01": Array.from({ length: 401 }, () => row("claude", 1, 1)) } },
  ];
  for (const body of bad) assert.equal((await call("PUT", "/v1/devices/" + ID, body)).status, 400, JSON.stringify(body).slice(0, 80));
  for (const id of ["short", "UPPERCASE-ID-0000", "-leading-dash-000", "a".repeat(65), "has.dot.in-id-00", "%2e%2e%2f%2e%2e%2f"])
    assert.equal((await call("PUT", "/v1/devices/" + id, good)).status, 400, id);
  assert.equal((await call("PUT", "/v1/devices/" + ID + "/extra", good)).status, 404);
  assert.equal((await call("GET", "/")).status, 404);
  assert.equal((await call("GET", "/v1")).status, 404);
  assert.equal((await call("POST", "/v1/devices", good)).status, 405);
  assert.equal((await call("POST", "/v1/devices/" + ID, good)).status, 405);
  assert.equal((await call("PUT", "/v1/devices/" + ID, "x".repeat(8 * 1024 * 1024 + 1))).status, 413);
  assert.deepEqual(await (await call("GET", "/v1/devices")).json(), { devices: [] });
});

test("the number of computers is capped and storage failures do not leak details", async () => {
  const { call } = store();
  for (let i = 0; i < 50; i++)
    assert.equal((await call("PUT", `/v1/devices/device-${String(i).padStart(4, "0")}`, { name: "c" + i, days: {} })).status, 200);
  assert.equal((await call("PUT", "/v1/devices/device-9999", { name: "extra", days: {} })).status, 409);
  // An existing computer can still update at the cap.
  assert.equal((await call("PUT", "/v1/devices/device-0000", { name: "renamed", days: {} })).status, 200);

  const broken = await worker.fetch(
    new Request("https://sync.example.test/v1/devices/" + ID, { headers: { Authorization: "Bearer " + TOKEN } }),
    { SYNC_TOKEN: TOKEN, DB: { prepare: () => { throw new Error("secret internal detail"); }, batch: async () => [] } },
  );
  assert.equal(broken.status, 500);
  assert.deepEqual(await broken.json(), { error: "Sync storage failed" });
});

test("cloud sessions add up under one computer and replace their own earlier part", async () => {
  const { call } = store();
  const put = (session, rows) =>
    call("PUT", `/v1/devices/claude-cloud/sessions/${session}`, { name: "Claude cloud", days: { "2026-10-09": rows } });
  assert.equal((await put("session_aaaaaaaa", [row("claude", 10, 1)])).status, 200);
  assert.equal((await put("session_bbbbbbbb", [row("claude", 5, 0.5), row("codex", 7, 2)])).status, 200);
  // A later upload of the same session replaces it rather than adding to it.
  assert.equal((await put("session_aaaaaaaa", [row("claude", 20, 2)])).status, 200);
  const list = await (await call("GET", "/v1/devices")).json();
  assert.deepEqual(list.devices.map((device) => [device.id, device.name]), [["claude-cloud", "Claude cloud"]]);
  const device = await (await call("GET", "/v1/devices/claude-cloud")).json();
  const day = device.days["2026-10-09"];
  assert.deepEqual(
    day.map((entry) => [entry.client, entry.tokens.input, entry.cost, entry.messages]).sort(),
    [["claude", 25, 2.5, 4], ["codex", 7, 2, 2]],
  );
  assert.equal((await call("DELETE", "/v1/devices/claude-cloud")).status, 200);
  assert.equal((await call("GET", "/v1/devices/claude-cloud")).status, 404);
  assert.equal((await put("session_aaaaaaaa", [row("claude", 1, 0)])).status, 200);
  const fresh = await (await call("GET", "/v1/devices/claude-cloud")).json();
  assert.equal(fresh.days["2026-10-09"][0].tokens.input, 1);
});

test("session parts reject bad ids, bad methods and bad snapshots", async () => {
  const { call } = store();
  const body = { name: "Claude cloud", days: { "2026-10-09": [row("claude", 1, 0)] } };
  assert.equal((await call("PUT", "/v1/devices/claude-cloud/sessions/short", body)).status, 400);
  assert.equal((await call("PUT", "/v1/devices/claude-cloud/sessions/bad.session.id", body)).status, 400);
  assert.equal((await call("PUT", "/v1/devices/BAD/sessions/session_aaaaaaaa", body)).status, 400);
  assert.equal((await call("GET", "/v1/devices/claude-cloud/sessions/session_aaaaaaaa")).status, 405);
  assert.equal((await call("PUT", "/v1/devices/claude-cloud/sessions/session_aaaaaaaa", { days: {} })).status, 400);
  assert.equal((await call("PUT", "/v1/devices/claude-cloud/sessions/session_aaaaaaaa/x", body)).status, 404);
});
