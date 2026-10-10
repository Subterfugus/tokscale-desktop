#!/usr/bin/env node
// Sends a Claude Code cloud session's usage to a Tokscale Desktop sync store.
//
// A cloud session runs on a short-lived machine, so its transcripts never reach
// the computer running Tokscale Desktop. This script runs on that machine: it
// totals the session's Claude Code usage with the same engine the app uses and
// uploads it as one part of a single "Claude cloud" computer in the sync store.
//
//   node tokscale-cloud-sync.mjs install   add a Stop hook that uploads after every turn
//   node tokscale-cloud-sync.mjs           upload now
//
// Settings come from the environment:
//   TOKSCALE_SYNC_URL       the sync store address, as entered in the app
//   TOKSCALE_SYNC_TOKEN     the sync store access token
//   TOKSCALE_SYNC_TIMEZONE  optional IANA zone for day boundaries, e.g. America/Chicago
//
// It makes no model requests and uses none of the account's Claude usage.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Keep in step with the engine Tokscale Desktop bundles (package.json).
export const ENGINE = "tokscale@4.17.0";
export const DEVICE_ID = "claude-cloud";
export const DEVICE_NAME = "Claude cloud";
const TOKEN_FIELDS = ["input", "output", "cacheRead", "cacheWrite", "reasoning"];
const SCRIPT = fileURLToPath(import.meta.url);

const log = (message) => process.stderr.write(`tokscale-cloud-sync: ${message}\n`);

// The engine's graph as the store's `days`: only Claude Code rows, keyed by date.
export function graphDays(graph) {
  const days = {};
  for (const day of graph?.contributions || []) {
    const rows = (day.clients || [])
      .filter((row) => row?.client === "claude" && row.modelId)
      .map((row) => ({
        client: row.client,
        modelId: row.modelId,
        providerId: row.providerId || "unknown",
        tokens: Object.fromEntries(TOKEN_FIELDS.map((field) => [field, Number(row.tokens?.[field]) || 0])),
        cost: Number(row.cost) || 0,
        messages: Number(row.messages) || 0,
      }));
    if (rows.length) days[day.date] = rows;
  }
  return days;
}

// The store accepts letters, digits, - and _; anything else is hashed so a
// session always maps to the same part.
export function sessionPart(id) {
  if (/^[A-Za-z0-9_-]{8,100}$/.test(id || "")) return id;
  return "s-" + createHash("sha256").update(String(id)).digest("hex").slice(0, 40);
}

