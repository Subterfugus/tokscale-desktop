const { pathToFileURL } = require("node:url");
const { opacityPercent } = require("./mini-options.cjs");

const MINI_WIDTH = 300;
const MINI_HEIGHT = 230;
const MINI_MIN_WIDTH = 280;
const MINI_MIN_HEIGHT = 230;
const MICRO_SIZE = 64;
const MARGIN = 16;

const finite = (value) => typeof value === "number" && Number.isFinite(value);
const shouldOpenOnStartup = (settings = {}) => settings.miniLaunchOnStartup !== false;

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

function clampMicroBounds(position, area) {
  return {
    x: Math.round(Math.max(area.x, Math.min(position.x, area.x + area.width - MICRO_SIZE))),
    y: Math.round(Math.max(area.y, Math.min(position.y, area.y + area.height - MICRO_SIZE))),
    width: MICRO_SIZE,
    height: MICRO_SIZE,
  };
}

function nearestWorkArea(position, areas, primary) {
  const containing = areas.find(area => position.x >= area.x && position.x < area.x + area.width && position.y >= area.y && position.y < area.y + area.height);
  if (containing) return containing;
  let nearest = primary, distance = Infinity;
  for (const area of areas) {
    const dx = Math.max(area.x - position.x, 0, position.x - (area.x + area.width));
    const dy = Math.max(area.y - position.y, 0, position.y - (area.y + area.height));
    if (dx * dx + dy * dy < distance) { nearest = area; distance = dx * dx + dy * dy; }
  }
  return nearest;
}

function resolveMicroBounds(saved, expanded, areas, primary) {
  const size = { width: MICRO_SIZE, height: MICRO_SIZE };
  if (isOnScreen(saved, areas, size)) return { x: Math.round(saved.x), y: Math.round(saved.y), ...size };
  const position = { x: expanded.x + expanded.width - MICRO_SIZE, y: expanded.y };
  return clampMicroBounds(position, nearestWorkArea(position, areas, primary));
}

// Moving the bubble anchors the expanded window's top-right to the bubble's.
function expandBounds(expanded, bubble, moved, areas, primary) {
  if (!moved) return resolveBounds(expanded, areas, primary);
  const saved = { ...expanded, x: bubble.x + MICRO_SIZE - expanded.width, y: bubble.y };
  const area = nearestWorkArea(bubble, areas, primary);
  return resolveBounds(saved, [area], area);
}

function moveMicroBounds(current, dx, dy, areas, primary) {
  if (!finite(dx) || !finite(dy)) throw new Error("Invalid mini movement");
  const position = {
    x: current.x + Math.max(-4000, Math.min(4000, dx)),
    y: current.y + Math.max(-4000, Math.min(4000, dy)),
  };
  return clampMicroBounds(position, nearestWorkArea(position, areas, primary));
}

