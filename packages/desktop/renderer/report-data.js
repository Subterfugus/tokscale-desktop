// Tokscale's public CLI schemas differ from the Rust core schemas. Keep
// aggregates here so the desktop never drops a bucket or changes its unit.
const finite = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

export function tokenTotal(row = {}) {
  return ["input", "output", "cacheRead", "cacheWrite", "reasoning"].reduce(
    (total, key) => total + finite(row?.[key]),
    0,
  );
}

export function modelTokenTotal(report) {
  if (!report) return null;
  // The original model JSON has four top-level token buckets, but no
  // totalReasoning. Reasoning is normalized into its own bucket upstream.
  const reasoning = (report.entries || []).reduce(
    (total, row) => total + finite(row.reasoning),
    0,
  );
  return tokenTotal({
    input: report.totalInput,
    output: report.totalOutput,
    cacheRead: report.totalCacheRead,
    cacheWrite: report.totalCacheWrite,
    reasoning,
  });
}

export function graphAverageTokens(graph) {
  const days = finite(graph?.summary?.totalDays);
  if (!graph?.summary || days <= 0) return null;
  // summary.averagePerDay is USD/day in Tokscale, despite its generic name.
  return finite(graph.summary.totalTokens) / days;
}

export function periodTokenCoverage(mode) {
  return mode === "hourly" ? "excludes-reasoning" : "all-reported-buckets";
}
