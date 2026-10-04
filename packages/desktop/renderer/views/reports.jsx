import React, { useEffect, useMemo, useState } from "react";
import { ArrowRight } from "lucide-react";
import { api, useReport } from "../use-report.js";
import {
  Button,
  Card,
  DataTable,
  Empty,
  ExportButton,
  Notice,
  ReportState,
  Segmented,
  Select,
  Stat,
} from "../ui.jsx";
import { BarChart, Heatmap, SERIES, ShareBar } from "../charts.jsx";
import {
  brand,
  compact,
  dateLabel,
  dateTime,
  hours,
  longDate,
  money,
  monthLabel,
  number,
  pct,
  safeMessage,
} from "../format.js";
import {
  tokenTotal,
  modelTokenTotal,
  graphAverageTokens,
  calendarContributionCells,
  ALL_TOKEN_TYPES,
  TOKEN_TYPES,
  tokenTypesDetail,
} from "../report-data.js";

const METRICS = [
  ["cost", "Cost"],
  ["tokens", "Tokens"],
];
const formatMetric = (metric) => (metric === "cost" ? money : number);
const axisMetric = (metric) =>
  metric === "cost"
    ? (v) =>
        v >= 100
          ? `$${compact(v)}`
          : v > 0 && v < 0.1
            ? `$${Number(v.toPrecision(2))}` // sub-cent ticks would all round to $0.00
            : money(v)
    : compact;

// Colour follows the provider, not its rank, so a filter never repaints it.
const KNOWN_PROVIDERS = ["anthropic", "openai", "google", "xai"];
function providerShares(rows) {
  const totals = new Map();
  for (const row of rows) {
    const name = String(row.provider || row.client || "unknown").toLowerCase();
    totals.set(name, (totals.get(name) || 0) + Number(row.cost || 0));
  }
  const others = [...totals.keys()]
    .filter((name) => !KNOWN_PROVIDERS.includes(name))
    .sort();
  const slot = (name) =>
    KNOWN_PROVIDERS.includes(name)
      ? KNOWN_PROVIDERS.indexOf(name)
      : KNOWN_PROVIDERS.length + others.indexOf(name);
  const items = [];
  let rest = 0;
  for (const [name, value] of [...totals].sort((a, b) => b[1] - a[1])) {
    if (slot(name) < 7)
      items.push({
        id: name,
        label: brand(name),
        value,
        color: SERIES[slot(name)],
      });
    else rest += value;
  }
  if (rest) items.push({ label: "Other", value: rest, color: "var(--text-3)" });
  return items;
}

const STACKS = [
  ["none", "None"],
  ["model", "Model"],
  ["provider", "Provider"],
  ["client", "Client"],
];
// Hourly and monthly reports carry no per-row breakdown, so only daily bars stack.
function stackSegments(by, metric, rowsOf, include) {
  if (by === "none") return undefined;
  return (entry) => {
    const sums = new Map();
    for (const row of rowsOf(entry) || []) {
      const key = String(
        (by === "model" ? row.modelId : by === "provider" ? row.providerId : row.client) ||
          "unknown",
      );
      const value = metric === "cost" ? Number(row.cost) || 0 : tokenTotal(row.tokens, include);
      sums.set(key, (sums.get(key) || 0) + value);
    }
    return [...sums].map(([key, value]) => ({
      key,
      label: by === "model" ? key : brand(key),
      value,
    }));
  };
}
function StackSelect({ value, onChange }) {
  return (
    <Select
      prefix="Stack by"
      label="Stack by"
      value={value}
      onChange={(e) => onChange(e.target.value)}
    >
      {STACKS.map(([id, text]) => (
        <option key={id} value={id}>
          {text}
        </option>
      ))}
    </Select>
  );
}

function ChartSlot({ state, onRetry, children }) {
  if (state.error && !state.data)
    return (
      <Notice
        tone="error"
        action={
          <Button small onClick={onRetry}>
            Try again
          </Button>
        }
      >
        {state.error}
      </Notice>
    );
  if (!state.data) return <div className="loading-state chart-placeholder" />;
  return children;
}

