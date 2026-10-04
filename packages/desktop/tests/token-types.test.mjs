import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ALL_TOKEN_TYPES,
  TOKEN_TYPES,
  graphAverageTokens,
  modelTokenTotal,
  normalizeTokenTypes,
  tokenTotal,
  tokenTypesDetail,
} from "../renderer/report-data.js";

const row = { input: 1, output: 20, cacheRead: 300, cacheWrite: 4000, reasoning: 50000 };

test("tokenTotal sums every bucket by default and only the selected ones otherwise", () => {
  assert.equal(tokenTotal(row), 54321);
  assert.equal(tokenTotal(row, ALL_TOKEN_TYPES), 54321);
  assert.equal(tokenTotal(row, ["input", "output"]), 21);
  assert.equal(tokenTotal(row, new Set(["cacheRead", "reasoning"])), 50300);
  assert.equal(tokenTotal({ input: 5 }, ["reasoning"]), 0);
});

test("modelTokenTotal honours the selection, including normalized reasoning", () => {
  const report = {
    totalInput: 10,
    totalOutput: 20,
    totalCacheRead: 30,
    totalCacheWrite: 40,
    entries: [{ reasoning: 5 }, { reasoning: 7 }],
  };
  assert.equal(modelTokenTotal(report), 112);
  assert.equal(modelTokenTotal(report, ["input", "reasoning"]), 22);
  assert.equal(modelTokenTotal(null, ["input"]), null);
});

test("graphAverageTokens uses day breakdowns for a subset and keeps the default", () => {
  const graph = {
    summary: { totalTokens: 1000, totalDays: 2 },
    contributions: [
      { date: "2026-10-01", tokenBreakdown: { input: 100, output: 50, cacheRead: 350 } },
      { date: "2026-10-04", tokenBreakdown: { input: 200, output: 100, cacheRead: 200 } },
    ],
  };
  assert.equal(graphAverageTokens(graph), 250);
  assert.equal(graphAverageTokens(graph, ALL_TOKEN_TYPES), 250);
  assert.equal(graphAverageTokens(graph, ["input", "output"]), 112.5);
  assert.equal(graphAverageTokens(null, ["input"]), null);
});

test("token type helpers normalize and describe selections", () => {
  assert.deepEqual(TOKEN_TYPES.map(([key]) => key), ALL_TOKEN_TYPES);
  assert.deepEqual(normalizeTokenTypes(["reasoning", "input", "bogus"]), ["input", "reasoning"]);
  for (const bad of [undefined, null, "input", [], ["bogus"]])
    assert.deepEqual(normalizeTokenTypes(bad), ALL_TOKEN_TYPES);
  assert.equal(tokenTypesDetail(), "All token types");
  assert.equal(tokenTypesDetail(["input", "output"]), "Input and output");
  assert.equal(tokenTypesDetail(["input", "output", "reasoning"]), "Input, output and reasoning");
  assert.equal(tokenTypesDetail(["cacheRead"]), "Cache read");
});
