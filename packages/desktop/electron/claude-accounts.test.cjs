const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { createClaudeAccounts } = require("./claude-accounts.cjs");
const { settings: validate } = require("./security.cjs");

async function fixture(t, options = {}) {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "tokscale-claude-accounts-"));
  t.after(() => fs.rm(home, { recursive: true, force: true }));
  let settings = options.settings || {};
  const calls = [];
  const service = createClaudeAccounts({
    env: { USERPROFILE: home, HOME: home, APPDATA: path.join(home, "Roaming"), LOCALAPPDATA: path.join(home, "Local"), ...options.env },
    getSettings: () => settings,
    saveSettings: async patch => { settings = { ...settings, ...validate(patch) }; },
    fetchImpl: async (url, opts) => {
      calls.push(opts.headers.Authorization);
      assert.equal(url, "https://api.anthropic.com/api/oauth/usage");
      assert.equal(opts.method, "GET");
      assert.equal(opts.redirect, "error");
      return options.fetchImpl ? options.fetchImpl(url, opts) : reply(opts.headers.Authorization.includes("second") ? 65 : 25);
    },
    ...(options.now ? { now: options.now } : {}),
    ...(options.desktopFactory ? { desktopFactory: options.desktopFactory } : {}),
  });
  async function profile(folder, name, extra = {}) {
    const root = path.isAbsolute(folder) ? folder : path.join(home, folder);
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.join(root, ".credentials.json"), JSON.stringify({ claudeAiOauth: {
      accessToken: `synthetic-${name}`, expiresAt: Date.now() + 86400000, scopes: ["user:profile"], subscriptionType: "pro", ...extra,
    } }));
    await fs.writeFile(path.join(root, ".claude.json"), JSON.stringify({ oauthAccount: { accountUuid: name, emailAddress: `${name}@example.test` } }));
    return root;
  }
  return { home, service, profile, calls, settings: () => settings };
}
function reply(percent) { return { ok: true, status: 200, json: async () => ({ five_hour: { utilization: percent }, seven_day: { utilization: percent + 10 } }) }; }

test("discovers both Claude profiles, labels accounts, isolates quotas and never copies credentials", async t => {
  const f = await fixture(t);
  const roots = [await f.profile(".claude", "first"), await f.profile(".claude_second", "second")];
  const originals = await Promise.all(roots.map(root => fs.readFile(path.join(root, ".credentials.json"), "utf8")));
  const status = await f.service.status();
  assert.deepEqual(status.accounts.map(a => a.label), ["first@example.test", "second@example.test"]);
  assert.ok(status.accounts.every(a => !a.connected));
  await Promise.all(status.accounts.map(a => f.service.refresh({ accountId: a.id })));
  const connected = await f.service.refresh();
  assert.deepEqual(connected.accounts.map(a => a.metrics[0].used_percent), [25, 65]);
  assert.equal(f.calls.length, 2, "concurrent views reuse account caches");
  assert.equal(f.settings().claudeAccountIds.length, 2);
  assert.ok(!JSON.stringify(connected).includes("synthetic-"));
  assert.ok(!JSON.stringify(f.settings()).includes("synthetic-"));
  assert.deepEqual(await Promise.all(roots.map(root => fs.readFile(path.join(root, ".credentials.json"), "utf8"))), originals);
  await f.service.disconnect(status.accounts[0].id);
  const after = await f.service.status();
  assert.equal(after.accounts[0].connected, false);
  assert.equal(after.accounts[0].metrics, undefined);
  assert.equal(after.accounts[1].metrics[0].used_percent, 65);
});

test("deduplicates the same subscription across Code folders and desktop while migrating desktop consent", async t => {
  const f = await fixture(t, { settings: { claudeDesktopConnected: true } });
  await f.profile(".claude", "first");
  await f.profile(".claude_second", "first");
  const desktop = path.join(f.home, "Roaming/Claude");
  await fs.mkdir(desktop, { recursive: true });
  await fs.writeFile(path.join(desktop, "config.json"), JSON.stringify({ lastKnownAccountUuid: "first", "oauth:tokenCacheV2": "synthetic-cache" }));
  const status = await f.service.status();
  assert.equal(status.accounts.length, 1);
  assert.equal(status.accounts[0].profiles, 3);
  assert.equal(status.accounts[0].connected, true);
  await f.service.refresh();
  assert.equal(f.calls.length, 1);
  await f.service.disconnect(status.accounts[0].id);
  assert.deepEqual(f.settings().claudeAccountIds, []);
  assert.equal((await f.service.status()).accounts[0].connected, false);
});

test("rate limits and failures affect only one account, including forced refresh", async t => {
  let limited = false;
  const f = await fixture(t, { fetchImpl: async (_url, opts) => limited && opts.headers.Authorization.includes("first")
    ? { ok: false, status: 429, headers: { get: () => "600" } } : reply(20) });
  await f.profile(".claude", "first"); await f.profile(".claude_second", "second");
  const ids = (await f.service.status()).accounts.map(a => a.id);
  for (const id of ids) await f.service.refresh({ accountId: id });
  limited = true;
  let result = await f.service.refresh({ force: true });
  assert.match(result.accounts[0].error, /rate limiting/);
  assert.equal(result.accounts[1].error, null);
  const before = f.calls.length;
  result = await f.service.refresh({ force: true });
  assert.equal(f.calls.length, before + 1, "only the healthy account is requested during cooldown");
  assert.equal(result.accounts[1].metrics[0].used_percent, 20);
});

