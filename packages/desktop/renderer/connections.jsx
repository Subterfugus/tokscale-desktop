import React, { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, ExternalLink, Plug, LoaderCircle } from "lucide-react";
const api = window.tokscale;
const dollars = (value) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    value,
  );
const timestamp = (value) => {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "Unavailable";
};

// A newer request or an unmount must invalidate previous async UI updates.
// In particular, a late automatic refresh must not undo a disconnect.
function useConnectionRequest() {
  const revision = useRef(0);
  const [busy, setBusy] = useState("loading"),
    [error, setError] = useState("");
  const cancel = useCallback(() => {
    revision.current += 1;
  }, []);
  const run = useCallback(async (name, work) => {
    const request = ++revision.current;
    const update = (callback) => {
      if (revision.current === request) callback();
    };
    setBusy(name);
    setError("");
    try {
      await work(update);
    } catch (e) {
      update(() =>
        setError(
          String(e?.message || "The connection could not be completed. Try again.")
            .replace(/(Bearer\s+)[^\s]+/gi, "$1[hidden]")
            .replace(/sk-or-[A-Za-z0-9_-]+/g, "[hidden key]"),
        ),
      );
    } finally {
      update(() => setBusy(""));
    }
  }, []);
  return { busy, error, run, cancel, clearError: () => setError("") };
}

