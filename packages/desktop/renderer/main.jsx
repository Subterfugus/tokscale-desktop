import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  AlertCircle,
  ArrowDownCircle,
  Loader2,
  BarChart3,
  CalendarDays,
  ChevronDown,
  Gauge,
  Layers,
  LayoutDashboard,
  MessagesSquare,
  Plug,
  RefreshCw,
  Settings,
  SlidersHorizontal,
  TerminalSquare,
  X,
} from "lucide-react";
import "./styles.css";
import { api, useReport } from "./use-report.js";
import { Button, IconButton, Notice, Popover, Select, Toaster } from "./ui.jsx";
import { brand, clock, dateLabel, updateLabel } from "./format.js";
import {
  ALL_TOKEN_TYPES,
  TOKEN_TYPES,
  normalizeTokenTypes,
  validateDateFilter,
  reportRangeLabel,
} from "./report-data.js";
import { cssVariable, resolveTheme } from "./themes.js";
import {
  ActivityView,
  Insights,
  Models,
  Overview,
  Sessions,
} from "./views/reports.jsx";
import { Connections, Limits } from "./views/accounts.jsx";
import { TerminalView } from "./views/terminal.jsx";
import { SettingsView } from "./views/settings.jsx";

const NAV = [
  [
    "Reports",
    [
      ["overview", "Overview", LayoutDashboard],
      ["models", "Models", Layers],
      ["activity", "Activity", Activity],
      ["projects", "Sessions", MessagesSquare],
      ["insights", "Insights", BarChart3],
    ],
  ],
  [
    "Accounts",
    [
      ["usage", "Limits", Gauge],
      ["integrations", "Connections", Plug],
    ],
  ],
  ["Tools", [["commands", "Terminal", TerminalSquare]]],
];
const PAGES = [...NAV.flatMap(([, items]) => items), ["settings", "Settings"]];
const PERIODS = [
  ["today", "Today"],
  ["yesterday", "Yesterday"],
  ["week", "7 days"],
  ["month", "Month"],
  ["all", "All time"],
];
const FILTERED = ["overview", "models", "activity", "projects", "insights"];

