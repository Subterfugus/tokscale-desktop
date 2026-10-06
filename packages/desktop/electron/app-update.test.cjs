const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createAppUpdate, validateState, latestRelease, newer, ENDPOINT, INTERVAL_MS } = require("./app-update.cjs");
const release = (tag, extra = {}) => ({ tag_name: tag, html_url: "https://untrusted.invalid", ...extra });
const response = (releases, options = {}) => ({
  ok: options.status === undefined || options.status === 200,
  status: options.status || 200,
  headers: new Headers(options.headers),
  text: async () => options.content || JSON.stringify(releases),
});
function harness(initial = {}, overrides = {}) {
  const h = { time: 100000, state: initial, notes: [], calls: [], timers: [], result: response([]) };
  h.monitor = createAppUpdate({
    current: "0.4.6",
    store: { load: async () => ({ values: h.state }), save: async values => (h.state = structuredClone(values)) },
    now: () => h.time, notify: n => h.notes.push(n),
    fetchImpl: async (...args) => { h.calls.push(args); return h.result; },
    setTimer: (callback, ms) => { const timer = { callback, ms }; h.timers.push(timer); return timer; },
    clearTimer: timer => { if (timer) timer.cancelled = true; },
    ...overrides,
  });
  h.next = async (releases, options) => { h.time += INTERVAL_MS; h.result = response(releases, options); return h.monitor.poll(); };
  return h;
}

test("versions compare by number and only published desktop tags count", () => {
  assert.equal(newer("0.4.10", "0.4.9"), true);
  assert.equal(newer("0.4.6", "0.4.6"), false);
  assert.equal(newer("0.3.9", "0.4.0"), false);
  assert.equal(latestRelease([
    release("v9.9.9"), release("desktop-v0.5.0", { draft: true }), release("desktop-v0.6.0", { prerelease: true }),
    release("desktop-v0.4.7"), release("desktop-v0.4.10"), release("desktop-v0.4.10-beta"), release(42),
  ]), "0.4.10");
  assert.equal(latestRelease([]), null);
});

test("no release, or the running version, reports nothing and stays quiet", async () => {
  const h = harness();
  const empty = await h.monitor.poll();
  assert.equal(empty.available, null);
  assert.equal(empty.checkedAt, h.time);
  assert.equal(h.calls[0][0], ENDPOINT);
  assert.equal(h.calls[0][1].redirect, "error");
  assert.equal(h.calls[0][1].headers.Authorization, undefined);
  const same = await h.next([release("desktop-v0.4.6"), release("desktop-v0.3.0")]);
  assert.equal(same.latest, "0.4.6");
  assert.equal(same.available, null);
  assert.equal(h.notes.length, 0);
});

test("a newer release notifies once with a link built from the version", async () => {
  const h = harness();
  const found = await h.next([release("desktop-v0.4.7")]);
  assert.equal(found.available, "0.4.7");
  assert.equal(found.url, "https://github.com/Subterfugus/tokscale-desktop/releases/tag/desktop-v0.4.7");
  assert.equal(h.notes.length, 1);
  assert.equal(h.notes[0].url, found.url);
  await h.next([release("desktop-v0.4.7")]);
  assert.equal(h.notes.length, 1);
  const restart = harness(h.state);
  restart.result = response([release("desktop-v0.4.7")]);
  restart.time = h.time + INTERVAL_MS;
  assert.equal((await restart.monitor.poll()).available, "0.4.7");
  assert.equal(restart.notes.length, 0);
  await h.next([release("desktop-v0.5.0"), release("desktop-v0.4.7")]);
  assert.equal(h.notes.length, 2);
});

test("failures keep the last known release and never notify", async () => {
  const h = harness({ latest: "0.4.7", notified: "0.4.7" });
  for (const options of [{ status: 500 }, { content: '{"message":"no"}' }, { headers: { "content-length": "2000000" } }]) {
    const result = await h.next([release("desktop-v0.9.0")], options);
    assert.equal(result.available, "0.4.7");
    assert.ok(result.error);
  }
  const limited = await h.next([], { status: 403 });
  assert.match(limited.error, /limited/);
  const calls = h.calls.length;
  h.time += 1000;
  await h.monitor.poll();
  assert.equal(h.calls.length, calls);
  const offline = harness({}, { fetchImpl: async () => { throw new Error("Network failed"); } });
  assert.match((await offline.monitor.poll()).error, /Couldn't check GitHub/);
  assert.equal(h.notes.length, 0);
});

test("start schedules the next check and stop drops a late response", async () => {
  let finish;
  const h = harness({}, { fetchImpl: () => new Promise(resolve => { finish = resolve; }) });
  h.monitor.start();
  const task = h.monitor.poll();
  await new Promise(resolve => setImmediate(resolve));
  h.monitor.stop();
  finish(response([release("desktop-v0.4.7")]));
  await task;
  assert.equal(h.notes.length, 0);
  assert.equal(h.timers.length, 0);
  const normal = harness();
  normal.monitor.start();
  await normal.monitor.poll();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(normal.timers[0].ms, INTERVAL_MS);
  normal.monitor.stop();
  assert.equal(normal.timers[0].cancelled, true);
});

test("a release's portable build is installable only with a published size and hash", async () => {
  const digest = "sha256:" + "ab".repeat(32);
  const asset = (extra = {}) => ({ name: "Tokscale-Desktop-0.4.7-x64.exe", size: 1000, digest, ...extra });
  const h = harness();
  assert.deepEqual((await h.next([release("desktop-v0.4.7", { assets: [asset({ name: "other.exe" }), asset()] })])).asset, { size: 1000, sha256: "ab".repeat(32) });
  assert.deepEqual(harness(h.state).monitor.snapshot().asset, null, "nothing is offered before the saved state loads");
  for (const assets of [[], [asset({ digest: null })], [asset({ digest: "sha256:xyz" })], [asset({ size: 0 })], [asset({ name: "Tokscale-Desktop-0.4.8-x64.exe" })]])
    assert.equal((await h.next([release("desktop-v0.4.7", { assets })])).asset, null);
  assert.equal((await h.next([release("desktop-v0.4.6", { assets: [asset()] })])).asset, null);
});

test("saved state rejects anything that is not a plain version", () => {
  assert.deepEqual(validateState({ latest: "0.4.7/../x", notified: "1.2", checkedAt: -1, retryAt: "soon", size: -5, sha256: "../x" }),
    { latest: null, notified: null, checkedAt: null, retryAt: null, size: null, sha256: null });
  assert.throws(() => createAppUpdate({ current: "dev", store: {} }), /version/);
});
