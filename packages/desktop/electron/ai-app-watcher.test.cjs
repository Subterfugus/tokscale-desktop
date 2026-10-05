const { test } = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const { createAppWatcher, desktopApp } = require("./ai-app-watcher.cjs");
const claude = { pid: 101, path: "C:\\Program Files\\WindowsApps\\Claude_2.1_x64__publisher\\app\\Claude.exe", windowId: "1" };
const codex = { pid: 102, path: "C:\\Program Files\\WindowsApps\\OpenAI.Codex_26.9_x64__publisher\\app\\ChatGPT.exe", windowId: "2" };
const chatgpt = { pid: 103, path: "C:\\Program Files\\WindowsApps\\OpenAI.ChatGPT_1.0_x64__publisher\\app\\ChatGPT.exe", windowId: "3" };
const t3 = { pid: 104, path: "C:\\Users\\user\\AppData\\Local\\Programs\\t3code\\T3 Code (Alpha).exe", windowId: "4" };
function fixture() {
  const f = { opened: [], calls: [], timers: [] };
  f.watcher = createAppWatcher({
    platform: "win32", onOpen: apps => f.opened.push(apps),
    spawnImpl: (...args) => {
      f.calls.push(args);
      const child = new EventEmitter();
      child.stdout = new PassThrough(); child.stderr = new PassThrough();
      child.kill = () => { child.killed = true; child.emit("close", 0); };
      f.child = child;
      return child;
    },
    setTimer: (callback, ms) => { const timer = { callback, ms }; f.timers.push(timer); return timer; },
    clearTimer: timer => { if (timer) timer.cancelled = true; },
  });
  f.emit = (apps, foreground = null) => f.child.stdout.write(JSON.stringify({ apps, foreground }) + "\n");
  return f;
}

test("recognizes desktop Codex, Claude, ChatGPT and T3 Code while excluding CLI and resource helpers", () => {
  assert.equal(desktopApp(claude), "Claude");
  assert.equal(desktopApp(codex), "Codex");
  assert.equal(desktopApp(chatgpt), "ChatGPT");
  assert.equal(desktopApp(t3), "T3 Code");
  assert.equal(desktopApp({ ...t3, path: "C:\\Apps\\T3 Code\\T3 Code.exe" }), "T3 Code");
  assert.equal(desktopApp({ ...t3, path: "C:\\Apps\\t3code\\t3code.exe" }), "T3 Code");
  assert.equal(desktopApp({ ...t3, path: "C:\\Apps\\t3code\\resources\\resource-monitor\\t3-resource-monitor.exe" }), null);
  assert.equal(desktopApp({ ...t3, path: "C:\\bin\\t3code.exe" }), null);
  assert.equal(desktopApp({ pid: 1, path: "C:\\Users\\user\\AppData\\Roaming\\Claude\\claude-code\\2.1\\claude.exe" }), null);
  assert.equal(desktopApp({ pid: 1, path: "C:\\Users\\user\\.codex\\packages\\bin\\codex.exe" }), null);
  assert.equal(desktopApp({ pid: 1, path: "C:\\bin\\codex.exe" }), null);
  assert.equal(desktopApp({ pid: 1, path: "C:\\Windows\\notepad.exe" }), null);
});

test("T3 Code launch and foreground return reopen once per transition", () => {
  const f = fixture(); f.watcher.start();
  f.emit([]);
  f.emit([t3], t3);
  f.emit([t3], t3);
  assert.deepEqual(f.opened, [["T3 Code"]]);
  f.emit([t3]);
  f.emit([t3], t3);
  assert.deepEqual(f.opened, [["T3 Code"], ["T3 Code"]]);
  f.watcher.stop();
});

test("focus transitions reopen the widget once, including a new window in an existing app", () => {
  const f = fixture(); f.watcher.start();
  f.emit([claude, codex], codex);
  f.emit([claude, codex], codex);
  assert.deepEqual(f.opened, [["Codex"]]);
  f.emit([claude, codex]);
  f.emit([claude, codex], codex);
  f.emit([claude, codex], { ...codex, windowId: "99" });
  assert.equal(f.opened.length, 3);
  f.watcher.stop();
});

test("background launch reopens once and unchanged process snapshots do not create repeated popups", () => {
  const f = fixture(); f.watcher.start();
  f.emit([codex]);
  assert.equal(f.opened.length, 0);
  f.emit([codex, claude], claude);
  f.emit([codex, claude], claude);
  assert.deepEqual(f.opened, [["Claude"]]);
  f.emit([codex]);
  f.emit([codex, { ...claude, pid: 555 }]);
  assert.equal(f.opened.length, 2);
  f.watcher.stop();
});

test("hidden helper runs without a shell or changing execution policy, and stops with the app", () => {
  const f = fixture(); f.watcher.start();
  const [exe, argv, options] = f.calls[0];
  assert.match(exe, /powershell\.exe$/);
  assert.equal(options.windowsHide, true);
  assert.equal(options.shell, false);
  assert.ok(argv.includes("-EncodedCommand"));
  assert.ok(!argv.includes("-ExecutionPolicy"));
  assert.match(Buffer.from(argv.at(-1), "base64").toString("utf16le"), /T3 Code \(Alpha\)/);
  const child = f.child;
  f.watcher.stop();
  assert.equal(child.killed, true);
  child.stdout.write(JSON.stringify({ apps: [claude], foreground: claude }) + "\n");
  assert.equal(f.opened.length, 0);
  assert.equal(f.timers.length, 0);
});

test("helper failure schedules one retry, clears errors after recovery, and stop cancels retry", () => {
  const f = fixture(); f.watcher.start();
  f.child.emit("error", new Error("test")); f.child.emit("close", 1);
  assert.equal(f.timers.length, 1);
  assert.equal(f.timers[0].ms, 30000);
  assert.ok(f.watcher.snapshot().error);
  f.timers[0].callback();
  f.emit([claude], claude);
  assert.equal(f.watcher.snapshot().error, null);
  f.child.emit("close", 1);
  f.watcher.stop();
  assert.equal(f.timers.at(-1).cancelled, true);
});

test("partial JSON frames and malformed or oversized output cannot trigger arbitrary app popups", () => {
  const f = fixture(); f.watcher.start();
  f.child.stdout.write("not json\n");
  f.child.stdout.write("x".repeat(70000));
  f.child.stdout.write("\n");
  const value = JSON.stringify({ apps: [claude], foreground: claude });
  f.child.stdout.write(value.slice(0, 10));
  f.child.stdout.write(value.slice(10) + "\n");
  assert.deepEqual(f.opened, [["Claude"]]);
  f.watcher.stop();
});

test("stopping from a status callback is idempotent and cancels a pending popup", () => {
  const f = fixture();
  const watcher = createAppWatcher({
    platform: "win32", spawnImpl: (...args) => f.watcherSpawn(...args),
    onOpen: apps => f.opened.push(apps),
    onStatus: status => { if (status.ready) watcher.stop(); },
  });
  // Reuse a fake native process without launching any desktop application.
  f.watcher.start();
  const child = f.child;
  f.watcher.stop();
  f.watcherSpawn = () => child;
  watcher.start();
  child.stdout.write(JSON.stringify({ apps: [claude], foreground: claude }) + "\n");
  watcher.stop();
  assert.equal(watcher.snapshot().running, false);
  assert.equal(f.opened.length, 0);
});
