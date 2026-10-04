const { contextBridge, ipcRenderer } = require("electron");
const invoke = (name, ...args) =>
  ipcRenderer.invoke("tokscale:" + name, ...args);
function subscribe(name, callback) {
  if (typeof callback !== "function") throw new Error("Expected callback");
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on("tokscale:" + name, handler);
  return () => ipcRenderer.removeListener("tokscale:" + name, handler);
}
contextBridge.exposeInMainWorld(
  "tokscale",
  Object.freeze({
    getInfo: () => invoke("getInfo"),
    connectionStatus: () => invoke("connectionStatus"),
    claudeDesktopStatus: () => invoke("claudeDesktopStatus"),
    claudeDesktopRefresh: (options) => invoke("claudeDesktopRefresh", options),
    limitSnapshot: () => invoke("limitSnapshot"),
    claudeDesktopDisconnect: () => invoke("claudeDesktopDisconnect"),
    providerAction: (action) => invoke("providerAction", action),
    openRouterStatus: () => invoke("openRouterStatus"),
    openRouterConnect: (key) => invoke("openRouterConnect", key),
    openRouterRefresh: (options) => invoke("openRouterRefresh", options),
    openRouterDisconnect: () => invoke("openRouterDisconnect"),
    run: (args) => invoke("run", args),
    getGraph: (args) => invoke("getGraph", args),
    getSessionTitles: (home) => invoke("getSessionTitles", home),
    cancelRuns: () => invoke("cancelRuns"),
    startTerminal: (options) => invoke("startTerminal", options),
    writeTerminal: (id, data) => invoke("writeTerminal", id, data),
    resizeTerminal: (id, cols, rows) =>
      invoke("resizeTerminal", id, cols, rows),
    stopTerminal: (id) => invoke("stopTerminal", id),
    onTerminalData: (callback) => subscribe("terminalData", callback),
    onTerminalExit: (callback) => subscribe("terminalExit", callback),
    launchNative: (args) => invoke("launchNative", args),
    selectHome: () => invoke("selectHome"),
    exportFile: (value) => invoke("exportFile", value),
    openExternal: (url) => invoke("openExternal", url),
    showDataFolder: () => invoke("showDataFolder"),
    miniControl: (action) => invoke("miniControl", action),
    onSettingsChanged: (callback) => subscribe("settingsChanged", callback),
    getSettings: () => invoke("getSettings"),
    saveSettings: (value) => invoke("saveSettings", value),
    windowControl: (action) => {
      void invoke("windowControl", action);
    },
  }),
);
