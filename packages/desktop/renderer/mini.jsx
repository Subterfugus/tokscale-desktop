import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Maximize2, Minimize2, X } from "lucide-react";
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

// How long the widget's contents take to fade before the window shrinks.
const LEAVE_MS = 110;

// 64x64 bubble in the widget's own theme. Purely decorative: a small balance
// scale that tips when touched, no usage data. The whole window is one no-drag
// button; dragging is done by moving the window from pointer deltas so clicks
// are never swallowed.
function Bubble() {
  const drag = useRef(null),
    frame = useRef(0),
    [dragging, setDragging] = useState(false),
    [leaving, setLeaving] = useState(false);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);
  const title = "Tokscale · Click to expand, drag to move";
  const flush = () => {
    frame.current = 0;
    const d = drag.current;
    if (!d || (!d.dx && !d.dy)) return;
    const { dx, dy } = d;
    d.dx = d.dy = 0;
    Promise.resolve(api.miniMoveBy?.(dx, dy)).catch(() => {});
  };
  // The mark fades while the window grows back into the widget.
  const expand = () => {
    setLeaving(true);
    Promise.resolve()
      .then(() => api.miniControl("expand"))
      .catch(() => setLeaving(false));
  };
  return (
    <button
      type="button"
      className={`mini-bubble${dragging ? " dragging" : ""}${leaving ? " leaving" : ""}`}
      title={title}
      aria-label={title}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        drag.current = { x: e.screenX, y: e.screenY, dx: 0, dy: 0, moved: 0 };
        setDragging(true);
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const dx = e.screenX - d.x,
          dy = e.screenY - d.y;
        d.x = e.screenX;
        d.y = e.screenY;
        d.moved += Math.abs(dx) + Math.abs(dy);
        d.dx += dx;
        d.dy += dy;
        if (d.moved >= 4 && !frame.current)
          frame.current = requestAnimationFrame(flush);
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = null;
        setDragging(false);
        e.currentTarget.releasePointerCapture?.(e.pointerId);
        if (d && d.moved < 4) expand();
      }}
      onPointerCancel={() => {
        drag.current = null;
        setDragging(false);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          expand();
        }
      }}
    >
      <svg viewBox="0 0 64 64" aria-hidden="true">
        <path className="mini-bubble-stand" d="M32 17v30M23 48h18" />
        <g className="mini-bubble-beam">
          <path className="mini-bubble-stand" d="M15 22h34" />
          <g className="mini-bubble-pan left">
            <path className="mini-bubble-string" d="M15 22l-6.5 12m6.5-12l6.5 12" />
            <path className="mini-bubble-dish" d="M7.5 34h15a7.5 7.5 0 0 1-15 0z" />
          </g>
          <g className="mini-bubble-pan right">
            <path className="mini-bubble-string" d="M49 22l-6.5 12m6.5-12l6.5 12" />
            <path className="mini-bubble-dish" d="M41.5 34h15a7.5 7.5 0 0 1-15 0z" />
          </g>
        </g>
        <circle className="mini-bubble-pivot" cx="32" cy="22" r="3" />
      </svg>
    </button>
  );
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
    [visible, setVisible] = useState(document.visibilityState !== "hidden"),
    [leaving, setLeaving] = useState(false);
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
  const hidden = Array.isArray(settings.miniHiddenLimits) ? settings.miniHiddenLimits : [];
  const shown = (limits?.sources || []).filter(
    (row) => Number.isFinite(row.usedPercent) && !hidden.includes(row.id),
  );
  const micro = settings.miniMicro === true;
  useEffect(() => {
    document.documentElement.classList.toggle("mini-micro", micro);
    setLeaving(false);
    return () => document.documentElement.classList.remove("mini-micro");
  }, [micro]);
  if (micro) return <Bubble />;
  // Fade the contents first so the window shrinks as an empty panel.
  const shrink = () => {
    if (leaving) return;
    setLeaving(true);
    setTimeout(() => {
      Promise.resolve()
        .then(() => api.miniControl("micro"))
        .catch(() => setLeaving(false));
    }, LEAVE_MS);
  };
  const checkedAt = limits?.checkedAt && new Date(limits.checkedAt);
  const notices = Array.isArray(limits?.lines)
    ? limits.lines.filter((line) => typeof line === "string")
    : [];
  const status = reportFailed || limitsFailed
    ? "Refresh incomplete"
    : refreshing ? "Refreshing…" : "";
  return (
    <div className={`mini${leaving ? " leaving" : ""}`}>
      {["top", "right", "bottom", "left"].map((edge) => (
        <span key={edge} className={`mini-resize-edge ${edge}`} aria-hidden="true" />
      ))}
      <header className="mini-bar">
        <Logo />
        <strong>Tokscale</strong>
        <button
          type="button"
          className="icon-button"
          aria-label="Shrink to bubble"
          title="Shrink to bubble"
          onClick={shrink}
        >
          <Minimize2 size={13} />
        </button>
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
                    pace={row.pace}
                  />
                </div>
              ))}
            </div>
          ) : <p className="mini-notice">{!limits ? limitsFailed ? "Couldn't load provider limits." : "Loading provider limits…" : limitsFailed ? "Provider limits unavailable." : hidden.length ? "Every limit is hidden. Choose which to show in Settings." : "No provider limits available."}</p>}
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
