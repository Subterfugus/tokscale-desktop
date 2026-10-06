import React, { useEffect, useRef, useState } from "react";
import { Check, FolderOpen, TerminalSquare } from "lucide-react";
import { api } from "../use-report.js";
import { Button, Card, Notice, Select } from "../ui.jsx";
import { THEMES, resolveTheme } from "../themes.js";
import { dateTime, safeMessage } from "../format.js";

function Row({ title, description, children }) {
  return (
    <div className="setting-row">
      <div>
        <h3>{title}</h3>
        {description && <p>{description}</p>}
      </div>
      <div className="setting-control">{children}</div>
    </div>
  );
}

function Switch({ label, checked, onChange }) {
  return (
    <label className="switch">
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <i aria-hidden="true" />
    </label>
  );
}

// A miniature of the app: page, a card, two lines of text and the accent.
function Swatch({ colors }) {
  return (
    <span className="theme-swatch" style={{ background: colors.page }}>
      <span style={{ background: colors.surface, borderColor: colors.line }}>
        <i style={{ background: colors.accent }} />
        <i style={{ background: colors.text }} />
        <i style={{ background: colors.text3 }} />
      </span>
    </span>
  );
}
function ThemeButton({ name, active, onClick, colors, split }) {
  return (
    <button
      type="button"
      className={active ? "active" : ""}
      aria-pressed={active}
      onClick={onClick}
    >
      <span className={split ? "theme-preview split" : "theme-preview"}>
        <Swatch colors={colors} />
        {split && <Swatch colors={split} />}
      </span>
      <span>{name}</span>
    </button>
  );
}

