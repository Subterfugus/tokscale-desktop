import React, {
  useEffect,
  useState,
  useMemo,
  useRef,
  useCallback,
} from "react";
import { createRoot } from "react-dom/client";
import {
  ConnectionCards,
  OpenRouterCard,
  ClaudeDesktopCard,
} from "./connections.jsx";
import {
  Activity,
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  BarChart3,
  Boxes,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Coins,
  Command,
  Download,
  ExternalLink,
  Folder,
  FolderOpen,
  Gauge,
  Grid2X2,
  Layers,
  LoaderCircle,
  Minus,
  Monitor,
  MoreHorizontal,
  Play,
  Plug,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Square,
  TerminalSquare,
  TrendingUp,
  Workflow,
  X,
  Zap,
  AlertCircle,
  Sun,
  Moon,
  Copy,
  StopCircle,
} from "lucide-react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import "./styles.css";
import {
  tokenTotal,
  modelTokenTotal,
  graphAverageTokens,
  validateDateFilter,
  filterTableRows,
  reportRangeLabel,
  calendarContributionCells,
} from "./report-data.js";

const api = window.tokscale;
const NAV = [
  ["overview", "Overview", Grid2X2],
  ["usage", "Subscription quotas", Gauge],
  ["models", "Models", Layers],
  ["activity", "Activity", Activity],
  ["projects", "Projects & sessions", Folder],
  ["insights", "Insights", BarChart3],
  ["integrations", "Integrations", Plug],
  ["commands", "Command center", TerminalSquare],
];
const COLORS = [
  "#b7a0ff",
  "#cbec90",
  "#79b6ff",
  "#f8bd83",
  "#e693c1",
  "#7edace",
  "#bebbcf",
];
const money = (v) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(Number(v) || 0);
const number = (v) => new Intl.NumberFormat("en-US").format(Number(v) || 0);
const compact = (v) =>
  new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Number(v) || 0);
const pct = (v) => `${(Number(v) || 0).toFixed(1)}%`;
const tokens = tokenTotal;
const pretty = (s) =>
  (Array.isArray(s) ? s.map((item) => pretty(item)).join(" · ") : String(s || "Unknown"))
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
const dateLabel = (s) => {
  const d = new Date(
    /^\d{4}-\d{2}-\d{2}$/.test(s)
      ? s + "T12:00:00"
      : /^\d{4}-\d{2}$/.test(s)
        ? s + "-01T12:00:00"
        : s,
  );
  return isNaN(d)
    ? s
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};
const dateTime = (s) => {
  const d = new Date(s);
  return isNaN(d) ? String(s) : d.toLocaleString();
};
const safeMessage = (s) =>
  String(s || "").replace(
    /(Bearer\s+|(?:api[_-]?key|token|secret|authorization)[=:]\s*)[^\s,;]+/gi,
    "$1[hidden]",
  );
const cache = new Map();
async function jsonRun(args) {
  const r = await api.run(["--no-spinner", ...args.filter((arg) => arg !== "--no-spinner")]);
  if (r.code !== 0)
    throw new Error(
      safeMessage(
        r.stderr || r.stdout || `Tokscale exited with code ${r.code}`,
      ),
    );
  try {
    return JSON.parse(r.stdout);
  } catch {
    throw new Error(
      "Tokscale returned an unreadable report. Open Command center to inspect the original command.",
    );
  }
}
function useReport(args, epoch, enabled = true, graph = false) {
  const key = JSON.stringify([graph, args]);
  const [state, setState] = useState({
    key,
    data: null,
    loading: true,
    error: null,
  });
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const cached = cache.get(key);
    if (cached?.epoch === epoch && cached.data) {
      setState({ key, data: cached.data, error: null, loading: false });
      return;
    }
    setState({ key, data: cached?.data || null, loading: true, error: null });
    let task = cached?.epoch === epoch ? cached?.promise : null;
    if (!task) {
      task = graph ? api.getGraph(args) : jsonRun(args);
      cache.set(key, { epoch, promise: task, data: cached?.data });
      if (cache.size > 40) {
        const oldest = [...cache].find(([oldKey, value]) => oldKey !== key && !value.promise);
        if (oldest) cache.delete(oldest[0]);
      }
    }
    task.then(
      (data) => {
        if (cache.get(key)?.promise === task)
          cache.set(key, { epoch: cache.get(key).epoch, data });
        if (alive) setState({ key, data, error: null, loading: false });
      },
      (error) => {
        if (cache.get(key)?.promise === task)
          cache.set(key, { epoch: -1, data: cached?.data });
        if (alive)
          setState({
            key,
            data: cached?.data || null,
            loading: false,
            error: error.message,
          });
      },
    );
    return () => {
      alive = false;
    };
  }, [key, epoch, enabled]);
  // A different date/client selection must never flash the previous report
  // under the new filter labels while its effect is being scheduled.
  return state.key === key ? state : { key, data: null, loading: true, error: null };
}
function IconButton({ icon: Icon, label, onClick, ...props }) {
  return (
    <button
      className="icon-button"
      title={label}
      aria-label={label}
      onClick={onClick}
      {...props}
    >
      <Icon size={16} />
    </button>
  );
}
function Empty({
  title = "No activity in this period",
  text = "Choose a different date range or connect a supported client to see your usage.",
  icon: Icon = Activity,
  action,
}) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon size={25} />
      </div>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}