test("expired, malformed and rejected credentials expose no token and do not connect", async t => {
  const f = await fixture(t, { fetchImpl: async () => ({ ok: false, status: 401 }) });
  const root = await f.profile(".claude", "first", { expiresAt: 1 });
  const id = (await f.service.status()).accounts[0].id;
  await assert.rejects(f.service.refresh({ accountId: id }), /expired/);
  assert.equal(f.calls.length, 0);
  await f.profile(".claude", "first", { scopes: [] });
  await assert.rejects(f.service.refresh({ accountId: id }), /cannot read/);
  await f.profile(".claude", "first");
  await assert.rejects(f.service.refresh({ accountId: id }), /rejected/);
  await fs.writeFile(path.join(root, ".credentials.json"), '{"claudeAiOauth": "synthetic-secret-token');
  await assert.rejects(f.service.refresh({ accountId: id }), error => /could not be read/.test(error.message) && !error.message.includes("synthetic-secret"));
  assert.equal((await f.service.status()).accounts[0].connected, false);
});

test("disconnect wins over an in-flight connect and late quota results", async t => {
  let release, started;
  const entered = new Promise(resolve => { started = resolve; });
  const f = await fixture(t, { fetchImpl: async () => { started(); return new Promise(resolve => { release = () => resolve(reply(99)); }); } });
  await f.profile(".claude", "first");
  const id = (await f.service.status()).accounts[0].id;
  const pending = f.service.refresh({ accountId: id });
  await entered;
  await f.service.disconnect(id);
  release(); await assert.rejects(pending, /Connection changed/);
  const account = (await f.service.status()).accounts[0];
  assert.equal(account.connected, false);
  assert.equal(account.metrics, undefined);
  assert.deepEqual(f.settings().claudeAccountIds, []);
});

test("an unreadable profile does not prevent discovery or refresh of another subscription", async t => {
  const f = await fixture(t);
  const bad = await f.profile(".claude", "first");
  await f.profile(".claude_second", "second");
  await fs.writeFile(path.join(bad, ".credentials.json"), "null");
  await fs.writeFile(path.join(bad, ".claude.json"), "null");
  const accounts = (await f.service.status()).accounts;
  assert.equal(accounts.length, 2);
  await assert.rejects(f.service.refresh({ accountId: accounts[0].id }), /could not be read/);
  const result = await f.service.refresh({ accountId: accounts[1].id });
  assert.equal(result.accounts[1].metrics[0].used_percent, 65);
});

test("custom folders and environment overrides are supported and duplicate roots are merged", async t => {
  const f = await fixture(t);
  const custom = await f.profile("custom-profile", "custom");
  assert.equal((await f.service.status()).accounts.length, 0);
  await f.service.addDirectory(custom);
  await f.service.addDirectory(custom);
  assert.equal((await f.service.status()).accounts.length, 1);
  assert.deepEqual(f.settings().claudeProfileDirs, [custom]);
  const another = createClaudeAccounts({ env: { USERPROFILE: f.home, CLAUDE_CONFIG_DIR: custom }, getSettings: () => f.settings(), saveSettings: async () => {} });
  assert.equal((await another.status()).accounts.length, 1);
  await assert.rejects(f.service.addDirectory("relative-folder"), /absolute/);
  await assert.rejects(f.service.refresh({ accountId: "../secret" }), /Invalid/);
  await assert.rejects(f.service.refresh({ force: "true" }), /Invalid/);
  await assert.rejects(f.service.disconnect(), /Choose/);
  assert.throws(() => validate({ claudeAccountIds: ["other"] }), /Invalid/);
  assert.throws(() => validate({ claudeProfileDirs: ["relative"] }), /Invalid/);
});

test("desktop-only accounts preserve the existing reader and stay independently connected", async t => {
  const roots = [];
  const f = await fixture(t, { desktopFactory: ({ roots: selected }) => ({ refresh: async () => { roots.push(selected); return { metrics: [{ label: "Weekly usage", used_percent: 42 }], samples: [], checkedAt: new Date().toISOString() }; } }) });
  for (const [folder, uuid] of [["Roaming", "one"], ["Local", "two"]]) {
    const root = path.join(f.home, folder, "Claude");
    await fs.mkdir(root, { recursive: true });
    await fs.writeFile(path.join(root, "config.json"), JSON.stringify({ lastKnownAccountUuid: uuid, "oauth:tokenCacheV2": "synthetic" }));
  }
  const accounts = (await f.service.status()).accounts;
  assert.equal(accounts.length, 2);
  for (const account of accounts) await f.service.refresh({ accountId: account.id });
  assert.equal(roots.length, 2);
  assert.notDeepEqual(roots[0], roots[1]);
  assert.ok((await f.service.status()).accounts.every(a => a.connected));
});
