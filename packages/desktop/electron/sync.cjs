const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID, randomBytes, createHash } = require("node:crypto");
const { cleanDays, snapshotDays, archivedDays, joinDays } = require("./sync-data.cjs");

const DEVICE_ID = /^[a-z0-9][a-z0-9-]{7,63}$/;
const MAX_RESPONSE = 32 * 1024 * 1024;

function syncUrl(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 500)
    throw new Error("Enter the sync address.");
  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Enter the sync address as a full https:// link.");
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash)
    throw new Error("The sync address must be a plain https:// link.");
  return url.origin + url.pathname.replace(/\/+$/, "");
}
function syncToken(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_\-.~+/=]{32,256}$/.test(value.trim()))
    throw new Error("Enter the access token (at least 32 letters, digits or - _ characters).");
  return value.trim();
}
function deviceName(value) {
  if (typeof value !== "string") throw new Error("Enter a name for this computer.");
  const name = value.replace(/[\x00-\x1f]/g, " ").trim().slice(0, 80);
  if (!name) throw new Error("Enter a name for this computer.");
  return name;
}
const newToken = () => randomBytes(32).toString("base64url");

async function readJson(file, limit) {
  try {
    if ((await fs.stat(file)).size > limit) return null;
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return null;
  }
}
async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = file + "." + randomUUID() + ".tmp";
  try {
    await fs.writeFile(temp, JSON.stringify(value), { mode: 0o600 });
    await fs.rename(temp, file);
  } finally {
    await fs.rm(temp, { force: true });
  }
}

