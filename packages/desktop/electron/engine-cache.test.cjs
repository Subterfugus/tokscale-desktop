"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { engineConfigDir, resetPricingOnEngineChange } = require("./engine-cache.cjs");

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tokscale-engine-cache-"));
  const cache = path.join(root, "tokscale", "cache");
  await fs.mkdir(path.join(cache, "source-message-cache-v2"), { recursive: true });
  for (const name of ["pricing-litellm.json", "pricing-openrouter.json", "pricing-models-dev.json", "other.json"])
    await fs.writeFile(path.join(cache, name), "{}");
  return { root, cache, env: { APPDATA: root }, markerFile: path.join(root, "app", "engine-version") };
}
const list = async dir => (await fs.readdir(dir)).sort();

test("engine config dir follows TOKSCALE_CONFIG_DIR, then APPDATA", () => {
  assert.equal(engineConfigDir({ TOKSCALE_CONFIG_DIR: "C:/cfg", APPDATA: "C:/roaming" }), "C:/cfg");
  assert.equal(engineConfigDir({ APPDATA: "C:/roaming" }), path.join("C:/roaming", "tokscale"));
  assert.equal(engineConfigDir({}), "");
});

test("a new engine version clears only the saved price tables, once", async () => {
  const { root, cache, env, markerFile } = await fixture();
  try {
    const first = await resetPricingOnEngineChange({ env, version: "4.23.1", markerFile });
    assert.deepEqual(first.cleared.sort(), ["pricing-litellm.json", "pricing-models-dev.json", "pricing-openrouter.json"]);
    assert.deepEqual(await list(cache), ["other.json", "source-message-cache-v2"]);
    assert.equal(await fs.readFile(markerFile, "utf8"), "4.23.1");

    await fs.writeFile(path.join(cache, "pricing-litellm.json"), "{}");
    const again = await resetPricingOnEngineChange({ env, version: "4.23.1", markerFile });
    assert.deepEqual(again.cleared, []);
    assert.ok((await list(cache)).includes("pricing-litellm.json"));

    const upgraded = await resetPricingOnEngineChange({ env, version: "4.24.0", markerFile });
    assert.deepEqual(upgraded.cleared, ["pricing-litellm.json"]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("a missing engine cache folder still records the version", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "tokscale-engine-cache-"));
  try {
    const markerFile = path.join(root, "engine-version");
    const result = await resetPricingOnEngineChange({ env: { APPDATA: path.join(root, "none") }, version: "4.23.1", markerFile });
    assert.deepEqual(result.cleared, []);
    assert.equal(await fs.readFile(markerFile, "utf8"), "4.23.1");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
