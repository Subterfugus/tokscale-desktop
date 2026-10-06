const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  Menu,
  Tray,
  nativeImage,
  safeStorage,
  nativeTheme,
  screen,
  Notification,
} = require("electron");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const { pathToFileURL } = require("node:url");
const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const security = require("./security.cjs");
const { runCommand } = require("./runner.cjs");
const { createOpenRouter } = require("./accounts.cjs");
const { createClaudeDesktop } = require("./claude-desktop.cjs");
const { createProviderCache } = require("./provider-cache.cjs");
const { getSessionTitles } = require("./session-titles.cjs");
const { createPreferences } = require("./preferences.cjs");
const { resolveTheme } = require("./themes.cjs");
const { createMini, shouldOpenOnStartup } = require("./mini-window.cjs");
const { createAppWatcher } = require("./ai-app-watcher.cjs");
const { createLimitMonitor, formatStatus, tooltip } = require("./limit-monitor.cjs");
const { createUpstreamMonitor, validateState: validateUpstreamState } = require("./upstream-monitor.cjs");
const { createAppUpdate, validateState: validateAppUpdateState } = require("./app-update.cjs");
const { downloadUpdate, replacedFile } = require("./app-install.cjs");
const pkg = require("../package.json");
const enginePath = app.isPackaged
  ? path.join(process.resourcesPath, "engine", "tokscale.exe")
  : path.join(
      __dirname,
      "../node_modules/@tokscale/cli-win32-x64-msvc/bin/tokscale.exe",
    );
const indexPath = path.join(__dirname, "../dist-renderer/index.html");
const indexUrl = pathToFileURL(indexPath).href;
const iconPath = app.isPackaged
  ? path.join(process.resourcesPath, "icon.png")
  : path.join(__dirname, "../assets/icon.png");
const terminals = new Map(),
  runs = new Set();
const upstreamNotices = new Set();
let window,
  tray,
  mini,
  monitor,
  upstreamMonitor,
  appUpdate,
  appWatcher,
  claudeRequests,
  claudeDisconnecting = false,
  quitting = false,
  settingsWarning = "";
const miniPath = path.join(__dirname, "../dist-renderer/mini.html");
const miniUrl = pathToFileURL(miniPath).href;
// The mini window only reads today's totals and limits.
const MINI_API = new Set([
  "getSettings",
  "run",
  "connectionStatus",
  "limitSnapshot",
  "appUpdateStatus",
  "miniControl",
  "miniMoveBy",
]);
// Started by the login item: stay in the tray until opened.
const startHidden = process.argv.includes("--hidden");
let preferences = {
  theme: "dark",
  refreshInterval: 120000,
  home: "",
  defaultPeriod: "month",
  includeGeminiThoughts: true,
  upstreamNotifications: true,
  appUpdateChecks: true,
  miniLaunchOnStartup: true,
  miniOnAiApps: true,
  miniMicro: false,
};
let pty;
try {
  // ConPTY starts a worker by filename, so it must resolve outside app.asar.
  const ptyModule = app.isPackaged
    ? path.join(
        process.resourcesPath,
        "app.asar.unpacked/node_modules/node-pty",
      )
    : "node-pty";
  pty = require(ptyModule);
} catch {
  /* Native terminal remains available if PTY cannot load. */
}
const settingsPath = () =>
  path.join(app.getPath("userData"), "desktop-settings.json");