function ReportState({ state, children, onRetry }) {
  const error = state.error && (
    <div className="error-state">
      <AlertCircle size={22} />
      <div>
        <h3>
          {state.data
            ? "Refresh failed · showing last successful report"
            : "Unable to load this report"}
        </h3>
        <p>{state.error}</p>
      </div>
      {onRetry && (
        <button className="button" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
  if (state.error && !state.data) return error;
  if (state.loading && !state.data)
    return (
      <div className="loading-state">
        <LoaderCircle className="spin" size={24} />
        <span>Reading your local activity…</span>
      </div>
    );
  return (
    <div className={state.loading ? "report refreshing" : "report"}>
      {state.loading && <div className="refresh-indicator" role="status"><LoaderCircle className="spin" size={14} /> Refreshing this report…</div>}
      {error}
      {children}
      {state.data?.warnings?.length > 0 && (
        <details className="warnings">
          <summary>{state.data.warnings.length} report notice(s)</summary>
          {state.data.warnings.map((w, i) => (
            <p key={i}>{safeMessage(w)}</p>
          ))}
        </details>
      )}
      {state.data?.diagnostics?.length > 0 && (
        <details className="warnings">
          <summary>Client diagnostics</summary>
          <pre>
            {safeMessage(JSON.stringify(state.data.diagnostics, null, 2))}
          </pre>
        </details>
      )}
    </div>
  );
}
function Panel({ title, description, action, children, className = "" }) {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-head">
        <div>
          <h3>{title}</h3>
          {description && <p>{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
function Metric({ label, value, detail, icon: Icon, color }) {
  return (
    <div className="metric">
      <div className="metric-top">
        <span>{label}</span>
        <Icon size={16} style={{ color: color || "var(--muted)" }} />
      </div>
      <strong>{value}</strong>
      <div className="metric-detail">{detail}</div>
    </div>
  );
}
function Chart({ entries, metric = "cost", labelKey = "date", height = 200 }) {
  const [hover, setHover] = useState(null);
  const chartLabel = (value) => labelKey === "hour" ? dateTime(value) : labelKey === "month" ? new Date(`${value}-01T12:00:00`).toLocaleDateString(undefined, { month: "short", year: "numeric" }) : dateLabel(value);
  useEffect(() => setHover(null), [entries.length, labelKey, metric]);
  if (!entries.length) return <Empty />;
  const vals = entries.map((r) => Number(r[metric] ?? r.totals?.[metric] ?? 0));
  const max = Math.max(...vals, 0) || 1;
  const width = 800,
    pad = 16,
    plotH = height - 42,
    barW = Math.max(1, ((width - 2 * pad) / entries.length) * 0.65);
  return (
    <div className="chart">
      <div className="chart-label">
        {metric === "cost" ? "Estimated cost · USD" : "Tokens"}
        <strong>
          {hover === null || !entries[hover]
            ? ""
            : `${chartLabel(entries[hover][labelKey])} · ${metric === "cost" ? money(vals[hover]) : number(vals[hover])}`}
        </strong>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`${metric} by ${labelKey}`}
      >
        <defs>
          <linearGradient id="barfill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#b8a0ff" />
            <stop offset="1" stopColor="#6b539c" />
          </linearGradient>
        </defs>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line
              x1={pad}
              x2={width - pad}
              y1={plotH - f * (plotH - 12)}
              y2={plotH - f * (plotH - 12)}
              stroke="var(--line)"
              strokeDasharray="3 5"
            />
            <text
              x={pad}
              y={plotH - f * (plotH - 12) - 5}
              fill="var(--muted)"
              fontSize="15"
            >
              {metric === "cost" ? money(max * f) : compact(max * f)}
            </text>
          </g>
        ))}
        {vals.map((v, i) => {
          const x = pad + (i * (width - 2 * pad)) / entries.length;
          return (
            <g
              key={i}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              <rect
                x={x}
                y="0"
                width={(width - 2 * pad) / entries.length}
                height={plotH + 5}
                fill="transparent"
              />
              <rect
                x={x + ((width - 2 * pad) / entries.length) * 0.175}
                y={plotH - (v / max) * (plotH - 22)}
                width={barW}
                height={Math.max(v ? 2 : 0, (v / max) * (plotH - 22))}
                rx={Math.min(3, barW / 2)}
                fill={hover === i ? "#d5c5ff" : "url(#barfill)"}
              />
              <title>{`${entries[i][labelKey]}: ${metric === "cost" ? money(v) : number(v)}`}</title>
            </g>
          );
        })}
        <text x={pad} y={height - 5} fill="var(--muted)" fontSize="15">
          {chartLabel(entries[0][labelKey])}
        </text>
        <text
          x={width - pad}
          y={height - 5}
          textAnchor="end"
          fill="var(--muted)"
          fontSize="15"
        >
          {chartLabel(entries.at(-1)[labelKey])}
        </text>
      </svg>
    </div>
  );
}
function Distribution({ entries }) {
  const groups = {};
  entries.forEach(
    (r) =>
      (groups[r.provider || r.client || "Unknown"] =
        (groups[r.provider || r.client || "Unknown"] || 0) +
        Number(r.cost || 0)),
  );
  const rows = Object.entries(groups).sort((a, b) => b[1] - a[1]),
    total = rows.reduce((s, r) => s + r[1], 0);
  if (!rows.length)
    return <Empty text="Provider costs will appear when usage is recorded." />;
  return (
    <>
      <div className="distribution-total">
        <strong>{money(total)}</strong>
        <span>
          across {rows.length} provider{rows.length !== 1 ? "s" : ""}
        </span>
      </div>
      <div className="distribution-bar">
        {rows.map(([k, v], i) => (
          <div
            key={k}
            style={{
              width: `${total ? (v / total) * 100 : 100 / rows.length}%`,
              background: COLORS[i % COLORS.length],
            }}
            title={`${pretty(k)}: ${money(v)}`}
          />
        ))}
      </div>
      <div className="distribution-list">
        {rows.map(([k, v], i) => (
          <div key={k}>
            <span>
              <i style={{ background: COLORS[i % COLORS.length] }} />
              {pretty(k)}
            </span>
            <b>{money(v)}</b>
            <small>{total ? pct((v / total) * 100) : "—"}</small>
          </div>
        ))}
      </div>
    </>
  );
}
function ExportButton({ data, name = "tokscale-report" }) {
  const [saved, setSaved] = useState(false);
  return (
    <button
      className="button small"
      disabled={!data}
      onClick={async () => {
        try {
          const p = await api.exportFile({
            name: `${name}.json`,
            content: JSON.stringify(data, null, 2),
          });
          if (p) {
            setSaved(true);
            setTimeout(() => setSaved(false), 2500);
          }
        } catch (e) {
          alert(e.message);
        }
      }}
    >
      {saved ? <Check size={14} /> : <Download size={14} />}{" "}
      {saved ? "Saved" : "Export JSON"}
    </button>
  );
}
function DataTable({ rows, columns, defaultSort = "cost", emptyText }) {
  const [search, setSearch] = useState(""),
    [sort, setSort] = useState(defaultSort),
    [direction, setDirection] = useState(-1),
    [expanded, setExpanded] = useState(null),
    [page, setPage] = useState(0);
  const pageSize = 50;
  const filtered = useMemo(
    () => filterTableRows(rows, columns, search, sort, direction),
    [rows, columns, search, sort, direction],
  );
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / pageSize) - 1));
  const visibleRows = filtered.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  useEffect(() => { setPage(0); setExpanded(null); }, [rows, search]);
  return (
    <>
      <div className="table-tools">
        <label className="search">
          <Search size={15} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search this report…"
            aria-label="Search report"
          />
        </label>
        <span>{number(filtered.length)}{search.trim() ? ` of ${number(rows.length)}` : ""} rows</span>
      </div>
      {!filtered.length ? (
        <Empty
          title={search ? "No matching rows" : "No recorded activity"}
          text={emptyText || "Try another date range or client."}
        />
      ) : (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th key={c.key} className={c.numeric ? "numeric" : ""} aria-sort={sort === c.key ? direction < 0 ? "descending" : "ascending" : "none"}>
                    <button
                      onClick={() => {
                        setSort(c.key);
                        setDirection(sort === c.key ? -direction : c.numeric ? -1 : 1);
                        setPage(0);
                      }}
                    >
                      {c.label}
                      {sort === c.key &&
                        (direction < 0 ? (
                          <ArrowDown size={12} />
                        ) : (
                          <ArrowUp size={12} />
                        ))}
                    </button>
                  </th>
                ))}
                <th><span className="sr-only">Details</span></th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((r) => (
                <React.Fragment key={rows.indexOf(r)}>
                  <tr
                    onClick={() => setExpanded(expanded === r ? null : r)}
                    className={expanded === r ? "selected-row" : ""}
                  >
                    {columns.map((c) => (
                      <td key={c.key} className={c.numeric ? "numeric" : ""}>
                        {c.render ? c.render(r) : (r[c.key] ?? "—")}
                      </td>
                    ))}
                    <td>
                      <button className="icon-button" aria-label={`${expanded === r ? "Hide" : "Show"} row details`} aria-expanded={expanded === r} onClick={(event) => { event.stopPropagation(); setExpanded(expanded === r ? null : r); }}><ChevronRight size={14} className={expanded === r ? "rotate" : ""} /></button>
                    </td>
                  </tr>
                  {expanded === r && (
                    <tr className="detail-row">
                      <td colSpan={columns.length + 1}>
                        <div className="row-details">
                          {Object.entries(r).map(([key, v]) => (
                            <div key={key}>
                              <small>{pretty(key)}</small>
                              <span>
                                {typeof v === "object"
                                  ? JSON.stringify(v)
                                  : String(v ?? "—")}
                              </span>
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {filtered.length > pageSize && <div className="table-pagination">
        <span>{number(currentPage * pageSize + 1)}–{number(Math.min((currentPage + 1) * pageSize, filtered.length))} of {number(filtered.length)}</span>
        <button className="button small" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button>
        <button className="button small" disabled={(currentPage + 1) * pageSize >= filtered.length} onClick={() => setPage(currentPage + 1)}>Next</button>
      </div>}
    </>
  );
}
const TOKEN_COLS = [
  {
    key: "totalTokens",
    label: "Total tokens",
    numeric: true,
    sortValue: tokenTotal,
    render: (r) => <b>{number(tokenTotal(r))}</b>,
  },
  {
    key: "input",
    label: "Input",
    numeric: true,
    render: (r) => number(r.input),
  },
  {
    key: "output",
    label: "Output",
    numeric: true,
    render: (r) => number(r.output),
  },
  {
    key: "cacheRead",
    label: "Cache read",
    numeric: true,
    render: (r) => number(r.cacheRead),
  },
  {
    key: "cacheWrite",
    label: "Cache write",
    numeric: true,
    render: (r) => number(r.cacheWrite),
  },
  {
    key: "reasoning",
    label: "Reasoning",
    numeric: true,
    render: (r) => (r.reasoning === undefined ? "—" : number(r.reasoning)),
  },
  {
    key: "messageCount",
    label: "Messages",
    numeric: true,
    render: (r) => number(r.messageCount),
  },
  {
    key: "cost",
    label: "Est. cost",
    numeric: true,
    render: (r) => <b>{money(r.cost)}</b>,
  },
];
function Overview({ args, epoch, refresh, setPage }) {
  const models = useReport(
      ["models", "--json", "--no-spinner", ...args],
      epoch,
    ),
    graph = useReport(args, epoch, true, true);
  const d = models.data,
    rows = d?.entries || [],
    g = graph.data;
  const total = modelTokenTotal(d);
  const top = [...rows].sort((a, b) => tokens(b) - tokens(a)).slice(0, 5);
  return (
    <ReportState state={models} onRetry={refresh}>
      <div className="metrics">
        <Metric
          label="Estimated cost"
          value={money(d?.totalCost)}
          detail="Based on model pricing"
          icon={Coins}
          color="var(--violet)"
        />
        <Metric
          label="Total tokens"
          value={compact(total)}
          detail="Includes cache reads, cache writes and reasoning"
          icon={Zap}
          color="var(--lime)"
        />
        <Metric
          label="Messages"
          value={number(d?.totalMessages)}
          detail={`${rows.length} model / client combinations`}
          icon={Workflow}
        />
        <Metric
          label="Cache share"
          value={pct(total ? ((d?.totalCacheRead || 0) / total) * 100 : 0)}
          detail={`${compact(d?.totalCacheRead)} tokens read from cache`}
          icon={Boxes}
        />
      </div>
      <div className="token-breakdown" aria-label="Token breakdown">
        {[
          ["Input", d?.totalInput], ["Output", d?.totalOutput],
          ["Cache read", d?.totalCacheRead], ["Cache write", d?.totalCacheWrite],
          ["Reasoning", rows.reduce((sum, row) => sum + Number(row.reasoning || 0), 0)],
        ].map(([label, value]) => <div key={label}><span>{label}</span><b title={number(value)}>{compact(value)}</b></div>)}
      </div>
      <div className="overview-grid">
        <Panel
          title="Your activity, over time"
          description="Daily estimated cost from local usage records"
          action={<ExportButton data={g} name="tokscale-activity" />}
        >
          <ReportState state={graph} onRetry={refresh}>
            <Chart entries={g?.contributions || []} />
          </ReportState>
        </Panel>
        <Panel
          title="Provider distribution"
          description="Where your estimated spend goes"
        >
          <Distribution entries={rows} />
        </Panel>
      </div>
      <Panel
        title="Most-used models"
        description="Ranked by total tokens, including cache and reasoning"
        action={
          <button className="text-button" onClick={() => setPage("models")}>
            View all models <ArrowUpRight size={14} />
          </button>
        }
      >
        <DataTable
          rows={top}
          defaultSort="totalTokens"
          columns={[
            {
              key: "model",
              label: "Model",
              render: (r) => (
                <div className="model-cell">
                  <span className="model-dot" />
                  <div>
                    <b>{r.model}</b>
                    <small>
                      {pretty(r.client)} · {pretty(r.provider)}
                    </small>
                  </div>
                </div>
              ),
            },
            {
              key: "totalTokens",
              label: "Total tokens",
              sortValue: tokenTotal,
              render: (r) => compact(tokens(r)),
              numeric: true,
            },
            {
              key: "output",
              label: "Output",
              render: (r) => compact(r.output),
              numeric: true,
            },
            {
              key: "cacheRead",
              label: "Cache read",
              render: (r) => compact(r.cacheRead),
              numeric: true,
            },
            {
              key: "messageCount",
              label: "Messages",
              render: (r) => number(r.messageCount),
              numeric: true,
            },
            {
              key: "cost",
              label: "Estimated cost",
              render: (r) => <b>{money(r.cost)}</b>,
              numeric: true,
            },
          ]}
        />
      </Panel>
      <div className="footnote">
        <ShieldCheck size={14} /> Usage is read from your machine. Cost
        estimates may differ from your bill.{" "}
        {g?.summary?.activeDays > 0 && (
          <span>{g.summary.activeDays} active days in this period</span>
        )}
      </div>
    </ReportState>
  );
}
function Quotas({ epoch, refresh, toCommand }) {
  const state = useReport(["usage", "--json", "--no-spinner"], epoch);
  const rows = Array.isArray(state.data) ? state.data : [];
  return (
    <>
      <div className="connection-grid quota-connections">
        <ClaudeDesktopCard epoch={epoch} />
        <OpenRouterCard epoch={epoch} />
      </div>
      <ReportState state={state} onRetry={refresh}>
        <div className="notice">
          <ShieldCheck size={16} />
          <span>
            Live subscription limits from your connected accounts. Date and
            client filters apply to usage reports, not quotas.
          </span>
        </div>
        {!rows.length ? (
          <Empty
            title="No additional provider quota data returned"
            text="The original engine returned no additional subscription data. Claude desktop and OpenRouter are shown above; provider diagnostics can help with missing accounts."
            action={
              <button
                className="button"
                onClick={() => toCommand("--no-spinner usage --light")}
              >
                Inspect quota diagnostics <TerminalSquare size={14} />
              </button>
            }
          />
        ) : (
          <div className="quota-grid">
            {rows.map((r, i) => (
              <Panel
                key={i}
                className="quota-card"
                title={pretty(r.provider)}
                description={[r.plan, r.account?.label, r.email]
                  .filter(Boolean)
                  .join(" · ")}
                action={
                  <span className="badge green">
                    {r.account?.is_active ? "Active account" : "Connected"}
                  </span>
                }
              >
                {r.metrics?.map((m, j) => (
                  <div className="quota-metric" key={j}>
                    <div>
                      <b>{m.label}</b>
                      <strong>
                        {pct(m.remaining_percent)} <small>left</small>
                      </strong>
                    </div>
                    <div className="progress">
                      <i
                        style={{
                          width: `${Math.min(100, Math.max(0, m.used_percent))}%`,
                          background:
                            m.remaining_percent < 15
                              ? "var(--orange)"
                              : "var(--violet)",
                        }}
                      />
                    </div>
                    <div className="quota-detail">
                      <span>
                        {pct(m.used_percent)} used
                        {m.remaining_label ? ` · ${m.remaining_label}` : ""}
                      </span>
                      <span>
                        <Clock size={11} />
                        {m.resets_at
                          ? `Resets ${dateTime(m.resets_at)}`
                          : "No reset reported"}
                      </span>
                    </div>
                  </div>
                ))}
                {r.credit_status && (
                  <div className="account-detail">
                    Credits:{" "}
                    {r.credit_status.unlimited
                      ? "Unlimited"
                      : (r.credit_status.balance ??
                        (r.credit_status.has_credits == null
                          ? "Not reported"
                          : r.credit_status.has_credits
                            ? "Available"
                            : "None"))}
                    {r.credit_status.overage_limit_reached
                      ? " · Overage limit reached"
                      : ""}
                  </div>
                )}
                {r.reset_credits && (
                  <details className="account-detail">
                    <summary>
                      {r.reset_credits.available_count} reset credits available
                    </summary>
                    <pre>
                      {JSON.stringify(r.reset_credits.credits, null, 2)}
                    </pre>
                  </details>
                )}
                {r.spend_control && (
                  <div className="account-detail">
                    Individual spend limit:{" "}
                    {r.spend_control.individual_limit ?? "Not reported"}
                    {r.spend_control.reached ? " · Reached" : ""}
                  </div>
                )}
              </Panel>
            ))}
          </div>
        )}
        <div className="footnote">
          Quota fetch failures may be omitted by the original JSON report. Use
          “Inspect quota diagnostics” for full provider status.
        </div>
        <button
          className="text-button"
          onClick={() => toCommand("--no-spinner usage --light")}
        >
          Inspect quota diagnostics <ChevronRight size={14} />
        </button>
      </ReportState>
    </>
  );
}
function Models({ args, epoch, refresh, projects = false }) {
  const [group, setGroup] = useState(
      projects ? "client,session,model" : "client,provider,model",
    ),
    [merge, setMerge] = useState(false),
    [sessionTitles, setSessionTitles] = useState({ titles: {} }),
    [actionError, setActionError] = useState("");
  const home = args.includes("--home") ? args[args.indexOf("--home") + 1] : "";
  useEffect(() => {
    if (!projects || !api.getSessionTitles) return;
    let live = true;
    setSessionTitles({ titles: {} });
    api.getSessionTitles(home).then((result) => { if (live) setSessionTitles(result); }, (error) => { if (live) setSessionTitles({ titles: {}, warning: safeMessage(error.message) }); });
    return () => { live = false; };
  }, [projects, home, epoch]);
  const state = useReport(
    [
      "models",
      "--json",
      "--no-spinner",
      "--group-by",
      group,
      ...(merge && group === "workspace,model" ? ["--merge-worktrees"] : []),
      ...args,
    ],
    epoch,
  );
  const rows = useMemo(() => (state.data?.entries || []).map((row) => ({ ...row,
    ...(projects && group.includes("session") ? { sessionTitle: row.client === "codex" ? sessionTitles.titles?.[row.sessionId] || null : null } : {}),
  })), [state.data, projects, group, sessionTitles]);
  const cols = [
    ...(group.includes("workspace")
      ? [
          {
            key: "workspaceLabel",
            label: "Workspace",
            render: (r) => (
              <b>{r.workspaceLabel || r.workspaceKey || "Unknown workspace"}</b>
            ),
          },
        ]
      : []),
    ...(group.includes("session")
      ? [
          {
            key: projects ? "sessionTitle" : "sessionId",
            label: "Session",
            sortValue: (r) => r.sessionTitle || r.sessionId,
            render: (r) => (
              <div className="session-cell" title={r.sessionId}><b>{r.sessionTitle || (projects ? r.client === "codex" ? "Untitled Codex chat" : `${pretty(r.client)} session` : r.sessionId || "Unknown session")}</b>{projects && <small>{r.sessionTitle ? "Saved chat title" : "Saved title unavailable"} · {r.sessionId?.slice(-12)}</small>}</div>
            ),
          },
        ]
      : []),
    { key: "model", label: "Model", render: (r) => <b>{r.model}</b> },
    {
      key: "client",
      label: "Client",
      render: (r) => pretty(r.mergedClients || r.client),
    },
    ...(!projects ? [{ key: "provider", label: "Provider", render: (r) => pretty(r.provider) }] : []),
    ...(projects ? TOKEN_COLS.filter((column) => ["totalTokens", "messageCount", "cost"].includes(column.key)) : TOKEN_COLS),
    ...(!projects ? [{
      key: "performance",
      label: "ms / 1K",
      numeric: true,
      sortValue: (r) => r.performance?.msPer1KTokens,
      render: (r) =>
        r.performance?.msPer1KTokens == null
          ? "—"
          : number(Math.round(r.performance.msPer1KTokens)),
    }] : []),
  ];
  return (
    <>
      <div className="view-toolbar">
        <label>
          Group by{" "}
          <select value={group} onChange={(e) => setGroup(e.target.value)}>
            <option value="model">Model</option>
            <option value="client,model">Client + model</option>
            <option value="client,provider,model">
              Client + provider + model
            </option>
            <option value="workspace,model">Workspace + model</option>
            <option value="session,model">Session + model</option>
            <option value="client,session,model">
              Client + session + model
            </option>
          </select>
        </label>
        {group === "workspace,model" && (
          <label className="check-label">
            <input
              type="checkbox"
              checked={merge}
              onChange={(e) => setMerge(e.target.checked)}
            />{" "}
            Merge worktrees
          </label>
        )}
        <ExportButton
          data={state.data}
          name={projects ? "tokscale-projects" : "tokscale-models"}
        />
      </div>
      {actionError && <div className="inline-error" role="alert">{actionError}</div>}
      <ReportState state={state} onRetry={refresh}>
        <Panel
          title={projects ? "Explore your work" : "Complete model breakdown"}
          description={`${number(rows.length)} ${group.includes("session") ? "session / model" : group.includes("workspace") ? "workspace / model" : "model"} rows · ${money(state.data?.totalCost)} estimated cost · expand a row for the full token breakdown`}
        >
          <DataTable rows={rows} columns={cols} />
        </Panel>
        <div className="footnote">
          {projects ? "Saved Codex chat names are shown when available. Workspace labels describe folders and can contain multiple sessions." : "Reasoning is a separate reported token bucket. Timing coverage and source fields are available in each row."}
        </div>
        {projects && sessionTitles.warning && <div className="footnote">Saved chat titles: {sessionTitles.warning}</div>}
        {projects && (
          <div className="notice space-top">
            <TerminalSquare size={16} />
            <span>
              These are model aggregates by workspace or session. The original
              TUI includes session titles, project timelines, and minute-level
              activity.
            </span>
            <button
              className="text-button"
              onClick={() => { setActionError(""); api.launchNative([]).catch(error => setActionError(safeMessage(error.message))); }}
            >
              Open original TUI <ExternalLink size={12} />
            </button>
          </div>
        )}
      </ReportState>
    </>
  );
}
function ActivityView({ args, epoch, refresh }) {
  const [mode, setMode] = useState("daily"),
    [metric, setMetric] = useState("cost");
  const state = useReport(
    mode === "daily" ? args : [mode, "--json", "--no-spinner", ...args],
    epoch,
    true,
    mode === "daily",
  );
  const rows =
    mode === "daily"
      ? (state.data?.contributions || []).map((d) => ({
          date: d.date,
          ...d.tokenBreakdown,
          messageCount: d.totals?.messages,
          cost: d.totals?.cost,
          tokens: d.totals?.tokens,
          clients: d.clients,
          activeTimeMs: d.activeTimeMs,
          costIsComplete: d.totals?.costIsComplete,
        }))
      : state.data?.entries || [];
  const key = mode === "daily" ? "date" : mode === "monthly" ? "month" : "hour";
  return (
    <>
      <div className="view-toolbar">
        <div className="segmented">
          {["daily", "hourly", "monthly"].map((m) => (
            <button
              className={mode === m ? "active" : ""}
              onClick={() => setMode(m)}
              key={m}
            >
              {pretty(m)}
            </button>
          ))}
        </div>
        <div className="toolbar-end">
          <select
            aria-label="Chart metric"
            value={metric}
            onChange={(e) => setMetric(e.target.value)}
          >
            <option value="cost">Estimated cost</option>
            <option value="tokens">Tokens</option>
          </select>
          <ExportButton data={state.data} name={`tokscale-${mode}`} />
        </div>
      </div>
      <ReportState state={state} onRetry={refresh}>
        <Panel
          title={`${pretty(mode)} activity`}
          description={
            mode === "hourly"
              ? "Local hours with messages and turn counts"
              : "Every recorded period, with the complete token breakdown"
          }
        >
          <Chart
            entries={rows.map((r) => ({ ...r, tokens: r.tokens ?? tokens(r) }))}
            metric={metric}
            labelKey={key}
          />
        </Panel>
        <Panel title="Activity ledger" className="space-top">
          <DataTable
            rows={rows}
            defaultSort={key}
            columns={[
              { key, label: pretty(mode), render: (r) => <b>{r[key]}</b> },
              ...TOKEN_COLS,
              ...(mode === "hourly"
                ? [
                    {
                      key: "turnCount",
                      label: "Turns",
                      render: (r) => number(r.turnCount),
                      numeric: true,
                    },
                  ]
                : []),
            ]}
          />
        </Panel>
        {mode === "hourly" && (
          <div className="footnote">
            Hourly JSON reports do not include reasoning tokens. View daily or
            monthly reports for reasoning.
          </div>
        )}
      </ReportState>
    </>
  );
}
function Insights({ args, epoch, refresh }) {
  const state = useReport(args, epoch, true, true),
    [selected, setSelected] = useState(null),
    [metric, setMetric] = useState("tokens");
  const days = state.data?.contributions || [];
  const calendarCells = useMemo(() => calendarContributionCells(days), [state.data]);
  const max = Math.max(1, ...days.map((d) => Number(d.totals?.[metric] || 0)));
  const sum = state.data?.summary || {},
    tm = state.data?.timeMetrics;
  const selectedDay = days.find((d) => d.date === selected);
  return (
    <ReportState state={state} onRetry={refresh}>
      <div className="metrics">
        <Metric
          label="Active days"
          value={number(sum.activeDays)}
          detail={`${sum.totalDays || 0} recorded dates in the report`}
          icon={Activity}
        />
        <Metric
          label="Daily average"
          value={compact(graphAverageTokens(state.data))}
          detail="Tokens per day in the recorded date span"
          icon={TrendingUp}
        />
        <Metric
          label="Largest day"
          value={money(sum.maxCostInSingleDay)}
          detail="Estimated cost"
          icon={Coins}
        />
        <Metric
          label="Active time"
          value={tm ? `${(tm.totalActiveTimeMs / 3600000).toFixed(1)}h` : "—"}
          detail={
            tm
              ? `${number(tm.sessionCount)} sessions · ${tm.maxConcurrentSessions} max concurrent`
              : "Time metrics not reported"
          }
          icon={Clock}
        />
      </div>
      <Panel
        title="Your contribution map"
        description="Each square is one calendar day. Blank dates have no recorded activity; select an active day to explore it."
        action={
          <select
            aria-label="Contribution metric"
            value={metric}
            onChange={(e) => setMetric(e.target.value)}
          >
            <option value="tokens">Tokens</option>
            <option value="cost">Cost</option>
            <option value="messages">Messages</option>
          </select>
        }
      >
        {!days.length ? (
          <Empty />
        ) : (
          <>
            <div className="heatmap-labels">
              <span>{dateLabel(days[0].date)}</span>
              <span>{dateLabel(days.at(-1).date)}</span>
            </div>
            <div className="calendar-map">
              <div className="heatmap-weekdays" aria-hidden="true">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => <span key={day}>{day}</span>)}</div>
              <div className="heatmap">
              {calendarCells.map((cell, index) => {
                if (!cell) return <span key={`padding-${index}`} className="heatmap-spacer" aria-hidden="true" />;
                const d = cell.contribution || { date: cell.date, totals: {} };
                return (
                <button
                  aria-label={`${d.date}: ${number(d.totals?.[metric])} ${metric}`}
                  title={cell.contribution ? `${d.date}: ${metric === "cost" ? money(d.totals.cost) : number(d.totals?.[metric])}` : `${d.date}: No recorded activity`}
                  key={d.date}
                  disabled={!cell.contribution}
                  className={`${selected === d.date ? "selected" : ""} ${!cell.contribution ? "heatmap-empty-day" : ""}`}
                  onClick={() => setSelected(d.date)}
                  style={{
                    background: `color-mix(in srgb, var(--violet) ${d.totals?.[metric] ? Math.max(20, (Number(d.totals[metric]) / max) * 100) : 0}%, var(--heat-empty))`,
                  }}
                />
                );
              })}
              </div>
            </div>
            <div className="heatmap-legend">
              <span>{number(sum.totalTokens)} total tokens</span>
              <div>
                Less{" "}
                {[0, 25, 50, 75, 100].map((x) => (
                  <i
                    key={x}
                    style={{
                      background: `color-mix(in srgb,var(--violet) ${x}%,var(--heat-empty))`,
                    }}
                  />
                ))}{" "}
                More
              </div>
            </div>
          </>
        )}
      </Panel>
      {selectedDay && (
        <Panel
          className="space-top"
          title={dateTime(`${selectedDay.date}T12:00:00`)}
          description={`${number(selectedDay.totals.tokens)} tokens · ${money(selectedDay.totals.cost)} · ${number(selectedDay.totals.messages)} messages${selectedDay.totals.costIsComplete === false ? " · Cost data incomplete" : ""}`}
        >
          <DataTable
            rows={selectedDay.clients.map((r) => ({
              ...r,
              ...r.tokens,
              messageCount: r.messages,
              model: r.modelId,
              provider: r.providerId,
            }))}
            columns={[
              {
                key: "client",
                label: "Client",
                render: (r) => pretty(r.client),
              },
              { key: "model", label: "Model" },
              { key: "provider", label: "Provider" },
              ...TOKEN_COLS,
            ]}
          />
        </Panel>
      )}
      <div className="view-toolbar space-top">
        <ExportButton data={state.data} name="tokscale-insights" />
        {tm && (
          <span className="muted">
            Longest continuous activity:{" "}
            {(tm.longestContinuousMs / 3600000).toFixed(1)} hours
          </span>
        )}
      </div>
    </ReportState>
  );
}

function Integrations({ epoch, refresh, toCommand, home }) {
  const state = useReport(["clients", "--json", "--no-spinner", ...(home ? ["--home", home] : [])], epoch),
    [search, setSearch] = useState(""),
    [catalog, setCatalog] = useState("detected");
  const allClients = state.data?.clients || [];
  const clients = allClients.filter((r) =>
    (catalog === "all" || r.messageCount > 0 || r.sessionsPathExists) && `${r.client} ${r.label}`.toLowerCase().includes(search.trim().toLowerCase()),
  );
  return (
    <>
      <ConnectionCards epoch={epoch} refresh={refresh} />
      <ReportState state={state} onRetry={refresh}>
        <div className="notice">
          <Plug size={16} />
          <span>
            Local scan paths and original account tools. Sharing requires an
            explicit submit action.
            {home && " Local scans use your selected report home; account connections use this Windows account."}
          </span>
        </div>
        <div className="view-toolbar">
          <div className="segmented"><button className={catalog === "detected" ? "active" : ""} onClick={() => setCatalog("detected")}>Detected clients</button><button className={catalog === "all" ? "active" : ""} onClick={() => setCatalog("all")}>All supported ({allClients.length})</button></div>
          <label className="search">
            <Search size={15} />
            <input
              aria-label="Find integration"
              placeholder="Find an integration…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <button
            className="button small"
              onClick={() => toCommand("--no-spinner clients")}
          >
            Full diagnostics <TerminalSquare size={14} />
          </button>
        </div>
        <div className="integration-grid">
          {clients.map((r) => (
            <Panel
              key={r.client}
              title={r.label || pretty(r.client)}
              description={r.client}
              action={
                <span className={`badge ${r.messageCount ? "green" : ""}`}>
                  {r.messageCount
                    ? "Activity found"
                    : r.sessionsPathExists
                      ? "Path found"
                      : "Not detected"}
                </span>
              }
            >
              <div className="integration-stat">
                <strong>{compact(r.messageCount)}</strong>
                <span>local messages</span>
              </div>
              <div className="integration-path" title={r.sessionsPath}>
                <FolderOpen size={13} />
                <span>{r.sessionsPath || "No local session path"}</span>
              </div>
              {r.headlessSupported && (
                <div className="integration-extra">
                  Headless supported · {number(r.headlessMessageCount)} messages
                </div>
              )}
              {r.exporterStatus && (
                <div className="integration-extra">
                  Exporter:{" "}
                  {typeof r.exporterStatus === "string"
                    ? r.exporterStatus
                    : JSON.stringify(r.exporterStatus)}
                </div>
              )}
              <details className="integration-extra">
                <summary>Paths and diagnostics</summary>
                <pre>
                  {safeMessage(
                    JSON.stringify(
                      {
                        additionalPaths: r.additionalPaths,
                        legacyPaths: r.legacyPaths,
                        headlessPaths: r.headlessPaths,
                        extraPaths: r.extraPaths,
                        diagnostics: r.diagnostics,
                      },
                      null,
                      2,
                    ),
                  )}
                </pre>
              </details>
              <button
                className="text-button"
                onClick={() =>
                  toCommand(
                    [
                      "codex",
                      "cursor",
                      "trae",
                      "warp",
                      "antigravity",
                      "hindsight",
                    ].includes(r.client)
                      ? r.client + " --help"
                      : "clients --help",
                  )
                }
              >
                Account & integration commands <ChevronRight size={14} />
              </button>
            </Panel>
          ))}
        </div>
        {!clients.length && (
          <Empty
            title={search ? "No matching integrations" : "No local clients detected"}
            text="Account connections appear above. Browse all supported clients to inspect their session paths."
            action={catalog === "detected" && <button className="button" onClick={() => { setCatalog("all"); setSearch(""); }}>Browse supported clients</button>}
          />
        )}
        {state.data?.note && <div className="footnote">{state.data.note}</div>}
        <Panel
          className="space-top"
          title="Account tools"
          description="Credentials stay with the original Tokscale engine."
        >
          <div className="quick-actions">
            {[
              "codex accounts --help",
              "cursor accounts --help",
              "login --help",
              "logout --help",
              "whoami",
              "headless --help",
              "import --help",
            ].map((c) => (
              <button
                key={c}
                className="button small"
                onClick={() => toCommand(c)}
              >
                <TerminalSquare size={14} />
                {c.split(" ")[0]}
              </button>
            ))}
          </div>
        </Panel>
      </ReportState>
    </>
  );
}

// Arguments are passed directly to the original executable, never a shell.
function parseArgs(text) {
  const args = [];
  let word = "",
    quote = null,
    started = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote) {
        quote = null;
        started = true;
      } else word += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      started = true;
    } else if (/\s/.test(c)) {
      if (started) {
        args.push(word);
        word = "";
        started = false;
      }
    } else {
      word += c;
      started = true;
    }
  }
  if (quote)
    throw new Error("Close the quoted argument before running the command.");
  if (started) args.push(word);
  if (args[0] === "tokscale" || args[0] === "tokscale.exe") args.shift();
  return args;
}
const COMMAND_GROUPS = [
  [
    "Explore & report",
    [
      "models",
      "monthly",
      "hourly",
      "graph",
      "report",
      "clients",
      "time-metrics",
      "tui",
    ],
  ],
  ["Accounts & subscriptions", ["usage", "login", "logout", "whoami", "qr"]],
  [
    "Integrations",
    ["codex", "cursor", "trae", "warp", "antigravity", "hindsight"],
  ],
  [
    "Advanced & sharing",
    [
      "pricing",
      "headless",
      "import",
      "submit",
      "autosubmit",
      "wrapped",
      "config",
      "delete-submitted-data",
      "help",
    ],
  ],
];
function CommandCenter({ initialCommand, info, onCommandConsumed, visible }) {
  const [command, setCommand] = useState(initialCommand || "--help"),
    [status, setStatus] = useState("Ready"),
    [busy, setBusy] = useState(false),
    [help, setHelp] = useState(""),
    [catalogSearch, setCatalogSearch] = useState(""),
    [error, setError] = useState("");
  const terminalElement = useRef(null),
    term = useRef(null),
    fit = useRef(null),
    session = useRef(null),
    early = useRef([]),
    earlyExit = useRef(new Map()),
    commandRevision = useRef(0),
    running = useRef(false);
  useEffect(() => {
    if (initialCommand) {
      setCommand(initialCommand);
      onCommandConsumed();
    }
  }, [initialCommand]);
  useEffect(() => {
    let live = true;
    api.run(["--no-spinner", "--help"]).then((r) => {
      if (!live) return;
      if (r.code !== 0) { setError(safeMessage(r.stderr || "Unable to load engine help. Try running --help again.")); return; }
      setHelp(r.stdout || r.stderr);
    }, (error) => { if (live) setError(safeMessage(error.message)); });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    const t = new Terminal({
      fontFamily: "Cascadia Mono, Consolas, monospace",
      fontSize: 13,
      lineHeight: 1.35,
      cursorBlink: true,
      convertEol: true,
      scrollback: 10000,
      theme: {
        background: "#141419",
        foreground: "#dcd9e6",
        cursor: "#b7a0ff",
        selectionBackground: "#4f4267",
        black: "#141419",
        red: "#ed9b9b",
        green: "#cbec90",
        yellow: "#e8c38b",
        blue: "#91bbff",
        magenta: "#c6a8fa",
        cyan: "#8ed5d0",
        white: "#dedbe8",
      },
    });
    const f = new FitAddon();
    t.loadAddon(f);
    t.open(terminalElement.current);
    term.current = t;
    fit.current = f;
    t.writeln(
      "\x1b[38;2;183;160;255mTOKSCALE\x1b[0m  Original engine, native terminal.",
    );
    t.writeln("Run a command above, or open the interactive TUI.\r\n");
    const input = t.onData((data) => {
      if (session.current) api.writeTerminal(session.current, data).catch((error) => setError(safeMessage(error.message)));
    });
    const offData = api.onTerminalData(({ id, data }) => {
      if (session.current === id) t.write(data);
      else if (running.current) early.current.push({ id, data });
    });
    const offExit = api.onTerminalExit(({ id, code }) => {
      if (id === session.current) {
        session.current = null;
        running.current = false;
        setBusy(false);
        setStatus(`Finished · exit ${code ?? 0}`);
        t.writeln(`\r\n\x1b[90mProcess finished (${code ?? 0}).\x1b[0m`);
      } else if (running.current) {
        earlyExit.current.set(id, code);
      }
    });
    const ro = new ResizeObserver(() => {
      try {
        f.fit();
        if (session.current)
          api.resizeTerminal(session.current, t.cols, t.rows);
      } catch {}
    });
    ro.observe(terminalElement.current);
    return () => {
      commandRevision.current++;
      ro.disconnect();
      input.dispose();
      offData();
      offExit();
      if (session.current) api.stopTerminal(session.current);
      t.dispose();
    };
  }, []);
  useEffect(() => {
    if (visible)
      requestAnimationFrame(() => {
        try {
          fit.current?.fit();
          if (session.current)
            api.resizeTerminal(
              session.current,
              term.current.cols,
              term.current.rows,
            );
        } catch {}
      });
  }, [visible]);
  const execute = async (args) => {
    if (running.current) return;
    const revision = ++commandRevision.current;
    setError("");
    try {
      fit.current.fit();
      term.current.reset();
      early.current = [];
      earlyExit.current.clear();
      running.current = true;
      setBusy(true);
      setStatus(args.length ? "Running" : "Interactive TUI");
      const id = await api.startTerminal({
        args,
        cols: term.current.cols,
        rows: term.current.rows,
      });
      if (revision !== commandRevision.current) {
        await api.stopTerminal(id);
        return;
      }
      session.current = id;
      early.current
        .filter((e) => e.id === id)
        .forEach((e) => term.current.write(e.data));
      early.current = [];
      if (earlyExit.current.has(id)) {
        const code = earlyExit.current.get(id);
        session.current = null;
        running.current = false;
        setBusy(false);
        setStatus(`Finished · exit ${code ?? 0}`);
        term.current.writeln(
          `\r\n\x1b[90mProcess finished (${code ?? 0}).\x1b[0m`,
        );
        earlyExit.current.delete(id);
      }
      term.current.focus();
    } catch (e) {
      if (revision !== commandRevision.current) return;
      running.current = false;
      setBusy(false);
      setStatus("Unable to start");
      setError(safeMessage(e.message));
    }
  };
  const run = () => {
    try {
      let args = parseArgs(command);
      if (args.length)
        args = ["--no-spinner", ...args.filter((a) => a !== "--no-spinner")];
      execute(args);
    } catch (e) {
      setError(e.message);
    }
  };
  const stop = async () => {
    commandRevision.current++;
    const id = session.current;
    session.current = null;
    running.current = false;
    setBusy(false);
    setStatus("Stopped");
    if (id) {
      try { await api.stopTerminal(id); }
      catch (error) { setError(safeMessage(error.message)); }
    }
  };
  const discovered = Array.from(
    help.matchAll(/^\s{2}([a-z][\w-]+)\s{2,}(.+)$/gm),
  ).map((m) => ({ name: m[1], description: m[2] }));
  return (
    <>
      <div className="terminal-intro">
        <div>
          <h3>The whole engine. At your fingertips.</h3>
          <p>
            Original commands and interactive TUI, running directly on your
            machine.
          </p>
        </div>
        <button
          className="button"
          onClick={() => api.launchNative([]).catch((e) => setError(e.message))}
        >
          <Monitor size={15} /> Open in native terminal{" "}
          <ExternalLink size={13} />
        </button>
      </div>
      <div className="command-line">
        <span>tokscale</span>
        <input
          aria-label="Tokscale arguments"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run()}
          placeholder="models --json --today"
          spellCheck={false}
        />
        <button className="button primary" onClick={run} disabled={busy}>
          <Play size={14} /> Run
        </button>
        <button className="button" onClick={() => execute([])} disabled={busy}>
          Interactive TUI
        </button>
      </div>
      {error && <div className="inline-error">{error}</div>}
      <div className="terminal-panel">
        <div className="terminal-top">
          <span>
            <i className={busy ? "live-dot" : "idle-dot"} />
            {status}
          </span>
          <div>
            <IconButton
              icon={Copy}
              label="Copy selected terminal text"
              onClick={() => {
                const s = term.current?.getSelection();
                if (s) navigator.clipboard.writeText(s);
              }}
            />
            <IconButton
              icon={X}
              label="Clear terminal"
              onClick={() => term.current?.clear()}
            />
            {busy && (
              <IconButton
                icon={StopCircle}
                label="Stop current command"
                onClick={stop}
              />
            )}
          </div>
        </div>
        <div className="terminal-body" ref={terminalElement} />
      </div>
      <div className="footnote">
        <Command size={14} /> Ctrl+C interrupts a running command. The original
        TUI uses your normal home directory. Report home filters are not added
        here.
      </div>
      <Panel
        title="Command library"
        description="Select a command to inspect its help, then edit arguments above before running."
        action={
          <label className="search compact-search">
            <Search size={14} />
            <input
              aria-label="Search commands"
              placeholder="Find a command…"
              value={catalogSearch}
              onChange={(e) => setCatalogSearch(e.target.value)}
            />
          </label>
        }
      >
        <div className="command-catalog">
          {COMMAND_GROUPS.map(([title, cmds]) => (
            <div key={title}>
              <h4>{title}</h4>
              {cmds
                .filter((c) => c.includes(catalogSearch.toLowerCase()))
                .map((c) => (
                  <button
                    key={c}
                    onClick={() => {
                      setCommand(c === "help" ? "--help" : `${c} --help`);
                      document.querySelector(".command-line input")?.focus();
                    }}
                  >
                    <span>{c}</span>
                    <ChevronRight size={13} />
                  </button>
                ))}
            </div>
          ))}
        </div>
        {discovered.length > 0 && (
          <details className="help-details">
            <summary>
              Every command supported by this engine ({discovered.length})
            </summary>
            <div className="discovered-commands">
              {discovered
                .filter((c) =>
                  `${c.name} ${c.description}`.toLowerCase().includes(catalogSearch.toLowerCase()),
                )
                .map((c) => (
                  <button
                    key={c.name}
                    onClick={() => setCommand(`${c.name} --help`)}
                  >
                    <b>{c.name}</b>
                    <span>{c.description}</span>
                  </button>
                ))}
            </div>
          </details>
        )}
        <details className="help-details">
          <summary>Original command-line help</summary>
          <pre>{help || "Loading help…"}</pre>
        </details>
      </Panel>
    </>
  );
}

