import React, { useEffect, useState } from "react";
import {
  Check,
  RefreshCw,
  ExternalLink,
  Plug,
  LoaderCircle,
} from "lucide-react";
const api = window.tokscale;
const dollars = (value) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    value,
  );
function Card({ name, badge, children }) {
  return (
    <section className="panel connection-card">
      <div className="panel-head">
        <div>
          <span className="connection-eyebrow">ACCOUNT CONNECTION</span>
          <h3>{name}</h3>
        </div>
        <span className="badge">{badge}</span>
      </div>
      <div className="connection-body">{children}</div>
    </section>
  );
}
export function OpenRouterCard({ epoch }) {
  const [state, setState] = useState(null),
    [key, setKey] = useState(""),
    [editing, setEditing] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    api
      .openRouterStatus()
      .then(async (status) => {
        if (alive) setState(status);
        if (status.connected) {
          const result = await api.openRouterRefresh();
          if (alive) setState(result);
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [epoch]);
  async function action(kind) {
    setBusy(true);
    setError("");
    try {
      const result =
        kind === "connect"
          ? await api.openRouterConnect(key)
          : kind === "disconnect"
            ? await api.openRouterDisconnect()
            : await api.openRouterRefresh();
      setState(result);
      setEditing(false);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
      setKey("");
    }
  }
  return (
    <Card
      name="OpenRouter"
      badge={state?.connected ? "Key saved" : "Connect account"}
    >
      <p>
        See your account credit balance and actual spending, across all your
        OpenRouter apps.
      </p>
      {state?.remaining != null && (
        <div className="connection-balances">
          <div>
            <small>Remaining credits</small>
            <strong>{dollars(state.remaining)}</strong>
          </div>
          <div>
            <small>Total spent</small>
            <strong>{dollars(state.spent)}</strong>
          </div>
          <div>
            <small>Credits purchased</small>
            <strong>{dollars(state.purchased)}</strong>
          </div>
        </div>
      )}
      {state?.checkedAt && (
        <p className="connection-detail">
          Checked {new Date(state.checkedAt).toLocaleTimeString()} · account
          totals, separate from local estimated costs
        </p>
      )}
      {error && (
        <div className="inline-error" role="alert">
          {error}
        </div>
      )}
      {(!state?.connected || editing) && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) action("connect");
          }}
        >
          <label className="connection-key">
            Management key
            <input
              aria-label="OpenRouter management key"
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="sk-or-…"
              autoComplete="off"
              spellCheck={false}
              disabled={busy}
            />
          </label>
          <p className="connection-detail">
            Account balances require a management key. It stays encrypted on
            this Windows account. This app only reads credit totals.
          </p>
          <div className="connection-actions">
            <button
              type="submit"
              className="button primary"
              disabled={busy || !key.trim()}
            >
              {busy ? (
                <LoaderCircle size={14} className="spin" />
              ) : (
                <Plug size={14} />
              )}{" "}
              Connect OpenRouter
            </button>
            <button
              type="button"
              className="button"
              onClick={() =>
                api.openExternal(
                  "https://openrouter.ai/settings/provisioning-keys",
                )
              }
            >
              Create management key <ExternalLink size={14} />
            </button>
            {state?.connected && (
              <button
                type="button"
                className="text-button"
                onClick={() => setEditing(false)}
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      )}
      {state?.connected && !editing && (
        <div className="connection-actions">
          <button
            className="button"
            disabled={busy}
            onClick={() => action("refresh")}
          >
            <RefreshCw size={14} /> Refresh balance
          </button>
          <button
            className="button"
            disabled={busy}
            onClick={() => setEditing(true)}
          >
            Replace key
          </button>
          <button
            className="text-button"
            disabled={busy}
            onClick={() => action("disconnect")}
          >
            Disconnect
          </button>
          <button
            className="text-button"
            onClick={() => api.openExternal("https://openrouter.ai/activity")}
          >
            View usage details <ExternalLink size={14} />
          </button>
        </div>
      )}
    </Card>
  );
}
export function ConnectionCards({ epoch, refresh }) {
  const [gravity, setGravity] = useState(null),
    [busy, setBusy] = useState(""),
    [error, setError] = useState({}),
    [message, setMessage] = useState({});
  useEffect(() => {
    let alive = true;
    api
      .providerAction("antigravity-status")
      .then((value) => {
        if (alive) setGravity(value);
      })
      .catch((e) => {
        if (alive) setError((old) => ({ ...old, antigravity: e.message }));
      });
    return () => {
      alive = false;
    };
  }, [epoch]);
  async function run(provider, action) {
    setBusy(provider);
    setError((old) => ({ ...old, [provider]: "" }));
    try {
      const value = await api.providerAction(action);
      if (action === "antigravity-status" || action === "antigravity-sync") {
        setGravity(
          action === "antigravity-status"
            ? value
            : await api.providerAction("antigravity-status"),
        );
        if (action === "antigravity-sync") {
          setMessage((old) => ({
            ...old,
            antigravity: "Sync finished. Local reports have been refreshed.",
          }));
          refresh();
        }
      }
      if (action === "antigravity-open")
        setMessage((old) => ({
          ...old,
          antigravity: "Sign in inside Antigravity, then click Detect.",
        }));
    } catch (e) {
      setError((old) => ({
        ...old,
        [provider]: e.message.replace(/(Bearer\s+)[^\s]+/gi, "$1[hidden]"),
      }));
    } finally {
      setBusy("");
    }
  }
  return (
    <div className="connection-section">
      <div className="connection-intro">
        <h2>Connect your accounts</h2>
        <p>Choose an account below. Setup and status stay here.</p>
      </div>
      <div className="connection-grid">
        <ClaudeDesktopCard epoch={epoch} />
        <Card
          name="Antigravity"
          badge={
            gravity?.detectedConnections
              ? "Running · detected"
              : "Open app to connect"
          }
        >
          <p>
            Sign in inside Antigravity and keep it open. Tokscale reads its
            local service and caches activity for your reports.
          </p>
          <div className="connection-stat">
            <strong>{gravity?.cachedSessions ?? "—"}</strong>
            <span>cached sessions</span>
            {gravity?.lastSyncedAt && (
              <small>
                Last sync {new Date(gravity.lastSyncedAt).toLocaleString()}
              </small>
            )}
          </div>
          <div className="connection-actions">
            <button
              className="button"
              disabled={Boolean(busy)}
              onClick={() => run("antigravity", "antigravity-open")}
            >
              Open Antigravity
            </button>
            <button
              className="button"
              disabled={Boolean(busy)}
              onClick={() => run("antigravity", "antigravity-status")}
            >
              Detect
            </button>
            <button
              className="button primary"
              disabled={Boolean(busy) || !gravity?.detectedConnections}
              onClick={() => run("antigravity", "antigravity-sync")}
            >
              {busy === "antigravity" ? (
                <LoaderCircle size={14} className="spin" />
              ) : (
                <RefreshCw size={14} />
              )}{" "}
              Sync usage
            </button>
          </div>
          {message.antigravity && (
            <p className="connection-detail" role="status">
              {message.antigravity}
            </p>
          )}
          {error.antigravity && (
            <div className="inline-error" role="alert">
              {error.antigravity}
            </div>
          )}
          <p className="connection-detail">
            No API key needed. Subscription quotas appear on the quotas page
            when its local service exposes them.
          </p>
        </Card>
        <OpenRouterCard epoch={epoch} />
      </div>
    </div>
  );
}

