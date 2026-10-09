// Pure helpers for cross-computer sync: turning the engine's graph into a
// per-day snapshot, and folding other computers' snapshots back into the
// engine's report shapes. Nothing here touches the network or the disk.
const TOKEN_FIELDS = ["input", "output", "cacheRead", "cacheWrite", "reasoning"];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
// The report groupings a daily snapshot can answer. Workspace and session
// groupings need data that never leaves the computer it was recorded on.
const MODEL_GROUPS = ["model", "client,model", "client,provider,model"];

const finite = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};
const text = (value, fallback) =>
  typeof value === "string" && value && value.length <= 200 ? value : fallback;

function cleanRow(row) {
  const client = text(row?.client, ""),
    modelId = text(row?.modelId, "");
  if (!client || !modelId) return null;
  const tokens = {};
  for (const field of TOKEN_FIELDS) tokens[field] = finite(row.tokens?.[field]);
  return {
    client,
    modelId,
    providerId: text(row.providerId, "unknown"),
    tokens,
    cost: finite(row.cost),
    messages: finite(row.messages),
  };
}

// Accepts anything shaped like { date: rows[] } and keeps only valid rows.
function cleanDays(days) {
  const result = {};
  if (!days || typeof days !== "object" || Array.isArray(days)) return result;
  for (const date of Object.keys(days).sort()) {
    if (!DATE.test(date) || !Array.isArray(days[date])) continue;
    const rows = days[date].map(cleanRow).filter(Boolean);
    if (rows.length) result[date] = rows;
  }
  return result;
}

// This computer's snapshot, from the engine's unfiltered graph.
function snapshotDays(graph) {
  const days = {};
  for (const day of graph?.contributions || []) days[day.date] = day.clients;
  return cleanDays(days);
}

// Clients delete old transcripts, and the engine can only report what is still
// on disk. A client's day that this computer uploaded earlier and can no longer
// see locally is kept from the earlier upload.
function archivedDays(local, uploaded) {
  const result = {};
  for (const [date, rows] of Object.entries(uploaded || {})) {
    const present = new Set((local?.[date] || []).map((row) => row.client));
    const kept = rows.filter((row) => !present.has(row.client));
    if (kept.length) result[date] = kept;
  }
  return result;
}

function joinDays(...sets) {
  const result = {};
  for (const days of sets)
    for (const [date, rows] of Object.entries(days || {}))
      result[date] = [...(result[date] || []), ...rows];
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}

const stamp = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

// Reads the date and client flags the desktop passes to the engine. `local`
// is false when the report cannot be combined with other computers at all.
function reportFilter(args, now = new Date()) {
  const filter = { since: "", until: "", client: "", local: true };
  const value = (flag) => {
    const index = args.indexOf(flag);
    return index >= 0 && typeof args[index + 1] === "string" ? args[index + 1] : "";
  };
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const back = (days) => stamp(new Date(today.getFullYear(), today.getMonth(), today.getDate() - days));
  if (args.includes("--today")) filter.since = filter.until = back(0);
  else if (args.includes("--yesterday")) filter.since = filter.until = back(1);
  else if (args.includes("--week")) [filter.since, filter.until] = [back(6), back(0)];
  else if (args.includes("--month"))
    [filter.since, filter.until] = [stamp(new Date(today.getFullYear(), today.getMonth(), 1)), back(0)];
  else if (value("--year")) {
    filter.since = `${value("--year")}-01-01`;
    filter.until = `${value("--year")}-12-31`;
  } else {
    filter.since = value("--since");
    filter.until = value("--until");
  }
  filter.client = value("--client");
  // A custom report home is some other folder's data, not this computer's.
  if (args.includes("--home")) filter.local = false;
  return filter;
}

function filterDays(days, filter) {
  const result = {};
  for (const [date, rows] of Object.entries(days || {})) {
    if ((filter.since && date < filter.since) || (filter.until && date > filter.until)) continue;
    const kept = filter.client ? rows.filter((row) => row.client === filter.client) : rows;
    if (kept.length) result[date] = kept;
  }
  return result;
}

