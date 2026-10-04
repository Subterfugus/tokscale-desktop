import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Maximize2, X } from "lucide-react";
import "./styles.css";
import "./mini.css";
import { Meter } from "./charts.jsx";
import { clock, compact, money, number, safeMessage } from "./format.js";
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

async function loadLimits() {
  const status = await api.connectionStatus();
  if (!status?.claudeDesktopConnected) return [];
  const result = await api.claudeDesktopRefresh({});
  return (result?.metrics || []).filter((row) => Number.isFinite(row?.used_percent));
}

function Mini() {
  const [settings, setSettings] = useState({ theme: "dark", miniTheme: "match", home: "" }),
    [ready, setReady] = useState(false),
    [today, setToday] = useState(null),
    [limits, setLimits] = useState([]),
    [failed, setFailed] = useState(false),
    [updated, setUpdated] = useState(null),
    [visible, setVisible] = useState(document.visibilityState !== "hidden");
  const busy = useRef(false);
  useMiniTheme(settings);
  useEffect(() => {
    let alive = true;
    Promise.resolve()
      .then(() => api.getSettings())
      .then((s) => alive && setSettings((x) => ({ ...x, ...s })))
      .catch(() => {})
      .finally(() => alive && setReady(true));
    let off;
    try {
      off = api.onSettingsChanged?.((s) => setSettings((x) => ({ ...x, ...s })));
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
  const refresh = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    let bad = false;
    try {
      setToday(await loadToday(settings.home));
    } catch {
      bad = true;
    }
    try {
      setLimits(await loadLimits());
    } catch {
      bad = true;
    }
    busy.current = false;
    setFailed(bad);
    if (!bad) setUpdated(new Date());
  }, [settings.home]);
  useEffect(() => {
    if (!ready || !visible) return;
    refresh();
    const timer = setInterval(refresh, REFRESH_MS);
    return () => clearInterval(timer);
  }, [ready, visible, refresh]);
  const shown = limits.slice(0, 2);
  return (
    <div className="mini">
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
        {shown.length > 0 && (
          <div className="mini-limits">
            {shown.map((row) => (
              <Meter key={row.label} label={row.label} value={row.used_percent} />
            ))}
          </div>
        )}
      </div>
      <footer className="mini-foot" role="status">
        <span>{failed ? "Couldn't refresh" : ""}</span>
        <span>{updated ? `Updated ${clock(updated)}` : ""}</span>
      </footer>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<Mini />);