let preferenceStore;
function savePreferences(patch) {
  return preferenceStore.save(patch).then(values => {
    const homeChanged = preferences.home !== values.home;
    const claudeChanged = Boolean(preferences.claudeDesktopConnected) !== Boolean(values.claudeDesktopConnected);
    const upstreamChanged = (preferences.upstreamNotifications !== false) !== (values.upstreamNotifications !== false);
    const updatesChanged = (preferences.appUpdateChecks !== false) !== (values.appUpdateChecks !== false);
    const miniChanged = (preferences.miniEnabled !== false) !== (values.miniEnabled !== false);
    const appsChanged = (preferences.miniOnAiApps !== false) !== (values.miniOnAiApps !== false);
    preferences=values; settingsWarning='';
    if (upstreamMonitor && !smoke && upstreamChanged) {
      if (values.upstreamNotifications !== false) upstreamMonitor.start();
      else upstreamMonitor.stop();
    }
    if (appUpdate && !smoke && updatesChanged) {
      if (values.appUpdateChecks !== false) appUpdate.start();
      else appUpdate.stop();
    }
    // Turning the mini window on shows it now; turning it off puts it away.
    if (mini && miniChanged) values.miniEnabled !== false ? mini.show() : mini.hide();
    if (appWatcher && !smoke && appsChanged) {
      if (values.miniOnAiApps !== false) appWatcher.start();
      else appWatcher.stop();
    }
    if (homeChanged) monitor?.invalidate();
    else if (claudeChanged) monitor?.invalidate(source => !/claude|anthropic/i.test(source.provider));
    // The save itself succeeded; a failing side effect must not report otherwise.
    for (const effect of [applyTheme, applyLoginItem, () => mini?.applyTheme(), () => mini?.applyOpacity?.(), refreshTray])
      try { effect(); } catch (error) { console.error(error.message); }
    for (const target of [window, mini?.window])
      if (target && !target.isDestroyed()) target.webContents.send("tokscale:settingsChanged", values);
    return values;
  });
}
// A portable build runs from a temporary folder; the login item must point at
// the executable the user actually launched. The registry is only touched
// when the setting is on or has just been turned off.
let loginItem = false;
function applyLoginItem() {
  const wanted = Boolean(preferences.launchAtLogin);
  if (!app.isPackaged || smoke || wanted === loginItem) return;
  loginItem = wanted;
  app.setLoginItemSettings({
    openAtLogin: wanted,
    path: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath,
    args: ["--hidden"],
  });
}
const miniTheme = () => resolveTheme(
  !preferences.miniTheme || preferences.miniTheme === "match" ? preferences.theme : preferences.miniTheme,
  nativeTheme.shouldUseDarkColors,
);
function showMain() {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}
// The setting says whether the mini window may appear at all. Closing it only
// puts it away until startup or an AI app brings it back, and never changes
// the setting.
const miniEnabled = () => preferences.miniEnabled !== false;
function setMiniVisible(visible) {
  if (!mini) return;
  visible && miniEnabled() ? mini.show() : mini.hide();
}
function refreshTray() {
  if (!tray) return;
  const status = monitor?.snapshot();
  const lines = [...(status?.lines || [])];
  if (status?.error) lines.push("Limits check: " + status.error);
  tray.setToolTip(tooltip(lines, "Tokscale Desktop"));
  const menuLines = status ? formatStatus(status.sources, true) : [];
  if (status?.error) menuLines.push("Limits check: " + status.error);
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open Tokscale", click: showMain },
      {
        label: "Mini window",
        type: "checkbox",
        checked: miniEnabled(),
        click: (item) => void savePreferences({ miniEnabled: item.checked }).catch(() => {}),
      },
      { type: "separator" },
      ...(menuLines.length
        ? menuLines.map((label) => ({ label, enabled: false }))
        : [{ label: "No usage limits to show", enabled: false }]),
      { type: "separator" },
      { label: "Quit", click: () => { quitting = true; app.quit(); } },
    ]),
  );
}
// Limits come from the connected Claude desktop account and from the engine's
// own quota report; the desktop reading wins when both describe Claude.
async function limitSources() {
  const sources = [];
  // Several accounts can share a provider; the account keeps their ids apart.
  const add = (provider, metrics, account = "") => {
    for (const metric of Array.isArray(metrics) ? metrics : [])
      sources.push({
        id: `${provider}:${account}:${metric.label}`.toLowerCase(),
        provider,
        label: metric.label,
        usedPercent: metric.used_percent,
        resetsAt: metric.resets_at || null,
      });
  };
  const failures = [];
  let desktopClaude = false;
  if (preferences.claudeDesktopConnected && !claudeDisconnecting)
    await claudeRequests.refresh({}).then((result) => {
      add("Claude", result.metrics);
      desktopClaude = sources.some(source => source.provider === "Claude" && Number.isFinite(source.usedPercent));
    }, (error) => failures.push(error));
  await run(["usage", "--json"]).then((result) => {
    if (result.code !== 0) throw new Error(result.stderr || "Quota report failed");
    const rows = JSON.parse(result.stdout);
    for (const row of Array.isArray(rows) ? rows : []) {
      // Copilot is hidden in the app; the Limits page skips it too.
      if (typeof row?.provider !== "string" || /^copilot$/i.test(row.provider)) continue;
      if (desktopClaude && /claude|anthropic/i.test(row.provider)) continue;
      add(row.provider.replace(/^\w/, (c) => c.toUpperCase()), row.metrics, row.account?.label || row.email || "");
    }
  }).catch((error) => failures.push(error));
  if (!sources.length && failures.length) throw failures[0];
  return { sources, error: failures.length ? "Some usage limits could not be refreshed" : null };
}
// Native window buttons, menus and form popups follow the app's appearance.
const chrome = () => {
  const { colors } = resolveTheme(preferences.theme, nativeTheme.shouldUseDarkColors);
  return { color: colors.page, symbolColor: colors.text2, height: 40 };
};
function applyTheme() {
  nativeTheme.themeSource = preferences.theme === "system" ? "system" : resolveTheme(preferences.theme, true).scheme;
  if (!window || window.isDestroyed()) return;
  window.setTitleBarOverlay(chrome());
  window.setBackgroundColor(chrome().color);
}
const smoke = process.argv.includes("--desktop-smoke");
const switchValue = (name) =>
  process.argv
    .find((arg) => arg.startsWith(name + "="))
    ?.slice(name.length + 1);