// Keeps this computer's daily totals in the user's own sync store and a local
// copy of every other computer's, so reports still combine them offline.
function createSync({
  dir,
  safeStorage,
  getGraph,
  hostname = "This computer",
  fetchImpl = fetch,
  now = Date.now,
  interval = 300000,
  onStatus = () => {},
}) {
  const connectionFile = path.join(dir, "sync-connection.json");
  const deviceFile = path.join(dir, "sync-device.json");
  const cacheFile = path.join(dir, "sync-cache.json");
  let connection = null, // { url, token }
    device = null, // { id, name }
    cache = { devices: {}, own: null, syncedAt: null },
    loaded = null,
    running = null,
    timer = null,
    revision = 0,
    error = null;

  function load() {
    loaded ||= (async () => {
      const savedDevice = await readJson(deviceFile, 4096);
      device =
        savedDevice && DEVICE_ID.test(savedDevice.id || "")
          ? { id: savedDevice.id, name: deviceName(String(savedDevice.name || hostname)) }
          : { id: randomUUID(), name: deviceName(hostname) };
      if (!savedDevice) await writeJson(deviceFile, device).catch(() => {});
      const saved = await readJson(connectionFile, 8192);
      if (saved?.version === 1 && typeof saved.encryptedToken === "string") {
        try {
          if (!safeStorage.isEncryptionAvailable()) throw new Error("unavailable");
          connection = {
            url: syncUrl(saved.url),
            token: syncToken(safeStorage.decryptString(Buffer.from(saved.encryptedToken, "base64"))),
          };
        } catch {
          error = "The saved sync connection could not be read. Connect again.";
        }
      }
      const savedCache = connection && (await readJson(cacheFile, 256 * 1024 * 1024));
      if (savedCache?.version === 1) {
        const devices = {};
        for (const [id, entry] of Object.entries(savedCache.devices || {}))
          if (DEVICE_ID.test(id) && id !== device.id)
            devices[id] = {
              name: String(entry?.name || "Computer").slice(0, 80),
              updatedAt: String(entry?.updatedAt || ""),
              days: cleanDays(entry?.days),
            };
        const own = savedCache.own;
        cache = {
          devices,
          own: own
            ? {
                hash: String(own.hash || ""),
                updatedAt: String(own.updatedAt || ""),
                days: cleanDays(own.days),
                archived: cleanDays(own.archived),
              }
            : null,
          syncedAt: Number.isFinite(savedCache.syncedAt) ? savedCache.syncedAt : null,
        };
      }
    })();
    return loaded;
  }

  async function request(target, method, pathname, body) {
    let response;
    try {
      response = await fetchImpl(target.url + pathname, {
        method,
        headers: {
          Authorization: "Bearer " + target.token,
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: "error",
        signal: AbortSignal.timeout(30000),
      });
    } catch {
      throw new Error("Could not reach the sync address. Check it and your connection.");
    }
    if (response.status === 401) throw new Error("The sync address rejected this access token.");
    if (response.status === 503)
      throw new Error("The sync store has no access token set up yet. Finish its setup first.");
    if (response.status === 404 && pathname === "/v1/devices")
      throw new Error("Nothing at this address answers as a Tokscale sync store.");
    if (!response.ok) {
      let detail = "";
      try {
        detail = String((await response.json()).error || "").slice(0, 120);
      } catch {}
      throw new Error(detail ? `Sync failed: ${detail}` : "The sync store is unavailable. Try again later.");
    }
    const raw = await response.text();
    if (raw.length > MAX_RESPONSE) throw new Error("The sync store returned too much data.");
    try {
      return JSON.parse(raw);
    } catch {
      throw new Error("Nothing at this address answers as a Tokscale sync store.");
    }
  }

  function status() {
    const describe = (days) => {
      const dates = Object.keys(days || {});
      return { days: dates.length, lastDate: dates.sort().at(-1) || null };
    };
    return {
      connected: Boolean(connection),
      url: connection?.url || "",
      device: device ? { ...device } : null,
      devices: connection
        ? [
            ...(device
              ? [{ id: device.id, name: device.name, self: true, updatedAt: cache.own?.updatedAt || null, ...describe(cache.own?.days) }]
              : []),
            ...Object.entries(cache.devices)
              .map(([id, entry]) => ({ id, name: entry.name, self: false, updatedAt: entry.updatedAt || null, ...describe(entry.days) }))
              .sort((a, b) => a.name.localeCompare(b.name)),
          ]
        : [],
      syncedAt: cache.syncedAt,
      syncing: Boolean(running),
      error,
    };
  }
  const publish = (changed) => {
    try {
      onStatus(status(), changed);
    } catch {}
  };

  async function runSync() {
    const target = connection,
      attempt = revision;
    const stale = () => attempt !== revision;
    let changed = false;
    const list = await request(target, "GET", "/v1/devices");
    if (stale()) return false;
    const remote = new Map();
    for (const entry of Array.isArray(list?.devices) ? list.devices : [])
      if (DEVICE_ID.test(entry?.id || ""))
        remote.set(entry.id, { name: String(entry.name || "Computer").slice(0, 80), updatedAt: String(entry.updatedAt || "") });
    for (const id of Object.keys(cache.devices))
      if (!remote.has(id)) {
        delete cache.devices[id];
        changed = true;
      }
    for (const [id, meta] of remote) {
      if (id === device.id) continue;
      if (cache.devices[id]?.updatedAt === meta.updatedAt) {
        cache.devices[id].name = meta.name;
        continue;
      }
      const detail = await request(target, "GET", "/v1/devices/" + id);
      if (stale()) return false;
      cache.devices[id] = { ...meta, days: cleanDays(detail?.days) };
      changed = true;
    }
    // What this computer uploaded before: the copy kept here, unless the store
    // holds a different one (a reinstall, or a cleared app data folder).
    const mine = remote.get(device.id);
    let uploaded = cache.own?.days || {};
    if (mine && mine.updatedAt !== cache.own?.updatedAt) {
      const detail = await request(target, "GET", "/v1/devices/" + device.id);
      if (stale()) return false;
      uploaded = cleanDays(detail?.days);
    }
    const local = snapshotDays(await getGraph());
    if (stale()) return false;
    const archived = archivedDays(local, uploaded);
    const days = joinDays(local, archived);
    const hash = createHash("sha256").update(JSON.stringify([device.name, days])).digest("hex");
    let updatedAt = mine?.updatedAt || "";
    if (!mine || hash !== cache.own?.hash || mine.updatedAt !== cache.own?.updatedAt) {
      const saved = await request(target, "PUT", "/v1/devices/" + device.id, { name: device.name, days });
      if (stale()) return false;
      updatedAt = String(saved?.updatedAt || "");
    }
    if (JSON.stringify(archived) !== JSON.stringify(cache.own?.archived || {})) changed = true;
    cache.own = { hash, updatedAt, days, archived };
    cache.syncedAt = now();
    await writeJson(cacheFile, { version: 1, ...cache }).catch(() => {});
    return changed;
  }

  function sync() {
    if (running) return running;
    const task = load().then(async () => {
      if (!connection) return status();
      let changed = false;
      try {
        changed = await runSync();
        error = null;
      } catch (failure) {
        error = String(failure?.message || failure).slice(0, 300);
      }
      return changed;
    });
    running = task.then((changed) => {
      running = null;
      publish(changed === true);
      return status();
    });
    publish(false);
    return running;
  }

  return {
    newToken,
    async status() {
      await load();
      return status();
    },
    sync,
    async connect(input) {
      await load();
      const url = syncUrl(input?.url),
        token = syncToken(input?.token),
        name = deviceName(input?.name ?? device.name);
      if (!safeStorage.isEncryptionAvailable())
        throw new Error("Windows credential encryption is unavailable; the connection was not saved.");
      // Proves the address and token before anything is saved.
      await request({ url, token }, "GET", "/v1/devices");
      revision++;
      await running?.catch(() => {});
      const switched = connection && connection.url !== url;
      await writeJson(connectionFile, {
        version: 1,
        url,
        encryptedToken: safeStorage.encryptString(token).toString("base64"),
      });
      connection = { url, token };
      if (switched) cache = { devices: {}, own: null, syncedAt: null };
      if (name !== device.name) {
        device = { ...device, name };
        await writeJson(deviceFile, device);
      }
      error = null;
      return sync();
    },
    async rename(value) {
      await load();
      const name = deviceName(value);
      if (name !== device.name) {
        device = { ...device, name };
        await writeJson(deviceFile, device);
      }
      return connection ? sync() : status();
    },
    // Forgets the connection here; the store keeps what was uploaded.
    async disconnect() {
      await load();
      revision++;
      await running?.catch(() => {});
      connection = null;
      cache = { devices: {}, own: null, syncedAt: null };
      error = null;
      await fs.rm(connectionFile, { force: true });
      await fs.rm(cacheFile, { force: true });
      publish(true);
      return status();
    },
    // Deletes another computer's snapshot from the store, for one no longer used.
    async removeDevice(id) {
      await load();
      if (!connection) throw new Error("Sync is not connected.");
      if (typeof id !== "string" || !DEVICE_ID.test(id)) throw new Error("Unknown computer");
      if (id === device.id) throw new Error("Disconnect to stop syncing this computer.");
      await running?.catch(() => {});
      await request(connection, "DELETE", "/v1/devices/" + id);
      delete cache.devices[id];
      await writeJson(cacheFile, { version: 1, ...cache }).catch(() => {});
      publish(true);
      return status();
    },
    // The usage to add to a report of this computer's own data. `selected` is
    // "all", this computer's id, or another computer's id.
    extra(selected = "all") {
      if (!connection || !device) return { includeLocal: true, days: {} };
      if (selected === device.id) return { includeLocal: true, days: cache.own?.archived || {} };
      if (selected !== "all")
        return { includeLocal: false, days: cache.devices[selected]?.days || {} };
      return {
        includeLocal: true,
        days: joinDays(cache.own?.archived, ...Object.values(cache.devices).map((entry) => entry.days)),
      };
    },
    start() {
      if (timer) return;
      void sync();
      timer = setInterval(() => void sync(), interval);
      timer.unref?.();
    },
    stop() {
      clearInterval(timer);
      timer = null;
    },
  };
}

module.exports = { createSync, syncUrl, syncToken, deviceName, newToken };
