const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const security = require("./security.cjs");

// Exercise main's actual IPC registration without starting a native app.
function harness() {
  const handlers = new Map(), broadcasts = [];
  const target = url => ({
    isDestroyed: () => false,
    setTitleBarOverlay() {}, setBackgroundColor() {},
    webContents: { mainFrame: { url }, send: (channel, value) => broadcasts.push({ url, channel, value }) },
  });
  const { pathToFileURL } = require("node:url");
  const main = target(pathToFileURL(path.join(__dirname, "../dist-renderer/index.html")).href);
  const widget = target(pathToFileURL(path.join(__dirname, "../dist-renderer/mini.html")).href);
  let saved = { miniMicro: false, theme: "dark", miniBounds: { x: 100, y: 100, width: 300, height: 230 } };
  const prefs = { save: async patch => (saved = { ...saved, ...security.settings(patch) }) };
  const file = path.join(__dirname, "main.cjs");
  const localRequire = createRequire(file);
  const module = { exports: {} };
  const electron = {
    app: { isPackaged: false, setName() {}, setAppUserModelId() {}, requestSingleInstanceLock: () => false, quit() {} },
    ipcMain: { handle: (channel, fn) => handlers.set(channel, fn) },
    nativeTheme: { shouldUseDarkColors: true },
  };
  vm.runInNewContext(fs.readFileSync(file, "utf8") + `
    module.exports = {
      setup(mainWindow, widget, store) { window = mainWindow; mini = widget; preferenceStore = store; },
      savePreferences, wireApi, limitSources,
      setClaude(requests) { claudeRequests = requests; },
    };
  `, {
    require: name => {
      if (name === "electron") return electron;
      if (name === "node-pty") throw new Error("Not used in IPC tests");
      if (name === "./runner.cjs") return { runCommand: async () => ({ code: 0, stdout: "[]" }) };
      return localRequire(name);
    },
    module, __dirname, process: { argv: [], env: {}, platform: "win32" }, console, setTimeout, clearTimeout,
  }, { filename: file });
  const api = module.exports;
  const mini = {
    window: widget, applyTheme() {},
    collapse: () => api.savePreferences({ miniMicro: true }),
    expand: () => api.savePreferences({ miniMicro: false }),
    moveBy(dx, dy) {
      if (!saved.miniMicro) throw new Error("Mini movement requires micro mode");
      return [dx, dy];
    },
  };
  api.setup(main, mini, prefs);
  // wireApi creates account readers, but does not access them until invoked.
  electron.app.getPath = () => __dirname;
  api.wireApi();
  const invoke = (from, name, ...args) => handlers.get("tokscale:" + name)({ sender: from.webContents, senderFrame: from.webContents.mainFrame }, ...args);
  return { api, main, widget, broadcasts, invoke };
}

test("micro IPC and main saves expose mode to both renderers while protecting owned settings", async () => {
  const { main, widget, broadcasts, invoke } = harness();
  assert.equal(invoke(widget, "getSettings").miniMicro, false);
  await invoke(widget, "miniControl", "micro");
  assert.equal(invoke(widget, "getSettings").miniMicro, true);
  assert.equal(broadcasts.filter(message => message.channel === "tokscale:settingsChanged" && message.value.miniMicro).length, 2);
  assert.deepEqual(invoke(widget, "miniMoveBy", 12, 8), [12, 8]);
  await invoke(main, "saveSettings", { miniMicro: false, miniMicroBounds: { x: 0, y: 0 }, miniBounds: { width: 64 }, theme: "light" });
  const settings = invoke(widget, "getSettings");
  assert.equal(settings.miniMicro, true);
  assert.equal(settings.miniMicroBounds, undefined);
  assert.equal(settings.miniBounds.width, 300);
  assert.equal(settings.theme, "light");
  assert.throws(() => invoke(widget, "saveSettings", { theme: "dark" }), /Untrusted/);
  await invoke(widget, "miniControl", "expand");
  assert.equal(invoke(widget, "getSettings").miniMicro, false);
  assert.throws(() => invoke(widget, "miniMoveBy", 1, 1), /micro mode/);
});

test("Claude desktop weekly samples are mapped to the monitor source id", async () => {
  const { api } = harness();
  await api.savePreferences({ claudeDesktopConnected: true });
  api.setClaude({ refresh: async () => ({
    metrics: [{ label: "Weekly usage", used_percent: 40, resets_at: "2026-10-08T08:00:00Z" }],
    samples: [{ timestamp: 1000, fiveHour: 90, sevenDay: 30 }],
  }) });
  const result = await api.limitSources();
  assert.equal(result.sources[0].id, "claude::weekly usage");
  assert.equal(result.samples[result.sources[0].id][0].p, 30);
  assert.equal(result.samples[result.sources[0].id][0].t, 1000);
});

test("preload exposes mini movement on the existing invoke channel", () => {
  let api;
  const calls = [];
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "preload.cjs"), "utf8"), { require: () => ({
    contextBridge: { exposeInMainWorld: (_name, value) => { api = value; } },
    ipcRenderer: { invoke: (...args) => { calls.push(args); } },
  }) });
  api.miniMoveBy(12, -8);
  assert.deepEqual(calls[0], ["tokscale:miniMoveBy", 12, -8]);
});
