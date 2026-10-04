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
  const dates = (graph?.contributions || []).map((day) => day.date).filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)).sort();
  const span = dates.length
    ? (Date.parse(`${dates.at(-1)}T00:00:00Z`) - Date.parse(`${dates[0]}T00:00:00Z`)) / 86400000 + 1
    : null;
  const days = span || finite(graph?.summary?.totalDays);
  if (!graph?.summary || days <= 0) return null;
  // summary.averagePerDay is USD/day in Tokscale, despite its generic name.
  return finite(graph.summary.totalTokens) / days;
}

export function calendarContributionCells(contributions = []) {
  const dates = contributions.filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day.date)).sort((a, b) => a.date.localeCompare(b.date));
  if (!dates.length) return [];
  const byDate = new Map(dates.map((day) => [day.date, day]));
  const start = new Date(`${dates[0].date}T00:00:00Z`);
  const end = new Date(`${dates.at(-1).date}T00:00:00Z`);
  const cells = Array.from({ length: start.getUTCDay() }, () => null);
  for (let date = start; date <= end; date = new Date(date.getTime() + 86400000)) {
    const key = date.toISOString().slice(0, 10);
    cells.push({ date: key, contribution: byDate.get(key) || null });
  }
  while (cells.length % 7) cells.push(null);
  return cells;
}

export function periodTokenCoverage(mode) {
  return mode === "hourly" ? "excludes-reasoning" : "all-reported-buckets";
}

export function validateDateFilter({ period, since = "", until = "", year = "" }) {
  if (period === "year" && !/^(20\d{2}|2100)$/.test(String(year)))
    return "Enter a complete year between 2000 and 2100.";
  if (period === "custom") {
    if (!since && !until) return "Choose a start date or an end date.";
    const valid = (date) => {
      if (!date) return true;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
      const parsed = new Date(`${date}T00:00:00Z`);
      return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
    };
    if (!valid(since) || !valid(until)) return "Enter a valid calendar date.";
    if (since && until && since > until) return "The end date must be on or after the start date.";
  }
  return "";
}

export function reportRangeLabel({ period, since = "", until = "", year = "" }, now = new Date()) {
  const label = (date) => {
    const parsed = typeof date === "string" ? new Date(`${date}T12:00:00`) : date;
    return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  };
  if (period === "all") return "All recorded history";
  if (period === "year") return `Calendar year ${year}`;
  if (period === "custom") return `${since ? label(since) : "Beginning of history"} → ${until ? label(until) : "Latest activity"}`;
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start = new Date(end);
  if (period === "yesterday") { end.setDate(end.getDate() - 1); start.setDate(start.getDate() - 1); }
  if (period === "week") start.setDate(start.getDate() - 6);
  if (period === "month") start.setDate(1);
  return `${label(start)}${start.getTime() === end.getTime() ? "" : ` → ${label(end)}`} · local calendar dates`;
}

export function filterTableRows(rows, columns, search, sort, direction) {
  const query = search.trim().toLowerCase();
  const column = columns.find((entry) => entry.key === sort);
  const value = column?.sortValue || ((row) => row[sort]);
  return rows.filter((row) => !query || JSON.stringify(row).toLowerCase().includes(query)).sort((a, b) => {
    const av = value(a), bv = value(b);
    // Missing timings/fields belong at the end in either direction.
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    return (column?.numeric || typeof av === "number"
      ? finite(av) - finite(bv)
      : String(av).localeCompare(String(bv), undefined, { numeric: true })) * direction;
  });
}
