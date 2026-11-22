"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { refreshShortcuts, NAME } = require("./app-shortcut.cjs");

const ID = "io.tokscale.desktop";
const EXE = path.resolve("C:/Users/me/Downloads/Tokscale-Desktop-0.4.16-x64.exe");
const START = path.resolve("C:/Users/me/AppData/Roaming/Microsoft/Windows/Start Menu/Programs");
const DESK = path.resolve("C:/Users/me/Desktop");

function fakes(links = {}, files = []) {
  const written = [];
  const present = new Set([...Object.keys(links), ...files].map(f => path.resolve(f).toLowerCase()));
  return {
    written,
    exists: file => present.has(path.resolve(file).toLowerCase()),
    shell: {
      readShortcutLink: file => {
        const link = links[file];
        if (!link) throw new Error("not a shortcut");
        return link;
      },
      writeShortcutLink: (file, operation, options) => { written.push({ file, operation, options }); return true; },
    },
  };
}
const run = (f, desktopDir = DESK) => refreshShortcuts({ shell: f.shell, exists: f.exists, target: EXE, startMenuDir: START, desktopDir, appUserModelId: ID });

test("creates a Start menu shortcut to the launched executable", () => {
  const f = fakes();
  assert.deepEqual(run(f), [path.join(START, NAME)]);
  assert.equal(f.written[0].options.target, EXE);
  assert.equal(f.written[0].options.icon, EXE);
  assert.equal(f.written[0].options.appUserModelId, ID);
  assert.equal(f.written[0].options.cwd, path.dirname(EXE));
});

test("leaves a current Start menu shortcut alone", () => {
  const f = fakes({ [path.join(START, NAME)]: { target: EXE.toUpperCase(), appUserModelId: ID } });
  assert.deepEqual(run(f), []);
});

test("repoints a Start menu shortcut left at an old or temporary executable", () => {
  const f = fakes({ [path.join(START, NAME)]: { target: "C:/Users/me/AppData/Local/Temp/abc/Tokscale Desktop.exe", appUserModelId: ID } });
  assert.deepEqual(run(f), [path.join(START, NAME)]);
});

test("repairs a broken desktop shortcut but never creates or steals one", () => {
  const stale = fakes({ [path.join(START, NAME)]: { target: EXE, appUserModelId: ID }, [path.join(DESK, NAME)]: { target: "C:/gone/Tokscale-Desktop-0.4.15-x64.exe" } });
  assert.deepEqual(run(stale), [path.join(DESK, NAME)]);

  const absent = fakes({ [path.join(START, NAME)]: { target: EXE, appUserModelId: ID } });
  assert.deepEqual(run(absent), []);

  const installed = "C:/Users/me/AppData/Local/Programs/Tokscale Desktop/Tokscale Desktop.exe";
  const working = fakes({ [path.join(START, NAME)]: { target: EXE, appUserModelId: ID }, [path.join(DESK, NAME)]: { target: installed } }, [installed]);
  assert.deepEqual(run(working), []);
});
