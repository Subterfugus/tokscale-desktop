"use strict";
const fs = require("node:fs/promises");
const path = require("node:path");

// The engine keeps downloaded price tables for an hour and reloads them through
// its own model of a price row. An older engine drops rates it does not know
// (4.17.0 dropped the 1-hour cache-write rate), so a newer engine reading that
// copy prices with the missing rates until the hour runs out. Clearing the
// tables once per bundled engine version makes the first run fetch them again.
function engineConfigDir(env) {
  if (env.TOKSCALE_CONFIG_DIR) return env.TOKSCALE_CONFIG_DIR;
  const base = env.APPDATA || (env.USERPROFILE || env.HOME ? path.join(env.USERPROFILE || env.HOME, "AppData", "Roaming") : "");
  return base ? path.join(base, "tokscale") : "";
}

async function resetPricingOnEngineChange({ env, version, markerFile }) {
  let previous = "";
  try { previous = (await fs.readFile(markerFile, "utf8")).trim(); } catch {}
  if (previous === version) return { cleared: [] };
  const cleared = [];
  const configDir = engineConfigDir(env);
  if (configDir) {
    const cacheDir = path.join(configDir, "cache");
    let names = [];
    try { names = await fs.readdir(cacheDir); } catch {}
    for (const name of names) {
      if (!/^pricing-[\w-]+\.json$/.test(name)) continue;
      try { await fs.rm(path.join(cacheDir, name), { force: true }); cleared.push(name); } catch {}
    }
  }
  await fs.mkdir(path.dirname(markerFile), { recursive: true });
  await fs.writeFile(markerFile, version);
  return { cleared };
}

module.exports = { engineConfigDir, resetPricingOnEngineChange };
