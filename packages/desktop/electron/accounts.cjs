const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
function apiKey(value) {
  if (
    typeof value !== "string" ||
    !/^sk-or-[A-Za-z0-9_-]{16,512}$/.test(value.trim())
  )
    throw new Error("Enter a valid OpenRouter management key.");
  return value.trim();
}
function credits(data) {
  if (
    !data ||
    !Number.isFinite(data.total_credits) ||
    !Number.isFinite(data.total_usage) ||
    data.total_credits < 0 ||
    data.total_usage < 0
  )
    throw new Error("OpenRouter returned an unreadable credit balance.");
  return {
    purchased: data.total_credits,
    spent: data.total_usage,
    remaining: data.total_credits - data.total_usage,
    checkedAt: new Date().toISOString(),
  };
}
function createOpenRouter({ file, safeStorage, fetchImpl = fetch }) {
  let revision = 0,
    mutations = Promise.resolve();
  function change(fn) {
    const next = mutations.then(fn);
    mutations = next.catch(() => {});
    return next;
  }
  async function readKey() {
    try {
      const stat = await fs.stat(file);
      if (!safeStorage.isEncryptionAvailable() || stat.size > 8192)
        throw new Error("Unreadable connection");
      const stored = JSON.parse(await fs.readFile(file, "utf8"));
      if (stored.version !== 1 || typeof stored.encryptedKey !== "string")
        throw new Error("Invalid saved connection");
      return apiKey(
        safeStorage.decryptString(Buffer.from(stored.encryptedKey, "base64")),
      );
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw new Error(
        "Saved OpenRouter connection could not be read. Reconnect using a management key.",
      );
    }
  }
  async function request(key) {
    let response;
    try {
      response = await fetchImpl("https://openrouter.ai/api/v1/credits", {
        method: "GET",
        headers: { Authorization: "Bearer " + key },
        redirect: "error",
        signal: AbortSignal.timeout(20000),
      });
    } catch {
      throw new Error(
        "Could not reach OpenRouter. Check your connection and try again.",
      );
    }
    if (response.status === 403)
      throw new Error(
        "Account balances require an OpenRouter management key. Create one using the button below.",
      );
    if (response.status === 401)
      throw new Error(
        "OpenRouter rejected this key. Check it or create a new management key.",
      );
    if (response.status === 429)
      throw new Error("OpenRouter is rate limiting requests. Try again later.");
    if (!response.ok)
      throw new Error("OpenRouter is unavailable. Try again later.");
    try {
      return credits((await response.json()).data);
    } catch {
      throw new Error("OpenRouter returned an unreadable credit balance.");
    }
  }
  return {
    async status() {
      return { connected: Boolean(await readKey()) };
    },
    connect(value) {
      return change(async () => {
        ++revision;
        const key = apiKey(value);
        if (!safeStorage.isEncryptionAvailable())
          throw new Error(
            "Windows credential encryption is unavailable; the key was not saved.",
          );
        const result = await request(key);
        await fs.mkdir(path.dirname(file), { recursive: true });
        const temp = file + "." + randomUUID() + ".tmp";
        try {
          await fs.writeFile(
            temp,
            JSON.stringify({
              version: 1,
              encryptedKey: safeStorage.encryptString(key).toString("base64"),
            }),
            { mode: 0o600 },
          );
          await fs.rename(temp, file);
        } finally {
          await fs.rm(temp, { force: true });
        }
        return { connected: true, ...result };
      });
    },
    async refresh() {
      const attempt = revision;
      const key = await readKey();
      if (!key) return { connected: false };
      const result = await request(key);
      if (attempt !== revision)
        throw new Error("Connection changed; refresh again.");
      return { connected: true, ...result };
    },
    disconnect() {
      return change(async () => {
        ++revision;
        await fs.rm(file, { force: true });
        return { connected: false };
      });
    },
  };
}
module.exports = { apiKey, credits, createOpenRouter };
