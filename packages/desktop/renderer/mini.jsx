import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Maximize2, X } from "lucide-react";
import "./styles.css";
import "./mini.css";
import { Meter } from "./charts.jsx";
import { clock, compact, dateTime, money, number, safeMessage } from "./format.js";
import { modelTokenTotal } from "./report-data.js";
import { cssVariable, resolveTheme } from "./themes.js";

const api = window.tokscale;
const REFRESH_MS = 60000;

function Logo() {
  return (
    <svg className="logo" viewBox="0 0 20 20" aria-hidden="true">
      <rect x="2" y="10" width="4" height="8" rx="1.5" />
      <rect x="8" y="5" width="4" height="13" rx="1.5" />
      <rect x="14" y="2" width="4" height="16" rx="1.5" />
    </svg>
  );
}

function useMiniTheme(settings) {
  const choice =
    !settings.miniTheme || settings.miniTheme === "match"
      ? settings.theme
      : settings.miniTheme;
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: light)");
    const apply = () => {
      const theme = resolveTheme(choice, !media.matches),
        root = document.documentElement;
      root.dataset.theme = theme.id;
      root.dataset.scheme = theme.scheme;
      for (const [key, value] of Object.entries(theme.colors))
        root.style.setProperty(cssVariable(key), value);
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [choice]);
}

async function loadToday(home) {
  const result = await api.run([
    "--no-spinner",
    "models",
    "--json",
    "--today",
    ...(home ? ["--home", home] : []),
  ]);
  if (result.code !== 0)
    throw new Error(safeMessage(result.stderr || result.stdout || "Report failed"));
  const report = JSON.parse(result.stdout);
  return {
    cost: Number(report.totalCost) || 0,
    messages: Number(report.totalMessages) || 0,
    tokens: modelTokenTotal(report) || 0,
  };
}

function Mini() {
  const [settings, setSettings] = useState({ theme: "dark", miniTheme: "match", home: "" }),
    [ready, setReady] = useState(false),
    [today, setToday] = useState(null),
    [limits, setLimits] = useState(null),
    [reportFailed, setReportFailed] = useState(false),
    [limitsFailed, setLimitsFailed] = useState(false),
    [refreshing, setRefreshing] = useState(false),
    [updated, setUpdated] = useState(null),
    [visible, setVisible] = useState(document.visibilityState !== "hidden");
  const settingsRevision = useRef(0);
  useMiniTheme(settings);
  useEffect(() => {
    let alive = true;
    Promise.resolve()
      .then(() => api.getSettings())
      .then((s) => {
        if (alive && settingsRevision.current === 0)
          setSettings((x) => ({ ...x, ...s }));
      })
      .catch(() => {})
      .finally(() => alive && setReady(true));
    let off;
    try {
      off = api.onSettingsChanged?.((s) => {
        if (!alive) return;
        settingsRevision.current += 1;
        setSettings((x) => ({ ...x, ...s }));
      });
    } catch {
      /* Settings sync is best effort. */
    }
    const listen = () => setVisible(document.visibilityState !== "hidden");
    document.addEventListener("visibilitychange", listen);
    return () => {
      alive = false;
      document.removeEventListener("visibilitychange", listen);
      try {
        off?.();
      } catch {}
    };
  }, []);
  // Reports from the previous home must never replace the current home's totals.
  useEffect(() => {
    setToday(null);
    setUpdated(null);
    setReportFailed(false);
  }, [settings.home]);
  useEffect(() => {
    setLimits(null);
    setLimitsFailed(false);
  }, [settings.claudeDesktopConnected]);
  useEffect(() => {
    if (!ready || !visible) return;
    let active = true,
      busy = false;
    const refresh = async () => {
      if (busy) return;
      busy = true;
      setRefreshing(true);
      const [report, snapshot] = await Promise.allSettled([
        loadToday(settings.home),
        Promise.resolve().then(() => api.limitSnapshot()),
      ]);
      if (!active) return;
      busy = false;
      setRefreshing(false);
      setReportFailed(report.status === "rejected");
      setLimitsFailed(snapshot.status === "rejected" || Boolean(snapshot.value?.error));
      if (report.status === "fulfilled") {
        setToday(report.value);
        setUpdated(new Date());
      }
      if (snapshot.status === "fulfilled") setLimits(snapshot.value);
    };
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [ready, visible, settings.home, settings.claudeDesktopConnected]);
  const shown = (limits?.sources || []).filter((row) =>
    Number.isFinite(row.usedPercent),
  );
  const checkedAt = limits?.checkedAt && new Date(limits.checkedAt);
  const notices = Array.isArray(limits?.lines)
    ? limits.lines.filter((line) => typeof line === "string")
    : [];
  const status = reportFailed || limitsFailed
    ? "Refresh incomplete"
    : refreshing ? "Refreshing…" : "";
  return (
    <div className="mini">
      {["top", "right", "bottom", "left"].map((edge) => (
        <span key={edge} className={`mini-resize-edge ${edge}`} aria-hidden="true" />
      ))}
      <header className="mini-bar">
        <Logo />
        <strong>Tokscale</strong>
        <button
          type="button"
          className="icon-button"
          aria-label="Open Tokscale"
          title="Open Tokscale"
          onClick={() => api.miniControl("main")?.catch?.(() => {})}
        >
          <Maximize2 size={13} />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Close"
          title="Close"
          onClick={() => api.miniControl("close")?.catch?.(() => {})}
        >
          <X size={15} />
        </button>
      </header>
      <div className="mini-body">
        <div className="mini-summary">
          <div className="mini-cost">
            <span>Today's estimated cost</span>
            <strong>{today ? money(today.cost) : "—"}</strong>
          </div>
          <div className="mini-stats">
            <div>
              <span>Tokens</span>
              <b>{today ? compact(today.tokens) : "—"}</b>
            </div>
            <div>
              <span>Messages</span>
              <b>{today ? number(today.messages) : "—"}</b>
            </div>
          </div>
        </div>
        <section className="mini-limits" aria-label="Provider limits" tabIndex={0}>
          <div className="mini-limits-heading">
            <strong>Provider limits</strong>
            {checkedAt && !isNaN(checkedAt) && (
              <span title={`Limits checked ${dateTime(checkedAt)}`}>{clock(checkedAt)}</span>
            )}
          </div>
          {shown.length > 0 ? (
            <div className="mini-limit-list">
              {shown.map((row) => (
                <div className="mini-limit" key={row.id || `${row.provider}:${row.label}`}>
                  <Meter
                    label={`${row.provider} · ${row.label}`}
                    value={row.usedPercent}
                    detail={row.resetsAt ? `Resets ${dateTime(row.resetsAt)}` : undefined}
                  />
                </div>
              ))}
            </div>
          ) : <p className="mini-notice">{!limits ? limitsFailed ? "Couldn't load provider limits." : "Loading provider limits…" : limitsFailed ? "Provider limits unavailable." : "No provider limits available."}</p>}
          {shown.length === 0 && notices.map((line, index) => (
            <p className="mini-notice" key={index}>{safeMessage(line)}</p>
          ))}
          {limitsFailed && shown.length > 0 && (
            <p className="mini-notice">Some limits couldn't refresh. Last available values are shown.</p>
          )}
        </section>
      </div>
      <footer className="mini-foot" role="status">
        <span title={reportFailed ? "Today's totals couldn't refresh. Last available totals are shown." : undefined}>{status}</span>
        <span title={updated ? `Today's totals checked ${dateTime(updated)}` : undefined}>{updated ? `Totals ${clock(updated)}` : ""}</span>
      </footer>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<Mini />);
