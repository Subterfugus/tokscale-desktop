const { pathToFileURL } = require("node:url");

const MINI_WIDTH = 300;
const MINI_HEIGHT = 230;
const MINI_MIN_WIDTH = 280;
const MINI_MIN_HEIGHT = 230;
const MARGIN = 16;

const finite = (value) => typeof value === "number" && Number.isFinite(value);

// Bottom-right corner of a work area, inset by the margin.
function defaultPosition(workArea, size = { width: MINI_WIDTH, height: MINI_HEIGHT }, margin = MARGIN) {
  return {
    x: Math.round(workArea.x + Math.max(0, workArea.width - size.width - margin)),
    y: Math.round(workArea.y + Math.max(0, workArea.height - size.height - margin)),
  };
}

// Retain a resized widget on its display, and recover it when that display is
// removed. Legacy preferences contain only x/y, so dimensions are optional.
function resolveBounds(saved, workAreas, primaryWorkArea) {
  const hasPosition = saved && finite(saved.x) && finite(saved.y);
  const areas = workAreas.length ? workAreas : [primaryWorkArea];
  let area = primaryWorkArea;
  if (hasPosition) {
    // Prefer the display containing the top-left corner. For a widget partially
    // outside that display, use overlap; never leave it straddling two displays.
    area = areas.find((candidate) => saved.x >= candidate.x && saved.x < candidate.x + candidate.width && saved.y >= candidate.y && saved.y < candidate.y + candidate.height);
    if (!area) {
      const width = finite(saved.width) && saved.width > 0 ? saved.width : MINI_WIDTH;
      const height = finite(saved.height) && saved.height > 0 ? saved.height : MINI_HEIGHT;
      let largestOverlap = 0;
      for (const candidate of areas) {
        const overlap = Math.max(0, Math.min(saved.x + width, candidate.x + candidate.width) - Math.max(saved.x, candidate.x))
          * Math.max(0, Math.min(saved.y + height, candidate.y + candidate.height) - Math.max(saved.y, candidate.y));
        if (overlap > largestOverlap) {
          largestOverlap = overlap;
          area = candidate;
        }
      }
    }
  }
  const restorePosition = Boolean(area && hasPosition);
  area ||= primaryWorkArea;
  const width = Math.round(Math.min(area.width, Math.max(MINI_MIN_WIDTH, finite(saved?.width) && saved.width > 0 ? saved.width : MINI_WIDTH)));
  const height = Math.round(Math.min(area.height, Math.max(MINI_MIN_HEIGHT, finite(saved?.height) && saved.height > 0 ? saved.height : MINI_HEIGHT)));
  const position = restorePosition ? {
    x: Math.round(Math.max(area.x, Math.min(saved.x, area.x + area.width - width))),
    y: Math.round(Math.max(area.y, Math.min(saved.y, area.y + area.height - height))),
  } : defaultPosition(area, { width, height });
  return { ...position, width, height };
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
  let boundsTimer = null;
  const alive = () => Boolean(win) && !win.isDestroyed();
  const background = () => getState().theme.colors.page;

  function bounds(saved = getState()?.bounds) {
    return resolveBounds(
      saved,
      screen.getAllDisplays().map((display) => display.workArea),
      screen.getPrimaryDisplay().workArea,
    );
  }

  function persistBounds() {
    clearTimeout(boundsTimer);
    if (!alive()) return;
    try {
      Promise.resolve(saveState({ bounds: win.getBounds() })).catch(() => {});
    } catch {
      /* Geometry is a convenience; never fail the window. */
    }
  }

  function scheduleBoundsSave() {
    clearTimeout(boundsTimer);
    boundsTimer = setTimeout(persistBounds, 400);
  }

  function recoverBounds() {
    if (!alive()) return;
    const current = win.getBounds();
    const recovered = bounds(current);
    win.setMinimumSize(Math.min(MINI_MIN_WIDTH, recovered.width), Math.min(MINI_MIN_HEIGHT, recovered.height));
    if (Object.keys(recovered).some((key) => recovered[key] !== current[key])) win.setBounds(recovered);
    persistBounds();
  }

  const displayEvents = ["display-added", "display-removed", "display-metrics-changed"];

  function create() {
    const initialBounds = bounds();
    win = new BrowserWindow({
      ...initialBounds,
      minWidth: Math.min(MINI_MIN_WIDTH, initialBounds.width),
      minHeight: Math.min(MINI_MIN_HEIGHT, initialBounds.height),
      show: false,
      frame: false,
      resizable: true,
      thickFrame: true,
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
    win.on("move", scheduleBoundsSave);
    win.on("resize", scheduleBoundsSave);
    // A completed native drag/resize saves immediately; move/resize also cover
    // programmatic changes and platforms without the completed-event variants.
    win.on("moved", persistBounds);
    win.on("resized", persistBounds);
    for (const event of displayEvents) screen.on(event, recoverBounds);
    // The window can also be hidden with Alt+F4, so report what really happened.
    win.on("show", () => onVisibility(true));
    win.on("hide", () => {
      persistBounds();
      if (!destroyed) onVisibility(false);
    });
    win.on("close", (event) => {
      if (destroyed) return;
      event.preventDefault();
      win.hide();
    });
    win.on("closed", () => {
      clearTimeout(boundsTimer);
      for (const event of displayEvents) screen.removeListener(event, recoverBounds);
      win = null;
    });
    win.loadFile(htmlPath).catch(() => {});
  }

  return {
    show() {
      if (destroyed) return;
      if (!alive()) return create();
      if (smoke) return;
      recoverBounds();
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
      persistBounds();
      clearTimeout(boundsTimer);
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
  resolveBounds,
  MINI_WIDTH,
  MINI_HEIGHT,
  MINI_MIN_WIDTH,
  MINI_MIN_HEIGHT,
  MARGIN,
};