export function ClaudeDesktopCard({ epoch }) {
  const [state, setState] = useState(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [connected, setConnected] = useState(false);
  useEffect(() => {
    let alive = true;
    Promise.all([api.claudeDesktopStatus(), api.connectionStatus()])
      .then(async ([status, info]) => {
        if (alive) {
          setState(status);
          setConnected(info.claudeDesktopConnected);
        }
        if (info.claudeDesktopConnected) {
          const result = await api.claudeDesktopRefresh();
          if (alive) setState(result);
        }
      })
      .catch((e) => {
        if (alive) setError(e.message);
      });
    return () => {
      alive = false;
    };
  }, [epoch]);
  async function connect() {
    setBusy(true);
    setError("");
    try {
      setState(await api.claudeDesktopRefresh());
      setConnected(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function disconnect() {
    setBusy(true);
    try {
      await api.claudeDesktopDisconnect();
      setConnected(false);
      setState(await api.claudeDesktopStatus());
      setError("");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const samples = state?.samples || [],
    latest = samples.at(-1);
  const points = samples.slice(-40),
    start = points[0]?.timestamp || 0,
    duration = (points.at(-1)?.timestamp || 0) - start || 1;
  return (
    <Card
      name="Claude desktop"
      badge={
        state?.checkedAt
          ? error
            ? "Last successful usage"
            : "Live usage"
          : state?.detected
            ? "Desktop sign-in found"
            : "Sign in to Claude"
      }
    >
      <p>
        Use the account already signed in to the Claude desktop app. One click
        reads its subscription limits and saved plan usage history.
      </p>
      {error && (
        <div className="inline-error" role="alert">
          {error}
        </div>
      )}
      <div className="connection-actions">
        <button className="button primary" disabled={busy} onClick={connect}>
          {busy ? (
            <LoaderCircle size={14} className="spin" />
          ) : (
            <Plug size={14} />
          )}{" "}
          {connected ? "Refresh Claude usage" : "Connect Claude desktop"}
        </button>
        <button
          className="text-button"
          onClick={() => api.openExternal("https://claude.ai/settings/usage")}
        >
          View in Claude <ExternalLink size={14} />
        </button>
        {connected && (
          <button className="text-button" disabled={busy} onClick={disconnect}>
            Disconnect
          </button>
        )}
      </div>
      <div className="connection-quota">
        {(
          state?.metrics ||
          (latest
            ? [
                { label: "5-hour usage", used_percent: latest.fiveHour },
                { label: "Weekly usage", used_percent: latest.sevenDay },
              ]
            : [])
        )
          .filter((row) => Number.isFinite(row.used_percent))
          .map((row, index) => (
            <div key={index}>
              <span>
                {row.label}
                {row.resets_at && (
                  <small>
                    Resets {new Date(row.resets_at).toLocaleString()}
                  </small>
                )}
              </span>
              <b>{row.used_percent.toFixed(1)}% used</b>
              <progress
                max="100"
                value={row.used_percent}
                aria-label={row.label}
              />
            </div>
          ))}
      </div>
      {state?.spend && (
        <p className="connection-detail">
          Extra usage: {dollars(state.spend.spent)} of{" "}
          {dollars(state.spend.limit)}
        </p>
      )}
      {points.length > 1 && (
        <div className="connection-history">
          <div>
            <b>Saved plan history</b>
            <span>{samples.length} snapshots</span>
          </div>
          <svg
            viewBox="0 0 400 100"
            role="img"
            aria-label="Claude desktop cached five-hour and weekly usage history"
          >
            <path
              d="M0 95H400 M0 50H400 M0 5H400"
              stroke="var(--line)"
              fill="none"
            />
            {[
              ["fiveHour", "var(--violet)"],
              ["sevenDay", "var(--lime)"],
            ].map(([field, color]) => (
              <polyline
                key={field}
                fill="none"
                stroke={color}
                strokeWidth="2"
                points={points
                  .filter((point) => point[field] != null)
                  .map(
                    (point) =>
                      `${((point.timestamp - start) / duration) * 400},${95 - Math.min(100, Math.max(0, point[field])) * 0.9}`,
                  )
                  .join(" ")}
              />
            ))}
          </svg>
          <p>5-hour usage · weekly usage</p>
        </div>
      )}
      <p className="connection-detail">
        {state?.checkedAt
          ? `${error ? "Last successful limit check" : "Live limits checked"} ${new Date(state.checkedAt).toLocaleTimeString()}. `
          : latest
            ? `Cached desktop snapshot from ${new Date(latest.timestamp).toLocaleString()}. `
            : ""}
        Desktop sign-in is read locally; credentials are sent only to Anthropic.
        Saved history shows plan utilization, separate from transcript token
        counts.
      </p>
    </Card>
  );
}
