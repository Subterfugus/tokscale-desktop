const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const crypto = require("node:crypto");
const { createOpenRouter, apiKey, credits } = require("./accounts.cjs");
const {
  createClaudeDesktop,
  decryptCache,
  selectToken,
  history,
  usage,
} = require("./claude-desktop.cjs");
function encrypt(value, key) {
  const nonce = crypto.randomBytes(12),
    cipher = crypto.createCipheriv("aes-256-gcm", key, nonce);
  return Buffer.concat([
    Buffer.from("v10"),
    nonce,
    cipher.update(value, "utf8"),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
}
const fakeKey = "sk-or-v1-FAKE_SYNTHETIC_TEST_KEY_ONLY";
async function routerFixture(t, fetchImpl) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tokscale-router-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const key = crypto.randomBytes(32),
    file = path.join(dir, "connection.json");
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => encrypt(value, key),
    decryptString: (value) => {
      const d = crypto.createDecipheriv(
        "aes-256-gcm",
        key,
        value.subarray(3, 15),
      );
      d.setAuthTag(value.subarray(-16));
      return Buffer.concat([
        d.update(value.subarray(15, -16)),
        d.final(),
      ]).toString();
    },
  };
  return {
    file,
    service: createOpenRouter({ file, safeStorage, fetchImpl }),
    safeStorage,
  };
}
test("OpenRouter validates balances, uses only read-only fixed origin, and stores encrypted credentials", async (t) => {
  const fixture = await routerFixture(t, async (url, options) => {
    assert.equal(url, "https://openrouter.ai/api/v1/credits");
    assert.equal(options.method, "GET");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.Authorization, "Bearer " + fakeKey);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        data: { total_credits: 100.5, total_usage: 25.75 },
      }),
    };
  });
  assert.deepEqual(await fixture.service.status(), { connected: false });
  const connected = await fixture.service.connect(fakeKey);
  assert.equal(connected.remaining, 74.75);
  assert.equal(JSON.stringify(connected).includes(fakeKey), false);
  assert.equal(
    (await fs.readFile(fixture.file, "utf8")).includes(fakeKey),
    false,
  );
  assert.equal((await fixture.service.refresh()).spent, 25.75);
  await fixture.service.disconnect();
  assert.deepEqual(await fixture.service.status(), { connected: false });
});
test("OpenRouter rejects ordinary keys and failed saves without replacing existing connection", async (t) => {
  let accepted = true;
  const fixture = await routerFixture(t, async () =>
    accepted
      ? {
          ok: true,
          status: 200,
          json: async () => ({ data: { total_credits: 20, total_usage: 1 } }),
        }
      : { ok: false, status: 403 },
  );
  await fixture.service.connect(fakeKey);
  const saved = await fs.readFile(fixture.file, "utf8");
  accepted = false;
  await assert.rejects(fixture.service.connect(fakeKey), /management key/);
  assert.equal(await fs.readFile(fixture.file, "utf8"), saved);
  assert.throws(() => apiKey("secret\nheader"), /valid/);
  assert.throws(
    () => credits({ total_credits: 20, total_usage: "1" }),
    /unreadable/,
  );
  fixture.safeStorage.isEncryptionAvailable = () => false;
  await assert.rejects(fixture.service.connect(fakeKey), /not saved/);
});
test("A concurrent disconnect cannot leave a newly saved OpenRouter credential behind", async (t) => {
  const fixture = await routerFixture(t, async () => ({
    ok: true,
    status: 200,
    json: async () => ({ data: { total_credits: 20, total_usage: 1 } }),
  }));
  await Promise.all([
    fixture.service.connect(fakeKey),
    fixture.service.disconnect(),
  ]);
  assert.deepEqual(await fixture.service.status(), { connected: false });
});
test("Claude desktop authenticated cache checks AES integrity, account, scope and expiration", () => {
  const key = crypto.randomBytes(32),
    now = Date.now(),
    cache = {
      "acct:other|profile:user:profile": {
        token: "wrong-account",
        expiresAt: now + 99999,
      },
      "acct:mine|profile:user:profile:expired": {
        token: "expired",
        expiresAt: now - 1,
      },
      "acct:mine|profile:other": {
        token: "wrong-scope",
        expiresAt: now + 99999,
      },
      "acct:mine|profile:user:profile": {
        token: "synthetic-token",
        expiresAt: now + 50000,
      },
    };
  const blob = encrypt(JSON.stringify(cache), key);
  assert.equal(
    selectToken(decryptCache(blob.toString("base64"), key), "mine", now),
    "synthetic-token",
  );
  blob[20] ^= 1;
  assert.throws(() => decryptCache(blob.toString("base64"), key));
  assert.throws(() => selectToken(cache, "missing", now), /expired/);
});
test("Claude desktop reads its login in memory, fetches usage and preserves original app files", async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "tokscale-claude-test-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const root = path.join(dir, "Claude");
  await fs.mkdir(root);
  const key = crypto.randomBytes(32),
    config = {
      lastKnownAccountUuid: "mine",
      "oauth:tokenCacheV2": encrypt(
        JSON.stringify({
          "acct:mine|client:org:user:profile": {
            token: "synthetic-token",
            expiresAt: Date.now() + 60000,
          },
        }),
        key,
      ).toString("base64"),
    };
  await fs.writeFile(path.join(root, "config.json"), JSON.stringify(config));
  await fs.writeFile(
    path.join(root, "Local State"),
    JSON.stringify({
      os_crypt: {
        encrypted_key: Buffer.from("DPAPIencrypted-test-key").toString(
          "base64",
        ),
      },
    }),
  );
  await fs.writeFile(
    path.join(root, "plan-usage-history.json"),
    JSON.stringify({
      samples: [
        { t: 1791085204138, org: "organization", u: { fh: 20, sd: 40 } },
      ],
    }),
  );
  const before = await fs.readFile(path.join(root, "config.json"), "utf8");
  const service = createClaudeDesktop({
    env: { APPDATA: dir, LOCALAPPDATA: dir },
    unlock: async () => Buffer.from(key),
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://api.anthropic.com/api/oauth/usage");
      assert.equal(options.headers.Authorization, "Bearer synthetic-token");
      return {
        ok: true,
        status: 200,
        json: async () => ({
          five_hour: { utilization: 25, resets_at: null },
          seven_day: { utilization: 40, resets_at: "2026-10-07T12:00:00Z" },
        }),
      };
    },
  });
  const result = await service.refresh();
  assert.equal(result.metrics[0].used_percent, 25);
  assert.equal(result.samples.length, 1);
  assert.equal(JSON.stringify(result).includes("synthetic-token"), false);
  assert.equal(
    await fs.readFile(path.join(root, "config.json"), "utf8"),
    before,
  );
});
test("Claude usage history keeps unknown windows unknown, supports extra spend and filters organizations", () => {
  assert.deepEqual(
    history(
      {
        samples: [
          { t: 2, org: "other", u: { fh: 90 } },
          { t: 1, org: "mine", u: { sd: 25 } },
        ],
      },
      "mine",
    ),
    [{ timestamp: 1, fiveHour: null, sevenDay: 25 }],
  );
  const result = usage({
    five_hour: null,
    extra_usage: { used_credits: 4132, monthly_limit: 100000 },
  });
  assert.equal(result.metrics.length, 0);
  assert.deepEqual(result.spend, { spent: 41.32, limit: 1000 });
  assert.throws(() => usage({ five_hour: null }), /no quota/);
});
