const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createLimitMonitor, formatStatus, tooltip } = require("./limit-monitor.cjs");

const settle = () => new Promise((resolve) => setImmediate(resolve));

function src(percent, extra = {}) {
  return {
    id: "claude:5-hour usage",
    provider: "Claude",
    label: "5-hour usage",
    usedPercent: percent,
    resetsAt: null,
    ...extra,
  };
}

function harness(overrides = {}) {
  const h = {
    value: [src(10)],
    fail: null,
    calls: 0,
    notes: [],
    statuses: [],
    enabled: true,
    time: 1000,
    timers: [],
  };
  const monitor = createLimitMonitor({
    getSources: async () => {
      h.calls++;
      if (h.fail) throw h.fail;
      return h.value;
    },
    notify: (n) => h.notes.push(n),
    onStatus: (s) => h.statuses.push(s),
    isEnabled: () => h.enabled,
    setTimer: (fn, ms) => {
      const t = { fn, ms, cancelled: false, fired: false };
      h.timers.push(t);
      return t;
    },
    clearTimer: (t) => {
      t.cancelled = true;
    },
    now: () => h.time,
    ...overrides,
  });
  h.monitor = monitor;
  h.pending = () => h.timers.filter((t) => !t.cancelled && !t.fired);
  h.fire = async () => {
    const t = h.pending()[0];
    assert.ok(t, "expected a pending timer");
    t.fired = true;
    t.fn();
    await settle();
  };
  h.setPct = async (p, extra) => {
    h.value = [src(p, extra)];
    await monitor.poll();
  };
  return h;
}

test("first poll at 92% notifies once with almost-used-up wording", async () => {
  const h = harness();
  await h.setPct(92, { resetsAt: "2026-10-04T12:00:00Z" });
  assert.equal(h.notes.length, 1);
  assert.equal(h.notes[0].title, "Claude 5-hour usage almost used up (92%)");
  assert.match(h.notes[0].body, /^Resets /);
  assert.equal(h.statuses.length, 1);
});

test("neutral body without a valid reset time", async () => {
  const h = harness();
  await h.setPct(80, { resetsAt: "not a date" });
  assert.equal(h.notes[0].title, "Claude 5-hour usage at 80%");
  assert.doesNotMatch(h.notes[0].body, /^Resets /);
  assert.ok(h.notes[0].body.length > 0);
});

test("jump from 10% straight to 95% notifies once", async () => {
  const h = harness();
  await h.monitor.poll();
  assert.equal(h.notes.length, 0);
  await h.setPct(95);
  assert.equal(h.notes.length, 1);
  assert.match(h.notes[0].title, /almost used up \(95%\)/);
});

test("75 then 90 escalation, no repeats on unchanged polls", async () => {
  const h = harness();
  await h.setPct(76);
  await h.setPct(78);
  assert.equal(h.notes.length, 1);
  assert.equal(h.notes[0].title, "Claude 5-hour usage at 76%");
  await h.setPct(91);
  await h.setPct(91);
  await h.setPct(99);
  assert.equal(h.notes.length, 2);
  assert.match(h.notes[1].title, /almost used up \(91%\)/);
});

test("reset notification below lowest threshold, then re-arms", async () => {
  const h = harness();
  await h.setPct(92);
  await h.setPct(20);
  assert.equal(h.notes.length, 2);
  assert.equal(h.notes[1].title, "Claude 5-hour usage has reset");
  assert.match(h.notes[1].body, /20%/);
  await h.setPct(15);
  assert.equal(h.notes.length, 2, "no second reset notice");
  await h.setPct(77);
  assert.equal(h.notes.length, 3);
  assert.equal(h.notes[2].title, "Claude 5-hour usage at 77%");
});

test("never-warned source dropping does not notify a reset", async () => {
  const h = harness();
  await h.setPct(50);
  await h.setPct(10);
  assert.equal(h.notes.length, 0);
});

test("92 -> 80 -> 92 does not notify or re-warn", async () => {
  const h = harness();
  await h.setPct(92);
  await h.setPct(80);
  await h.setPct(92);
  assert.equal(h.notes.length, 1);
});

test("disappearing source keeps memory and does not notify", async () => {
  const h = harness();
  await h.setPct(92);
  h.value = [];
  await h.monitor.poll();
  assert.equal(h.notes.length, 1);
  assert.deepEqual(h.monitor.snapshot().sources, []);
  await h.setPct(93);
  assert.equal(h.notes.length, 1);
});

