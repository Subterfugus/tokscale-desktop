"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { createHash } = require("node:crypto");
const { createClaudeDesktop, desktopRoots, usage } = require("./claude-desktop.cjs");
const { createProviderCache } = require("./provider-cache.cjs");

const hash = value => createHash("sha256").update(value).digest("hex").slice(0, 32);
const text = value => typeof value === "string" ? value.replace(/[\x00-\x1f\x7f]/g, "").slice(0, 160) : "";
async function json(file) {
  if ((await fs.stat(file)).size > 4 * 1024 * 1024) throw new Error("Claude profile is too large to read.");
  const value = JSON.parse(await fs.readFile(file, "utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Claude profile could not be read.");
  return value;
}
async function optionalJson(file) { try { return await json(file); } catch { return {}; } }

function createClaudeAccounts({ env = process.env, fetchImpl = fetch, getSettings, saveSettings, desktopFactory = createClaudeDesktop, now = Date.now }) {
  const home = env.USERPROFILE || env.HOME || os.homedir();
  const caches = new Map(), results = new Map(), revisions = new Map(), cooldowns = new Map(), currentGroups = new Map();
  let mutations = Promise.resolve();
  const revision = id => revisions.get(id) || 0;
  const change = work => {
    const task = mutations.then(work);
    mutations = task.catch(() => {});
    return task;
  };
  async function discover() {
    const settings = getSettings();
    const roots = [env.CLAUDE_CONFIG_DIR, path.join(home, ".claude"), ...(settings.claudeProfileDirs || [])].filter(Boolean);
    try {
      for (const entry of await fs.readdir(home, { withFileTypes: true }))
        if (entry.isDirectory() && /^\.claude[_-].+$/i.test(entry.name)) roots.push(path.join(home, entry.name));
    } catch {}
    const profiles = [], seen = new Set();
    for (const candidate of roots) {
      if (!path.isAbsolute(candidate)) continue;
      let root;
      try {
        root = await fs.realpath(candidate);
        if (!(await fs.stat(path.join(root, ".credentials.json"))).isFile()) continue;
      } catch { continue; }
      const canonical = process.platform === "win32" ? root.toLowerCase() : root;
      if (seen.has(canonical)) continue;
      seen.add(canonical);
      const config = await optionalJson(path.join(root, ".claude.json"));
      const metadata = config.oauthAccount || (canonical === path.join(home, ".claude").toLowerCase() || root === path.join(home, ".claude")
        ? (await optionalJson(path.join(home, ".claude.json"))).oauthAccount : null) || {};
      const credentials = await optionalJson(path.join(root, ".credentials.json"));
      const oauth = credentials.claudeAiOauth;
      // The access token is used only for in-memory deduplication; it is never returned or saved.
      profiles.push({ root, kind: "code", uuid: text(metadata.accountUuid), org: text(metadata.organizationUuid),
        fingerprint: typeof oauth?.accessToken === "string" ? hash(oauth.accessToken) : "",
        label: text(metadata.emailAddress) || path.basename(root), plan: text(oauth?.subscriptionType),
        source: `Claude Code · ${path.basename(root)}` });
    }
    for (const root of await desktopRoots(env)) {
      const config = await optionalJson(path.join(root, "config.json"));
      if (typeof config.lastKnownAccountUuid !== "string" || !config["oauth:tokenCacheV2"]) continue;
      profiles.push({ root, kind: "desktop", uuid: text(config.lastKnownAccountUuid), org: "", label: `Claude desktop · ${text(config.lastKnownAccountUuid).slice(0, 8)}`, source: "Claude desktop login" });
    }
    const groups = [];
    for (const profile of profiles) {
      const match = groups.find(group => group.profiles.some(other =>
        (profile.uuid && profile.uuid === other.uuid && (!profile.org || !other.org || profile.org === other.org)) ||
        (profile.fingerprint && profile.fingerprint === other.fingerprint)));
      if (match) match.profiles.push(profile);
      else groups.push({ id: `claude-${hash(profile.uuid ? `${profile.uuid}:${profile.org}` : profile.root)}`, profiles: [profile] });
    }
    return groups;
  }
  function connected(group) {
    const settings = getSettings();
    return Array.isArray(settings.claudeAccountIds) ? settings.claudeAccountIds.includes(group.id)
      : Boolean(settings.claudeDesktopConnected && group.profiles.some(p => p.kind === "desktop"));
  }
  function publicAccount(group) {
    const primary = group.profiles[0];
    return { id: group.id, label: primary.label, plan: primary.plan || "", source: group.profiles.map(p => p.source).join(" / "),
      connected: connected(group), detected: true, ...(connected(group) ? results.get(group.id) : {}), profiles: group.profiles.length };
  }
  async function status() { return { accounts: (await discover()).map(publicAccount) }; }
  function cache(group) {
    currentGroups.set(group.id, group);
    if (!caches.has(group.id)) caches.set(group.id, createProviderCache(async () => {
      group = currentGroups.get(group.id);
      if ((cooldowns.get(group.id) || 0) > now()) throw new Error("Claude is rate limiting this account. Try again in a few minutes.");
      let failure;
      for (const profile of group.profiles) {
        try {
          if (profile.kind === "desktop") {
            const reader = desktopFactory({ env, fetchImpl, roots: [profile.root] });
            return await reader.refresh();
          }
          let credentials;
          try { credentials = await json(path.join(profile.root, ".credentials.json")); }
          catch { throw new Error("Claude Code sign-in could not be read. Sign in to this profile again."); }
          const oauth = credentials.claudeAiOauth;
          if (!oauth || typeof oauth.accessToken !== "string" || !oauth.accessToken || /[\r\n]/.test(oauth.accessToken))
            throw new Error("Claude Code sign-in could not be read. Sign in to this profile again.");
          if (!Number.isFinite(oauth.expiresAt) || oauth.expiresAt <= now())
            throw new Error("This Claude Code sign-in has expired. Open Claude Code with this profile to refresh its login.");
          if (!Array.isArray(oauth.scopes) || !oauth.scopes.includes("user:profile"))
            throw new Error("This Claude Code sign-in cannot read subscription usage. Sign in to this profile again.");
          let response;
          try {
            response = await fetchImpl("https://api.anthropic.com/api/oauth/usage", {
              method: "GET", headers: { Authorization: `Bearer ${oauth.accessToken}`, "anthropic-beta": "oauth-2025-04-20" },
              redirect: "error", signal: AbortSignal.timeout(20000),
            });
          } catch { throw new Error("Claude could not be reached. Check your connection and try again."); }
          if (response.status === 429) {
            cooldowns.set(group.id, now() + Math.min(3600, Math.max(60, Number(response.headers?.get("retry-after")) || 300)) * 1000);
            throw new Error("Claude is rate limiting this account. Try again in a few minutes.");
          }
          if (response.status === 401 || response.status === 403) throw new Error("Claude rejected this sign-in. Sign in to this Claude Code profile again.");
          if (!response.ok) throw new Error("Claude usage is currently unavailable for this account.");
          let result;
          try { result = usage(await response.json()); } catch { throw new Error("Claude returned no readable quota data for this account."); }
          return { ...result, samples: [], checkedAt: new Date(now()).toISOString() };
        } catch (error) {
          failure = error;
          // A server cooldown applies to the subscription, including alternate logins.
          if (cooldowns.get(group.id) > now() || /rate limiting/.test(error.message)) {
            if (!cooldowns.get(group.id)) cooldowns.set(group.id, now() + 300000);
            break;
          }
        }
      }
      throw failure || new Error("Claude sign-in was not found.");
    }, { now }));
    return caches.get(group.id);
  }
  function validateOptions(options) {
    if (!options || typeof options !== "object" || Array.isArray(options) ||
      (options.force !== undefined && typeof options.force !== "boolean") ||
      (options.accountId !== undefined && (typeof options.accountId !== "string" || !/^claude-[a-f0-9]{32}$/.test(options.accountId))))
      throw new Error("Invalid Claude account request");
  }
  async function refresh(options = {}) {
    validateOptions(options);
    const requestedRevision = options.accountId ? revision(options.accountId) : null;
    const groups = await discover();
    const selected = options.accountId ? groups.filter(g => g.id === options.accountId) : groups.filter(connected);
    if (options.accountId && !selected.length) throw new Error("Claude profile was not found. Check that it still exists and is signed in.");
    await Promise.all(selected.map(async group => {
      const attempt = options.accountId ? requestedRevision : revision(group.id);
      if (attempt !== revision(group.id)) return;
      try {
        const data = await cache(group).refresh({ force: Boolean(options.force) });
        if (attempt !== revision(group.id)) return;
        if (options.accountId && !connected(group)) await change(async () => {
          if (attempt !== revision(group.id)) return;
          const ids = groups.filter(connected).map(g => g.id);
          await saveSettings({ claudeAccountIds: [...new Set([...ids, group.id])], claudeDesktopConnected: false });
        });
        if (attempt === revision(group.id)) results.set(group.id, { ...data, error: null });
      } catch (error) {
        if (attempt === revision(group.id)) {
          caches.delete(group.id);
          results.set(group.id, { ...results.get(group.id), error: error.message });
        }
        if (options.accountId) throw error;
      }
    }));
    return status();
  }
  async function disconnect(accountId) {
    validateOptions({ accountId });
    if (!accountId) throw new Error("Choose a Claude account to disconnect");
    revisions.set(accountId, revision(accountId) + 1);
    caches.get(accountId)?.invalidate();
    caches.delete(accountId);
    results.delete(accountId);
    await change(async () => {
      const groups = await discover();
      await saveSettings({ claudeAccountIds: groups.filter(g => g.id !== accountId && connected(g)).map(g => g.id), claudeDesktopConnected: false });
    });
    return status();
  }
  async function addDirectory(directory) {
    if (typeof directory !== "string" || !path.isAbsolute(directory) || directory.includes("\0")) throw new Error("Choose an absolute Claude profile folder");
    const root = await fs.realpath(directory);
    if (!(await fs.stat(path.join(root, ".credentials.json"))).isFile()) throw new Error("Choose a signed-in Claude Code profile containing .credentials.json");
    await change(() => saveSettings({ claudeProfileDirs: [...new Set([...(getSettings().claudeProfileDirs || []), root])] }));
    return status();
  }
  return { status, refresh, disconnect, addDirectory };
}
module.exports = { createClaudeAccounts };
