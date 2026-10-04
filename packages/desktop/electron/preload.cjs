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
    run: (args) => invoke("run", args),
    getGraph: (args) => invoke("getGraph", args),
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
    getSettings: () => invoke("getSettings"),
    saveSettings: (value) => invoke("saveSettings", value),
    windowControl: (action) => {
      void invoke("windowControl", action);
    },
  }),
);
