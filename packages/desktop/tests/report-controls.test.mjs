import { test } from "node:test";
import assert from "node:assert/strict";
import { validateDateFilter, filterTableRows, tokenTotal, reportRangeLabel, graphAverageTokens, calendarContributionCells, reportCacheKey } from "../renderer/report-data.js";

test("relative reports cannot reuse another day's successful totals after a failed refresh", () => {
  const before = new Date(2026, 9, 30, 23, 59);
  const after = new Date(2026, 10, 4, 16, 33);
  for (const period of ["--today", "--yesterday", "--week", "--month"]) {
    for (const graph of [true, false]) {
      const args = ["--no-spinner", ...(graph ? [] : ["models", "--json"]), period];
      const cached = new Map([[reportCacheKey(graph, args, "all", before), { cost: 55.96 }]]);
      assert.equal(cached.get(reportCacheKey(graph, args, "all", after)), undefined);
      assert.deepEqual(cached.get(reportCacheKey(graph, args, "all", new Date(2026, 9, 30, 23, 59, 59))), { cost: 55.96 });
    }
  }
});

test("relative report caches roll over at local midnight, including DST days", () => {
  const args = ["--today"];
  const key = date => reportCacheKey(true, args, "all", date);
  assert.notEqual(key(new Date(2026, 9, 31, 23, 59)), key(new Date(2026, 10, 1, 0, 1)));
  assert.equal(key(new Date(2026, 10, 1, 0, 1)), key(new Date(2026, 10, 1, 23, 59)));
});

test("fixed date and all-time caches remain reusable without mixing computers or report kinds", () => {
  const before = new Date(2026, 9, 30), after = new Date(2026, 10, 4);
  for (const args of [[], ["--since", "2026-10-30", "--until", "2026-10-30"], ["--year", "2026"]]) {
    assert.equal(reportCacheKey(true, args, "all", before), reportCacheKey(true, args, "all", after));
    assert.notEqual(reportCacheKey(true, args, "all", after), reportCacheKey(true, args, "desktop", after));
    assert.notEqual(reportCacheKey(true, args, "all", after), reportCacheKey(false, args, "all", after));
  }
});

test("custom date validation rejects reversed, impossible and partial dates without crashing", () => {
  for (const range of [
    { since: "2026-10-04", until: "2026-10-03" },
    { since: "2026-02-30" },
    { since: "2026-99-04" },
    { since: "2026-10" },
    {},
  ]) assert.ok(validateDateFilter({ period: "custom", ...range }));
  assert.equal(validateDateFilter({ period: "custom", since: "2024-02-29" }), "");
  assert.equal(validateDateFilter({ period: "custom", until: "2026-10-04" }), "");
  assert.equal(validateDateFilter({ period: "custom", since: "2026-10-04", until: "2026-10-04" }), "");
  assert.ok(validateDateFilter({ period: "year", year: "202" }));
  assert.ok(validateDateFilter({ period: "year", year: "2026.5" }));
  assert.equal(validateDateFilter({ period: "year", year: "2026" }), "");
});

test("performance and computed token sorts use the reported values, with missing timings last", () => {
  const rows = [
    { model: "Slow", input: 1, performance: { msPer1KTokens: 120 } },
    { model: "Missing", input: 20 },
    { model: "Fast", input: 2, cacheRead: 40, performance: { msPer1KTokens: 4 } },
  ];
  const columns = [
    { key: "performance", numeric: true, sortValue: (row) => row.performance?.msPer1KTokens },
    { key: "tokens", numeric: true, sortValue: tokenTotal },
  ];
  assert.deepEqual(filterTableRows(rows, columns, "", "performance", 1).map((row) => row.model), ["Fast", "Slow", "Missing"]);
  assert.deepEqual(filterTableRows(rows, columns, "", "performance", -1).map((row) => row.model), ["Slow", "Fast", "Missing"]);
  assert.deepEqual(filterTableRows(rows, columns, "", "tokens", -1).map((row) => row.model), ["Fast", "Missing", "Slow"]);
  assert.deepEqual(rows.map((row) => row.model), ["Slow", "Missing", "Fast"]);
});

test("table search includes nested session metadata and trims whitespace", () => {
  const row = { sessionId: "123", mergedClients: ["codex", "claude"], sessionTitle: "Renamed project" };
  assert.deepEqual(filterTableRows([row], [], " claude ", "sessionId", 1), [row]);
  assert.deepEqual(filterTableRows([row], [], "renamed project", "sessionId", 1), [row]);
});

test("week and month labels expose calendar boundaries across months and years", () => {
  const now = new Date(2026, 0, 3, 23, 30);
  const week = reportRangeLabel({ period: "week" }, now);
  assert.match(week, /Dec 28, 2025/);
  assert.match(week, /Jan 3, 2026/);
  assert.match(reportRangeLabel({ period: "month" }, now), /Jan 1, 2026.*Jan 3, 2026/);
  assert.match(reportRangeLabel({ period: "yesterday" }, now), /Jan 2, 2026/);
  assert.equal(reportRangeLabel({ period: "all" }, now), "All recorded history");
});

test("calendar contribution cells preserve missing days and Sunday weekday alignment", () => {
  const contributions = [
    { date: "2026-10-04", totals: { tokens: 300 } },
    { date: "2026-10-01", totals: { tokens: 100 } },
  ];
  const cells = calendarContributionCells(contributions);
  assert.equal(cells.length, 14);
  assert.deepEqual(cells.slice(0, 4), [null, null, null, null]);
  assert.equal(cells[4].date, "2026-10-01"); // Thursday
  assert.equal(cells[5].date, "2026-10-02");
  assert.equal(cells[5].contribution, null);
  assert.equal(cells[6].date, "2026-10-03");
  assert.equal(cells[7].date, "2026-10-04"); // Sunday of next column
  assert.equal(cells[7].contribution.totals.tokens, 300);
  assert.equal(contributions[0].date, "2026-10-04");
  assert.deepEqual(calendarContributionCells([]), []);
});

test("daily token average includes calendar gaps and stays stable across DST", () => {
  assert.equal(graphAverageTokens({
    summary: { totalTokens: 400, totalDays: 2 },
    contributions: [{ date: "2026-10-01" }, { date: "2026-10-04" }],
  }), 100);
  assert.equal(graphAverageTokens({
    summary: { totalTokens: 600, totalDays: 2 },
    contributions: [{ date: "2026-10-31" }, { date: "2026-11-02" }],
  }), 200);
});
