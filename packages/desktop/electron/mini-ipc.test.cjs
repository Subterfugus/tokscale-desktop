const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRequire } = require("node:module");
const security = require("./security.cjs");

// Exercise main's actual IPC registration without starting a native app.
function harness() {
  const handlers = new Map(), broadcasts = [], shown = [], engineRuns = [], engine = { stdout: "[]" };
  const target = url => ({
    isDestroyed: () => false,
    setTitleBarOverlay() {}, setBackgroundColor() {}, isMinimized: () => false, show() {}, focus() {},
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
      setSync(service) { sync = service; },
    };
  `, {
    require: name => {
      if (name === "electron") return electron;
      if (name === "node-pty") throw new Error("Not used in IPC tests");
      if (name === "./runner.cjs") return { runCommand: async (_engine, args) => { engineRuns.push(args); return { code: 0, stdout: engine.stdout }; } };
      return localRequire(name);
    },
    module, __dirname, process: { argv: [], env: {}, platform: "win32" }, console, setTimeout, clearTimeout,
  }, { filename: file });
  const api = module.exports;
  const mini = {
    window: widget, applyTheme() {},
    show: () => shown.push(true), hide: () => shown.push(false), isVisible: () => shown.at(-1) === true,
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
  return { api, main, widget, broadcasts, invoke, shown, engineRuns, engine };
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

test("closing the mini window hides it without touching its setting; only the setting turns it off and on", async () => {
  const { main, widget, invoke, shown } = harness();
  await invoke(widget, "miniControl", "close");
  assert.deepEqual(shown, [false]);
  assert.notEqual(invoke(main, "getSettings").miniEnabled, false);
  assert.throws(() => invoke(main, "miniControl", "toggle"), /Invalid mini window action/);
  await invoke(main, "saveSettings", { miniEnabled: false });
  assert.deepEqual(shown, [false, false]);
  await invoke(main, "saveSettings", { theme: "light" });
  assert.deepEqual(shown, [false, false]);
  await invoke(main, "saveSettings", { miniEnabled: true });
  assert.deepEqual(shown, [false, false, true]);
  assert.throws(() => invoke(widget, "saveSettings", { miniEnabled: false }), /Untrusted/);
});

test("opening the full app from the mini window shrinks it to the bubble", async () => {
  const { widget, invoke } = harness();
  assert.equal(invoke(widget, "getSettings").miniMicro, false);
  await invoke(widget, "miniControl", "main");
  assert.equal(invoke(widget, "getSettings").miniMicro, true);
});

test("simultaneous quota reports share one engine run, and later ones run again", async () => {
  const { main, invoke, engineRuns } = harness();
  const quota = () => engineRuns.filter(args => args.includes("usage")).length;
  const [one, two] = [invoke(main, "run", ["usage", "--json"]), invoke(main, "run", ["usage", "--json"])];
  assert.equal(one, two);
  await one;
  assert.equal(quota(), 1);
  await invoke(main, "run", ["usage", "--json"]);
  assert.equal(quota(), 2);
  await Promise.all([invoke(main, "run", ["models", "--json"]), invoke(main, "run", ["models", "--json"])]);
  assert.equal(engineRuns.length, 4);
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

test("reports gain synced usage for both windows, except where only this computer can answer", async () => {
  const { main, widget, invoke, api, engine } = harness();
  const report = (groupBy) => JSON.stringify({
    groupBy, entries: [{ client: "claude", model: "opus", provider: "anthropic", input: 10, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, messageCount: 1, cost: 1 }],
    totalInput: 10, totalOutput: 0, totalCacheRead: 0, totalCacheWrite: 0, totalMessages: 1, totalCost: 1,
  });
  const days = { "2026-10-01": [{ client: "codex", modelId: "gpt", providerId: "openai", tokens: { input: 5, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 }, cost: 2, messages: 3 }] };
  const asked = [];
  api.setSync({ extra: (selected) => { asked.push(selected); return selected === "other" ? { includeLocal: false, days } : { includeLocal: true, days: selected === "all" ? days : {} }; } });
  engine.stdout = report("client,model");
  const total = async (from, args, ...rest) => JSON.parse((await invoke(from, "run", args, ...rest)).stdout).totalCost;
  assert.equal(await total(main, ["models", "--json"]), 3);
  assert.equal(await total(widget, ["--no-spinner", "models", "--json"]), 3);
  assert.equal(await total(main, ["models", "--json"], "other"), 2);
  assert.equal(await total(main, ["models", "--json"], "self"), 1);
  assert.equal(await total(main, ["models", "--json", "--client", "claude"]), 1);
  assert.equal(await total(main, ["models", "--json", "--until", "2026-09-30"]), 1);
  // A custom report home is another folder's data and is never combined.
  assert.equal(await total(main, ["models", "--json", "--home", "D:\Other"]), 1);
  assert.deepEqual(asked, ["all", "all", "other", "self", "all", "all"]);
  engine.stdout = report("workspace,model");
  assert.equal(await total(main, ["models", "--json", "--group-by", "workspace,model"]), 1);
  assert.equal(await total(main, ["models", "--json", "--group-by", "workspace,model"], "other"), 0);
  await assert.rejects(invoke(main, "run", ["models", "--json"], 7), /Invalid computer/);
  // Unreadable engine output is passed on as it is.
  engine.stdout = "not json";
  assert.equal((await invoke(main, "run", ["models", "--json"])).stdout, "not json");
});
