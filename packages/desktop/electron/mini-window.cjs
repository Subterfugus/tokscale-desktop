const { pathToFileURL } = require("node:url");

const MINI_WIDTH = 300;
const MINI_HEIGHT = 230;
const MARGIN = 16;

const finite = (value) => typeof value === "number" && Number.isFinite(value);

// Bottom-right corner of a work area, inset by the margin.
function defaultPosition(workArea, size = { width: MINI_WIDTH, height: MINI_HEIGHT }, margin = MARGIN) {
  return {
    x: Math.round(workArea.x + workArea.width - size.width - margin),
    y: Math.round(workArea.y + workArea.height - size.height - margin),
  };
}

// True when a window of `size` placed at `bounds` lies fully inside one of the
// display work areas.
function isOnScreen(bounds, workAreas, size = { width: MINI_WIDTH, height: MINI_HEIGHT }) {
  if (!bounds || !finite(bounds.x) || !finite(bounds.y)) return false;
  return workAreas.some(
    (area) =>
      bounds.x >= area.x &&
      bounds.y >= area.y &&
      bounds.x + size.width <= area.x + area.width &&
      bounds.y + size.height <= area.y + area.height,
  );
}

// Saved position when it is still on a connected display, else the default.
function resolvePosition(saved, workAreas, primaryWorkArea, size = { width: MINI_WIDTH, height: MINI_HEIGHT }, margin = MARGIN) {
  if (isOnScreen(saved, workAreas, size))
    return { x: Math.round(saved.x), y: Math.round(saved.y) };
  return defaultPosition(primaryWorkArea, size, margin);
}

function createMini({ BrowserWindow, screen, preloadPath, htmlPath, iconPath, smoke = false, getState, saveState, onVisibility = () => {} }) {
  const htmlUrl = pathToFileURL(htmlPath).href;
  let win = null;
  let destroyed = false;
  let moveTimer = null;
  const size = { width: MINI_WIDTH, height: MINI_HEIGHT };
  const alive = () => Boolean(win) && !win.isDestroyed();
  const background = () => getState().theme.colors.page;

  function position() {
    const state = getState() || {};
    return resolvePosition(
      state.bounds,
      screen.getAllDisplays().map((display) => display.workArea),
      screen.getPrimaryDisplay().workArea,
      size,
    );
  }

  function create() {
    const { x, y } = position();
    win = new BrowserWindow({
      x,
      y,
      width: size.width,
      height: size.height,
      show: false,
      frame: false,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      title: "Tokscale",
      icon: iconPath,
      backgroundColor: background(),
      webPreferences: {
        preload: preloadPath,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        spellcheck: false,
        backgroundThrottling: !smoke,
      },
    });
    win.setAlwaysOnTop(true, "floating");
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (event, url) => {
      if (url !== htmlUrl) event.preventDefault();
    });
    win.once("ready-to-show", () => {
      if (!smoke && alive() && !destroyed) win.show();
    });
    win.on("moved", () => {
      clearTimeout(moveTimer);
      moveTimer = setTimeout(() => {
        if (!alive()) return;
        const [bx, by] = win.getPosition();
        try {
          saveState({ bounds: { x: bx, y: by } });
        } catch {
          /* Position is a convenience; never fail the window. */
        }
      }, 400);
    });
    // The window can also be hidden with Alt+F4, so report what really happened.
    win.on("show", () => onVisibility(true));
    win.on("hide", () => !destroyed && onVisibility(false));
    win.on("close", (event) => {
      if (destroyed) return;
      event.preventDefault();
      win.hide();
    });
    win.on("closed", () => {
      clearTimeout(moveTimer);
      win = null;
    });
    win.loadFile(htmlPath).catch(() => {});
  }

  return {
    show() {
      if (destroyed) return;
      if (!alive()) return create();
      if (smoke) return;
      win.show();
    },
    hide() {
      if (alive()) win.hide();
    },
    toggle() {
      if (this.isVisible()) this.hide();
      else this.show();
    },
    isVisible() {
      return alive() && win.isVisible();
    },
    get window() {
      return alive() ? win : null;
    },
    applyTheme() {
      if (alive()) win.setBackgroundColor(background());
    },
    destroy() {
      destroyed = true;
      clearTimeout(moveTimer);
      if (alive()) win.destroy();
      win = null;
    },
  };
}

module.exports = {
  createMini,
  defaultPosition,
  isOnScreen,
  resolvePosition,
  MINI_WIDTH,
  MINI_HEIGHT,
  MARGIN,
};
