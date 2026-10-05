import React, { useCallback, useEffect, useRef, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { api } from "./use-report.js";
import { Badge, Button, Notice } from "./ui.jsx";
import { Meter, SERIES, TrendLines } from "./charts.jsx";
import { dateTime, metricPace, money } from "./format.js";

const timestamp = (value) =>
  Number.isFinite(new Date(value).getTime()) ? dateTime(value) : "unavailable";

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

function ConnectionCard({ name, status, tone, busy, summary, children, actions, note }) {
  return (
    <section className="panel connection-card" aria-busy={Boolean(busy)}>
      <div className="panel-head">
        <div>
          <h2>{name}</h2>
          <p>{summary}</p>
        </div>
        <Badge tone={tone}>{status}</Badge>
      </div>
      <div className="connection-body">{children}</div>
      {note && <p className="connection-note">{note}</p>}
      <div className="connection-actions">{actions}</div>
    </section>
  );
}

const external = (run, url) => () => run("opening", () => api.openExternal(url));

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
  const connect = () =>
    run("refresh", async (update) => {
      const result = await api.claudeDesktopRefresh({ force: true });
      update(() => {
        setState(result);
        setConnected(true);
      });
    });
  const disconnect = () =>
    run("disconnect", async (update) => {
      await api.claudeDesktopDisconnect();
      update(() => {
        setConnected(false);
        setState(null);
      });
      const status = await api.claudeDesktopStatus();
      update(() => setState(status));
    });
  const samples = (state?.samples || [])
      .filter((sample) => Number.isFinite(sample.timestamp))
      .sort((a, b) => a.timestamp - b.timestamp),
    latest = samples.at(-1),
    points = samples.slice(-40);
  const metrics = (
    state?.metrics ||
    (latest
      ? [
          { label: "5-hour usage", used_percent: latest.fiveHour },
          { label: "Weekly usage", used_percent: latest.sevenDay },
        ]
      : [])
  ).filter((row) => Number.isFinite(row.used_percent));
  const live = connected && state?.checkedAt;
  return (
    <ConnectionCard
      name="Claude desktop"
      busy={busy}
      summary="Subscription limits for the account signed in to Claude desktop."
      tone={live ? (error ? "warning" : "good") : undefined}
      status={
        busy === "loading"
          ? "Checking…"
          : live
            ? error
              ? "Stale"
              : "Connected"
            : latest
              ? "Saved snapshot"
              : state?.detected
                ? "Sign-in found"
                : "Not signed in"
      }
      note={
        state?.checkedAt
          ? `${error ? "Last checked" : "Checked"} ${timestamp(state.checkedAt)}. Your sign-in is read locally and sent only to Anthropic.`
          : latest
            ? `Saved snapshot from ${timestamp(latest.timestamp)}.`
            : !busy && !connected
              ? state?.detected
                ? "Your desktop sign-in is available. Connect to check current limits."
                : "Open Claude desktop and sign in, then connect here."
              : "Your sign-in is read locally and sent only to Anthropic."
      }
      actions={
        <>
          <Button
            variant={connected ? undefined : "primary"}
            icon={connected ? RefreshCw : undefined}
            spin={busy === "refresh"}
            disabled={Boolean(busy)}
            onClick={connect}
          >
            {busy === "refresh"
              ? "Checking…"
              : connected
                ? "Refresh"
                : "Connect Claude desktop"}
          </Button>
          {connected && (
            <Button variant="ghost" disabled={Boolean(busy)} onClick={disconnect}>
              {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
            </Button>
          )}
          <Button
            variant="ghost"
            iconEnd={ExternalLink}
            disabled={Boolean(busy)}
            onClick={external(run, "https://claude.ai/settings/usage")}
          >
            Open in Claude
          </Button>
        </>
      }
    >
      {error && <Notice tone="error">{error}</Notice>}
      {metrics.map((row, index) => (
        <Meter
          key={index}
          label={row.label}
          value={row.used_percent}
          detail={row.resets_at ? `Resets ${timestamp(row.resets_at)}` : undefined}
          pace={metricPace(row)}
        />
      ))}
      {state?.spend && (
        <p className="connection-line">
          <span>Extra usage</span>
          <b>
            {money(state.spend.spent)} of {money(state.spend.limit)}
          </b>
        </p>
      )}
      {points.length > 1 && (
        <TrendLines
          label="Saved five-hour and weekly plan usage history"
          points={points}
          series={[
            { field: "fiveHour", color: SERIES[0], name: "5-hour" },
            { field: "sevenDay", color: SERIES[1], name: "Weekly" },
          ]}
        />
      )}
    </ConnectionCard>
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
    if (kind === "connect") setKey("");
  }
  const showForm = editing || (!state?.connected && busy !== "loading");
  return (
    <ConnectionCard
      name="OpenRouter"
      busy={busy}
      summary="Account credit balance and spending across your OpenRouter apps."
      tone={state?.connected ? (error ? "warning" : "good") : undefined}
      status={
        busy === "loading"
          ? "Checking…"
          : state?.connected
            ? "Connected"
            : "Not connected"
      }
      note={
        showForm
          ? "Balances need a management key, not an inference key. It is stored encrypted on this Windows account and only used to read credit totals."
          : state?.checkedAt
            ? `${error ? "Last checked" : "Checked"} ${timestamp(state.checkedAt)}. Account totals, not affected by the report date filter.`
            : undefined
      }
      actions={
        showForm ? (
          <>
            <Button
              type="submit"
              form="openrouter-key"
              variant="primary"
              disabled={Boolean(busy) || !key.trim()}
            >
              {busy === "connect"
                ? "Connecting…"
                : editing
                  ? "Save key"
                  : "Connect OpenRouter"}
            </Button>
            {state?.connected && (
              <Button
                variant="ghost"
                disabled={Boolean(busy)}
                onClick={() => {
                  setEditing(false);
                  setKey("");
                  clearError();
                }}
              >
                Cancel
              </Button>
            )}
            <Button
              variant="ghost"
              iconEnd={ExternalLink}
              disabled={Boolean(busy)}
              onClick={external(
                run,
                "https://openrouter.ai/settings/provisioning-keys",
              )}
            >
              Create a key
            </Button>
          </>
        ) : (
          state?.connected && (
            <>
              <Button
                icon={RefreshCw}
                spin={busy === "refresh"}
                disabled={Boolean(busy)}
                onClick={() => action("refresh")}
              >
                {busy === "refresh" ? "Checking…" : "Refresh"}
              </Button>
              <Button
                variant="ghost"
                disabled={Boolean(busy)}
                onClick={() => {
                  setEditing(true);
                  clearError();
                }}
              >
                Replace key
              </Button>
              <Button
                variant="ghost"
                disabled={Boolean(busy)}
                onClick={() => action("disconnect")}
              >
                {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
              </Button>
              <Button
                variant="ghost"
                iconEnd={ExternalLink}
                disabled={Boolean(busy)}
                onClick={external(run, "https://openrouter.ai/activity")}
              >
                Activity
              </Button>
            </>
          )
        )
      }
    >
      {error && <Notice tone="error">{error}</Notice>}
      {state?.remaining != null && (
        <dl className="connection-figures">
          <div>
            <dt>Remaining</dt>
            <dd>{money(state.remaining)}</dd>
          </div>
          <div>
            <dt>Spent</dt>
            <dd>{money(state.spent)}</dd>
          </div>
          <div>
            <dt>Purchased</dt>
            <dd>{money(state.purchased)}</dd>
          </div>
        </dl>
      )}
      {showForm && (
        <form
          id="openrouter-key"
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) action("connect");
          }}
        >
          <label className="field">
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
        </form>
      )}
    </ConnectionCard>
  );
}

