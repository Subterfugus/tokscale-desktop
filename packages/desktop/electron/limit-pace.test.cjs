const { test } = require("node:test");
const assert = require("node:assert/strict");
const { calculatePace, HOUR_MS, DAY_MS } = require("./limit-pace.cjs");

// Fixed 24-hour steps from a base instant, so results don't depend on DST.
const BASE = new Date(2026, 9, 1, 8).getTime();
const at = (day, hour = 8, minute = 0) => BASE + (day - 1) * DAY_MS + (hour - 8) * HOUR_MS + minute * 60000;
const source = (usedPercent, resetsAt = at(8)) => ({ label: "Weekly usage", usedPercent, resetsAt });
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-8, `${actual} != ${expected}`);

test("pace applies only to weekly sources with a future valid reset", () => {
  for (const label of ["5-hour usage", "Pro", "Daily"]) assert.equal(calculatePace({ ...source(40), label }, at(4)), null);
  for (const resetsAt of [null, "", "bad", at(3), at(4)]) assert.equal(calculatePace(source(40, resetsAt), at(4)), null);
  for (const label of ["Weekly", "seven-day", "seven day", "7-day", "7day"]) assert.ok(calculatePace({ ...source(40), label }, at(4)));
});

test("expected usage and projection are straight lines over the week", () => {
  const pace = calculatePace(source(30), at(4));
  near(pace.expectedPercent, 300 / 7);
  near(pace.projectedPercent, 70);
  near(pace.daysLeft, 4);
  near(pace.dailyBudgetPercent, 70 / 4);
  near(calculatePace(source(30), at(4, 20)).expectedPercent, 3.5 / 7 * 100);
});

test("a 5am reset counts its last morning as a fraction of a day", () => {
  const pace = calculatePace(source(40, at(8, 5)), at(5, 5));
  near(pace.daysLeft, 3);
  const evening = calculatePace(source(40, at(8, 5)), at(7, 17));
  near(evening.daysLeft, 0.5);
  // Under a day left: the budget is the remainder, not a rate above it.
  near(evening.dailyBudgetPercent, 60);
});

test("status distinguishes under, on-track and over", () => {
  const under = calculatePace(source(20), at(4));
  const track = calculatePace(source(40), at(4));
  const over = calculatePace(source(50), at(4));
  assert.equal(under.status, "under");
  assert.equal(track.status, "on-track");
  assert.equal(over.status, "over");
  assert.equal(under.runsOutAt, null);
  assert.equal(track.runsOutAt, null);
  near(over.runsOutAt, at(7));
  assert.equal(calculatePace(source(300 / 7), at(4)).runsOutAt, null);
});

test("the first hour of the week makes no projection unless usage is already high", () => {
  const early = calculatePace(source(10), at(1, 8, 1));
  assert.equal(early.status, "on-track");
  near(early.projectedPercent, 10);
  assert.ok(Number.isFinite(early.dailyBudgetPercent));
  assert.equal(calculatePace(source(95), at(1, 8, 1)).status, "over");
});

test("already exhausted usage has no daily budget and runs out now", () => {
  const pace = calculatePace(source(100), at(4));
  assert.equal(pace.status, "over");
  assert.equal(pace.dailyBudgetPercent, 0);
  assert.equal(pace.runsOutAt, at(4));
});
