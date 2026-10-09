import React, { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { api } from "../use-report.js";
import { Button, Card, Notice } from "../ui.jsx";
import { dateLabel, dateTime, safeMessage } from "../format.js";

// Settings card for combining usage across the user's own computers.
export function SyncCard({ sync, setSync }) {
  const [url, setUrl] = useState(""),
    [token, setToken] = useState(""),
    [name, setName] = useState(""),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [removing, setRemoving] = useState("");
  const ownName = sync?.device?.name || "";
  useEffect(() => setName(ownName), [ownName]);
  const act = async (label, task) => {
    setBusy(label);
    setError("");
    try {
      setSync(await task());
      return true;
    } catch (e) {
      setError(safeMessage(e.message));
      return false;
    } finally {
      setBusy("");
    }
  };
  if (!sync) return null;
  if (!sync.connected)
    return (
      <Card title="Sync across computers">
        <p className="muted">
          Combine usage from all your computers. Each one saves its daily totals
          (dates, clients, models, tokens and cost) to a private store you run
          on your own Cloudflare account, and reads the others. Chats, session
          names and folder paths never leave this computer.
        </p>
        <form
          className="sync-form"
          onSubmit={async (e) => {
            e.preventDefault();
            if (busy) return;
            if (await act("connect", () => api.syncConnect({ url, token, name }))) setToken("");
          }}
        >
          <label className="field">
            Sync address
            <input
              aria-label="Sync address"
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…"
              autoComplete="off"
              spellCheck={false}
              disabled={Boolean(busy)}
            />
          </label>
          <label className="field">
            Access token
            <input
              aria-label="Sync access token"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              autoComplete="off"
              spellCheck={false}
              disabled={Boolean(busy)}
            />
          </label>
          <label className="field">
            This computer's name
            <input
              aria-label="This computer's name"
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
              disabled={Boolean(busy)}
            />
          </label>
          <div className="sync-actions">
            <Button variant="primary" type="submit" disabled={Boolean(busy) || !url || !token}>
              {busy === "connect" ? "Connecting…" : "Connect"}
            </Button>
            <span className="muted">Use the same address and token on every computer.</span>
          </div>
        </form>
        {(error || sync.error) && <Notice tone="error">{error || sync.error}</Notice>}
      </Card>
    );
  const working = Boolean(busy) || sync.syncing;
  return (
    <Card title="Sync across computers">
      <div className="setting-row">
        <div>
          <h3>Connected</h3>
          <p>
            <code className="path" title={sync.url}>{sync.url}</code>
            {sync.syncedAt ? ` · Synced ${dateTime(sync.syncedAt)}` : " · Not synced yet"}
          </p>
        </div>
        <div className="setting-control">
          <Button small icon={RefreshCw} spin={working} disabled={working} onClick={() => act("sync", () => api.syncNow())}>
            {working ? "Syncing…" : "Sync now"}
          </Button>
          <Button small variant="ghost" disabled={Boolean(busy)} onClick={() => act("disconnect", () => api.syncDisconnect())}>
            Disconnect
          </Button>
        </div>
      </div>
      <div className="setting-row">
        <div>
          <h3>This computer's name</h3>
          <p>How this computer is listed on your others.</p>
        </div>
        <form
          className="setting-control"
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy && name.trim() && name.trim() !== ownName) act("rename", () => api.syncRename(name));
          }}
        >
          <label className="field">
            <input
              aria-label="This computer's name"
              value={name}
              maxLength={80}
              onChange={(e) => setName(e.target.value)}
              disabled={Boolean(busy)}
            />
          </label>
          <Button small type="submit" disabled={Boolean(busy) || !name.trim() || name.trim() === ownName}>
            Save
          </Button>
        </form>
      </div>
      <div className="setting-row sync-devices-row">
        <div>
          <h3>Computers</h3>
          <p>
            Reports add these together; the computer filter on report pages
            shows one at a time. Sessions, workspaces and hourly reports stay
            on the computer that recorded them.
          </p>
        </div>
        <ul className="sync-devices">
          {sync.devices.map((device) => (
            <li key={device.id}>
              <div>
                <b>{device.name}</b>
                {device.self && <span className="muted"> · this computer</span>}
                <small>
                  {device.days
                    ? `${device.days} day${device.days === 1 ? "" : "s"} of usage through ${dateLabel(device.lastDate)}`
                    : "No usage yet"}
                  {device.updatedAt ? ` · Updated ${dateTime(device.updatedAt)}` : ""}
                </small>
              </div>
              {!device.self && (
                <Button
                  small
                  variant="ghost"
                  disabled={Boolean(busy)}
                  onBlur={() => setRemoving("")}
                  onClick={async () => {
                    if (removing !== device.id) return setRemoving(device.id);
                    setRemoving("");
                    await act("remove", () => api.syncRemoveDevice(device.id));
                  }}
                >
                  {removing === device.id ? "Confirm removal" : "Remove"}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </div>
      {(error || sync.error) && <Notice tone="error">{error || sync.error}</Notice>}
    </Card>
  );
}
