const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createUpstreamMonitor, validateState, ENDPOINT, INTERVAL_MS } = require("./upstream-monitor.cjs");
const A = "a".repeat(40), B = "b".repeat(40), C = "c".repeat(40);
const response = (commit = A, options = {}) => ({
  ok: options.status === undefined || options.status === 200,
  status: options.status || 200,
  headers: new Headers({ etag: '"head"', ...options.headers }),
  text: async () => options.content || JSON.stringify([{ sha: commit, html_url: "https://untrusted.invalid", commit: { message: "New feature\nUntrusted body" } }]),
});
function harness(initial = {}, overrides = {}) {
  const h = { time: 100000, state: initial, notes: [], calls: [], timers: [], result: response(), failSave: false };
  h.store = {
    load: async () => ({ values: h.state }),
    save: async values => { if (h.failSave) throw new Error("Disk failure"); h.state = structuredClone(values); return h.state; },
  };
  h.monitor = createUpstreamMonitor({
    store: h.store, now: () => h.time, notify: n => h.notes.push(n),
    fetchImpl: async (...args) => { h.calls.push(args); return h.result; },
    setTimer: (callback, ms) => { const timer = { callback, ms }; h.timers.push(timer); return timer; },
    clearTimer: timer => { if (timer) timer.cancelled = true; },
    ...overrides,
  });
  h.next = async (commit, options) => { h.time += INTERVAL_MS; h.result = response(commit, options); return h.monitor.poll(); };
  return h;
}

test("first check silently saves a baseline using only the fixed public endpoint", async () => {
  const h = harness();
  const status = await h.monitor.poll();
  assert.equal(status.sha, A);
  assert.equal(status.checking, false);
  assert.equal(status.checkedAt, h.time);
  assert.equal(h.notes.length, 0);
  assert.equal(h.calls[0][0], ENDPOINT);
  assert.equal(h.calls[0][1].redirect, "error");
  assert.equal(h.calls[0][1].headers.Authorization, undefined);
  assert.equal(status.url, `https://github.com/junhoyeo/tokscale/commit/${A}`);
});

test("new default-branch head notifies once with a safe comparison link and no repeated alert after restart", async () => {
  const h = harness();
  await h.monitor.poll();
  await h.next(B);
  assert.equal(h.notes.length, 1);
  assert.equal(h.notes[0].body, "New feature");
  assert.equal(h.notes[0].url, `https://github.com/junhoyeo/tokscale/compare/${A}...${B}`);
  await h.next(B);
  assert.equal(h.notes.length, 1);
  const restart = harness(h.state);
  restart.time = h.time + INTERVAL_MS;
  restart.result = response(B);
  await restart.monitor.poll();
  assert.equal(restart.notes.length, 0);
  await h.next(C);
  assert.equal(h.notes.length, 2);
});

test("conditional 304 updates the check time while retaining commit and comparison details", async () => {
  const h = harness();
  await h.monitor.poll();
  await h.next(B);
  const result = await h.next(B, { status: 304 });
  assert.equal(h.calls.at(-1)[1].headers["If-None-Match"], '"head"');
  assert.equal(result.sha, B);
  assert.equal(result.previousSha, A);
  assert.equal(result.checkedAt, h.time);
  assert.equal(h.notes.length, 1);
});

test("simultaneous and repeated immediate checks share a request and preserve the minimum interval", async () => {
  let release;
  const h = harness({}, { fetchImpl: () => new Promise(resolve => { release = resolve; }) });
  const one = h.monitor.poll(), two = h.monitor.poll();
  assert.equal(one, two);
  await new Promise(resolve => setImmediate(resolve));
  release(response());
  await one;
  assert.equal((await h.monitor.poll()).sha, A);
});

test("GitHub rate limits persist a retry deadline and suppress requests across a restart", async () => {
  const h = harness();
  h.result = response(A, { status: 429, headers: { "retry-after": "7200" } });
  const result = await h.monitor.poll();
  assert.match(result.error, /limited/);
  assert.equal(result.retryAt, h.time + 7200000);
  await h.monitor.poll();
  assert.equal(h.calls.length, 1);
  const restart = harness(h.state);
  await restart.monitor.poll();
  assert.equal(restart.calls.length, 0);
  h.time = result.retryAt + 1;
  h.result = response();
  assert.equal((await h.monitor.poll()).error, null);
});

test("invalid, failed and oversized responses retain the baseline and never notify", async () => {
  const h = harness({ sha: A });
  for (const options of [
    { status: 500 },
    { content: '[{"sha":"invalid"}]' },
    { headers: { "content-length": "2000000" } },
  ]) {
    const result = await h.next(B, options);
    assert.equal(result.sha, A);
    assert.ok(result.error);
    assert.equal(h.notes.length, 0);
  }
});

test("an offline check reports failure without changing the saved head", async () => {
  const h = harness({ sha: A }, { fetchImpl: async () => { throw new Error("Network failed"); } });
  const result = await h.monitor.poll();
  assert.equal(result.sha, A);
  assert.match(result.error, /Couldn't check GitHub/);
  assert.equal(h.notes.length, 0);
});

test("persistence must succeed before an update can be announced", async () => {
  const h = harness({ sha: A });
  h.failSave = true;
  const result = await h.next(B);
  assert.equal(result.sha, A);
  assert.equal(h.notes.length, 0);
  h.failSave = false;
  await h.next(B);
  assert.equal(h.notes.length, 1);
});

test("start polls and schedules hourly; stop aborts a late response without saving or notifying", async () => {
  let release, signal;
  const h = harness({ sha: A }, { fetchImpl: (_url, options) => { signal = options.signal; return new Promise(resolve => { release = resolve; }); } });
  h.monitor.start();
  const task = h.monitor.poll();
  await new Promise(resolve => setImmediate(resolve));
  h.monitor.stop();
  assert.equal(signal.aborted, true);
  release(response(B));
  await task;
  assert.equal(h.state.sha, A);
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

test("state validation strips control characters and rejects unsafe SHAs, headers and timestamps", () => {
  const state = validateState({ sha: "bad", previousSha: "https://bad", title: "Hello\0there\nignored", etag: "header\r\ninjection", checkedAt: -1 });
  assert.equal(state.sha, null);
  assert.equal(state.previousSha, null);
  assert.equal(state.title, "Hello there");
  assert.equal(state.etag, null);
  assert.equal(state.checkedAt, null);
});