export function settings(env = process.env) {
  const url = String(env.TOKSCALE_SYNC_URL || "").trim().replace(/\/+$/, "");
  const token = String(env.TOKSCALE_SYNC_TOKEN || "").trim();
  if (!/^https:\/\/[^\s/?#]+(\/[^\s?#]*)?$/.test(url)) throw new Error("Set TOKSCALE_SYNC_URL to the sync store's https:// address.");
  if (token.length < 32) throw new Error("Set TOKSCALE_SYNC_TOKEN to the sync store's access token.");
  const session = env.CLAUDE_CODE_REMOTE_SESSION_ID || env.CLAUDE_CODE_SESSION_ID || "";
  if (!session) throw new Error("No Claude Code session id in the environment.");
  return { url, token, session: sessionPart(session), timezone: String(env.TOKSCALE_SYNC_TIMEZONE || "").trim() };
}

// Runs the engine with its own settings folder, so a pinned timezone applies
// and nothing is written into the session's own config. `.claude` points at the
// real one so the engine reads this machine's transcripts.
function runEngine(options, home = os.homedir()) {
  const state = path.join(home, ".cache", "tokscale-cloud-sync");
  const engineHome = path.join(state, "home");
  fs.mkdirSync(engineHome, { recursive: true });
  const link = path.join(engineHome, ".claude");
  const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(home, ".claude");
  if (!fs.existsSync(link)) fs.symlinkSync(claudeDir, link);
  const env = {
    ...process.env,
    HOME: engineHome,
    CLAUDE_CONFIG_DIR: link,
    npm_config_cache: process.env.npm_config_cache || path.join(home, ".npm"),
    npm_config_update_notifier: "false",
  };
  const npx = (args) => spawnSync("npx", ["-y", ENGINE, ...args], { cwd: state, env, encoding: "utf8", timeout: 240000 });
  const marker = path.join(state, "timezone");
  if (options.timezone && !fs.existsSync(marker)) {
    // The engine fixes the day boundary on first use, so the zone must be set before any report.
    const result = npx(["config", "set", "timezone", options.timezone]);
    if (result.status !== 0) throw new Error(`Could not set the timezone: ${(result.stderr || "").split("\n")[0]}`);
    fs.writeFileSync(marker, options.timezone);
  }
  const output = path.join(state, "graph.json");
  fs.rmSync(output, { force: true });
  const result = npx(["graph", "--client", "claude", "--no-spinner", "--output", output]);
  if (result.status !== 0 || !fs.existsSync(output))
    throw new Error(`The engine failed: ${(result.stderr || result.stdout || "").trim().split("\n").at(-1)}`);
  return { graph: JSON.parse(fs.readFileSync(output, "utf8")), state };
}

export async function upload({ env = process.env, fetchImpl = fetch, readGraph } = {}) {
  const options = settings(env);
  const { graph, state } = readGraph ? { graph: readGraph(options), state: null } : runEngine(options);
  const days = graphDays(graph);
  if (!Object.keys(days).length) return { skipped: "no usage yet" };
  const body = JSON.stringify({ name: DEVICE_NAME, days });
  const hash = createHash("sha256").update(options.url + "\n" + options.session + "\n" + body).digest("hex");
  const sent = state && path.join(state, "sent");
  if (sent && fs.existsSync(sent) && fs.readFileSync(sent, "utf8") === hash) return { skipped: "unchanged" };
  const response = await fetchImpl(`${options.url}/v1/devices/${DEVICE_ID}/sessions/${options.session}`, {
    method: "PUT",
    headers: { Authorization: "Bearer " + options.token, "Content-Type": "application/json" },
    body,
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  if (response.status === 404 || response.status === 405)
    throw new Error("The sync store does not accept cloud sessions yet. Redeploy it from packages/desktop/sync-worker.");
  if (!response.ok) {
    let detail = "";
    try {
      detail = (await response.json()).error || "";
    } catch {}
    throw new Error(`The sync store answered ${response.status}${detail ? `: ${detail}` : ""}`);
  }
  if (sent) fs.writeFileSync(sent, hash);
  return { uploaded: Object.keys(days).length };
}

// Adds the Stop hook to the user's Claude Code settings, once.
export function install(home = os.homedir()) {
  const dir = path.join(home, ".claude");
  const target = path.join(dir, "tokscale-cloud-sync.mjs");
  fs.mkdirSync(dir, { recursive: true });
  if (path.resolve(SCRIPT) !== path.resolve(target)) fs.copyFileSync(SCRIPT, target);
  const file = path.join(dir, "settings.json");
  let config = {};
  if (fs.existsSync(file)) config = JSON.parse(fs.readFileSync(file, "utf8"));
  const command = `node "${target}" hook`;
  config.hooks ||= {};
  config.hooks.Stop ||= [];
  const present = config.hooks.Stop.some((entry) =>
    (entry?.hooks || []).some((hook) => String(hook?.command || "").includes("tokscale-cloud-sync.mjs")),
  );
  if (!present) config.hooks.Stop.push({ hooks: [{ type: "command", command }] });
  fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
  return { file, added: !present };
}

// Turns can end close together; one upload runs at a time and the next waits,
// so the last one always sees the newest transcript.
async function locked(task, home = os.homedir()) {
  const state = path.join(home, ".cache", "tokscale-cloud-sync");
  fs.mkdirSync(state, { recursive: true });
  const lock = path.join(state, "lock");
  for (let waited = 0; ; waited += 1000) {
    try {
      fs.mkdirSync(lock);
      break;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const age = Date.now() - fs.statSync(lock, { throwIfNoEntry: false })?.mtimeMs;
      if (age > 300000 || waited > 300000) fs.rmSync(lock, { recursive: true, force: true });
      else await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  try {
    return await task();
  } finally {
    fs.rmSync(lock, { recursive: true, force: true });
  }
}

async function main(mode) {
  if (mode === "install") {
    const { file, added } = install();
    log(added ? `added the upload hook to ${file}` : `the upload hook is already in ${file}`);
    return;
  }
  if (mode === "hook") {
    // Hands the upload to a detached process so the session never waits on it.
    process.stdin.resume();
    process.stdin.on("error", () => {});
    const child = spawn(process.execPath, [SCRIPT], { detached: true, stdio: "ignore" });
    child.unref();
    process.exit(0);
  }
  const result = await locked(() => upload());
  log(result.skipped ? `nothing sent (${result.skipped})` : `sent ${result.uploaded} day(s) of usage`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(SCRIPT))
  main(process.argv[2]).catch((error) => {
    log(error.message);
    process.exitCode = 1;
  });