// One-click updates swap the portable file the user launched for a newer one
// in the same folder. Other builds only link to the release page.
const portableFile = app.isPackaged ? process.env.PORTABLE_EXECUTABLE_FILE || "" : "";
let install = { phase: "idle", percent: 0, error: null };
function updateStatus() {
  const status = appUpdate?.snapshot();
  return status ? { ...status, installable: Boolean(status.asset && portableFile && !smoke), install } : null;
}
function publishUpdate() {
  const status = updateStatus();
  for (const target of [window, mini?.window])
    if (status && target && !target.isDestroyed()) target.webContents.send("tokscale:appUpdateStatus", status);
}
async function installUpdate() {
  const status = updateStatus();
  if (!status?.available || ["downloading", "restarting"].includes(install.phase)) return status;
  if (!status.installable || install.phase === "error") {
    await shell.openExternal(security.externalUrl(status.url));
    return status;
  }
  install = { phase: "downloading", percent: 0, error: null };
  publishUpdate();
  try {
    const file = await downloadUpdate({
      version: status.available, ...status.asset, dir: path.dirname(portableFile),
      onProgress: (part) => {
        const percent = Math.floor(part * 100);
        if (percent !== install.percent) { install = { ...install, percent }; publishUpdate(); }
      },
    });
    install = { phase: "restarting", percent: 100, error: null };
    publishUpdate();
    // The new build starts as its own portable app and retires this file.
    const env = { ...process.env };
    for (const key of Object.keys(env)) if (/^PORTABLE_EXECUTABLE_/i.test(key)) delete env[key];
    app.releaseSingleInstanceLock();
    // Updating from the mini window or the tray keeps the main window out of the way.
    const hidden = window && !window.isDestroyed() && window.isVisible() ? [] : ["--hidden"];
    spawn(file, ["--replaces=" + portableFile, ...hidden], { detached: true, stdio: "ignore", env }).unref();
    app.quit();
  } catch (error) {
    install = { phase: "error", percent: 0, error: String(error?.message || error).slice(0, 200) };
    publishUpdate();
  }
  return updateStatus();
}
// After an update the previous build goes to the Recycle Bin once it has exited.
function retireReplacedBuild() {
  const old = replacedFile(switchValue("--replaces"), portableFile);
  if (!old) return;
  let tries = 0;
  const attempt = () => shell.trashItem(old).catch(() => {
    if (++tries < 20) setTimeout(attempt, 3000).unref();
  });
  setTimeout(attempt, 3000).unref();
}
// A build started by an update may arrive before the old one has let go.
function singleInstance() {
  if (app.requestSingleInstanceLock()) return true;
  if (!switchValue("--replaces")) return false;
  const pause = new Int32Array(new SharedArrayBuffer(4));
  for (let i = 0; i < 40; i++) {
    Atomics.wait(pause, 0, 0, 500);
    if (app.requestSingleInstanceLock()) return true;
  }
  return false;
}
function engineEnv() {
  const isolated = smoke && switchValue("--smoke-home");
  const env = isolated
    ? Object.fromEntries(
        Object.entries(process.env).filter(([key]) =>
          /^(PATH|SYSTEMROOT|WINDIR|COMSPEC|PATHEXT|TEMP|TMP|SYSTEMDRIVE|PROCESSOR_ARCHITECTURE|NUMBER_OF_PROCESSORS)$/i.test(
            key,
          ),
        ),
      )
    : { ...process.env };
  if (smoke && switchValue("--smoke-home")) {
    const fixture = switchValue("--smoke-home");
    env.HOME = fixture;
    env.USERPROFILE = fixture;
    env.APPDATA = path.join(fixture, "AppData/Roaming");
    env.LOCALAPPDATA = path.join(fixture, "AppData/Local");
    env.TOKSCALE_CONFIG_DIR = path.join(fixture, ".config/tokscale");
    env.TOKSCALE_CACHE_DIR = path.join(fixture, ".cache/tokscale");
  }
  return env;
}
function commandArgs(input, noninteractive = true) {
  const argv = security.args(input);
  const result = noninteractive
    ? ["--no-spinner", ...argv.filter((arg) => arg !== "--no-spinner")]
    : argv;
  return result;
}
// The limit monitor, the Limits page and the mini window can all ask for the
// quota report in the same moment, most often right after startup. Two engines
// refreshing the same sign-ins at once can leave one with stale or failed
// providers, so identical requests share a single run.
let usageRun = null;
function run(input) {
  const usage = Array.isArray(input) && input.length === 2 && input[0] === "usage" && input[1] === "--json";
  if (usage && usageRun) return usageRun;
  const task = runCommand(enginePath, commandArgs(input), {
    env: engineEnv(),
    register: (child) => runs.add(child),
    unregister: (child) => runs.delete(child),
  });
  if (usage) {
    usageRun = task;
    const clear = () => { if (usageRun === task) usageRun = null; };
    task.then(clear, clear);
  }
  return task;
}
function send(channel, payload) {
  if (window && !window.isDestroyed() && !window.webContents.isDestroyed())
    window.webContents.send("tokscale:" + channel, payload);
}
function stopAll() {
  for (const child of runs) { try { child.kill(); } catch {} }
  for (const terminal of terminals.values()) { try { terminal.kill(); } catch {} }
  terminals.clear();
}
function handle(name, callback) {
  ipcMain.handle("tokscale:" + name, (event, ...input) => {
    const from = (target, url) =>
      target &&
      !target.isDestroyed() &&
      event.sender === target.webContents &&
      event.senderFrame === target.webContents.mainFrame &&
      event.senderFrame.url === url;
    if (!from(window, indexUrl) && !(MINI_API.has(name) && from(mini?.window, miniUrl)))
      throw new Error("Untrusted caller");
    return callback(...input);
  });
}
function terminal(id) {
  if (typeof id !== "string" || !terminals.has(id))
    throw new Error("Unknown terminal");
  return terminals.get(id);
}
function wireApi() {
  handle("miniWatchStatus", () => appWatcher?.snapshot() || null);
  handle("upstreamStatus", () => upstreamMonitor?.snapshot() || null);
  handle("upstreamCheck", () => upstreamMonitor.poll());
  handle("appUpdateStatus", () => updateStatus());
  handle("appUpdateCheck", () => appUpdate.poll().then(updateStatus));
  handle("appUpdateInstall", () => installUpdate());
  const claudeDesktop = createClaudeDesktop({ env: engineEnv() });
  let claudeRevision = 0;
  handle("claudeDesktopStatus", () => claudeDesktop.status());
  claudeRequests = createProviderCache(async () => {
    if (claudeDisconnecting) throw new Error("Claude is disconnecting. Try again after it completes.");
    const attempt = claudeRevision;
    const result = smoke
      ? {
          detected: true,
          source: "Generated desktop account",
          checkedAt: new Date().toISOString(),
          metrics: [
            { label: "5-hour usage", used_percent: 25, resets_at: null },
            { label: "Weekly usage", used_percent: 40, resets_at: null },
          ],
          samples: [
            { timestamp: 1791054000000, fiveHour: 20, sevenDay: 35 },
            { timestamp: 1791057600000, fiveHour: 25, sevenDay: 40 },
          ],
        }
      : await claudeDesktop.refresh();
    if (attempt !== claudeRevision) throw new Error('Claude was disconnected while refreshing.');
    // Retain consent to reuse the desktop sign-in, never a duplicate token.
    if (!preferences.claudeDesktopConnected) await savePreferences({ claudeDesktopConnected: true });
    if (attempt !== claudeRevision) throw new Error('Claude was disconnected while refreshing.');
    return result;
  });
  handle("claudeDesktopRefresh", (options) => claudeRequests.refresh(options));
  handle("limitSnapshot", async () => {
    if (!monitor) return { sources: [], checkedAt: null, error: null, lines: [] };
    const status = monitor.snapshot();
    if (status.checkedAt === null || Date.now() - status.checkedAt >= 60000)
      return monitor.poll();
    return status;
  });
  handle("claudeDesktopDisconnect", async () => {
    claudeDisconnecting = true;
    claudeRevision++;
    claudeRequests.invalidate();
    monitor?.invalidate(source => !/claude|anthropic/i.test(source.provider));
    try {
      await savePreferences({ claudeDesktopConnected: false });
      return { connected: false };
    } finally {
      claudeDisconnecting = false;
    }
  });
  const openrouter = createOpenRouter({
    file: path.join(app.getPath("userData"), "openrouter-connection.json"),
    safeStorage,
    ...(smoke
      ? {
          fetchImpl: async () => ({
            ok: true,
            status: 200,
            json: async () => ({
              data: { total_credits: 100.5, total_usage: 25.75 },
            }),
          }),
        }
      : {}),
  });
  async function findApplication(name) {
    if (smoke) return null;
    const roots = (process.env.PATH || "")
      .split(path.delimiter)
      .filter(Boolean);
    const candidates = [
      path.join(
        process.env.LOCALAPPDATA || "",
        "Programs/Antigravity/Antigravity.exe",
      ),
      ...roots.map((root) => path.join(root, "Antigravity.exe")),
    ];
    for (const candidate of candidates) {
      try {
        if ((await fs.stat(candidate)).isFile()) return candidate;
      } catch {}
    }
    return null;
  }
  handle("connectionStatus", async () => {
    return {
      antigravityInstalled: Boolean(await findApplication("antigravity")),
      claudeDesktopConnected: Boolean(preferences.claudeDesktopConnected),
    };
  });
  handle("providerAction", async (action) => {
    if (action === "antigravity-status" || action === "antigravity-sync") {
      const result = await run([
        "antigravity",
        action === "antigravity-sync" ? "sync" : "status",
        ...(action === "antigravity-status" ? ["--json"] : []),
      ]);
      if (result.code !== 0)
        throw new Error(
          result.stderr ||
            "Antigravity could not be reached. Open it and sign in first.",
        );
      return action === "antigravity-status"
        ? JSON.parse(result.stdout)
        : { synced: true };
    }
    if (smoke)
      throw new Error(
        "Account login and application launch are disabled during synthetic checks.",
      );
    if (action === "antigravity-open") {
      const exe = await findApplication("antigravity");
      if (!exe)
        throw new Error(
          "Open Antigravity from your Start menu, sign in, then click Detect.",
        );
      const error = await shell.openPath(exe);
      if (error)
        throw new Error(
          "Could not open Antigravity. Open it from your Start menu.",
        );
      return { opened: true };
    }
    throw new Error("Unsupported connection action");
  });
  const routerRequests = createProviderCache(() => openrouter.refresh());
  handle("openRouterStatus", () => openrouter.status());
  handle("openRouterConnect", async (key) => {
    routerRequests.invalidate();
    const result = await openrouter.connect(key);
    routerRequests.invalidate();
    return result;
  });
  handle("openRouterRefresh", (options) => routerRequests.refresh(options));
  handle("openRouterDisconnect", async () => {
    routerRequests.invalidate();
    return openrouter.disconnect();
  });
  handle("getSessionTitles", (home = '') => getSessionTitles(home, {env:engineEnv()}));
  handle("getInfo", () => ({
    version: pkg.version,
    engineVersion: "4.17.0",
    enginePath,
    platform: process.platform,
    homePath: preferences.home || os.homedir(),
    settingsPath: settingsPath(),
    terminalAvailable: Boolean(pty),
    settingsWarning,
  }));
  handle("run", run);
  handle("cancelRuns", () => {
    for (const child of runs) child.kill();
  });
  handle("getGraph", async (input) => {
    const args = security.args(input);
    if (args.some((arg) => arg === "--output" || arg.startsWith("--output=")))
      throw new Error("Graph output is managed by the desktop app");
    const dir = await fs.mkdtemp(
      path.join(app.getPath("temp"), "tokscale-desktop-graph-"),
    );
    try {
      const output = path.join(dir, "graph.json");
      const result = await run(["graph", ...args, "--output", output]);
      if (result.code !== 0)
        throw new Error(
          result.stderr || result.stdout || "Graph export failed",
        );
      const stat = await fs.stat(output);
      if (stat.size > 64 * 1024 * 1024)
        throw new Error("Graph data exceeds 64 MB");
      return JSON.parse(await fs.readFile(output, "utf8"));
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
  handle("startTerminal", async (options) => {
    if (!pty)
      throw new Error(
        "Embedded terminal is unavailable. Open the native terminal to use all Tokscale commands.",
      );
    if (!options || typeof options !== "object")
      throw new Error("Invalid terminal options");
    const size = security.dimensions(options.cols, options.rows);
    const args = commandArgs(options.args, false);
    if (terminals.size >= 8)
      throw new Error("Close an existing terminal first");
    const id = randomUUID();
    const proc = pty.spawn(enginePath, args, {
      name: "xterm-256color",
      cols: size.cols,
      rows: size.rows,
      cwd:
        smoke && switchValue("--smoke-home")
          ? switchValue("--smoke-home")
          : os.homedir(),
      env: { ...engineEnv(), TERM: "xterm-256color", COLORTERM: "truecolor" },
      useConpty: true,
      useConptyDll: true,
      conptyInheritCursor: false,
    });
    terminals.set(id, proc);
    proc.onData((data) => send("terminalData", { id, data }));
    proc.onExit((event) => {
      terminals.delete(id);
      send("terminalExit", { id, code: event.exitCode });
    });
    // Exercise cancellation before a terminal ID reaches the renderer.
    if (smoke) await new Promise(resolve => setTimeout(resolve, 350));
    return id;
  });
  handle("writeTerminal", (id, data) => {
    if (typeof data !== "string" || data.length > 1048576)
      throw new Error("Invalid terminal input");
    if (typeof id !== 'string') throw new Error('Invalid terminal');
    const proc = terminals.get(id);
    if (!proc) return;
    try { proc.write(data); }
    catch (error) { if (!/already exited/i.test(error.message)) throw error; }
  });
  handle("resizeTerminal", (id, cols, rows) => {
    const size = security.dimensions(cols, rows);
    if (typeof id !== "string") throw new Error("Invalid terminal");
    // A window resize can race the final output flush of a quick command.
    const proc = terminals.get(id);
    if (!proc) return;
    try {
      proc.resize(size.cols, size.rows);
    } catch (error) {
      if (!/already exited/i.test(error.message)) throw error;
    }
  });
  handle("stopTerminal", (id) => {
    if (typeof id !== "string") throw new Error("Invalid terminal");
    const proc = terminals.get(id);
    if (proc) { try { proc.kill(); } catch (error) { if (!/already exited/i.test(error.message)) throw error; } }
  });
  handle("launchNative", async (input) => {
    const args = commandArgs(input, false);
    const literal = (value) => "'" + value.replace(/'/g, "''") + "'";
    const command =
      "Start-Process -FilePath " +
      literal(enginePath) +
      (args.length
        ? " -ArgumentList " +
          literal(args.map(security.quoteWindowsArg).join(" "))
        : "");
    const encoded = Buffer.from(command, "utf16le").toString("base64");
    await new Promise((resolve, reject) => {
      const child = spawn(
        path.join(
          process.env.SystemRoot || "C:\\Windows",
          "System32/WindowsPowerShell/v1.0/powershell.exe",
        ),
        ["-NoProfile", "-NonInteractive", "-EncodedCommand", encoded],
        { shell: false, windowsHide: true, env: engineEnv(), stdio: "ignore" },
      );
      child.once("error", reject);
      child.once("exit", (code) =>
        code === 0
          ? resolve()
          : reject(new Error("Could not open native terminal")),
      );
    });
  });
  handle("selectHome", async () => {
    const result = await dialog.showOpenDialog(window, {
      title: "Choose a home folder containing AI client data",
      properties: ["openDirectory"],
      defaultPath: preferences.home || os.homedir(),
    });
    return result.canceled ? null : result.filePaths[0];
  });
  handle("exportFile", async (input) => {
    const value = security.exportRequest(input);
    const result = await dialog.showSaveDialog(window, {
      title: "Export Tokscale data",
      defaultPath: path.join(app.getPath("documents"), value.name),
    });
    if (result.canceled || !result.filePath) return null;
    await fs.writeFile(result.filePath, value.content, "utf8");
    return result.filePath;
  });
  handle("openExternal", (url) =>
    shell.openExternal(security.externalUrl(url)),
  );
  handle("showDataFolder", async () => {
    const dir =
      process.env.TOKSCALE_CONFIG_DIR ||
      path.join(app.getPath("appData"), "tokscale");
    await fs.mkdir(dir, { recursive: true });
    const error = await shell.openPath(dir);
    if (error) throw new Error(error);
  });
  handle("getSettings", () => preferences);
  handle("saveSettings", async (value) => {
    const next = security.settings(value);
    // These are owned by the main process and follow real state.
    for (const key of ["claudeDesktopConnected", "miniBounds", "miniMicro", "miniMicroBounds"]) delete next[key];
    const home = next.home;
    if (home && !(await fs.stat(home)).isDirectory())
      throw new Error("Home must be a folder");
    return savePreferences(next);
  });
  handle("miniControl", (action) => {
    // Opening the full app from the mini window leaves only the bubble behind.
    if (action === "main") {
      showMain();
      if (mini && !mini.isMicro?.()) return Promise.resolve(mini.collapse()).then(() => undefined);
    }
    else if (action === "close") setMiniVisible(false);
    // The pointer entering or leaving the mini window; it is solid while inside.
    else if (action === "solid" || action === "faded") mini?.setHover?.(action === "solid");
    else if (action === "micro") return mini?.collapse();
    else if (action === "expand") return mini?.expand();
    // The widget never supplies a link or a file; main decides both.
    else if (action === "update") return installUpdate().then(() => undefined);
    else throw new Error("Invalid mini window action");
  });
  handle("miniMoveBy", (dx, dy) => {
    if (!mini) throw new Error("Mini movement requires micro mode");
    return mini.moveBy(dx, dy);
  });
  handle("windowControl", (action) => {
    if (!["minimize", "maximize", "close"].includes(action))
      throw new Error("Invalid window action");
    if (action === "minimize") window.minimize();
    if (action === "maximize")
      window.isMaximized() ? window.unmaximize() : window.maximize();
    if (action === "close") window.close();
  });
}
async function createWindow() {
  window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: chrome().color,
    title: "Tokscale Desktop",
    icon: iconPath,
    titleBarStyle: "hidden",
    titleBarOverlay: chrome(),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
      backgroundThrottling: !smoke,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (url !== indexUrl) event.preventDefault();
  });
  window.webContents.session.setPermissionRequestHandler(
    (_wc, _permission, callback) => callback(false),
  );
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.webContents.on("render-process-gone", () => stopAll());
  window.once("ready-to-show", () => {
    if (!smoke && !startHidden) window.show();
  });
  // A maximized main window fills the screen, so the mini window shrinks to
  // its bubble instead of sitting on top of it.
  window.on("maximize", () => {
    if (mini?.isVisible() && !mini.isMicro()) void Promise.resolve(mini.collapse()).catch(() => {});
  });
  window.on("close", (event) => {
    if (preferences.minimizeToTray && tray && !quitting && !smoke) {
      event.preventDefault();
      window.hide();
    }
  });
  // The mini window must not keep the app alive once the main window is gone.
  window.on("closed", () => {
    stopAll();
    if (!quitting) app.quit();
  });
  await window.loadFile(indexPath);
}
async function smokeTest() {
  const output = switchValue("--smoke-output");
  if (!output || !switchValue("--smoke-home"))
    throw new Error(
      "Smoke test requires a synthetic home and output directory",
    );
  await fs.mkdir(output, { recursive: true });
  const bridge = await window.webContents.executeJavaScript(`(async () => {
    const info = await window.tokscale.getInfo();
    const version = await window.tokscale.run(['--version']);
    const invalid = await window.tokscale.run(['--this-option-does-not-exist']);
    let blockedUrl = false; try { await window.tokscale.openExternal('file:///C:/Windows'); } catch { blockedUrl = true; }
    return { info, version, invalidCode: invalid.code, blockedUrl, requireType: typeof require, processType: typeof process };
  })()`);
  if (
    bridge.version.code !== 0 ||
    !bridge.version.stdout.includes("4.17.0") ||
    bridge.invalidCode === 0 ||
    !bridge.blockedUrl ||
    bridge.requireType !== "undefined" ||
    bridge.processType !== "undefined"
  )
    throw new Error("Desktop bridge smoke test failed");
  const terminalResult = await window.webContents
    .executeJavaScript(`(async () => {
    let text = ''; let id; let timedOut = false;
    return await new Promise(async (resolve, reject) => {
      const dataOff = window.tokscale.onTerminalData(event => { if (!id || event.id === id) text += event.data; });
      const exitOff = window.tokscale.onTerminalExit(event => { if (!id || event.id === id) finish(event.code); });
      const timer = setTimeout(() => { timedOut = true; finish(-1); }, 15000);
      function finish(code) { clearTimeout(timer); dataOff(); exitOff(); resolve({code, text, timedOut}); }
      try { id = await window.tokscale.startTerminal({args:['--no-spinner','--version'], cols:100, rows:30}); } catch(error) { clearTimeout(timer); dataOff(); exitOff(); reject(error); }
    });
  })()`);
  if (terminalResult.code !== 0 || !terminalResult.text.includes("4.17.0"))
    throw new Error(
      "Embedded terminal smoke test failed: " + JSON.stringify(terminalResult),
    );
  const tuiResult = await window.webContents.executeJavaScript(`(async () => {
    return await new Promise(async (resolve, reject) => {
      let id; let text = ''; let interacting = false; let resized = false; let finished = false;
      const timer = setTimeout(() => finish(-1, 'Interactive TUI timed out'), 45000);
      const dataOff = window.tokscale.onTerminalData(event => {
        if (id && event.id !== id) return;
        text += event.data;
        if (event.data.includes('\\x1b[6n') && id) void window.tokscale.writeTerminal(id, '\\x1b[1;1R');
        if (text.length > 1500 && id && !interacting) {
          interacting = true;
          void (async () => {
            await window.tokscale.resizeTerminal(id, 112, 32); resized = true;
            await window.tokscale.writeTerminal(id, '\\t\\x1b[B');
            await new Promise(resolve => setTimeout(resolve, 1200));
            await window.tokscale.writeTerminal(id, 'q');
          })().catch(error => finish(-1, error.message));
        }
      });
      const exitOff = window.tokscale.onTerminalExit(event => { if (!id || event.id === id) finish(event.code); });
      function finish(code, error) {
        if (finished) return; finished = true; clearTimeout(timer); dataOff(); exitOff();
        if (error && id) void window.tokscale.stopTerminal(id);
        resolve({code, renderedBytes:text.length, resized, interacted:interacting, error});
      }
      try { id = await window.tokscale.startTerminal({args:['--no-spinner'],cols:100,rows:30}); }
      catch(error) { finish(-1,error.message); }
    });
  })()`);
  if (tuiResult.code !== 0 || !tuiResult.resized || !tuiResult.interacted)
    throw new Error(
      "Interactive TUI smoke failed: " + JSON.stringify(tuiResult),
    );
  for (let attempt = 0; attempt < 60; attempt++) {
    const loading = await window.webContents.executeJavaScript(
      `document.body.innerText.includes('Loading') || document.body.innerText.includes('Scanning')`,
    );
    if (!loading && attempt >= 5) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  let uiChecks;
  const uiCheckPath = path.join(__dirname, "ui-checks.cjs");
  try {
    await fs.access(uiCheckPath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (require("node:fs").existsSync(uiCheckPath))
    uiChecks = await require(uiCheckPath).runUiChecks({
      window,
      mini: mini?.window,
      output,
      fixtureHome: switchValue("--smoke-home"),
      terminalCount: () => terminals.size,
    });
  await fs.writeFile(
    path.join(output, "desktop.png"),
    (await window.webContents.capturePage()).toPNG(),
  );
  const documentState = await window.webContents.executeJavaScript(
    `({title:document.title, body:document.body.innerText, width:innerWidth,height:innerHeight})`,
  );
  await fs.writeFile(
    path.join(output, "smoke.json"),
    JSON.stringify(
      {
        smokeId: switchValue("--smoke-id"),
        ...bridge,
        terminal: terminalResult,
        tui: tuiResult,
        uiChecks,
        document: documentState,
      },
      null,
      2,
    ),
  );
}
app.setName("Tokscale Desktop");
if (process.platform === "win32") app.setAppUserModelId("io.tokscale.desktop");
if (smoke) {
  const output = switchValue("--smoke-output");
  if (output) app.setPath("userData", path.join(output, "app-data"));
}
if (!singleInstance()) app.quit();
else {
  app.on("second-instance", (_event, argv) => {
    if (!argv.includes("--hidden")) showMain();
    if (miniEnabled() && shouldOpenOnStartup(preferences)) mini?.show();
  });
  app
    .whenReady()
    .then(async () => {
      preferenceStore = createPreferences(settingsPath(),preferences,security.settings);
      const loaded = await preferenceStore.load();
      preferences=loaded.values; settingsWarning=loaded.warning;
      if (smoke) await savePreferences({home:switchValue("--smoke-home") || ""});
      Menu.setApplicationMenu(null);
      applyTheme();
      nativeTheme.on("updated", applyTheme);
      wireApi();
      // One toast path for both update checks; clicking opens the link.
      const linkNotice = ({ title, body, url }) => {
        if (Notification.isSupported()) {
          const notice = new Notification({ title, body, icon: iconPath });
          upstreamNotices.add(notice);
          notice.on("click", () => void shell.openExternal(security.externalUrl(url)).catch(() => {}));
          notice.on("close", () => upstreamNotices.delete(notice));
          notice.on("failed", () => {
            upstreamNotices.delete(notice);
            if (tray) tray.displayBalloon({ title, content: body });
          });
          notice.show();
        } else if (tray) tray.displayBalloon({ title, content: body });
      };
      appUpdate = createAppUpdate({
        current: app.getVersion(),
        store: createPreferences(path.join(app.getPath("userData"), "app-update.json"), {}, validateAppUpdateState),
        ...(smoke ? { fetchImpl: async () => ({
          ok: true, status: 200, headers: new Headers(),
          text: async () => JSON.stringify([{ tag_name: "desktop-v999.0.0" }, { tag_name: "v1000.0.0" }]),
        }) } : {}),
        // Both windows show an update icon; there is no toast for this.
        onStatus: publishUpdate,
      });
      upstreamMonitor = createUpstreamMonitor({
        store: createPreferences(path.join(app.getPath("userData"), "upstream-updates.json"), {}, validateUpstreamState),
        ...(smoke ? { fetchImpl: async () => ({
          ok: true, status: 200, headers: new Headers(),
          text: async () => JSON.stringify([{ sha: "a".repeat(40), commit: { message: "Synthetic upstream update baseline" } }]),
        }) } : {}),
        onStatus: (status) => send("upstreamStatus", status),
        notify: (notice) => { if (!smoke && preferences.upstreamNotifications !== false) linkNotice(notice); },
      });
      // Both windows and the tray read one monitor, including the first mini
      // render. Synthetic checks never access live account credentials.
      // Earlier versions kept a usage sample log here; nothing reads it now.
      void fs.rm(path.join(app.getPath("userData"), "limit-history.json"), { force: true }).catch(() => {});
      monitor = createLimitMonitor({
        getSources: smoke ? async () => [
          { id: "claude:5-hour", provider: "Claude", label: "5-hour usage", usedPercent: 25, resetsAt: null },
          { id: "claude:weekly", provider: "Claude", label: "Weekly usage", usedPercent: 40, resetsAt: null },
          { id: "codex:5-hour", provider: "Codex", label: "5-hour", usedPercent: 65, resetsAt: null },
          { id: "codex:weekly", provider: "Codex", label: "Weekly", usedPercent: 15, resetsAt: null },
          { id: "antigravity:pro", provider: "Antigravity", label: "Pro", usedPercent: 82, resetsAt: null },
          { id: "antigravity:flash", provider: "Antigravity", label: "Flash", usedPercent: 12, resetsAt: null },
        ] : limitSources,
        isEnabled: () => !smoke && preferences.limitNotifications !== false,
        onStatus: refreshTray,
        notify: ({ title, body }) => {
          if (tray) tray.displayBalloon({ title, content: body, icon: nativeImage.createFromPath(iconPath) });
          else if (Notification.isSupported()) new Notification({ title, body, icon: iconPath }).show();
        },
      });
      await createWindow();
      mini = createMini({
        BrowserWindow,
        screen,
        preloadPath: path.join(__dirname, "preload.cjs"),
        htmlPath: miniPath,
        iconPath,
        smoke,
        animationMs: smoke ? 0 : 190,
        getState: () => ({ bounds: preferences.miniBounds, micro: preferences.miniMicro, microBounds: preferences.miniMicroBounds, theme: miniTheme(), opacity: preferences.miniOpacity }),
        saveState: ({ bounds, micro, microBounds }) => savePreferences({
          ...(bounds ? { miniBounds: bounds } : {}),
          ...(micro !== undefined ? { miniMicro: micro } : {}),
          ...(microBounds ? { miniMicroBounds: microBounds } : {}),
        }),
      });
      appWatcher = createAppWatcher({
        onOpen: () => { if (miniEnabled() && !mini.isVisible()) mini.show(); },
        onStatus: status => send("miniWatchStatus", status),
      });
      if (smoke) {
        mini.show();
        await smokeTest();
        quitting = true;
        app.quit();
        return;
      }
      const image = nativeImage.createFromPath(iconPath);
      if (!image.isEmpty()) {
        tray = new Tray(image.resize({ width: 16, height: 16 }));
        tray.on("click", showMain);
        tray.on("double-click", showMain);
      }
      // Without a tray icon there would be no way back to a hidden window.
      if (startHidden && !tray) window.show();
      applyLoginItem();
      refreshTray();
      monitor.start();
      if (preferences.upstreamNotifications !== false) upstreamMonitor.start();
      if (!smoke && preferences.appUpdateChecks !== false) appUpdate.start();
      retireReplacedBuild();
      if (miniEnabled() && shouldOpenOnStartup(preferences)) mini.show();
      if (preferences.miniOnAiApps !== false) appWatcher.start();
    })
    .catch(async (error) => {
      if (smoke) {
        const output = switchValue("--smoke-output");
        if (output)
          await fs.writeFile(
            path.join(output, "smoke-error.txt"),
            error.stack || error.message,
          );
        console.error(error.message);
        app.exit(1);
      } else {
        dialog.showErrorBox("Tokscale Desktop could not start", error.message);
        app.quit();
      }
    });
  app.on("before-quit", () => {
    quitting = true;
    monitor?.stop();
    upstreamMonitor?.stop();
    appUpdate?.stop();
    appWatcher?.stop();
    for (const notice of upstreamNotices) notice.close();
    upstreamNotices.clear();
    mini?.destroy();
    tray?.destroy();
    stopAll();
  });
  app.on("window-all-closed", () => app.quit());
}