test("disabled tracks thresholds without replay when enabled later", async () => {
  const h = harness();
  h.enabled = false;
  await h.setPct(92);
  assert.equal(h.notes.length, 0);
  assert.equal(h.monitor.snapshot().lines[0], "Claude: 5-hour 92%");
  h.enabled = true;
  await h.setPct(92);
  assert.equal(h.notes.length, 0);
  await h.setPct(10);
  assert.equal(h.notes.length, 1, "reset after enabling is announced");
});

test("disabled reset is silent but clears memory", async () => {
  const h = harness();
  await h.setPct(92);
  h.enabled = false;
  await h.setPct(10);
  h.enabled = true;
  await h.setPct(80);
  assert.equal(h.notes.length, 2);
  assert.equal(h.notes[1].title, "Claude 5-hour usage at 80%");
});

test("rejected getSources keeps sources, sets error, then recovers", async () => {
  const h = harness();
  await h.setPct(92);
  h.fail = new Error("rate limited");
  const snap = await h.monitor.poll();
  assert.equal(snap.error, "rate limited");
  assert.equal(snap.sources.length, 1);
  assert.equal(h.notes.length, 1);
  assert.equal(h.statuses.length, 2);
  h.fail = null;
  const ok = await h.monitor.poll();
  assert.equal(ok.error, null);
});

test("non-Error rejection yields a short string", async () => {
  const h = harness();
  h.fail = "x".repeat(500);
  const snap = await h.monitor.poll();
  assert.equal(typeof snap.error, "string");
  assert.ok(snap.error.length <= 120);
});

test("start polls immediately then on schedule, never overlapping", async () => {
  let release;
  let calls = 0;
  const h = harness({
    getSources: () => {
      calls++;
      return new Promise((resolve) => {
        release = () => resolve([src(10)]);
      });
    },
  });
  h.monitor.start();
  h.monitor.start(); // idempotent
  assert.equal(calls, 1);
  await settle();
  assert.equal(h.pending().length, 0, "no timer while poll in flight");
  release();
  await settle();
  assert.equal(h.pending().length, 1);
  assert.equal(h.pending()[0].ms, 300000);
  await h.fire();
  assert.equal(calls, 2);
  release();
  await settle();
  assert.equal(h.pending().length, 1);
});

test("custom interval and failures keep the schedule", async () => {
  const h = harness({ intervalMs: 1234 });
  h.fail = new Error("offline");
  h.monitor.start();
  await settle();
  assert.equal(h.pending()[0].ms, 1234);
  await h.fire();
  assert.equal(h.calls, 2);
  assert.equal(h.pending().length, 1);
});

test("overlapping poll() calls share one promise", async () => {
  const h = harness();
  const a = h.monitor.poll();
  const b = h.monitor.poll();
  assert.equal(a, b);
  await a;
  assert.equal(h.calls, 1);
  const c = h.monitor.poll();
  assert.notEqual(a, c);
  await c;
  assert.equal(h.calls, 2);
});

test("stop cancels the timer", async () => {
  const h = harness();
  h.monitor.start();
  await settle();
  assert.equal(h.pending().length, 1);
  h.monitor.stop();
  assert.equal(h.pending().length, 0);
});

test("stop during an in-flight poll prevents notify, status and reschedule", async () => {
  let release;
  const h = harness({
    getSources: () =>
      new Promise((resolve) => {
        release = () => resolve([src(95)]);
      }),
  });
  h.monitor.start();
  h.monitor.stop();
  release();
  await settle();
  assert.equal(h.notes.length, 0);
  assert.equal(h.statuses.length, 0);
  assert.equal(h.timers.length, 0);
  assert.equal(h.monitor.snapshot().checkedAt, null);
});

test("throwing notify and onStatus never break the monitor", async () => {
  const h = harness({
    notify: () => {
      throw new Error("boom");
    },
    onStatus: () => {
      throw new Error("boom");
    },
  });
  h.value = [src(95)];
  h.monitor.start();
  await settle();
  assert.equal(h.pending().length, 1);
  await h.fire();
  assert.equal(h.calls, 2);
  assert.equal(h.pending().length, 1);
});

test("throwing isEnabled is treated as disabled", async () => {
  const h = harness({
    isEnabled: () => {
      throw new Error("boom");
    },
  });
  await h.setPct(95);
  assert.equal(h.notes.length, 0);
});

