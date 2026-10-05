"use strict";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const WINDOW_MS = 7 * DAY_MS;
const UNDER_THRESHOLD = 80;
const OVER_THRESHOLD = 100;
const MIN_DAYS = 0.05;

function cleanSamples(samples) {
  return (Array.isArray(samples) ? samples : [])
    .filter(s => Number.isFinite(s?.t) && Number.isFinite(s?.p) && s.p >= 0 && s.p <= 100)
    .slice().sort((a, b) => a.t - b.t);
}

// Straight-line pace over the 7 days before the reset. Days are fractions of
// 24 hours, so a 5am reset counts its last morning as 5/24 of a day.
function calculatePace(source, _samples, now = Date.now()) {
  if (!/weekly|seven[- ]?day|7[- ]?day/i.test(source?.label || "")) return null;
  if (source.resetsAt == null || source.resetsAt === "") return null;
  const reset = new Date(source.resetsAt).getTime();
  if (!Number.isFinite(reset) || reset <= now || !Number.isFinite(source.usedPercent)) return null;
  const used = Math.max(0, source.usedPercent);
  const left = (reset - now) / DAY_MS;
  const elapsed = Math.max(0, 7 - left);
  const expectedPercent = elapsed / 7 * 100;
  const remaining = Math.max(0, 100 - used);
  // With under a day to go the whole remainder is what is left to spend.
  const dailyBudgetPercent = used >= 100 ? 0 : remaining / Math.max(left, 1);
  // Too little of the week has passed to judge a rate from it.
  const early = elapsed < MIN_DAYS && used < UNDER_THRESHOLD;
  const rate = early ? 0 : used / Math.max(elapsed, MIN_DAYS);
  const projectedPercent = used + rate * left;
  const status = projectedPercent >= OVER_THRESHOLD ? "over" : early ? "on-track" : projectedPercent < UNDER_THRESHOLD ? "under" : "on-track";
  let runsOutAt = null;
  if (used >= 100) runsOutAt = now;
  else if (rate > 0 && projectedPercent > 100) runsOutAt = now + remaining / rate * DAY_MS;
  if (runsOutAt >= reset) runsOutAt = null;
  return { status, expectedPercent, projectedPercent, dailyBudgetPercent, daysLeft: left, runsOutAt };
}

module.exports = { calculatePace, UNDER_THRESHOLD, OVER_THRESHOLD, MIN_DAYS, HOUR_MS, DAY_MS, WINDOW_MS, cleanSamples };