function Logo() {
  return (
    <svg className="logo" viewBox="0 0 20 20" aria-hidden="true">
      <rect x="2" y="10" width="4" height="8" rx="1.5" />
      <rect x="8" y="5" width="4" height="13" rx="1.5" />
      <rect x="14" y="2" width="4" height="16" rx="1.5" />
    </svg>
  );
}

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
    [saved, setSaved] = useState(null),
    [modelSearch, setModelSearch] = useState(""),
    [filterOpen, setFilterOpen] = useState(false),
    [tokenTypes, setTokenTypes] = useState(ALL_TOKEN_TYPES),
    [typesOpen, setTypesOpen] = useState(false),
    [draft, setDraft] = useState({ period: "custom", since: "", until: "", year: "" }),
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
        setTokenTypes(normalizeTokenTypes(s.tokenTypes));
        setReady(true);
      })
      .catch(() => setReady(true));
    // Only the mini window's switch changes outside this window (tray menu).
    // Taking every broadcast key would let an older save briefly overwrite a
    // newer choice made here.
    const offSettings = api.onSettingsChanged((s) =>
      setSettings((x) =>
        (x.miniEnabled !== false) === (s.miniEnabled !== false)
          ? x
          : { ...x, miniEnabled: s.miniEnabled },
      ),
    );
    const listen = () => setVisible(!document.hidden);
    document.addEventListener("visibilitychange", listen);
    return () => {
      offSettings();
      document.removeEventListener("visibilitychange", listen);
    };
  }, []);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const apply = () => {
      const theme = resolveTheme(settings.theme, !media.matches),
        root = document.documentElement;
      root.dataset.theme = theme.id;
      root.dataset.scheme = theme.scheme;
      for (const [key, value] of Object.entries(theme.colors))
        root.style.setProperty(cssVariable(key), value);
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [settings.theme]);
  const refresh = useCallback(() => {
    setEpoch((n) => n + 1);
    setLastRefresh(new Date());
  }, []);
  const refreshable = page !== "commands" && page !== "settings";
  useEffect(() => {
    const shortcuts = (event) => {
      // Inside the terminal these keys belong to the running program.
      if (!event.ctrlKey || event.altKey || event.target.closest?.(".xterm"))
        return;
      const key = event.key.toLowerCase();
      if (key === "k") setPage("commands");
      else if (key === "r" && refreshable) refresh();
      else if (key === ",") setPage("settings");
      else if (/^[1-8]$/.test(key)) setPage(PAGES[Number(key) - 1][0]);
      else return;
      event.preventDefault();
    };
    document.addEventListener("keydown", shortcuts);
    return () => document.removeEventListener("keydown", shortcuts);
  }, [refresh, refreshable]);
  useEffect(() => {
    if (!ready || !visible || !settings.refreshInterval || !refreshable) return;
    const t = setInterval(refresh, settings.refreshInterval);
    return () => clearInterval(t);
  }, [ready, visible, settings.refreshInterval, refreshable, refresh]);
  const clientState = useReport(
    ["clients", "--json", ...(settings.home ? ["--home", settings.home] : [])],
    epoch,
    ready,
  );
  useEffect(() => {
    setFilterOpen(false);
    setTypesOpen(false);
  }, [page]);
  // A client that is not in the current list (after changing the report
  // home, say) would silently empty every report.
  useEffect(() => {
    const list = clientState.data?.clients;
    if (list && client !== "all" && !list.some((c) => c.client === client))
      setClient("all");
  }, [clientState.data, client]);
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
  const focusDay = (date) => {
    setSaved((s) => s || { period, since, until, year });
    setPeriod("custom");
    setSince(date);
    setUntil(date);
    setYear("");
    setFilterOpen(false);
  };
  const clearDay = () => {
    if (!saved) return;
    setPeriod(saved.period);
    setSince(saved.since);
    setUntil(saved.until);
    setYear(saved.year);
    setSaved(null);
  };
  const openModels = (text) => {
    setModelSearch(text);
    setPage("models");
  };
  useEffect(() => {
    if (page !== "models") setModelSearch("");
  }, [page]);
  const [update, setUpdate] = useState(null);
  useEffect(() => {
    let alive = true, revision = 0;
    api.appUpdateStatus().then((status) => { if (alive && revision === 0) setUpdate(status); }).catch(() => {});
    const off = api.onAppUpdateStatus((status) => { revision++; if (alive) setUpdate(status); });
    return () => { alive = false; off(); };
  }, []);
  const updateReady = settings.appUpdateChecks !== false && update?.available;
  const updateBusy = ["downloading", "restarting"].includes(update?.install?.phase);
  const toCommand = (c) => {
    setCommand(c);
    setPage("commands");
  };
  const closeFilter = useCallback(() => setFilterOpen(false), []);
  const closeTypes = useCallback(() => setTypesOpen(false), []);
  const changeTokenTypes = (keys) => {
    const next = normalizeTokenTypes(keys);
    setTokenTypes(next);
    try {
      Promise.resolve(api.saveSettings({ tokenTypes: next })).catch(() => {});
    } catch {}
  };
  const toggleTokenType = (key, on) =>
    changeTokenTypes(
      on ? [...tokenTypes, key] : tokenTypes.filter((k) => k !== key),
    );
  const allTypes = tokenTypes.length === ALL_TOKEN_TYPES.length;
  const editDraft = (patch) => {
    setDraft((current) => ({ ...current, ...patch }));
    setFilterError("");
  };
  const applyDraft = () => {
    const error = validateDateFilter(draft);
    if (error) {
      setFilterError(error);
      return;
    }
    setSaved(null);
    setPeriod(draft.period);
    setSince(draft.since);
    setUntil(draft.until);
    setYear(draft.year);
    setFilterOpen(false);
  };
  const title = PAGES.find(([id]) => id === page)[1];
  const filtered = FILTERED.includes(page);
  const customActive = ["custom", "year"].includes(period);
  const clients = clientState.data?.clients || [];
  const navButton = ([id, label, Icon]) => (
    <button
      type="button"
      key={id}
      className={page === id ? "active" : ""}
      aria-current={page === id ? "page" : undefined}
      onClick={() => setPage(id)}
    >
      <Icon size={16} />
      <span>{label}</span>
    </button>
  );
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <Logo />
          <strong>Tokscale</strong>
        </div>
        <nav aria-label="Pages">
          {NAV.map(([group, items]) => (
            <React.Fragment key={group}>
              <h2>{group}</h2>
              {items.map(navButton)}
            </React.Fragment>
          ))}
        </nav>
        <div className="sidebar-bottom">
          {navButton(["settings", "Settings", Settings])}
          <small>Engine {info.engineVersion || "…"}</small>
        </div>
      </aside>
      <main className="main">
        <header className="page-header">
          <h1>{title}</h1>
          {(refreshable || updateReady) && (
            <div className="header-actions">
              {refreshable && <span className="refresh-time">Updated {clock(lastRefresh)}</span>}
              {updateReady && (
                <IconButton
                  icon={updateBusy ? Loader2 : ArrowDownCircle}
                  spin={updateBusy}
                  disabled={updateBusy}
                  className="icon-button update-ready"
                  label={updateLabel(update)}
                  onClick={() => api.appUpdateInstall().catch(() => {})}
                />
              )}
              {refreshable && (
                <IconButton
                  icon={RefreshCw}
                  label="Refresh (Ctrl+R)"
                  onClick={refresh}
                />
              )}
            </div>
          )}
        </header>
        {filtered && (
          <div className="filterbar">
            <div className="period-tabs popover-anchor">
              <div className="segmented" role="group" aria-label="Date range">
                {PERIODS.map(([id, label]) => (
                  <button
                    type="button"
                    key={id}
                    className={period === id ? "active" : ""}
                    aria-pressed={period === id}
                    onClick={() => {
                      setSaved(null);
                      setPeriod(id);
                      setFilterOpen(false);
                    }}
                  >
                    {label}
                  </button>
                ))}
                <button
                  type="button"
                  className={customActive ? "active" : ""}
                  aria-pressed={customActive}
                  aria-expanded={filterOpen}
                  onClick={() => {
                    if (!filterOpen)
                      setDraft({
                        period: period === "year" ? "year" : "custom",
                        since,
                        until,
                        year,
                      });
                    setFilterError("");
                    setTypesOpen(false);
                    setFilterOpen(!filterOpen);
                  }}
                >
                  <CalendarDays size={13} />
                  Custom
                  <ChevronDown size={12} />
                </button>
              </div>
              <Popover
                open={filterOpen}
                onClose={closeFilter}
                label="Custom date range"
                className="custom-filters"
              >
                <Select
                  label="Custom date filter type"
                  value={draft.period}
                  onChange={(e) => editDraft({ period: e.target.value })}
                >
                  <option value="custom">Date range</option>
                  <option value="year">Calendar year</option>
                </Select>
                {draft.period === "custom" ? (
                  <div className="field-pair">
                    <label className="field">
                      From
                      <input
                        aria-label="Start date"
                        type="date"
                        value={draft.since}
                        onChange={(e) => editDraft({ since: e.target.value })}
                      />
                    </label>
                    <label className="field">
                      Through
                      <input
                        aria-label="End date"
                        type="date"
                        value={draft.until}
                        onChange={(e) => editDraft({ until: e.target.value })}
                      />
                    </label>
                  </div>
                ) : (
                  <label className="field">
                    Year
                    <input
                      aria-label="Report year"
                      type="number"
                      min="2000"
                      max="2100"
                      placeholder="YYYY"
                      value={draft.year}
                      onChange={(e) => editDraft({ year: e.target.value })}
                    />
                  </label>
                )}
                {filterError && (
                  <div className="filter-error" role="alert">
                    {filterError}
                  </div>
                )}
                <div className="popover-actions">
                  <Button variant="ghost" small onClick={closeFilter}>
                    Cancel
                  </Button>
                  <Button variant="primary" small onClick={applyDraft}>
                    Apply range
                  </Button>
                </div>
              </Popover>
            </div>
            <span className="filter-summary">
              {reportRangeLabel({ period, since, until, year }).replace(
                " · local calendar dates",
                "",
              )}
            </span>
            {saved && (
              <button
                type="button"
                className="filter-chip"
                aria-label="Clear day filter"
                title="Clear day filter"
                onClick={clearDay}
              >
                <span>{dateLabel(since)} only</span>
                <X size={12} />
              </button>
            )}
            <div className="popover-anchor">
              <Button
                small
                icon={SlidersHorizontal}
                className="token-types-button"
                aria-expanded={typesOpen}
                aria-haspopup="dialog"
                onClick={() => {
                  setFilterOpen(false);
                  setTypesOpen(!typesOpen);
                }}
              >
                {allTypes
                  ? "All tokens"
                  : `${tokenTypes.length} of ${ALL_TOKEN_TYPES.length} token types`}
              </Button>
              <Popover
                open={typesOpen}
                onClose={closeTypes}
                label="Token types"
                align="right"
                className="token-types"
              >
                {TOKEN_TYPES.map(([key, label]) => (
                  <label className="check-label" key={key}>
                    <input
                      type="checkbox"
                      aria-label={`Include ${label} tokens`}
                      checked={tokenTypes.includes(key)}
                      disabled={tokenTypes.length === 1 && tokenTypes[0] === key}
                      onChange={(e) => toggleTokenType(key, e.target.checked)}
                    />
                    {label}
                  </label>
                ))}
                <p className="token-types-note">
                  Changes token counts only. Cost always covers every type.
                </p>
                {!allTypes && (
                  <div className="popover-actions">
                    <Button
                      variant="ghost"
                      small
                      onClick={() => changeTokenTypes(ALL_TOKEN_TYPES)}
                    >
                      Select all
                    </Button>
                  </div>
                )}
              </Popover>
            </div>
            <Select
              className="client-select"
              label="Filter by client"
              value={client}
              onChange={(e) => setClient(e.target.value)}
            >
              <option value="all">All clients</option>
              {clients.map((c) => (
                <option value={c.client} key={c.client}>
                  {c.label || brand(c.client)}
                </option>
              ))}
            </Select>
          </div>
        )}
        <div className={page === "commands" ? "content flush" : "content"}>
          <div className="content-inner">
            {info.settingsWarning && (
              <Notice tone="error">{info.settingsWarning}</Notice>
            )}
            {filtered && clientState.error && (
              <Notice
                tone="error"
                action={
                  <Button small onClick={refresh}>
                    Retry
                  </Button>
                }
              >
                The client list could not refresh: {clientState.error}
              </Notice>
            )}
            {!ready ? (
              <div className="loading-state" role="status" aria-label="Starting">
                <i className="skeleton-block" />
              </div>
            ) : (
              <>
                {page === "overview" && (
                  <Overview
                    args={filterArgs}
                    epoch={epoch}
                    refresh={refresh}
                    setPage={setPage}
                    focusDay={focusDay}
                    setClient={setClient}
                    clientIds={clients.map((c) => c.client)}
                    openModels={openModels}
                    tokenTypes={tokenTypes}
                  />
                )}
                {page === "models" && (
                  <Models
                    args={filterArgs}
                    epoch={epoch}
                    refresh={refresh}
                    search={modelSearch}
                    tokenTypes={tokenTypes}
                  />
                )}
                {page === "activity" && (
                  <ActivityView
                    args={filterArgs}
                    epoch={epoch}
                    refresh={refresh}
                    focusDay={focusDay}
                    setClient={setClient}
                    clientIds={clients.map((c) => c.client)}
                    tokenTypes={tokenTypes}
                  />
                )}
                {page === "projects" && (
                  <Sessions
                    args={filterArgs}
                    epoch={epoch}
                    refresh={refresh}
                    tokenTypes={tokenTypes}
                  />
                )}
                {page === "insights" && (
                  <Insights
                    args={filterArgs}
                    epoch={epoch}
                    refresh={refresh}
                    tokenTypes={tokenTypes}
                  />
                )}
                {page === "usage" && (
                  <Limits epoch={epoch} refresh={refresh} toCommand={toCommand} />
                )}
                {page === "integrations" && (
                  <Connections
                    home={settings.home}
                    epoch={epoch}
                    refresh={refresh}
                    toCommand={toCommand}
                  />
                )}
                {page === "settings" && (
                  <SettingsView
                    settings={settings}
                    setSettings={setSettings}
                    onSaved={() =>
                      setInfo((current) => ({ ...current, settingsWarning: "" }))
                    }
                    info={info}
                    toCommand={toCommand}
                  />
                )}
                {/* Stays mounted so a running TUI survives navigation. */}
                <div className="terminal-host" hidden={page !== "commands"}>
                  <TerminalView
                    initialCommand={command}
                    visible={page === "commands"}
                    onCommandConsumed={() => setCommand("")}
                  />
                </div>
              </>
            )}
          </div>
        </div>
      </main>
      <Toaster />
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
        <AlertCircle size={24} />
        <h2>Something went wrong</h2>
        <p>{this.state.error.message}</p>
        <Button onClick={() => location.reload()}>Reload</Button>
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