export function AntigravityCard({ epoch, refresh }) {
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
  async function action(name) {
    setMessage("");
    await run(name, async (update) => {
      const value = await api.providerAction(name);
      if (name === "antigravity-open") {
        update(() => setMessage("Sign in inside Antigravity, then select Detect."));
        return;
      }
      const status =
        name === "antigravity-status"
          ? value
          : await api.providerAction("antigravity-status");
      update(() => {
        setGravity(status);
        if (name === "antigravity-sync") {
          setMessage("Sync finished. Reports have been refreshed.");
          refresh();
        } else
          setMessage(
            status.detectedConnections
              ? "Antigravity is running. You can sync its usage now."
              : "No running service found. Open Antigravity, sign in, then detect again.",
          );
      });
    });
  }
  const running = Boolean(gravity?.detectedConnections);
  return (
    <ConnectionCard
      name="Antigravity"
      busy={busy}
      summary="Usage read from Antigravity's local service while the app is open."
      tone={running ? "good" : undefined}
      status={
        busy === "loading"
          ? "Checking…"
          : running
            ? "Running"
            : gravity?.cachedSessions
              ? "Saved usage"
              : "Not running"
      }
      note={
        message ||
        (running
          ? "No API key needed. Limits appear on the Limits page when the service reports them."
          : "Open Antigravity and sign in to enable syncing. No API key needed.")
      }
      actions={
        <>
          <Button
            variant="primary"
            icon={RefreshCw}
            spin={busy === "antigravity-sync"}
            disabled={Boolean(busy) || !running}
            onClick={() => action("antigravity-sync")}
          >
            {busy === "antigravity-sync" ? "Syncing…" : "Sync usage"}
          </Button>
          <Button
            disabled={Boolean(busy)}
            onClick={() => action("antigravity-status")}
          >
            Detect
          </Button>
          <Button
            variant="ghost"
            disabled={Boolean(busy)}
            onClick={() => action("antigravity-open")}
          >
            Open Antigravity
          </Button>
        </>
      }
    >
      {error && <Notice tone="error">{error}</Notice>}
      <dl className="connection-figures">
        <div>
          <dt>Cached sessions</dt>
          <dd>{gravity?.cachedSessions ?? "—"}</dd>
        </div>
        <div>
          <dt>Last sync</dt>
          <dd className="small">
            {gravity?.lastSyncedAt ? timestamp(gravity.lastSyncedAt) : "Never"}
          </dd>
        </div>
      </dl>
    </ConnectionCard>
  );
}

export function ConnectionCards({ epoch, refresh }) {
  return (
    <div className="connection-section">
      <div className="connection-grid">
        <ClaudeDesktopCard epoch={epoch} />
        <AntigravityCard epoch={epoch} refresh={refresh} />
        <OpenRouterCard epoch={epoch} />
      </div>
    </div>
  );
}
