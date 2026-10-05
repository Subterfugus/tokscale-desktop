"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

function desktopApp(record) {
  if (!record || !Number.isInteger(record.pid) || record.pid <= 0 || typeof record.path !== "string") return null;
  const exe = record.path.replaceAll("/", "\\").toLowerCase();
  if (/\\(?:claude-code|node_modules|vendor|bin|\.codex)\\/.test(exe)) return null;
  if (/\\claude\.exe$/.test(exe)) return "Claude";
  if (/\\chatgpt\.exe$/.test(exe)) return /\\openai\.codex_[^\\]+\\/.test(exe) ? "Codex" : "ChatGPT";
  if (/\\codex\.exe$/.test(exe)) return "Codex";
  if (/\\(?:t3 code(?: \(alpha\))?|t3code)\.exe$/.test(exe)) return "T3 Code";
  return null;
}

function createAppWatcher({ onOpen = () => {}, onStatus = () => {}, spawnImpl = spawn, platform = process.platform, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let child = null, timer = null, running = false, initialized = false, previous = new Set(), active = null, buffer = "", error = null;
  const safe = (fn, value) => { try { fn(value); } catch {} };
  const snapshot = () => ({ running, ready: initialized, error });
  const publish = () => safe(onStatus, snapshot());
  function consume(value) {
    if (!running) return;
    if (value?.error) { error = "Desktop app detection failed; retrying."; publish(); return; }
    if (!Array.isArray(value?.apps)) return;
    const next = new Set();
    const opened = [];
    for (const app of value.apps) {
      const name = desktopApp(app);
      if (!name) continue;
      const key = `${name}:${app.pid}`;
      next.add(key);
      if (initialized && !previous.has(key)) opened.push(name);
    }
    const foregroundName = desktopApp(value.foreground);
    const foreground = foregroundName ? `${foregroundName}:${value.foreground.pid}:${value.foreground.windowId || ""}` : null;
    if (foreground && foreground !== active) opened.push(foregroundName);
    active = foreground;
    previous = next;
    initialized = true;
    error = null;
    publish();
    // One popup per snapshot even when an app launches and gains focus together.
    if (opened.length && running) safe(onOpen, [...new Set(opened)]);
  }
  function retry() {
    error = "Desktop app detection is unavailable. Retrying in 30 seconds.";
    publish();
    timer = setTimer(() => { timer = null; launch(); }, 30000);
    timer?.unref?.();
  }
  function launch() {
    if (!running) return;
    let current;
    try {
      const source = fs.readFileSync(path.join(__dirname, "watch-ai-apps.ps1"), "utf8");
      const powershell = path.join(process.env.SystemRoot || "C:\\Windows", "System32/WindowsPowerShell/v1.0/powershell.exe");
      current = spawnImpl(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(source, "utf16le").toString("base64")], { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    } catch { retry(); return; }
    child = current;
    buffer = "";
    current.stdout.setEncoding("utf8");
    current.stdout.on("data", data => {
      if (child !== current || !running) return;
      buffer += data;
      if (buffer.length > 65536) { buffer = ""; return; }
      let end;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end).trim();
        buffer = buffer.slice(end + 1);
        try { consume(JSON.parse(line)); } catch {}
      }
    });
    // Never retain raw subprocess diagnostics or desktop paths in UI/logs.
    current.stderr.resume();
    const ended = () => {
      if (child !== current) return;
      child = null;
      if (!running) return;
      retry();
    };
    current.once("error", ended);
    current.once("close", ended);
  }
  return {
    snapshot,
    start() {
      if (running || platform !== "win32") return;
      running = true; initialized = false; previous = new Set(); active = null;
      error = null; publish(); launch();
    },
    stop() {
      if (!running && !child && !timer) return;
      running = false; clearTimer(timer); timer = null;
      const old = child; child = null; old?.kill();
      buffer = ""; publish();
    },
  };
}
module.exports = { createAppWatcher, desktopApp };