function SettingsView({ settings, setSettings, info, toCommand }) {
  const [saved, setSaved] = useState(false),
    [saving, setSaving] = useState(false),
    [error, setError] = useState("");
  const saveQueue = useRef(Promise.resolve()), saveSequence = useRef(0), toastTimer = useRef(null);
  useEffect(() => () => clearTimeout(toastTimer.current), []);
  const save = async (patch) => {
    const sequence = ++saveSequence.current;
    setError("");
    setSaved(false);
    setSaving(true);
    setSettings((current) => ({ ...current, ...patch }));
    // Send patches in order: quick changes to theme and refresh settings must
    // not overwrite one another with an older settings object.
    const task = saveQueue.current.catch(() => {}).then(() => api.saveSettings(patch));
    saveQueue.current = task;
    try {
      const persisted = await task;
      if (sequence === saveSequence.current) {
        setSettings((current) => ({ ...current, ...persisted }));
        setError("");
        setSaved(true);
        clearTimeout(toastTimer.current);
        toastTimer.current = setTimeout(() => setSaved(false), 2000);
      }
    } catch (e) {
      if (sequence === saveSequence.current) {
        setError(e.message);
        const persisted = await api.getSettings().catch(() => null);
        if (persisted && sequence === saveSequence.current) setSettings((current) => ({ ...current, ...persisted }));
      }
    } finally {
      if (sequence === saveSequence.current) setSaving(false);
    }
  };
  return (
    <>
      <Panel
        title="Make it yours"
        description="Desktop preferences are separate from the original engine’s settings."
      >
        <div className="setting-row">
          <div>
            <h4>Appearance</h4>
            <p>A quieter workspace, day or night.</p>
          </div>
          <div className="segmented">
            {[
              ["dark", Moon],
              ["light", Sun],
              ["system", Monitor],
            ].map(([v, I]) => (
              <button
                key={v}
                className={settings.theme === v ? "active" : ""}
                onClick={() => save({ theme: v })}
              >
                <I size={14} />
                {pretty(v)}
              </button>
            ))}
          </div>
        </div>
        <div className="setting-row">
          <div>
            <h4>Automatic refresh</h4>
            <p>
              Refresh reports while the app is visible. Quotas refresh on their
              own page.
            </p>
          </div>
          <select
            aria-label="Refresh interval"
            value={settings.refreshInterval}
            onChange={(e) => save({ refreshInterval: Number(e.target.value) })}
          >
            <option value="0">Manual only</option>
            <option value="60000">Every minute</option>
            <option value="120000">Every 2 minutes</option>
            <option value="300000">Every 5 minutes</option>
            <option value="900000">Every 15 minutes</option>
          </select>
        </div>
        <div className="setting-row">
          <div>
            <h4>Default date range</h4>
            <p>Your starting view when the app opens.</p>
          </div>
          <select
            aria-label="Default date range"
            value={settings.defaultPeriod}
            onChange={(e) => save({ defaultPeriod: e.target.value })}
          >
            <option value="today">Today</option>
            <option value="week">Last 7 days</option>
            <option value="month">This month</option>
            <option value="all">All time</option>
          </select>
        </div>
        <div className="setting-row">
          <div>
            <h4>Report home directory</h4>
            <p>
              Read local reports from another home. Account tools and TUI use
              the normal home.
            </p>
            <code>{settings.home || info.homePath || "Default home"}</code>
          </div>
          <div className="quick-actions">
            <button
              className="button small"
              onClick={async () => {
                try {
                  const home = await api.selectHome();
                  if (home) await save({ home });
                } catch (error) { setError(safeMessage(error.message)); }
              }}
            >
              <FolderOpen size={14} /> Choose folder
            </button>
            {settings.home && (
              <button
                className="text-button"
                onClick={() => save({ home: "" })}
              >
                Reset
              </button>
            )}
          </div>
        </div>
      </Panel>
      <Panel
        className="space-top"
        title="Engine & files"
        description="The complete upstream engine powers every view."
      >
        <div className="setting-row">
          <div>
            <h4>Tokscale Desktop</h4>
            <p>
              Desktop {info.version || "—"} · Engine {info.engineVersion || "—"}{" "}
              · {info.platform || "Windows"}
            </p>
            <code>{info.enginePath}</code>
          </div>
          <button
            className="button small"
            onClick={() => toCommand("--version")}
          >
            Engine details <TerminalSquare size={14} />
          </button>
        </div>
        <div className="setting-row">
          <div>
            <h4>Tokscale data & advanced settings</h4>
            <p>
              Manage pricing, sort preferences, account configuration and
              integrations through the original engine.
            </p>
          </div>
          <div className="quick-actions">
            <button
              className="button small"
              onClick={() => { setError(""); api.showDataFolder().catch(error => setError(safeMessage(error.message))); }}
            >
              <FolderOpen size={14} /> Data folder
            </button>
            <button
              className="button small"
              onClick={() => toCommand("--help")}
            >
              Engine help
            </button>
          </div>
        </div>
        <div className="setting-row">
          <div>
            <h4>Exports</h4>
            <p>
              Every report has an Export JSON button. Choose a location in the
              native Save dialog.
            </p>
          </div>
          <Download size={18} className="muted" />
        </div>
      </Panel>
      {saving && <div className="toast" role="status"><LoaderCircle className="spin" size={16} /> Saving preferences…</div>}
      {saved && (
        <div className="toast">
          <Check size={16} /> Preferences saved
        </div>
      )}
      {error && <div className="inline-error">{error}</div>}
    </>
  );
}