export function Overview({
  args,
  epoch,
  refresh,
  setPage,
  focusDay,
  setClient,
  clientIds = [],
  openModels,
  tokenTypes = ALL_TOKEN_TYPES,
}) {
  const models = useReport(["models", "--json", ...args], epoch),
    graph = useReport(args, epoch, true, true),
    [metric, setMetric] = useState("cost"),
    [stack, setStack] = useState("model");
  const d = models.data,
    rows = d?.entries || [],
    days = graph.data?.contributions || [];
  const total = modelTokenTotal(d, tokenTypes),
    allTotal = modelTokenTotal(d);
  const reasoning = rows.reduce((sum, row) => sum + Number(row.reasoning || 0), 0);
  const top = [...rows].sort((a, b) => Number(b.cost) - Number(a.cost)).slice(0, 6);
  const activeDays = graph.data?.summary?.activeDays;
  return (
    <ReportState state={models} onRetry={refresh}>
      <div className="metrics">
        <Stat
          label="Estimated cost"
          value={money(d?.totalCost)}
          detail="At published model prices"
        />
        <Stat
          label="Tokens"
          value={compact(total)}
          detail={tokenTypesDetail(tokenTypes)}
        />
        <Stat
          label="Messages"
          value={number(d?.totalMessages)}
          detail={
            activeDays > 0
              ? `Across ${activeDays} active day${activeDays === 1 ? "" : "s"}`
              : `${rows.length} model${rows.length === 1 ? "" : "s"}`
          }
        />
        <Stat
          label="Cache share"
          value={pct(allTotal ? ((d?.totalCacheRead || 0) / allTotal) * 100 : 0)}
          detail={`${compact(d?.totalCacheRead)} tokens read from cache`}
        />
      </div>
      <div className="overview-grid">
        <Card
          title={metric === "cost" ? "Daily cost" : "Daily tokens"}
          action={
            <>
              <StackSelect value={stack} onChange={setStack} />
              <Segmented
                label="Chart metric"
                options={METRICS}
                value={metric}
                onChange={setMetric}
              />
              <ExportButton data={graph.data} name="tokscale-activity" />
            </>
          }
        >
          <ChartSlot state={graph} onRetry={refresh}>
            <BarChart
              title={`${metric} by day`}
              entries={days}
              value={(day) =>
                metric === "tokens"
                  ? tokenTotal(day.tokenBreakdown, tokenTypes)
                  : day.totals?.[metric]
              }
              label={(day) => dateLabel(day.date)}
              format={formatMetric(metric)}
              axisFormat={axisMetric(metric)}
              height={300}
              segments={stackSegments(stack, metric, (day) => day.clients, tokenTypes)}
              onSelect={(day) => focusDay(day.date)}
              onLegendSelect={setClient}
              legendSelectable={stack === "client" ? (key) => clientIds.includes(key) : () => false}
            />
          </ChartSlot>
        </Card>
        <div className="overview-side">
          <Card title="Cost by provider">
            {rows.length ? (
              <ShareBar
                items={providerShares(rows)}
                format={money}
                onSelect={(item) => openModels(item.id)}
              />
            ) : (
              <Empty text="Provider costs appear once usage is recorded." />
            )}
          </Card>
          <Card title="Token mix">
            <ShareBar
              format={compact}
              items={[
                d?.totalInput,
                d?.totalOutput,
                d?.totalCacheRead,
                d?.totalCacheWrite,
                reasoning,
              ]
                .map((value, i) => ({
                  key: TOKEN_TYPES[i][0],
                  label: TOKEN_TYPES[i][1],
                  value: Number(value) || 0,
                  color: SERIES[i],
                }))
                .filter((item) => tokenTypes.includes(item.key))}
            />
          </Card>
        </div>
      </div>
      <Card
          title="Top models"
          action={
            <Button
              variant="ghost"
              small
              iconEnd={ArrowRight}
              onClick={() => setPage("models")}
            >
              All models
            </Button>
          }
        >
          {top.length ? (
            <table className="plain-table">
              <thead>
                <tr>
                  <th>Model</th>
                  <th className="numeric">Tokens</th>
                  <th className="numeric">Messages</th>
                  <th className="numeric">Cost</th>
                  <th className="numeric">Share</th>
                </tr>
              </thead>
              <tbody>
                {top.map((r, i) => (
                  <tr
                    key={i}
                    role="button"
                    tabIndex={0}
                    onClick={() => openModels(r.model)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        openModels(r.model);
                      }
                    }}
                  >
                    <td>
                      <b>{r.model}</b>
                      <small>
                        {brand(r.client)} · {brand(r.provider)}
                      </small>
                    </td>
                    <td className="numeric">{compact(tokenTotal(r, tokenTypes))}</td>
                    <td className="numeric">{number(r.messageCount)}</td>
                    <td className="numeric">{money(r.cost)}</td>
                    <td className="numeric muted">
                      {d?.totalCost ? pct((r.cost / d.totalCost) * 100) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty />
          )}
      </Card>
      <p className="footnote">
        Read from local usage records on this machine. Estimates can differ from
        your bill.
      </p>
    </ReportState>
  );
}

const tokenCols = (include) => [
  {
    key: "totalTokens",
    label: "Tokens",
    numeric: true,
    sortValue: (r) => tokenTotal(r, include),
    render: (r) => <b>{number(tokenTotal(r, include))}</b>,
  },
  { key: "input", label: "Input", numeric: true, render: (r) => number(r.input) },
  { key: "output", label: "Output", numeric: true, render: (r) => number(r.output) },
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
    label: "Cost",
    numeric: true,
    render: (r) => <b>{money(r.cost)}</b>,
  },
];
const pick = (cols, ...keys) => cols.filter((column) => keys.includes(column.key));

const GROUPS = [
  ["model", "Model"],
  ["client,model", "Client and model"],
  ["client,provider,model", "Client, provider and model"],
  ["workspace,model", "Workspace and model"],
  ["session,model", "Session and model"],
  ["client,session,model", "Client, session and model"],
];

export function Models({ args, epoch, refresh, search = "", tokenTypes = ALL_TOKEN_TYPES }) {
  const [group, setGroup] = useState("client,provider,model"),
    [merge, setMerge] = useState(false);
  const state = useReport(
    [
      "models",
      "--json",
      "--group-by",
      group,
      ...(merge && group === "workspace,model" ? ["--merge-worktrees"] : []),
      ...args,
    ],
    epoch,
  );
  const rows = state.data?.entries || [];
  const columns = useMemo(
    () => [
      ...(group.includes("workspace")
        ? [
            {
              key: "workspaceLabel",
              label: "Workspace",
              render: (r) => r.workspaceLabel || r.workspaceKey || "Unknown",
            },
          ]
        : []),
      ...(group.includes("session")
        ? [
            {
              key: "sessionId",
              label: "Session",
              render: (r) => (
                <code title={r.sessionId}>{r.sessionId?.slice(-12) || "—"}</code>
              ),
            },
          ]
        : []),
      { key: "model", label: "Model", render: (r) => <b>{r.model}</b> },
      ...(group.includes("client")
        ? [
            {
              key: "client",
              label: "Client",
              render: (r) => brand(r.mergedClients || r.client),
            },
          ]
        : []),
      ...(group.includes("provider")
        ? [{ key: "provider", label: "Provider", render: (r) => brand(r.provider) }]
        : []),
      ...tokenCols(tokenTypes),
      {
        key: "performance",
        label: "ms / 1K",
        numeric: true,
        sortValue: (r) => r.performance?.msPer1KTokens,
        render: (r) =>
          r.performance?.msPer1KTokens == null
            ? "—"
            : number(Math.round(r.performance.msPer1KTokens)),
      },
    ],
    [group, tokenTypes],
  );
  return (
    <>
      <div className="view-toolbar">
        <Select
          prefix="Group by"
          label="Group by"
          value={group}
          onChange={(e) => setGroup(e.target.value)}
        >
          {GROUPS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
        {group === "workspace,model" && (
          <label className="check-label">
            <input
              type="checkbox"
              checked={merge}
              onChange={(e) => setMerge(e.target.checked)}
            />
            Merge worktrees
          </label>
        )}
        <div className="toolbar-end">
          <ExportButton data={state.data} name="tokscale-models" />
        </div>
      </div>
      <ReportState state={state} onRetry={refresh}>
        <Card className="table-card">
          <DataTable
            rows={rows}
            columns={columns}
            summary={`${money(state.data?.totalCost)} estimated`}
            searchPlaceholder="Search models"
            initialSearch={search}
          />
        </Card>
      </ReportState>
    </>
  );
}

export function Sessions({ args, epoch, refresh, tokenTypes = ALL_TOKEN_TYPES }) {
  const [view, setView] = useState("sessions"),
    [merge, setMerge] = useState(false),
    [titles, setTitles] = useState({ titles: {} });
  const home = args.includes("--home") ? args[args.indexOf("--home") + 1] : "";
  useEffect(() => {
    if (!api.getSessionTitles) return;
    let live = true;
    api.getSessionTitles(home).then(
      (result) => live && setTitles(result),
      (error) =>
        live && setTitles({ titles: {}, warning: safeMessage(error.message) }),
    );
    return () => {
      live = false;
    };
  }, [home, epoch]);
  const sessions = view === "sessions";
  const state = useReport(
    [
      "models",
      "--json",
      "--group-by",
      sessions ? "client,session,model" : "workspace,model",
      ...(merge && !sessions ? ["--merge-worktrees"] : []),
      ...args,
    ],
    epoch,
  );
  const rows = useMemo(
    () =>
      (state.data?.entries || []).map((row) =>
        sessions
          ? {
              ...row,
              sessionTitle: titles.titles?.[row.sessionId] || null,
            }
          : row,
      ),
    [state.data, sessions, titles],
  );
  const columns = useMemo(
    () => [
      sessions
        ? {
            key: "sessionTitle",
            label: "Session",
            sortValue: (r) => r.sessionTitle || r.sessionId,
            render: (r) => (
              <div className="stack-cell" title={r.sessionId}>
                <b>
                  {r.sessionTitle ||
                    (r.client === "codex"
                      ? "Untitled Codex chat"
                      : `${brand(r.client)} session`)}
                </b>
                <small>{r.sessionId?.slice(-12)}</small>
              </div>
            ),
          }
        : {
            key: "workspaceLabel",
            label: "Workspace",
            render: (r) => (
              <b>{r.workspaceLabel || r.workspaceKey || "Unknown workspace"}</b>
            ),
          },
      { key: "model", label: "Model" },
      {
        key: "client",
        label: "Client",
        render: (r) => brand(r.mergedClients || r.client),
      },
      ...pick(tokenCols(tokenTypes), "totalTokens", "messageCount", "cost"),
    ],
    [sessions, tokenTypes],
  );
  return (
    <>
      <div className="view-toolbar">
        <Segmented
          label="Group by"
          value={view}
          onChange={setView}
          options={[
            ["sessions", "Sessions"],
            ["workspaces", "Workspaces"],
          ]}
        />
        {!sessions && (
          <label className="check-label">
            <input
              type="checkbox"
              checked={merge}
              onChange={(e) => setMerge(e.target.checked)}
            />
            Merge worktrees
          </label>
        )}
        <div className="toolbar-end">
          <ExportButton data={state.data} name="tokscale-sessions" />
        </div>
      </div>
      <ReportState state={state} onRetry={refresh}>
        <Card className="table-card">
          <DataTable
            rows={rows}
            columns={columns}
            summary={`${money(state.data?.totalCost)} estimated`}
            searchPlaceholder={sessions ? "Search sessions" : "Search workspaces"}
          />
        </Card>
        <p className="footnote">
          {sessions
            ? "Saved chat names are shown when available."
            : "A workspace is a folder and can contain several sessions."}
          {titles.warning ? ` Saved chat titles: ${titles.warning}` : ""}
        </p>
      </ReportState>
    </>
  );
}

const MODES = [
  ["daily", "Daily"],
  ["hourly", "Hourly"],
  ["monthly", "Monthly"],
];
export function ActivityView({
  args,
  epoch,
  refresh,
  focusDay,
  setClient,
  clientIds = [],
  tokenTypes = ALL_TOKEN_TYPES,
}) {
  const [mode, setMode] = useState("daily"),
    [metric, setMetric] = useState("cost"),
    [stack, setStack] = useState("model");
  const state = useReport(
    mode === "daily" ? args : [mode, "--json", ...args],
    epoch,
    true,
    mode === "daily",
  );
  const key = mode === "daily" ? "date" : mode === "monthly" ? "month" : "hour";
  const periodLabel =
    mode === "daily" ? dateLabel : mode === "monthly" ? monthLabel : dateTime;
  const rows = useMemo(
    () =>
      mode === "daily"
        ? (state.data?.contributions || []).map((d) => ({
            date: d.date,
            ...d.tokenBreakdown,
            messageCount: d.totals?.messages,
            cost: d.totals?.cost,
            tokens: tokenTotal(d.tokenBreakdown, tokenTypes),
            activeTimeMs: d.activeTimeMs,
          }))
        : (state.data?.entries || []).map((r) => ({
            ...r,
            tokens:
              tokenTypes.length === ALL_TOKEN_TYPES.length
                ? (r.tokens ?? tokenTotal(r))
                : tokenTotal(r, tokenTypes),
          })),
    [state.data, mode, tokenTypes],
  );
  const dayClients = useMemo(
    () => new Map((state.data?.contributions || []).map((d) => [d.date, d.clients])),
    [state.data],
  );
  const columns = useMemo(
    () => [
      {
        key,
        label: mode === "daily" ? "Date" : mode === "monthly" ? "Month" : "Hour",
        render: (r) => <b>{periodLabel(r[key])}</b>,
      },
      ...tokenCols(tokenTypes),
      ...(mode === "hourly"
        ? [
            {
              key: "turnCount",
              label: "Turns",
              numeric: true,
              render: (r) => number(r.turnCount),
            },
          ]
        : []),
    ],
    [mode, tokenTypes],
  );
  return (
    <>
      <div className="view-toolbar">
        <Segmented label="Period" options={MODES} value={mode} onChange={setMode} />
        <div className="toolbar-end">
          <Segmented
            label="Chart metric"
            options={METRICS}
            value={metric}
            onChange={setMetric}
          />
          <ExportButton data={state.data} name={`tokscale-${mode}`} />
        </div>
      </div>
      <ReportState state={state} onRetry={refresh}>
        <Card
          title={`${MODES.find(([id]) => id === mode)[1]} ${metric === "cost" ? "cost" : "tokens"}`}
          description={
            mode === "hourly"
              ? "Hourly reports leave out reasoning tokens."
              : undefined
          }
          action={
            mode === "daily" ? <StackSelect value={stack} onChange={setStack} /> : undefined
          }
        >
          <BarChart
            title={`${metric} by ${key}`}
            entries={rows}
            value={(r) => r[metric]}
            label={(r) => periodLabel(r[key])}
            format={formatMetric(metric)}
            axisFormat={axisMetric(metric)}
            segments={
              mode === "daily"
                ? stackSegments(stack, metric, (r) => dayClients.get(r.date), tokenTypes)
                : undefined
            }
            onSelect={mode === "daily" ? (r) => focusDay(r.date) : undefined}
            onLegendSelect={setClient}
            legendSelectable={stack === "client" ? (k) => clientIds.includes(k) : () => false}
          />
        </Card>
        <Card className="table-card">
          <DataTable
            key={mode}
            rows={rows}
            columns={columns}
            defaultSort={key}
            defaultDirection={-1}
            searchPlaceholder="Search periods"
          />
        </Card>
      </ReportState>
    </>
  );
}

const HEAT_METRICS = [
  ["tokens", "Tokens"],
  ["cost", "Cost"],
  ["messages", "Messages"],
];
export function Insights({ args, epoch, refresh, tokenTypes = ALL_TOKEN_TYPES }) {
  const state = useReport(args, epoch, true, true),
    [selected, setSelected] = useState(null),
    [metric, setMetric] = useState("tokens");
  const days = state.data?.contributions || [];
  const cells = useMemo(() => calendarContributionCells(days), [state.data]);
  const sum = state.data?.summary || {},
    tm = state.data?.timeMetrics;
  const selectedDay = days.find((d) => d.date === selected);
  const show = (v) => (metric === "cost" ? money(v) : number(v));
  const dayValue = (day) =>
    metric === "tokens"
      ? tokenTotal(day.tokenBreakdown, tokenTypes)
      : Number(day.totals?.[metric]) || 0;
  const dayRows = useMemo(
    () =>
      (selectedDay?.clients || []).map((r) => ({
        ...r,
        ...r.tokens,
        messageCount: r.messages,
        model: r.modelId,
        provider: r.providerId,
      })),
    [selectedDay],
  );
  const dayColumns = useMemo(
    () => [
      { key: "model", label: "Model", render: (r) => <b>{r.model}</b> },
      { key: "client", label: "Client", render: (r) => brand(r.client) },
      { key: "provider", label: "Provider", render: (r) => brand(r.provider) },
      ...tokenCols(tokenTypes),
    ],
    [tokenTypes],
  );
  return (
    <ReportState state={state} onRetry={refresh}>
      <div className="metrics">
        <Stat
          label="Active days"
          value={number(sum.activeDays)}
          detail={`Of ${number(cells.filter(Boolean).length)} in this span`}
        />
        <Stat
          label="Daily average"
          value={compact(graphAverageTokens(state.data, tokenTypes))}
          detail="Tokens per calendar day"
        />
        <Stat
          label="Largest day"
          value={money(sum.maxCostInSingleDay)}
          detail="Estimated cost"
        />
        <Stat
          label="Active time"
          value={tm ? hours(tm.totalActiveTimeMs) : "—"}
          detail={
            tm
              ? `${number(tm.sessionCount)} sessions · longest ${hours(tm.longestContinuousMs)}`
              : "Not reported"
          }
        />
      </div>
      <Card
        title="Activity calendar"
        description={
          days.length
            ? `${longDate(days[0].date)} to ${longDate(days.at(-1).date)}. Select a day to see its models.`
            : undefined
        }
        action={
          <>
            <Segmented
              label="Calendar metric"
              options={HEAT_METRICS}
              value={metric}
              onChange={setMetric}
            />
            <ExportButton data={state.data} name="tokscale-insights" />
          </>
        }
      >
        {days.length ? (
          <Heatmap
            cells={cells}
            selected={selected}
            onSelect={setSelected}
            valueOf={dayValue}
            describe={(cell) =>
              cell.contribution
                ? `${dateLabel(cell.date)}: ${show(dayValue(cell.contribution))} ${metric === "cost" ? "" : metric}`.trim()
                : `${dateLabel(cell.date)}: no activity`
            }
          />
        ) : (
          <Empty />
        )}
      </Card>
      {selectedDay && (
        <Card
          className="table-card"
          title={longDate(selectedDay.date)}
          description={`${number(tokenTotal(selectedDay.tokenBreakdown, tokenTypes))} tokens · ${money(selectedDay.totals.cost)} · ${number(selectedDay.totals.messages)} messages${selectedDay.totals.costIsComplete === false ? " · cost data incomplete" : ""}`}
        >
          <DataTable rows={dayRows} columns={dayColumns} />
        </Card>
      )}
    </ReportState>
  );
}