export function SettingsView({ settings, setSettings, info, toCommand, onSaved }) {
  const [saved, setSaved] = useState(false),
    [error, setError] = useState(""),
    [upstream, setUpstream] = useState(null),
    [miniWatcher, setMiniWatcher] = useState(null),
    [limits, setLimits] = useState(null),
    [checkingUpstream, setCheckingUpstream] = useState(false);
  const saveQueue = useRef(Promise.resolve()),
    saveSequence = useRef(0),
    savedTimer = useRef(null);
  useEffect(() => () => clearTimeout(savedTimer.current), []);
  useEffect(() => {
    let alive = true, revision = 0;
    api.miniWatchStatus().then(status => { if (alive && !revision) setMiniWatcher(status); }).catch(() => {});
    const off = api.onMiniWatchStatus(status => { revision++; if (alive) setMiniWatcher(status); });
    return () => { alive = false; off(); };
  }, []);
  useEffect(() => {
    let alive = true, revision = 0;
    api.upstreamStatus().then(status => { if (alive && revision === 0) setUpstream(status); }).catch(() => {});
    const off = api.onUpstreamStatus(status => { revision++; if (alive) setUpstream(status); });
    return () => { alive = false; off(); };
  }, []);
  useEffect(() => {
    let alive = true;
    api
      .limitSnapshot()
      .then((snapshot) => {
        if (alive)
          setLimits((snapshot?.sources || []).filter((row) => row.id && Number.isFinite(row.usedPercent)));
      })
      .catch(() => alive && setLimits([]));
    return () => {
      alive = false;
    };
  }, []);
  const hiddenLimits = Array.isArray(settings.miniHiddenLimits) ? settings.miniHiddenLimits : [];
  const save = async (patch) => {
    const sequence = ++saveSequence.current;
    setError("");
    setSaved(false);
    setSettings((current) => ({ ...current, ...patch }));
    // Send patches in order: quick changes to theme and refresh settings must
    // not overwrite one another with an older settings object.
    const task = saveQueue.current
      .catch(() => {})
      .then(() => api.saveSettings(patch));
    saveQueue.current = task;
    try {
      const persisted = await task;
      if (sequence === saveSequence.current) {
        setSettings((current) => ({ ...current, ...persisted }));
        setSaved(true);
        onSaved?.();
        clearTimeout(savedTimer.current);
        savedTimer.current = setTimeout(() => setSaved(false), 2000);
      }
    } catch (e) {
      if (sequence === saveSequence.current) {
        setError(safeMessage(e.message));
        const persisted = await api.getSettings().catch(() => null);
        if (persisted && sequence === saveSequence.current)
          setSettings((current) => ({ ...current, ...persisted }));
      }
    }
  };
  return (
    <div className="settings">
      {error && <Notice tone="error">{error}</Notice>}
      <Card
        title="General"
        action={
          saved && (
            <span className="saved" role="status">
              <Check size={13} /> Saved
            </span>
          )
        }
      >
        <div className="setting-row theme-row">
          <div>
            <h3>Theme</h3>
            <p>System follows the Windows light or dark setting.</p>
          </div>
          <div className="theme-grid" role="group" aria-label="Theme">
            <ThemeButton
              name="System"
              active={settings.theme === "system"}
              onClick={() => save({ theme: "system" })}
              colors={resolveTheme("light").colors}
              split={resolveTheme("dark").colors}
            />
            {THEMES.map((theme) => (
              <ThemeButton
                key={theme.id}
                name={theme.name}
                active={settings.theme === theme.id}
                onClick={() => save({ theme: theme.id })}
                colors={theme.colors}
              />
            ))}
          </div>
        </div>
        <Row
          title="Refresh reports"
          description="Applies while the window is visible."
        >
          <Select
            label="Refresh interval"
            value={settings.refreshInterval}
            onChange={(e) => save({ refreshInterval: Number(e.target.value) })}
          >
            <option value="0">Manually</option>
            <option value="60000">Every minute</option>
            <option value="120000">Every 2 minutes</option>
            <option value="300000">Every 5 minutes</option>
            <option value="900000">Every 15 minutes</option>
          </Select>
        </Row>
        <Row
          title="Default date range"
          description="The range shown when the app opens."
        >
          <Select
            label="Default date range"
            value={settings.defaultPeriod}
            onChange={(e) => save({ defaultPeriod: e.target.value })}
          >
            <option value="today">Today</option>
            <option value="yesterday">Yesterday</option>
            <option value="week">Last 7 days</option>
            <option value="month">This month</option>
            <option value="all">All time</option>
          </Select>
        </Row>
        <Row
          title="Report home folder"
          description="Read reports from a different home folder. Terminal and account connections always use your own."
        >
          <code className="path" title={settings.home || info.homePath}>
            {settings.home || info.homePath || "Default"}
          </code>
          <Button
            small
            icon={FolderOpen}
            onClick={async () => {
              try {
                const home = await api.selectHome();
                if (home) await save({ home });
              } catch (e) {
                setError(safeMessage(e.message));
              }
            }}
          >
            Choose…
          </Button>
          {settings.home && (
            <Button small variant="ghost" onClick={() => save({ home: "" })}>
              Reset
            </Button>
          )}
        </Row>
      </Card>
      <Card title="Background">
        <Row
          title="Limit notifications"
          description="Notify when a usage limit passes 75% or 90%, and when it resets."
        >
          <Switch
            label="Limit notifications"
            checked={settings.limitNotifications !== false}
            onChange={(limitNotifications) => save({ limitNotifications })}
          />
        </Row>
        <Row
          title="Keep running in the tray"
          description="Closing the window hides it instead of quitting. Limits stay visible on the tray icon."
        >
          <Switch
            label="Keep running in the tray"
            checked={Boolean(settings.minimizeToTray)}
            onChange={(minimizeToTray) => save({ minimizeToTray })}
          />
        </Row>
        <Row
          title="Launch at login"
          description="Start in the tray when you sign in to Windows."
        >
          <Switch
            label="Launch at login"
            checked={Boolean(settings.launchAtLogin)}
            onChange={(launchAtLogin) => save({ launchAtLogin })}
          />
        </Row>
      </Card>
      <Card title="Upstream updates">
        <Row
          title="Notify when original Tokscale changes"
          description="Check junhoyeo/tokscale's default branch hourly while this app is running, including in the tray. The first check establishes a baseline."
        >
          <Switch
            label="Upstream update notifications"
            checked={settings.upstreamNotifications !== false}
            onChange={(upstreamNotifications) => save({ upstreamNotifications })}
          />
        </Row>
        <Row
          title="Original repository"
          description={upstream?.checkedAt ? `Last checked ${dateTime(upstream.checkedAt)}${upstream.sha ? ` · ${upstream.sha.slice(0, 7)}` : ""}` : "Waiting for the first successful check."}
        >
          <Button small disabled={checkingUpstream || upstream?.checking} onClick={async () => {
            setCheckingUpstream(true);
            try { setUpstream(await api.upstreamCheck()); }
            catch (e) { setError(safeMessage(e.message)); }
            finally { setCheckingUpstream(false); }
          }}>{checkingUpstream || upstream?.checking ? "Checking…" : "Check now"}</Button>
          <Button small variant="ghost" onClick={() => api.openExternal(upstream?.url || "https://github.com/junhoyeo/tokscale").catch(e => setError(safeMessage(e.message)))}>
            {upstream?.previousSha ? "View changes" : "View repository"}
          </Button>
        </Row>
        {upstream?.error && <Notice tone="error">{upstream.error}</Notice>}
        {upstream?.changedAt && <p className="muted">Latest detected change: {upstream.title || upstream.sha?.slice(0, 7)}</p>}
      </Card>
      <Card title="Mini window">
        <Row title="Show widget when AI apps open" description="Show the widget when you open or switch to Codex, Claude, ChatGPT or T3 Code desktop. Keep Tokscale running in the tray to detect them.">
          <Switch
            label="Show widget when AI apps open"
            checked={settings.miniOnAiApps !== false}
            onChange={(miniOnAiApps) => save({ miniOnAiApps })}
          />
        </Row>
        {miniWatcher?.error && settings.miniOnAiApps !== false && <Notice tone="error">{miniWatcher.error}</Notice>}
        <Row title="Open widget on startup" description="Show the widget whenever Tokscale launches.">
          <Switch
            label="Open widget on startup"
            checked={settings.miniLaunchOnStartup !== false}
            onChange={(miniLaunchOnStartup) => save({ miniLaunchOnStartup })}
          />
        </Row>
        <Row
          title="Show mini window"
          description="A small always-on-top view of today's cost and your limits. Closing the mini window only puts it away for now; it stays on here until you turn it off."
        >
          <Switch
            label="Show mini window"
            checked={settings.miniEnabled !== false}
            onChange={(miniEnabled) => save({ miniEnabled })}
          />
        </Row>
        <Row title="Mini window theme">
          <Select
            label="Mini window theme"
            value={settings.miniTheme || "match"}
            onChange={(e) => save({ miniTheme: e.target.value })}
          >
            <option value="match">Same as main window</option>
            <option value="system">System</option>
            {THEMES.map((theme) => (
              <option key={theme.id} value={theme.id}>
                {theme.name}
              </option>
            ))}
          </Select>
        </Row>
        <div className="setting-row limit-picker-row">
          <div>
            <h3>Limits in the mini window</h3>
            <p>Unticked limits are left out of the mini window. They still appear on the Limits page and in tray warnings.</p>
          </div>
          {!limits ? (
            <p className="muted">Loading limits…</p>
          ) : !limits.length ? (
            <p className="muted">No limits are available yet. Connect an account on the Connections page.</p>
          ) : (
            <div className="limit-picker">
              {limits.map((row) => (
                <label className="check-label" key={row.id}>
                  <input
                    type="checkbox"
                    checked={!hiddenLimits.includes(row.id)}
                    onChange={(e) =>
                      save({
                        miniHiddenLimits: e.target.checked
                          ? hiddenLimits.filter((id) => id !== row.id)
                          : [...hiddenLimits, row.id],
                      })
                    }
                  />
                  {row.provider} · {row.label}
                </label>
              ))}
            </div>
          )}
        </div>
      </Card>
      <Card title="About">
        <Row
          title="Tokscale Desktop"
          description={`Version ${info.version || "—"} · Tokscale engine ${info.engineVersion || "—"}`}
        >
          <Button
            small
            variant="ghost"
            onClick={() =>
              api
                .openExternal("https://github.com/junhoyeo/tokscale")
                .catch((e) => setError(safeMessage(e.message)))
            }
          >
            Tokscale on GitHub
          </Button>
        </Row>
        <Row title="Engine" description="Reports, pricing and account tools all come from the bundled Tokscale engine.">
          <code className="path" title={info.enginePath}>
            {info.enginePath || "—"}
          </code>
          <Button small icon={TerminalSquare} onClick={() => toCommand("--help")}>
            Engine help
          </Button>
        </Row>
        <Row
          title="Data folder"
          description="Tokscale's configuration and cached data."
        >
          <Button
            small
            icon={FolderOpen}
            onClick={() =>
              api.showDataFolder().catch((e) => setError(safeMessage(e.message)))
            }
          >
            Open folder
          </Button>
        </Row>
      </Card>
    </div>
  );
}