const DESCRIPTIONS = {
  overview: "A clear view of your AI usage.",
  usage: "Keep an eye on the limits that matter.",
  models: "Every model, every token, every detail.",
  activity: "Follow the rhythm of your work.",
  projects: "Understand where your tokens go.",
  insights: "Find the patterns in your activity.",
  integrations: "Your clients, accounts, and connections.",
  commands: "Full Tokscale functionality, built in.",
  settings: "Set up your workspace.",
};
function App() {
  const [page, setPage] = useState("overview"),
    [epoch, setEpoch] = useState(0),
    [info, setInfo] = useState({}),
    [settings, setSettings] = useState({
      theme: "dark",
      refreshInterval: 120000,
      home: "",
      defaultPeriod: "month",
    }),
    [period, setPeriod] = useState("month"),
    [client, setClient] = useState("all"),
    [since, setSince] = useState(""),
    [until, setUntil] = useState(""),
    [year, setYear] = useState(""),
    [filterOpen, setFilterOpen] = useState(false),
    [draftFilter, setDraftFilter] = useState({ period: "custom", since: "", until: "", year: "" }),
    [filterError, setFilterError] = useState(""),
    [command, setCommand] = useState(""),
    [ready, setReady] = useState(false),
    [lastRefresh, setLastRefresh] = useState(new Date()),
    [visible, setVisible] = useState(!document.hidden);
  useEffect(() => {
    Promise.all([api.getInfo(), api.getSettings()])
      .then(([i, s]) => {
        setInfo(i);
        setSettings((x) => ({ ...x, ...s }));
        setPeriod(s.defaultPeriod || "month");
        setReady(true);
      })
      .catch(() => setReady(true));
    const listen = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", listen);
    return () => document.removeEventListener("visibilitychange", listen);
  }, []);
  useEffect(() => {
    const openCommands = (event) => {
      if (event.ctrlKey && event.key.toLowerCase() === "k") { event.preventDefault(); setPage("commands"); }
    };
    document.addEventListener("keydown", openCommands);
    return () => document.removeEventListener("keydown", openCommands);
  }, []);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const apply = () =>
      (document.documentElement.dataset.theme =
        settings.theme === "system"
          ? media.matches
            ? "light"
            : "dark"
          : settings.theme);
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [settings.theme]);
  const refresh = useCallback(() => {
    setEpoch((n) => n + 1);
    setLastRefresh(new Date());
  }, []);
  useEffect(() => {
    if (
      !ready ||
      !visible ||
      !settings.refreshInterval ||
      page === "commands" ||
      page === "settings"
    )
      return;
    const t = setInterval(refresh, settings.refreshInterval);
    return () => clearInterval(t);
  }, [ready, visible, settings.refreshInterval, page, refresh]);
  const clientState = useReport(
    ["clients", "--json", "--no-spinner", ...(settings.home ? ["--home", settings.home] : [])],
    epoch,
    ready,
  );
  const filterArgs = useMemo(() => {
    const a = [];
    if (period === "custom") {
      if (since) a.push("--since", since);
      if (until) a.push("--until", until);
    } else if (period === "year") {
      if (year) a.push("--year", year);
    } else if (period !== "all") a.push(`--${period}`);
    if (client !== "all") a.push("--client", client);
    if (settings.home) a.push("--home", settings.home);
    return a;
  }, [period, since, until, year, client, settings.home]);
  const toCommand = (c) => {
    setCommand(c);
    setPage("commands");
  };
  const title =
    page === "settings" ? "Settings" : NAV.find((n) => n[0] === page)?.[1];
  const filtered = [
    "overview",
    "models",
    "activity",
    "projects",
    "insights",
  ].includes(page);
  return (
    <div className="app">
      <div className="titlebar">
        <div className="titlebar-name">
          <span className="brand-mini">t</span>
          <span>Tokscale Desktop</span>
        </div>
        <span className="titlebar-center">Your AI, in perspective</span>
        <div className="window-controls">
          <button
            aria-label="Minimize window"
            onClick={() => api.windowControl("minimize")}
          >
            <Minus size={14} />
          </button>
          <button
            aria-label="Maximize or restore window"
            onClick={() => api.windowControl("maximize")}
          >
            <Square size={11} />
          </button>
          <button
            aria-label="Close window"
            className="close-window"
            onClick={() => api.windowControl("close")}
          >
            <X size={15} />
          </button>
        </div>
      </div>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">
            <span />
            <span />
            <span />
          </div>
          <div>
            <strong>
              tokscale<span>desktop</span>
            </strong>
            <small>MEASURE YOUR MOMENTUM</small>
          </div>
        </div>
        <div className="nav-label">WORKSPACE</div>
        <nav>
          {NAV.map(([id, label, Icon]) => (
            <button
              key={id}
              className={page === id ? "active" : ""}
              onClick={() => setPage(id)}
            >
              <Icon size={18} />
              <span>{label}</span>
              {id === "commands" && <span className="nav-key">Ctrl K</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button
            className={page === "settings" ? "active" : ""}
            onClick={() => setPage("settings")}
          >
            <Settings size={17} />
            Settings
          </button>
          <div className="local-status">
            <i className="live-dot" />
            <div>
              <b>Runs on your machine</b>
              <span>Tokscale {info.engineVersion || "engine"}</span>
            </div>
            <ShieldCheck size={16} />
          </div>
        </div>
      </aside>
      <main className="main">
        <header className="page-header">
          <div>
            <div className="eyebrow">
              YOUR WORKSPACE <span>/</span> {title?.toUpperCase()}
            </div>
            <h1>{title}</h1>
            <p>{DESCRIPTIONS[page]}</p>
          </div>
          <div className="header-actions">
            {page !== "commands" && page !== "settings" && (
              <>
                <span className="refresh-time">
                  Refresh requested{" "}
                  {lastRefresh.toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
                <button className="button" onClick={refresh}>
                  <RefreshCw size={14} />
                  Refresh
                </button>
              </>
            )}
            <IconButton
              icon={TerminalSquare}
              label="Open command center"
              onClick={() => setPage("commands")}
            />
          </div>
        </header>
        {filtered && (
          <div className="filterbar">
            <div className="period-tabs">
              {[
                ["today", "Today"],
                ["yesterday", "Yesterday"],
                ["week", "Last 7 days"],
                ["month", "This month"],
                ["all", "All time"],
              ].map(([id, label]) => (
                <button
                  key={id}
                  className={period === id ? "active" : ""}
                  onClick={() => {
                    setPeriod(id);
                    setFilterOpen(false);
                  }}
                >
                  {label}
                </button>
              ))}
              <button
                className={["custom", "year"].includes(period) ? "active" : ""}
                aria-expanded={filterOpen}
                onClick={() => {
                  if (!filterOpen) setDraftFilter({ period: period === "year" ? "year" : "custom", since, until, year });
                  setFilterError("");
                  setFilterOpen(!filterOpen);
                }}
              >
                Custom <ChevronDown size={12} />
              </button>
            </div>
            <div className="client-select">
              <span className="filter-dot" />
              <select
                aria-label="Filter by client"
                value={client}
                onChange={(e) => setClient(e.target.value)}
              >
                <option value="all">All clients</option>
                {(clientState.data?.clients || []).map((c) => (
                  <option value={c.client} key={c.client}>
                    {c.label || pretty(c.client)}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
        {filtered && filterOpen && (
          <div className="custom-filters">
            <select aria-label="Custom date filter type" value={draftFilter.period} onChange={(event) => { const value = event.target.value; setDraftFilter((current) => ({ ...current, period: value })); setFilterError(""); }}><option value="custom">Date range</option><option value="year">Calendar year</option></select>
            {draftFilter.period === "custom" ? <>
            <label>
              From{" "}
              <input
                aria-label="Start date"
                type="date"
                value={draftFilter.since}
                onChange={(e) => {
                  const value = e.target.value;
                  setDraftFilter((current) => ({ ...current, since: value }));
                  setFilterError("");
                }}
              />
            </label>
            <label>
              Through{" "}
              <input
                aria-label="End date"
                type="date"
                value={draftFilter.until}
                onChange={(e) => {
                  const value = e.target.value;
                  setDraftFilter((current) => ({ ...current, until: value }));
                  setFilterError("");
                }}
              />
            </label>
            </> :
            <label>
              Year{" "}
              <input
                aria-label="Report year"
                type="number"
                min="2000"
                max="2100"
                placeholder="YYYY"
                value={draftFilter.year}
                onChange={(e) => {
                  const value = e.target.value;
                  setDraftFilter((current) => ({ ...current, year: value }));
                  setFilterError("");
                }}
              />
            </label>}
            <button
              className="button small"
              onClick={() => {
                const error = validateDateFilter(draftFilter);
                if (error) { setFilterError(error); return; }
                setPeriod(draftFilter.period);
                setSince(draftFilter.since);
                setUntil(draftFilter.until);
                setYear(draftFilter.year);
                setFilterError("");
                setFilterOpen(false);
              }}
            >
              Apply range
            </button>
            <button className="text-button" onClick={() => { setFilterOpen(false); setFilterError(""); }}>Cancel</button>
            {filterError && <div className="filter-error" role="alert">{filterError}</div>}
          </div>
        )}
        {filtered && <div className="filter-summary"><span>{reportRangeLabel({ period, since, until, year })} · {client === "all" ? "All clients" : clientState.data?.clients?.find((entry) => entry.client === client)?.label || pretty(client)}</span>{(client !== "all" || period !== settings.defaultPeriod) && <button className="text-button" onClick={() => { setClient("all"); setPeriod(settings.defaultPeriod); setFilterOpen(false); }}>Reset filters</button>}</div>}
        {filtered && clientState.error && <div className="filter-error" role="alert">Client list could not refresh: {clientState.error} <button className="text-button" onClick={refresh}>Retry</button></div>}
        <div className="content">
          {info.settingsWarning && (
            <div className="inline-error">{info.settingsWarning}</div>
          )}
          {!ready ? (
            <div className="loading-state">
              <LoaderCircle className="spin" size={24} />
              Connecting to the local engine…
            </div>
          ) : (
            <>
              {page === "overview" && (
                <Overview
                  args={filterArgs}
                  epoch={epoch}
                  refresh={refresh}
                  setPage={setPage}
                />
              )}{" "}
              {page === "usage" && (
                <Quotas epoch={epoch} refresh={refresh} toCommand={toCommand} />
              )}{" "}
              {page === "models" && (
                <Models
                  key="models"
                  args={filterArgs}
                  epoch={epoch}
                  refresh={refresh}
                />
              )}{" "}
              {page === "projects" && (
                <Models
                  key="projects"
                  args={filterArgs}
                  epoch={epoch}
                  refresh={refresh}
                  projects
                />
              )}{" "}
              {page === "activity" && (
                <ActivityView
                  args={filterArgs}
                  epoch={epoch}
                  refresh={refresh}
                />
              )}{" "}
              {page === "insights" && (
                <Insights args={filterArgs} epoch={epoch} refresh={refresh} />
              )}{" "}
              {page === "integrations" && (
                <Integrations
                  home={settings.home}
                  epoch={epoch}
                  refresh={refresh}
                  toCommand={toCommand}
                />
              )}{" "}
              {page === "settings" && (
                <SettingsView
                  settings={settings}
                  setSettings={setSettings}
                  info={info}
                  toCommand={toCommand}
                />
              )}
              <div style={{ display: page === "commands" ? "block" : "none" }}>
                <CommandCenter
                  initialCommand={command}
                  info={info}
                  visible={page === "commands"}
                  onCommandConsumed={() => setCommand("")}
                />
              </div>
            </>
          )}
        </div>
        <footer className="app-footer">
          <span>
            <i className="live-dot" /> LOCAL ENGINE
          </span>
          <span>
            {settings.home ? "Custom report home" : "Local usage records"}{" "}
            <b>·</b> USD cost estimates
          </span>
          <button
            onClick={() =>
              api.openExternal("https://github.com/junhoyeo/tokscale")
            }
          >
            Powered by Tokscale <ExternalLink size={11} />
          </button>
        </footer>
      </main>
    </div>
  );
}

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  render() {
    return this.state.error ? (
      <div className="fatal">
        <AlertCircle size={28} />
        <h2>Something went wrong</h2>
        <p>{this.state.error.message}</p>
        <button className="button" onClick={() => location.reload()}>
          Reload desktop
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}
createRoot(document.getElementById("root")).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