const rowTokens = (tokens) => TOKEN_FIELDS.reduce((sum, field) => sum + finite(tokens?.[field]), 0);

function combineRows(rows) {
  const byKey = new Map();
  for (const row of rows) {
    const key = `${row.client}\n${row.modelId}\n${row.providerId}`;
    const current = byKey.get(key);
    if (!current) {
      byKey.set(key, { ...row, tokens: { ...row.tokens } });
      continue;
    }
    for (const field of TOKEN_FIELDS)
      current.tokens[field] = finite(current.tokens[field]) + finite(row.tokens?.[field]);
    current.cost = finite(current.cost) + finite(row.cost);
    current.messages = finite(current.messages) + finite(row.messages);
  }
  return [...byKey.values()];
}

// Adds other computers' days to a graph report and recomputes every total the
// engine derives from the days. Active-time figures stay this computer's own.
function mergeGraph(graph, extra, { includeLocal = true } = {}) {
  const byDate = new Map();
  if (includeLocal) for (const day of graph.contributions || []) byDate.set(day.date, { ...day });
  for (const [date, rows] of Object.entries(extra)) {
    const day = byDate.get(date) || { date, clients: [], intensity: 0 };
    const clients = combineRows([...(day.clients || []), ...rows]);
    const tokenBreakdown = {};
    for (const field of TOKEN_FIELDS)
      tokenBreakdown[field] = clients.reduce((sum, row) => sum + finite(row.tokens[field]), 0);
    byDate.set(date, {
      ...day,
      clients,
      tokenBreakdown,
      totals: {
        ...day.totals,
        tokens: rowTokens(tokenBreakdown),
        cost: clients.reduce((sum, row) => sum + finite(row.cost), 0),
        messages: clients.reduce((sum, row) => sum + finite(row.messages), 0),
      },
    });
  }
  const contributions = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  const maxCost = contributions.reduce((max, day) => Math.max(max, finite(day.totals?.cost)), 0);
  for (const day of contributions) {
    const ratio = maxCost ? finite(day.totals?.cost) / maxCost : 0;
    day.intensity = ratio >= 0.75 ? 4 : ratio >= 0.5 ? 3 : ratio >= 0.25 ? 2 : ratio > 0 ? 1 : 0;
  }
  const totalCost = contributions.reduce((sum, day) => sum + finite(day.totals?.cost), 0);
  const activeDays = contributions.filter(
    (day) => finite(day.totals?.tokens) || finite(day.totals?.cost) || finite(day.totals?.messages),
  ).length;
  const years = new Map();
  for (const day of contributions) {
    const year = day.date.slice(0, 4);
    const entry = years.get(year) || {
      year,
      totalTokens: 0,
      totalCost: 0,
      range: { start: day.date, end: day.date },
    };
    entry.totalTokens += finite(day.totals?.tokens);
    entry.totalCost += finite(day.totals?.cost);
    entry.range.end = day.date;
    years.set(year, entry);
  }
  const names = (pick) =>
    [...new Set(contributions.flatMap((day) => (day.clients || []).map(pick)))].sort();
  const result = {
    ...graph,
    meta: {
      ...graph.meta,
      dateRange: contributions.length
        ? { start: contributions[0].date, end: contributions.at(-1).date }
        : graph.meta?.dateRange,
    },
    summary: {
      ...graph.summary,
      totalTokens: contributions.reduce((sum, day) => sum + finite(day.totals?.tokens), 0),
      totalCost,
      totalDays: contributions.length,
      activeDays,
      averagePerDay: activeDays ? totalCost / activeDays : 0,
      maxCostInSingleDay: maxCost,
      clients: names((row) => row.client),
      models: names((row) => row.modelId),
    },
    years: [...years.values()],
    contributions,
  };
  if (!includeLocal) delete result.timeMetrics;
  return result;
}

const groupOf = (args) => {
  const index = args.indexOf("--group-by");
  return index >= 0 ? args[index + 1] : "client,model";
};

