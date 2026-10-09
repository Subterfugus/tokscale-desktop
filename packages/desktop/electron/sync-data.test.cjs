const { test } = require("node:test");
const assert = require("node:assert/strict");
const data = require("./sync-data.cjs");

const row = (client, modelId, input, cost, messages = 1, providerId = "anthropic") => ({
  client,
  modelId,
  providerId,
  tokens: { input, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
  cost,
  messages,
});
const day = (date, clients, extra = {}) => ({
  date,
  totals: {
    tokens: clients.reduce((sum, r) => sum + r.tokens.input, 0),
    cost: clients.reduce((sum, r) => sum + r.cost, 0),
    messages: clients.reduce((sum, r) => sum + r.messages, 0),
  },
  intensity: 4,
  tokenBreakdown: {
    input: clients.reduce((sum, r) => sum + r.tokens.input, 0),
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    reasoning: 0,
  },
  clients,
  ...extra,
});
const graphOf = (contributions) => ({
  meta: { version: "4.17.0", dateRange: { start: contributions[0]?.date, end: contributions.at(-1)?.date } },
  summary: {},
  years: [],
  contributions,
  timeMetrics: { totalActiveTimeMs: 1000, sessionCount: 2 },
});

test("a snapshot keeps only well-formed days and rows", () => {
  const days = data.snapshotDays(
    graphOf([
      day("2026-10-01", [row("claude", "opus", 100, 1.5)]),
      day("not-a-date", [row("claude", "opus", 5, 1)]),
      { date: "2026-10-02", clients: [{ client: "", modelId: "x" }, row("codex", "gpt", 7, 0.25, 2, "openai")] },
      day("2026-10-03", []),
    ]),
  );
  assert.deepEqual(Object.keys(days), ["2026-10-01", "2026-10-02"]);
  assert.deepEqual(days["2026-10-02"], [row("codex", "gpt", 7, 0.25, 2, "openai")]);
  assert.deepEqual(data.cleanDays({ "2026-10-01": [{ ...row("claude", "opus", -4, NaN), messages: "3" }] }), {
    "2026-10-01": [{ ...row("claude", "opus", 0, 0), messages: 3 }],
  });
  assert.deepEqual(data.cleanDays(null), {});
  assert.deepEqual(data.cleanDays([1]), {});
});

test("usage a client has since deleted is kept from the earlier upload, per client and day", () => {
  const local = {
    "2026-10-02": [row("codex", "gpt", 9, 1)],
    "2026-10-03": [row("claude", "opus", 20, 2)],
  };
  const uploaded = {
    "2026-09-01": [row("claude", "opus", 50, 5)],
    "2026-10-02": [row("claude", "opus", 10, 1), row("codex", "gpt", 4, 0.5)],
    "2026-10-03": [row("claude", "opus", 99, 9)],
  };
  const archived = data.archivedDays(local, uploaded);
  // The local scan wins wherever it still has that client's day.
  assert.deepEqual(archived, {
    "2026-09-01": [row("claude", "opus", 50, 5)],
    "2026-10-02": [row("claude", "opus", 10, 1)],
  });
  const joined = data.joinDays(local, archived);
  assert.deepEqual(Object.keys(joined), ["2026-09-01", "2026-10-02", "2026-10-03"]);
  assert.equal(joined["2026-10-02"].length, 2);
  // Re-running against its own output changes nothing.
  assert.deepEqual(data.archivedDays(local, joined), archived);
});

test("report filters follow the engine's date flags on local calendar dates", () => {
  const now = new Date(2026, 9, 9, 23, 30);
  const f = (...args) => data.reportFilter(args, now);
  assert.deepEqual(f("--today"), { since: "2026-10-09", until: "2026-10-09", client: "", local: true });
  assert.deepEqual(f("--yesterday").since, "2026-10-08");
  assert.deepEqual([f("--week").since, f("--week").until], ["2026-10-03", "2026-10-09"]);
  assert.deepEqual([f("--month").since, f("--month").until], ["2026-10-01", "2026-10-09"]);
  assert.deepEqual([f("--year", "2025").since, f("--year", "2025").until], ["2025-01-01", "2025-12-31"]);
  assert.deepEqual(f("--since", "2026-01-05", "--client", "codex"), {
    since: "2026-01-05", until: "", client: "codex", local: true,
  });
  assert.equal(f().since, "");
  assert.equal(f("--home", "D:/other").local, false);
  // The first day of a month, and a week that crosses a month boundary.
  const first = new Date(2026, 2, 1, 0, 5);
  assert.equal(data.reportFilter(["--yesterday"], first).since, "2026-02-28");
  assert.equal(data.reportFilter(["--week"], first).since, "2026-02-23");

  const days = {
    "2026-10-02": [row("codex", "gpt", 1, 1)],
    "2026-10-09": [row("codex", "gpt", 2, 1), row("claude", "opus", 3, 1)],
  };
  assert.deepEqual(data.filterDays(days, f("--today", "--client", "claude")), {
    "2026-10-09": [row("claude", "opus", 3, 1)],
  });
  assert.deepEqual(Object.keys(data.filterDays(days, f("--until", "2026-10-02"))), ["2026-10-02"]);
  assert.deepEqual(data.filterDays(days, f("--client", "gemini")), {});
});

test("merging a graph recomputes days, totals and summary and leaves the input alone", () => {
  const graph = graphOf([
    day("2026-10-01", [row("claude", "opus", 100, 4)], { activeTimeMs: 500 }),
    day("2026-10-03", [row("claude", "opus", 10, 1)]),
  ]);
  const before = JSON.stringify(graph);
  const merged = data.mergeGraph(graph, {
    "2026-10-01": [row("claude", "opus", 50, 2, 3), row("codex", "gpt", 5, 0.5, 1, "openai")],
    "2026-10-02": [row("codex", "gpt", 8, 0.25, 1, "openai")],
    "2025-12-31": [row("codex", "gpt", 1, 6, 1, "openai")],
  });
  assert.equal(JSON.stringify(graph), before);
  assert.deepEqual(merged.contributions.map((d) => d.date), ["2025-12-31", "2026-10-01", "2026-10-02", "2026-10-03"]);
  const first = merged.contributions[1];
  // The same client and model on two computers becomes one row.
  assert.deepEqual(first.clients, [row("claude", "opus", 150, 6, 4), row("codex", "gpt", 5, 0.5, 1, "openai")]);
  assert.deepEqual(first.totals, { tokens: 155, cost: 6.5, messages: 5 });
  assert.equal(first.tokenBreakdown.input, 155);
  assert.equal(first.activeTimeMs, 500);
  assert.deepEqual(merged.contributions.map((d) => d.intensity), [4, 4, 1, 1]);
  assert.deepEqual(merged.summary, {
    totalTokens: 174,
    totalCost: 13.75,
    totalDays: 4,
    activeDays: 4,
    averagePerDay: 13.75 / 4,
    maxCostInSingleDay: 6.5,
    clients: ["claude", "codex"],
    models: ["gpt", "opus"],
  });
  assert.deepEqual(merged.years, [
    { year: "2025", totalTokens: 1, totalCost: 6, range: { start: "2025-12-31", end: "2025-12-31" } },
    { year: "2026", totalTokens: 173, totalCost: 7.75, range: { start: "2026-10-01", end: "2026-10-03" } },
  ]);
  assert.deepEqual(merged.meta.dateRange, { start: "2025-12-31", end: "2026-10-03" });
  assert.equal(merged.timeMetrics.sessionCount, 2);

  // Another computer on its own: none of this computer's days or timings.
  const other = data.mergeGraph(graph, { "2026-10-02": [row("codex", "gpt", 8, 0.25, 1, "openai")] }, { includeLocal: false });
  assert.deepEqual(other.contributions.map((d) => d.date), ["2026-10-02"]);
  assert.equal(other.summary.totalCost, 0.25);
  assert.equal(other.timeMetrics, undefined);
  const empty = data.mergeGraph(graph, {}, { includeLocal: false });
  assert.deepEqual(empty.contributions, []);
  assert.equal(empty.summary.averagePerDay, 0);
});

const entry = (client, provider, model, input, cost, messageCount, extra = {}) => ({
  client, mergedClients: null, model, provider, input, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0,
  messageCount, cost, performance: { msPer1KTokens: 12 }, ...extra,
});
const modelsReport = (groupBy, entries) => ({
  groupBy,
  entries,
  totalInput: entries.reduce((s, e) => s + e.input, 0),
  totalOutput: 0, totalCacheRead: 0, totalCacheWrite: 0,
  totalMessages: entries.reduce((s, e) => s + e.messageCount, 0),
  totalCost: entries.reduce((s, e) => s + e.cost, 0),
  processingTimeMs: 3,
});

test("merging a models report follows each grouping the snapshot can answer", () => {
  const extra = {
    "2026-10-01": [row("claude", "opus", 50, 2, 3), row("codex", "opus", 5, 9, 1, "openrouter")],
    "2026-10-02": [row("claude", "opus", 1, 1, 1), row("gemini", "flash", 7, 0.5, 2, "google")],
  };
  const full = data.mergeModels(
    modelsReport("client,provider,model", [entry("claude", "anthropic", "opus", 100, 4, 10)]),
    extra,
  );
  assert.deepEqual(
    full.entries.map((e) => [e.client, e.provider, e.model, e.input, e.cost, e.messageCount]),
    [
      ["codex", "openrouter", "opus", 5, 9, 1],
      ["claude", "anthropic", "opus", 151, 7, 14],
      ["gemini", "google", "flash", 7, 0.5, 2],
    ],
  );
  assert.equal(full.entries[1].performance.msPer1KTokens, 12);
  assert.equal(full.entries[0].performance, null);
  assert.deepEqual(
    [full.totalInput, full.totalMessages, full.totalCost, full.processingTimeMs],
    [163, 17, 16.5, 3],
  );

  const byModel = data.mergeModels(
    modelsReport("model", [entry("claude", "anthropic", "opus", 100, 4, 10, { mergedClients: "claude" })]),
    extra,
  );
  assert.deepEqual(byModel.entries.map((e) => [e.model, e.input, e.mergedClients]), [
    ["opus", 156, "claude, codex"],
    ["flash", 7, "gemini"],
  ]);

  const byClient = data.mergeModels(modelsReport("client,model", [entry("claude", "anthropic", "opus", 100, 4, 10)]), extra);
  assert.equal(byClient.entries.length, 3);

  const other = data.mergeModels(modelsReport("client,model", [entry("claude", "anthropic", "opus", 100, 4, 10)]), extra, { includeLocal: false });
  assert.equal(other.totalInput, 63);
  assert.equal(other.entries.every((e) => e.performance === null), true);
});

test("monthly reports gain other computers' months and models", () => {
  const report = {
    entries: [{ month: "2026-10", models: ["opus"], input: 10, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, messageCount: 2, cost: 1 }],
    totalCost: 1,
  };
  const merged = data.mergeMonthly(report, {
    "2026-09-30": [row("codex", "gpt", 4, 2)],
    "2026-10-01": [row("codex", "gpt", 6, 3), row("claude", "opus", 1, 1)],
  });
  assert.deepEqual(merged.entries.map((e) => [e.month, e.models, e.input, e.messageCount, e.cost]), [
    ["2026-09", ["gpt"], 4, 1, 2],
    ["2026-10", ["opus", "gpt"], 17, 4, 5],
  ]);
  assert.equal(merged.totalCost, 7);
  assert.deepEqual(report.entries[0].models, ["opus"]);
});

test("only reports a daily snapshot can answer are combined", () => {
  const kind = (...args) => data.reportKind(args);
  assert.equal(kind("--no-spinner", "models", "--json", "--today"), "models");
  assert.equal(kind("models", "--json", "--group-by", "model"), "models");
  assert.equal(kind("models", "--json", "--group-by", "client,provider,model", "--client", "codex"), "models");
  assert.equal(kind("models", "--json", "--group-by", "workspace,model"), "local");
  assert.equal(kind("models", "--json", "--group-by", "client,session,model"), "local");
  assert.equal(kind("hourly", "--json"), "local");
  assert.equal(kind("monthly", "--json"), "monthly");
  assert.equal(kind("models"), null);
  assert.equal(kind("usage", "--json"), null);
  assert.equal(kind("clients", "--json"), null);
  assert.equal(kind("--version"), null);
  assert.deepEqual(
    data.emptyReport({ groupBy: "workspace,model", entries: [1], totalInput: 5, totalCost: 2.5, processingTimeMs: 9 }),
    { groupBy: "workspace,model", entries: [], totalInput: 0, totalCost: 0, processingTimeMs: 9 },
  );
});