function Card({ name, badge, busy, children }) {
  return (
    <section className="panel connection-card" aria-busy={Boolean(busy)}>
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
    [editing, setEditing] = useState(false);
  const { busy, error, run, cancel, clearError } = useConnectionRequest();
  const lastEpoch = useRef(epoch);
  useEffect(() => {
    const force = lastEpoch.current !== epoch;
    lastEpoch.current = epoch;
    run("loading", async (update) => {
      const status = await api.openRouterStatus();
      update(() =>
        setState((previous) =>
          status.connected ? { ...previous, ...status } : status,
        ),
      );
      if (status.connected) {
        const result = await api.openRouterRefresh({ force });
        update(() => setState(result));
      }
    });
    return cancel;
  }, [epoch, run, cancel]);
  async function action(kind) {
    await run(kind, async (update) => {
      const result =
        kind === "connect"
          ? await api.openRouterConnect(key)
          : kind === "disconnect"
            ? await api.openRouterDisconnect()
            : await api.openRouterRefresh({ force: true });
      update(() => {
        setState(result);
        setEditing(false);
      });
    });
    // Never retain credentials after submitting, including a failed request.
    if (kind === "connect") {
      setKey("");
    }
  }
  return (
    <Card
      name="OpenRouter"
      busy={busy}
      badge={
        busy === "loading"
          ? "Checking connection…"
          : state?.connected ? "Key saved" : "Connect account"
      }
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
          {error ? "Last successful check" : "Checked"}{" "}
          {timestamp(state.checkedAt)} · account totals, separate from local
          estimated costs and the report date filter
        </p>
      )}
      {error && (
        <div className="inline-error" role="alert">
          {error}
        </div>
      )}
      {busy === "loading" && !state && (
        <p className="connection-detail" role="status">
          Checking the saved connection…
        </p>
      )}
      {(editing || (!state?.connected && busy !== "loading")) && (
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
              disabled={Boolean(busy)}
              autoFocus={editing}
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
              {busy === "connect" ? (
                <LoaderCircle size={14} className="spin" />
              ) : (
                <Plug size={14} />
              )}{" "}
              {busy === "connect"
                ? "Connecting…"
                : editing ? "Save replacement key" : "Connect OpenRouter"}
            </button>
            <button
              type="button"
              className="button"
              disabled={Boolean(busy)}
              onClick={() =>
                run("opening", () =>
                  api.openExternal("https://openrouter.ai/settings/provisioning-keys"),
                )
              }
            >
              Create management key <ExternalLink size={14} />
            </button>
            {state?.connected && (
              <button
                type="button"
                className="text-button"
                disabled={Boolean(busy)}
                onClick={() => {
                  setEditing(false);
                  setKey("");
                  clearError();
                }}
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
            disabled={Boolean(busy)}
            onClick={() => action("refresh")}
          >
            {busy === "refresh" ? (
              <LoaderCircle size={14} className="spin" />
            ) : (
              <RefreshCw size={14} />
            )}{" "}
            {busy === "refresh" ? "Refreshing…" : "Refresh balance"}
          </button>
          <button
            className="button"
            disabled={Boolean(busy)}
            onClick={() => {
              setEditing(true);
              clearError();
            }}
          >
            Replace key
          </button>
          <button
            className="text-button"
            disabled={Boolean(busy)}
            onClick={() => action("disconnect")}
          >
            {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
          </button>
          <button
            className="text-button"
            disabled={Boolean(busy)}
            onClick={() =>
              run("opening", () => api.openExternal("https://openrouter.ai/activity"))
            }
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
    [message, setMessage] = useState("");
  const { busy, error, run, cancel } = useConnectionRequest();
  useEffect(() => {
    run("loading", async (update) => {
      const status = await api.providerAction("antigravity-status");
      update(() => setGravity(status));
    });
    return cancel;
  }, [epoch, run, cancel]);
  async function action(action) {
    setMessage("");
    await run(action, async (update) => {
      const value = await api.providerAction(action);
      if (action === "antigravity-status" || action === "antigravity-sync") {
        const status =
          action === "antigravity-status"
            ? value
            : await api.providerAction("antigravity-status");
        update(() => setGravity(status));
        if (action === "antigravity-sync") {
          update(() => {
            setMessage("Sync finished. Local reports have been refreshed.");
            refresh();
          });
        } else {
          update(() =>
            setMessage(
              status.detectedConnections
                ? "Antigravity is running. You can sync its usage now."
                : "No running service found. Open Antigravity, sign in, then detect again.",
            ),
          );
        }
      }
      if (action === "antigravity-open")
        update(() =>
          setMessage("Sign in inside Antigravity, then click Detect."),
        );
    });
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
          busy={busy}
          badge={
            busy === "loading"
              ? "Checking local service…"
              : gravity?.detectedConnections
                ? "Running · detected"
                : gravity?.cachedSessions
                  ? "Saved usage available"
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
                Last sync {timestamp(gravity.lastSyncedAt)}
              </small>
            )}
          </div>
          <div className="connection-actions">
            <button
              className="button"
              disabled={Boolean(busy)}
              onClick={() => action("antigravity-open")}
            >
              Open Antigravity
            </button>
            <button
              className="button"
              disabled={Boolean(busy)}
              onClick={() => action("antigravity-status")}
            >
              {busy === "antigravity-status" && (
                <LoaderCircle size={14} className="spin" />
              )}{" "}
              Detect
            </button>
            <button
              className="button primary"
              disabled={Boolean(busy) || !gravity?.detectedConnections}
              onClick={() => action("antigravity-sync")}
            >
              {busy === "antigravity-sync" ? (
                <LoaderCircle size={14} className="spin" />
              ) : (
                <RefreshCw size={14} />
              )}{" "}
              {busy === "antigravity-sync" ? "Syncing usage…" : "Sync usage"}
            </button>
          </div>
          {busy === "loading" && (
            <p className="connection-detail" role="status">
              Checking for Antigravity’s local service…
            </p>
          )}
          {!busy && gravity && !gravity.detectedConnections && (
            <p className="connection-detail">
              Sync becomes available when Antigravity is open and its local
              service is detected.
            </p>
          )}
          {message && (
            <p className="connection-detail" role="status">
              {message}
            </p>
          )}
          {error && (
            <div className="inline-error" role="alert">
              {error}
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
    [connected, setConnected] = useState(false);
  const { busy, error, run, cancel } = useConnectionRequest();
  const lastEpoch = useRef(epoch);
  useEffect(() => {
    const force = lastEpoch.current !== epoch;
    lastEpoch.current = epoch;
    run("loading", async (update) => {
      const [status, info] = await Promise.all([
        api.claudeDesktopStatus(),
        api.connectionStatus(),
      ]);
      update(() => {
        setState((previous) =>
          info.claudeDesktopConnected ? { ...previous, ...status } : status,
        );
        setConnected(info.claudeDesktopConnected);
      });
      if (info.claudeDesktopConnected) {
        const result = await api.claudeDesktopRefresh({ force });
        update(() => setState(result));
      }
    });
    return cancel;
  }, [epoch, run, cancel]);
  async function connect() {
    await run("refresh", async (update) => {
      const result = await api.claudeDesktopRefresh({ force: true });
      update(() => {
        setState(result);
        setConnected(true);
      });
    });
  }
  async function disconnect() {
    await run("disconnect", async (update) => {
      await api.claudeDesktopDisconnect();
      update(() => {
        setConnected(false);
        setState(null);
      });
      const status = await api.claudeDesktopStatus();
      update(() => setState(status));
    });
  }
  const samples = (state?.samples || [])
      .filter((sample) => Number.isFinite(sample.timestamp))
      .sort((a, b) => a.timestamp - b.timestamp),
    latest = samples.at(-1);
  const points = samples.slice(-40),
    start = points[0]?.timestamp || 0,
    duration = (points.at(-1)?.timestamp || 0) - start || 1;
  return (
    <Card
      name="Claude desktop"
      busy={busy}
      badge={
        busy === "loading"
          ? "Checking desktop sign-in…"
          : connected && state?.checkedAt
            ? error ? "Last successful usage" : "Live usage"
            : latest
              ? "Saved plan usage"
              : state?.detected ? "Desktop sign-in found" : "Sign in to Claude"
      }
    >
      <p>
        Connect the account signed in to Claude desktop to see subscription
        limits. Token totals in your reports come from local transcripts.
      </p>
      {error && (
        <div className="inline-error" role="alert">
          {error}
        </div>
      )}
      <div className="connection-actions">
        <button
          className="button primary"
          disabled={Boolean(busy)}
          onClick={connect}
        >
          {busy === "refresh" ? (
            <LoaderCircle size={14} className="spin" />
          ) : (
            <Plug size={14} />
          )}{" "}
          {busy === "refresh"
            ? "Checking Claude usage…"
            : connected ? "Refresh Claude usage" : "Connect Claude desktop"}
        </button>
        <button
          className="text-button"
          disabled={Boolean(busy)}
          onClick={() =>
            run("opening", () => api.openExternal("https://claude.ai/settings/usage"))
          }
        >
          View in Claude <ExternalLink size={14} />
        </button>
        {connected && (
          <button className="text-button" disabled={Boolean(busy)} onClick={disconnect}>
            {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
          </button>
        )}
      </div>
      {busy === "loading" && (
        <p className="connection-detail" role="status">
          Checking the desktop sign-in and saved plan usage…
        </p>
      )}
      {!busy && !connected && (
        <p className="connection-detail">
          {state?.detected
            ? "Your desktop sign-in is available. Connect to check current limits."
            : "Open Claude desktop and sign in, then connect here."}
        </p>
      )}
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
                    Resets {timestamp(row.resets_at)}
                  </small>
                )}
              </span>
              <b>{row.used_percent.toFixed(1)}% used</b>
              <progress
                max="100"
                value={Math.max(0, Math.min(100, row.used_percent))}
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
            <span>{points.length} recent snapshots</span>
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
                  .filter((point) => Number.isFinite(point[field]))
                  .map(
                    (point) =>
                      `${((point.timestamp - start) / duration) * 400},${95 - Math.min(100, Math.max(0, point[field])) * 0.9}`,
                  )
                  .join(" ")}
              />
            ))}
          </svg>
          <p>
            <span style={{ color: "var(--violet)" }}>5-hour usage</span> ·{" "}
            <span style={{ color: "var(--lime)" }}>Weekly usage</span>
          </p>
          <p>
            {timestamp(points[0].timestamp)} – {timestamp(points.at(-1).timestamp)}
            {" "}· 0–100% plan utilization
          </p>
        </div>
      )}
      <p className="connection-detail">
        {state?.checkedAt
          ? `${error ? "Last successful limit check" : "Live limits checked"} ${timestamp(state.checkedAt)}. `
          : latest
            ? `Cached desktop snapshot from ${timestamp(latest.timestamp)}. `
            : ""}
        Desktop sign-in is read locally; credentials are sent only to Anthropic.
        Saved history shows plan utilization, separate from transcript token
        counts.
        {connected &&
          " Disconnect stops this app’s usage checks and keeps your Claude sign-in."}
      </p>
    </Card>
  );
}