// Adds other computers' usage to a models report. Rows the engine already
// lists gain the extra usage; anything else becomes a new row without timings.
function mergeModels(report, extra, { includeLocal = true, groupBy = report.groupBy } = {}) {
  const keyOf = (client, provider, model) =>
    groupBy === "model"
      ? model
      : groupBy === "client,model"
        ? `${client}\n${model}`
        : `${client}\n${provider}\n${model}`;
  const entries = includeLocal ? (report.entries || []).map((entry) => ({ ...entry })) : [];
  const byKey = new Map(entries.map((entry) => [keyOf(entry.client, entry.provider, entry.model), entry]));
  for (const row of Object.values(extra).flat()) {
    const key = keyOf(row.client, row.providerId, row.modelId);
    let entry = byKey.get(key);
    if (!entry) {
      entry = {
        client: row.client,
        mergedClients: groupBy === "model" ? row.client : null,
        model: row.modelId,
        provider: row.providerId,
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        reasoning: 0,
        messageCount: 0,
        cost: 0,
        performance: null,
      };
      byKey.set(key, entry);
      entries.push(entry);
    } else if (groupBy === "model") {
      const clients = new Set(String(entry.mergedClients || entry.client).split(/,\s*/).filter(Boolean));
      clients.add(row.client);
      entry.mergedClients = [...clients].join(", ");
    }
    for (const field of TOKEN_FIELDS) entry[field] = finite(entry[field]) + finite(row.tokens[field]);
    entry.messageCount = finite(entry.messageCount) + finite(row.messages);
    entry.cost = finite(entry.cost) + finite(row.cost);
  }
  entries.sort((a, b) => finite(b.cost) - finite(a.cost));
  const total = (field) => entries.reduce((sum, entry) => sum + finite(entry[field]), 0);
  return {
    ...report,
    entries,
    totalInput: total("input"),
    totalOutput: total("output"),
    totalCacheRead: total("cacheRead"),
    totalCacheWrite: total("cacheWrite"),
    totalMessages: total("messageCount"),
    totalCost: total("cost"),
  };
}

function mergeMonthly(report, extra, { includeLocal = true } = {}) {
  const entries = includeLocal
    ? (report.entries || []).map((entry) => ({ ...entry, models: [...(entry.models || [])] }))
    : [];
  const byMonth = new Map(entries.map((entry) => [entry.month, entry]));
  for (const [date, rows] of Object.entries(extra)) {
    const month = date.slice(0, 7);
    let entry = byMonth.get(month);
    if (!entry) {
      entry = { month, models: [], input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, messageCount: 0, cost: 0 };
      byMonth.set(month, entry);
      entries.push(entry);
    }
    for (const row of rows) {
      if (!entry.models.includes(row.modelId)) entry.models.push(row.modelId);
      for (const field of TOKEN_FIELDS) entry[field] = finite(entry[field]) + finite(row.tokens[field]);
      entry.messageCount = finite(entry.messageCount) + finite(row.messages);
      entry.cost = finite(entry.cost) + finite(row.cost);
    }
  }
  entries.sort((a, b) => a.month.localeCompare(b.month));
  return { ...report, entries, totalCost: entries.reduce((sum, entry) => sum + finite(entry.cost), 0) };
}

// Session, workspace and hourly reports exist only for the computer that
// recorded them, so another computer's view of them is empty.
function emptyReport(report) {
  const result = { ...report, entries: [] };
  for (const key of Object.keys(result))
    if (/^total[A-Z]/.test(key) && typeof result[key] === "number") result[key] = 0;
  return result;
}

// Which engine report an argument list asks for: one sync can add to
// ("models", "monthly"), or one that only this computer can answer ("local").
function reportKind(args) {
  if (!args.includes("--json")) return null;
  const command = args.find((arg) => !arg.startsWith("-"));
  if (command === "monthly") return "monthly";
  if (command === "models") return MODEL_GROUPS.includes(groupOf(args)) ? "models" : "local";
  if (command === "hourly") return "local";
  return null;
}

module.exports = {
  TOKEN_FIELDS,
  MODEL_GROUPS,
  cleanDays,
  snapshotDays,
  archivedDays,
  joinDays,
  reportFilter,
  filterDays,
  mergeGraph,
  mergeModels,
  mergeMonthly,
  emptyReport,
  reportKind,
  groupOf,
};
