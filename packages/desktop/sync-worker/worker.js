// Private store for Tokscale Desktop's per-computer usage snapshots.
//
// Each computer keeps one snapshot of its own daily totals here and reads the
// others. Every request must carry the shared access token, which is a Worker
// secret (SYNC_TOKEN) and never part of this repository.

const DEVICE_ID = /^[a-z0-9][a-z0-9-]{7,63}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TOKEN_FIELDS = ["input", "output", "cacheRead", "cacheWrite", "reasoning"];
const MAX_BODY = 8 * 1024 * 1024;
const MAX_DAYS = 8000;
const MAX_ROWS_PER_DAY = 400;
// A D1 row holds at most 2 MB; one year of one computer stays well under it.
const MAX_YEAR_BYTES = 1_800_000;
const MAX_DEVICES = 50;

const json = (value, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
const fail = (status, error) => json({ error }, status);

async function digest(text) {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
  );
}
const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

// Compares digests so the comparison takes the same time for any guess.
async function authorized(request, env) {
  const expected = typeof env.SYNC_TOKEN === "string" ? env.SYNC_TOKEN : "";
  const header = request.headers.get("authorization") || "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";
  const [a, b] = await Promise.all([digest(expected), digest(given)]);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}

const count = (value) =>
  Number.isFinite(value) && value >= 0 && value <= 1e15 ? value : null;

function cleanRow(row) {
  if (!row || typeof row !== "object") return null;
  const text = (value) =>
    typeof value === "string" && value.length > 0 && value.length <= 200 ? value : null;
  const client = text(row.client),
    modelId = text(row.modelId),
    providerId = text(row.providerId) || "unknown";
  const cost = count(row.cost),
    messages = count(row.messages);
  if (!client || !modelId || cost === null || messages === null) return null;
  const tokens = {};
  for (const field of TOKEN_FIELDS) {
    const value = count(row.tokens?.[field] ?? 0);
    if (value === null) return null;
    tokens[field] = value;
  }
  return { client, modelId, providerId, tokens, cost, messages };
}

// Returns the snapshot's days grouped by calendar year, or an error message.
function cleanSnapshot(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "Invalid snapshot";
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
  if (!name) return "A computer name is required";
  const days = body.days;
  if (!days || typeof days !== "object" || Array.isArray(days)) return "Invalid days";
  const dates = Object.keys(days);
  if (dates.length > MAX_DAYS) return "Too many days";
  const years = new Map();
  for (const date of dates) {
    if (!DATE.test(date)) return "Invalid date";
    const rows = days[date];
    if (!Array.isArray(rows) || rows.length > MAX_ROWS_PER_DAY) return "Invalid day";
    const cleaned = rows.map(cleanRow);
    if (cleaned.includes(null)) return "Invalid usage row";
    if (!cleaned.length) continue;
    const year = date.slice(0, 4);
    if (!years.has(year)) years.set(year, {});
    years.get(year)[date] = cleaned;
  }
  return { name, years };
}

const schemaReady = new WeakSet();
async function ensureSchema(db) {
  if (schemaReady.has(db)) return;
  await db.batch([
    db.prepare(
      "CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY, name TEXT NOT NULL, updated_at TEXT NOT NULL)",
    ),
    db.prepare(
      "CREATE TABLE IF NOT EXISTS device_years (device_id TEXT NOT NULL, year TEXT NOT NULL, hash TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY (device_id, year))",
    ),
  ]);
  schemaReady.add(db);
}

async function listDevices(db) {
  const { results } = await db
    .prepare("SELECT id, name, updated_at FROM devices ORDER BY name, id")
    .all();
  return json({
    devices: results.map((row) => ({ id: row.id, name: row.name, updatedAt: row.updated_at })),
  });
}

async function readDevice(db, id) {
  const device = await db
    .prepare("SELECT id, name, updated_at FROM devices WHERE id = ?")
    .bind(id)
    .first();
  if (!device) return fail(404, "Unknown computer");
  const { results } = await db
    .prepare("SELECT body FROM device_years WHERE device_id = ? ORDER BY year")
    .bind(id)
    .all();
  const days = {};
  for (const row of results) Object.assign(days, JSON.parse(row.body));
  return json({ id: device.id, name: device.name, updatedAt: device.updated_at, days });
}

async function writeDevice(db, id, request) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > MAX_BODY) return fail(413, "Snapshot is too large");
  const text = await request.text();
  if (text.length > MAX_BODY) return fail(413, "Snapshot is too large");
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return fail(400, "Invalid JSON");
  }
  const snapshot = cleanSnapshot(body);
  if (typeof snapshot === "string") return fail(400, snapshot);

  const known = await db.prepare("SELECT id FROM devices WHERE id = ?").bind(id).first();
  if (!known) {
    const total = await db.prepare("SELECT COUNT(*) AS n FROM devices").first();
    if (total.n >= MAX_DEVICES) return fail(409, "Too many computers; remove one first");
  }
  const { results } = await db
    .prepare("SELECT year, hash FROM device_years WHERE device_id = ?")
    .bind(id)
    .all();
  const stored = new Map(results.map((row) => [row.year, row.hash]));
  const updatedAt = new Date().toISOString();
  const statements = [
    db
      .prepare(
        "INSERT INTO devices (id, name, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated_at = excluded.updated_at",
      )
      .bind(id, snapshot.name, updatedAt),
  ];
  // Only years whose contents changed are rewritten; past years rarely do.
  for (const [year, days] of snapshot.years) {
    const body = JSON.stringify(days);
    if (body.length > MAX_YEAR_BYTES) return fail(413, `Usage for ${year} is too large`);
    const hash = hex(await digest(body));
    if (stored.get(year) !== hash)
      statements.push(
        db
          .prepare(
            "INSERT INTO device_years (device_id, year, hash, body) VALUES (?, ?, ?, ?) ON CONFLICT(device_id, year) DO UPDATE SET hash = excluded.hash, body = excluded.body",
          )
          .bind(id, year, hash, body),
      );
    stored.delete(year);
  }
  for (const year of stored.keys())
    statements.push(
      db.prepare("DELETE FROM device_years WHERE device_id = ? AND year = ?").bind(id, year),
    );
  await db.batch(statements);
  return json({ id, name: snapshot.name, updatedAt });
}

async function removeDevice(db, id) {
  await db.batch([
    db.prepare("DELETE FROM device_years WHERE device_id = ?").bind(id),
    db.prepare("DELETE FROM devices WHERE id = ?").bind(id),
  ]);
  return json({ removed: id });
}

export default {
  async fetch(request, env) {
    try {
      // Without a real secret the store stays closed rather than open.
      if (typeof env.SYNC_TOKEN !== "string" || env.SYNC_TOKEN.length < 32)
        return fail(503, "Sync is not configured");
      if (!(await authorized(request, env))) return fail(401, "Unauthorized");
      const { pathname } = new URL(request.url);
      const method = request.method;
      await ensureSchema(env.DB);
      if (pathname === "/v1/devices")
        return method === "GET" ? listDevices(env.DB) : fail(405, "Method not allowed");
      const match = /^\/v1\/devices\/([^/]+)$/.exec(pathname);
      if (!match) return fail(404, "Not found");
      const id = match[1];
      if (!DEVICE_ID.test(id)) return fail(400, "Invalid computer id");
      if (method === "GET") return await readDevice(env.DB, id);
      if (method === "PUT") return await writeDevice(env.DB, id, request);
      if (method === "DELETE") return await removeDevice(env.DB, id);
      return fail(405, "Method not allowed");
    } catch {
      return fail(500, "Sync storage failed");
    }
  },
};

export { cleanSnapshot };
