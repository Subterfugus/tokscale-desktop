"use strict";
const path = require("node:path");

const NAME = "Tokscale Desktop.lnk";
const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

// The portable build has no installer, so nothing gives Windows Search a Start
// menu entry for it, and its file name changes with every update. Each launch
// points the Start menu shortcut at the executable the user launched. A desktop
// shortcut is only repaired, never created: when it leads to a file that no
// longer exists, it is pointed at this executable too.
function refreshShortcuts({ shell, exists, target, startMenuDir, desktopDir, appUserModelId }) {
  const link = { target, cwd: path.dirname(target), icon: target, iconIndex: 0, description: "Tokscale Desktop", appUserModelId };
  const read = file => { try { return shell.readShortcutLink(file); } catch { return null; } };
  const changed = [];
  const startMenu = path.join(startMenuDir, NAME);
  const current = exists(startMenu) ? read(startMenu) : null;
  if (!current || !current.target || !same(current.target, target) || current.appUserModelId !== appUserModelId) {
    if (shell.writeShortcutLink(startMenu, "create", link)) changed.push(startMenu);
  }
  if (desktopDir) {
    const desktop = path.join(desktopDir, NAME);
    const existing = exists(desktop) ? read(desktop) : null;
    if (existing && existing.target && !same(existing.target, target) && !exists(existing.target)) {
      if (shell.writeShortcutLink(desktop, "create", link)) changed.push(desktop);
    }
  }
  return changed;
}

module.exports = { refreshShortcuts, NAME };
