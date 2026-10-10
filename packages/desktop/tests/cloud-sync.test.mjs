import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import worker from "../sync-worker/worker.js";
import { ENGINE, graphDays, install, sessionPart, settings, upload } from "../cloud-sync/tokscale-cloud-sync.mjs";

const require = createRequire(import.meta.url);
const { createD1, workerFetch } = require("./d1-shim.cjs");
const TOKEN = "synthetic-test-token-0123456789abcdef";
const ENV = {
  TOKSCALE_SYNC_URL: "https://sync.example.test/",
  TOKSCALE_SYNC_TOKEN: TOKEN,
  CLAUDE_CODE_REMOTE_SESSION_ID: "session_01AbCdEfGh",
};
const graph = (date, clients) => ({ contributions: [{ date, clients }] });
const usage = (client, input, cost) => ({
  client,
  modelId: "claude-opus-5-5",
  providerId: "anthropic",
  tokens: { input, output: 2, cacheRead: 3, cacheWrite: 4, reasoning: 0 },
  cost,
  messages: 3,
});

test("the script pins the same engine version the app bundles", () => {
  const pkg = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(ENGINE, "tokscale@" + pkg.dependencies["@tokscale/cli-win32-x64-msvc"]);
});

test("only Claude Code rows from the engine's graph are sent", () => {
  const days = graphDays({
    contributions: [
      { date: "2026-10-09", clients: [usage("claude", 10, 1), usage("codex", 99, 9)] },
      { date: "2026-10-10", clients: [usage("codex", 1, 1)] },
    ],
  });
  assert.deepEqual(Object.keys(days), ["2026-10-09"]);
  assert.deepEqual(days["2026-10-09"], [usage("claude", 10, 1)]);
});

test("settings need an https address, a real token and a session id", () => {
  assert.equal(settings(ENV).url, "https://sync.example.test");
  assert.equal(settings(ENV).session, "session_01AbCdEfGh");
  assert.throws(() => settings({ ...ENV, TOKSCALE_SYNC_URL: "http://sync.example.test" }), /https/);
  assert.throws(() => settings({ ...ENV, TOKSCALE_SYNC_TOKEN: "short" }), /TOKEN/);
  assert.throws(() => settings({ ...ENV, CLAUDE_CODE_REMOTE_SESSION_ID: "" }), /session/);
  assert.match(sessionPart("weird id/with:chars"), /^s-[0-9a-f]{40}$/);
});

test("each session's upload lands in the store and the app reads one combined computer", async () => {
  const DB = createD1();
  const { fetchImpl, calls } = workerFetch(worker, { DB, SYNC_TOKEN: TOKEN });
  await upload({ env: ENV, fetchImpl, readGraph: () => graph("2026-10-09", [usage("claude", 10, 1)]) });
  await upload({ env: ENV, fetchImpl, readGraph: () => graph("2026-10-09", [usage("claude", 15, 1.5)]) });
  await upload({
    env: { ...ENV, CLAUDE_CODE_REMOTE_SESSION_ID: "session_02ZyXwVuTs" },
    fetchImpl,
    readGraph: () => graph("2026-10-09", [usage("claude", 5, 0.5)]),
  });
  assert.deepEqual(calls, [
    "PUT /v1/devices/claude-cloud/sessions/session_01AbCdEfGh",
    "PUT /v1/devices/claude-cloud/sessions/session_01AbCdEfGh",
    "PUT /v1/devices/claude-cloud/sessions/session_02ZyXwVuTs",
  ]);
  const device = await (await fetchImpl("https://sync.example.test/v1/devices/claude-cloud", {
    headers: { Authorization: "Bearer " + TOKEN },
  })).json();
  assert.equal(device.name, "Claude cloud");
  assert.equal(device.days["2026-10-09"][0].tokens.input, 20);
  assert.equal(device.days["2026-10-09"][0].cost, 2);
});

test("an old store without session support gets a clear message", async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
  await assert.rejects(
    upload({ env: ENV, fetchImpl, readGraph: () => graph("2026-10-09", [usage("claude", 1, 0)]) }),
    /Redeploy/,
  );
  assert.deepEqual(await upload({ env: ENV, fetchImpl, readGraph: () => graph("2026-10-09", []) }), {
    skipped: "no usage yet",
  });
});

test("install adds the Stop hook once and keeps existing settings", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "tokscale-cloud-sync-"));
  try {
    fs.mkdirSync(path.join(home, ".claude"));
    const file = path.join(home, ".claude", "settings.json");
    fs.writeFileSync(file, JSON.stringify({ model: "x", hooks: { Stop: [{ hooks: [{ type: "command", command: "other" }] }] } }));
    assert.equal(install(home).added, true);
    assert.equal(install(home).added, false);
    const config = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(config.model, "x");
    assert.equal(config.hooks.Stop.length, 2);
    assert.match(config.hooks.Stop[1].hooks[0].command, /tokscale-cloud-sync\.mjs" hook$/);
    assert.ok(fs.existsSync(path.join(home, ".claude", "tokscale-cloud-sync.mjs")));
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});
