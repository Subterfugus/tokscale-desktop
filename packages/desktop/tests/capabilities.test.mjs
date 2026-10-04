import { test } from "node:test";
import assert from "node:assert/strict";
import {
  tokenTotal,
  modelTokenTotal,
  graphAverageTokens,
  periodTokenCoverage,
} from "../renderer/report-data.js";

// Captured from original Tokscale 4.17.0 scanning generated Codex/Claude
// JSONL, not from the desktop implementation. No account or personal data.
const models = {
  groupBy: "client,model",
  entries: [
    {
      client: "codex",
      model: "gpt-5.5",
      input: 804000,
      output: 116000,
      cacheRead: 364000,
      cacheWrite: 0,
      reasoning: 68000,
    },
    {
      client: "claude",
      model: "claude-opus-4-6",
      input: 750000,
      output: 99000,
      cacheRead: 512000,
      cacheWrite: 126000,
      reasoning: 0,
    },
    {
      client: "claude",
      model: "claude-sonnet-4-6",
      input: 750000,
      output: 99000,
      cacheRead: 512000,
      cacheWrite: 126000,
      reasoning: 0,
    },
    {
      client: "codex",
      model: "gpt-5.4",
      input: 620000,
      output: 88000,
      cacheRead: 364000,
      cacheWrite: 0,
      reasoning: 48000,
    },
  ],
  totalInput: 2924000,
  totalOutput: 402000,
  totalCacheRead: 1752000,
  totalCacheWrite: 252000,
  totalMessages: 160,
  totalCost: 25.032600000000002,
};
const graph = {
  summary: {
    totalTokens: 5446000,
    totalCost: 25.032600000000002,
    totalDays: 10,
    activeDays: 10,
    averagePerDay: 2.50326,
  },
};

test("model token total reconciles to original graph including Codex reasoning", () => {
  assert.equal(modelTokenTotal(models), 5446000);
  assert.equal(modelTokenTotal(models), graph.summary.totalTokens);
  assert.equal(tokenTotal(models.entries[0]), 1352000);
  assert.equal(tokenTotal(models.entries[1]), 1487000);
});

test("calendar-day token average is not Tokscale USD/day average", () => {
  assert.equal(graphAverageTokens(graph), 544600);
  assert.notEqual(graphAverageTokens(graph), graph.summary.averagePerDay);
  assert.equal(
    graphAverageTokens({ summary: { totalTokens: 0, totalDays: 0 } }),
    null,
  );
  assert.equal(graphAverageTokens(null), null);
});

test("hourly absent reasoning is represented as a partial report", () => {
  const hourly = { input: 100, output: 20, cacheRead: 40, cacheWrite: 5 };
  assert.equal(tokenTotal(hourly), 165);
  assert.equal(periodTokenCoverage("hourly"), "excludes-reasoning");
  assert.equal(periodTokenCoverage("daily"), "all-reported-buckets");
  assert.equal(modelTokenTotal(null), null);
});