test("non-finite percents are ignored; values are clamped", async () => {
  const h = harness();
  h.value = [
    src(NaN, { id: "a", label: "A" }),
    src(Infinity, { id: "b", label: "B" }),
    src("50", { id: "c", label: "C" }),
    src(null, { id: "d", label: "D" }),
    src(150, { id: "e", label: "E" }),
    src(-5, { id: "f", label: "F" }),
  ];
  const snap = await h.monitor.poll();
  assert.deepEqual(
    snap.sources.map((s) => [s.id, s.usedPercent]),
    [["e", 100], ["f", 0]],
  );
  assert.equal(h.notes.length, 1);
  assert.match(h.notes[0].title, /\(100%\)/);
});

test("snapshot shape and checkedAt", async () => {
  const h = harness();
  assert.deepEqual(h.monitor.snapshot(), { sources: [], checkedAt: null, error: null, lines: [] });
  h.time = 4242;
  await h.monitor.poll();
  const snap = h.monitor.snapshot();
  assert.equal(snap.checkedAt, 4242);
  assert.deepEqual(snap.lines, ["Claude: 5-hour 10%"]);
  assert.deepEqual(h.statuses[0], snap);
});

test("partial provider results replace failed provider values and expose the warning", async () => {
  let result = [src(42), src(15, { id: "codex", provider: "Codex" })];
  const h = harness({ getSources: async () => result });
  await h.monitor.poll();
  result = { sources: [src(20, { id: "codex", provider: "Codex" })], error: "Claude could not be refreshed" };
  const snap = await h.monitor.poll();
  assert.equal(snap.sources.length, 1);
  assert.equal(snap.sources[0].provider, "Codex");
  assert.equal(snap.error, "Claude could not be refreshed");
});

test("disconnect invalidation removes values immediately and ignores the old in-flight response", async () => {
  let release;
  let queued = false;
  const h = harness({ getSources: () => queued ? new Promise(resolve => { release = resolve; }) : [src(40), src(20, { id: "codex", provider: "Codex" })] });
  await h.monitor.poll();
  queued = true;
  const old = h.monitor.poll();
  h.monitor.invalidate(source => source.provider !== "Claude");
  assert.deepEqual(h.monitor.snapshot().sources.map(s => s.provider), ["Codex"]);
  assert.equal(h.monitor.snapshot().checkedAt, null);
  release([src(99)]);
  await old;
  assert.deepEqual(h.monitor.snapshot().sources.map(s => s.provider), ["Codex"]);
  assert.equal(h.notes.length, 0);
});

test("invalidating during polling allows a new source scope and retains the background schedule", async () => {
  let release;
  let calls = 0;
  const h = harness({ getSources: () => ++calls === 1 ? new Promise(resolve => { release = resolve; }) : [src(30, { id: "codex", provider: "Codex" })] });
  h.monitor.start();
  h.monitor.invalidate();
  await h.monitor.poll();
  release([src(95)]);
  await settle();
  assert.deepEqual(h.monitor.snapshot().sources.map(s => s.provider), ["Codex"]);
  assert.equal(h.notes.length, 0);
  assert.equal(h.pending().length, 1);
});

test("custom thresholds are honoured", async () => {
  const h = harness({ thresholds: [50] });
  await h.setPct(60);
  assert.equal(h.notes.length, 1);
  assert.equal(h.notes[0].title, "Claude 5-hour usage at 60%");
});

test("formatStatus groups, strips usage, rounds and sorts providers", () => {
  const lines = formatStatus([
    { provider: "Codex", label: "Weekly", usedPercent: 5.4 },
    { provider: "Claude", label: "5-hour usage", usedPercent: 82.4 },
    { provider: "Claude", label: "Weekly usage", usedPercent: 40 },
    { provider: "Antigravity", label: "Pro", usedPercent: 99.6 },
    { provider: "Claude", label: "Bad", usedPercent: NaN },
  ]);
  assert.deepEqual(lines, [
    "Antigravity: Pro 100%",
    "Claude: 5-hour 82%, Weekly 40%",
    "Codex: Weekly 5%",
  ]);
  assert.deepEqual(formatStatus([]), []);
  assert.deepEqual(formatStatus(undefined), []);
});

test("tooltip joins lines and truncates at exactly 127 characters", () => {
  assert.equal(tooltip([], "Tokscale"), "Tokscale");
  assert.equal(tooltip(["a", "b"], "App"), "App\na\nb");
  const exact = "x".repeat(123);
  assert.equal(tooltip([exact], "App").length, 127);
  assert.equal(tooltip([exact], "App"), "App\n" + exact);
  const over = tooltip([exact + "y"], "App");
  assert.equal(over.length, 127);
  assert.ok(over.endsWith("…"));
  assert.equal(over, ("App\n" + exact + "y").slice(0, 126) + "…");
});