function createMini({ BrowserWindow, screen, preloadPath, htmlPath, iconPath, smoke = false, getState, saveState, onVisibility = () => {}, setTimer = setTimeout, clearTimer = clearTimeout, animationMs = 0 }) {
  const htmlUrl = pathToFileURL(htmlPath).href;
  let win = null;
  let destroyed = false;
  let wantedVisible = false;
  let boundsTimer = null;
  let micro = Boolean(getState().micro);
  let expandedBounds = null;
  let bubbleOrigin = null;
  let changingBounds = false;
  let transitions = Promise.resolve();
  const alive = () => Boolean(win) && !win.isDestroyed();
  const applyOpacity = () => { if (alive()) win.setOpacity?.(opacityPercent(getState().opacity) / 100); };
  // Electron parks "floating" windows directly behind the Windows taskbar, and
  // when the taskbar leaves the top band the window sinks under every other
  // app with it. This level stays above ordinary windows on its own.
  const raise = () => {
    if (!alive()) return;
    win.setAlwaysOnTop(true, "pop-up-menu");
    win.moveTop?.();
  };
  const background = () => getState().theme.colors.page;
  const areas = () => screen.getAllDisplays().map(display => display.workArea);
  const primary = () => screen.getPrimaryDisplay().workArea;

  function save(patch) {
    try { return Promise.resolve(saveState(patch)).catch(() => {}); }
    catch { return Promise.resolve(); }
  }

  // Ease the native window from one rectangle towards another. The caller
  // still applies the final bounds, so an interrupted glide ends correctly.
  async function glide(from, to) {
    if (!(animationMs > 0) || !alive()) return;
    changingBounds = true;
    try {
      win.setResizable(true);
      win.setMinimumSize(MICRO_SIZE, MICRO_SIZE);
      const started = Date.now();
      for (;;) {
        await new Promise((resolve) => setTimeout(resolve, 12));
        const t = (Date.now() - started) / animationMs;
        if (!alive() || t >= 1) return;
        const k = 1 - (1 - t) ** 3;
        const at = (key) => Math.round(from[key] + (to[key] - from[key]) * k);
        win.setBounds({ x: at("x"), y: at("y"), width: at("width"), height: at("height") });
      }
    } finally { changingBounds = false; }
  }

  function applyBounds(next) {
    changingBounds = true;
    try {
      win.setResizable(true);
      win.setMinimumSize(micro ? MICRO_SIZE : Math.min(MINI_MIN_WIDTH, next.width), micro ? MICRO_SIZE : Math.min(MINI_MIN_HEIGHT, next.height));
      win.setBounds(next);
      if (micro) {
        win.setResizable(false);
        // Some Windows frame styles ignore bounds while non-resizable. Retry
        // while resizable, then check the actual native geometry.
        // Fractional display scaling can leave the native size a pixel off.
        const fits = (size) => Math.abs(size.width - MICRO_SIZE) <= 2 && Math.abs(size.height - MICRO_SIZE) <= 2;
        if (!fits(win.getBounds())) {
          win.setResizable(true);
          win.setBounds(next);
          win.setResizable(false);
        }
        if (!fits(win.getBounds())) throw new Error("Mini bubble could not shrink to 64x64");
      }
    } finally { changingBounds = false; }
  }

  function bounds(saved = getState()?.bounds) {
    return resolveBounds(
      saved,
      screen.getAllDisplays().map((display) => display.workArea),
      screen.getPrimaryDisplay().workArea,
    );
  }

  function persistBounds() {
    clearTimer(boundsTimer);
    if (!alive() || changingBounds) return;
    const current = win.getBounds();
    if (micro) void save({ microBounds: { x: current.x, y: current.y } });
    else { expandedBounds = current; void save({ bounds: current }); }
  }

  function scheduleBoundsSave() {
    if (changingBounds) return;
    clearTimer(boundsTimer);
    boundsTimer = setTimer(persistBounds, 400);
  }

  function recoverBounds() {
    if (!alive()) return;
    const current = win.getBounds();
    const recovered = micro ? clampMicroBounds(current, nearestWorkArea(current, areas(), primary())) : bounds(current);
    applyBounds(recovered);
    persistBounds();
  }

  const displayEvents = ["display-added", "display-removed", "display-metrics-changed"];

  function create() {
    expandedBounds = bounds();
    const initialBounds = micro ? resolveMicroBounds(getState().microBounds, expandedBounds, areas(), primary()) : expandedBounds;
    if (micro) bubbleOrigin = initialBounds;
    win = new BrowserWindow({
      ...initialBounds,
      minWidth: micro ? MICRO_SIZE : Math.min(MINI_MIN_WIDTH, initialBounds.width),
      minHeight: micro ? MICRO_SIZE : Math.min(MINI_MIN_HEIGHT, initialBounds.height),
      show: false,
      frame: false,
      resizable: !micro,
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
    if (micro) applyBounds(initialBounds);
    applyOpacity();
    win.setAlwaysOnTop(true, "pop-up-menu");
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (event, url) => {
      if (url !== htmlUrl) event.preventDefault();
    });
    win.once("ready-to-show", () => {
      if (!smoke && alive() && !destroyed && wantedVisible) {
        win.showInactive();
        raise();
      }
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
      wantedVisible = false;
      win.hide();
    });
    win.on("closed", () => {
      clearTimer(boundsTimer);
      for (const event of displayEvents) screen.removeListener(event, recoverBounds);
      win = null;
    });
    win.loadFile(htmlPath).catch(() => {});
  }

  return {
    collapse() {
      const task = transitions.then(async () => {
        if (!alive() || micro) return;
        clearTimer(boundsTimer);
        expandedBounds = win.getBounds();
        await save({ bounds: expandedBounds });
        if (!alive()) return;
        const next = resolveMicroBounds(getState().microBounds, expandedBounds, areas(), primary());
        await glide(expandedBounds, next);
        if (!alive()) return;
        micro = true;
        try { applyBounds(next); }
        catch (error) { micro = false; applyBounds(expandedBounds); throw error; }
        bubbleOrigin = win.getBounds();
        await save({ micro: true, microBounds: { x: bubbleOrigin.x, y: bubbleOrigin.y } });
      });
      transitions = task.catch(() => {});
      return task;
    },
    expand() {
      const task = transitions.then(async () => {
        if (!alive() || !micro) return;
        clearTimer(boundsTimer);
        const current = win.getBounds();
        const moved = current.x !== bubbleOrigin?.x || current.y !== bubbleOrigin?.y;
        const next = expandBounds(expandedBounds || bounds(), current, moved, areas(), primary());
        await glide(current, next);
        if (!alive()) return;
        micro = false;
        applyBounds(next);
        expandedBounds = win.getBounds();
        await save({ micro: false, bounds: expandedBounds, microBounds: { x: current.x, y: current.y } });
      });
      transitions = task.catch(() => {});
      return task;
    },
    moveBy(dx, dy) {
      if (!alive() || !micro) throw new Error("Mini movement requires micro mode");
      applyBounds(moveMicroBounds(win.getBounds(), dx, dy, areas(), primary()));
      persistBounds();
    },
    isMicro() { return micro; },
    show() {
      if (destroyed) return;
      wantedVisible = true;
      if (!alive()) return create();
      if (smoke) return;
      recoverBounds();
      win.showInactive();
      raise();
    },
    hide() {
      wantedVisible = false;
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
    applyOpacity,
    destroy() {
      destroyed = true;
      wantedVisible = false;
      persistBounds();
      clearTimer(boundsTimer);
      if (alive()) win.destroy();
      win = null;
    },
  };
}

module.exports = {
  shouldOpenOnStartup,
  createMini,
  defaultPosition,
  isOnScreen,
  resolvePosition,
  resolveBounds,
  MINI_WIDTH,
  MINI_HEIGHT,
  MINI_MIN_WIDTH,
  MINI_MIN_HEIGHT,
  MICRO_SIZE,
  resolveMicroBounds,
  expandBounds,
  moveMicroBounds,
  MARGIN,
};
