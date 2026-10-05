const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createMini, shouldOpenOnStartup, defaultPosition, isOnScreen, resolvePosition, resolveBounds, MINI_WIDTH, MINI_HEIGHT, MINI_MIN_WIDTH, MINI_MIN_HEIGHT } = require("./mini-window.cjs");

const size = { width: MINI_WIDTH, height: MINI_HEIGHT };
const primary = { x: 0, y: 0, width: 1920, height: 1040 };
const second = { x: 1920, y: 0, width: 1280, height: 1024 };

test("default position is the bottom-right corner with a 16px margin", () => {
  assert.deepEqual(defaultPosition(primary, size), { x: 1920 - 300 - 16, y: 1040 - 230 - 16 });
  assert.deepEqual(defaultPosition({ x: -1280, y: 0, width: 1280, height: 720 }, size), {
    x: -300 - 16,
    y: 720 - 230 - 16,
  });
});

test("saved bounds must lie fully on a connected display", () => {
  assert.equal(isOnScreen({ x: 100, y: 100 }, [primary], size), true);
  assert.equal(isOnScreen({ x: 2000, y: 50 }, [primary, second], size), true);
  assert.equal(isOnScreen({ x: 2000, y: 50 }, [primary], size), false);
  assert.equal(isOnScreen({ x: 1800, y: 50 }, [primary], size), false);
  assert.equal(isOnScreen({ x: NaN, y: 0 }, [primary], size), false);
  assert.equal(isOnScreen(undefined, [primary], size), false);
});

test("resolvePosition restores saved bounds or falls back to the default", () => {
  assert.deepEqual(resolvePosition({ x: 40, y: 60 }, [primary], primary, size), { x: 40, y: 60 });
  assert.deepEqual(resolvePosition({ x: 5000, y: 60 }, [primary], primary, size), defaultPosition(primary, size));
  assert.deepEqual(resolvePosition(undefined, [primary], primary, size), defaultPosition(primary, size));
});

test("saved resized bounds restore on another monitor and legacy positions migrate", () => {
  const resized = { x: 2000, y: 40, width: 510, height: 470 };
  assert.deepEqual(resolveBounds(resized, [primary, second], primary), resized);
  assert.deepEqual(resolveBounds({ x: 40, y: 60 }, [primary], primary), { x: 40, y: 60, ...size });
  assert.deepEqual(resolveBounds(undefined, [primary], primary), { ...defaultPosition(primary), ...size });
});

test("invalid or undersized dimensions use defaults or the usable minimum", () => {
  assert.deepEqual(resolveBounds({ x: 100, y: 100, width: NaN, height: -40 }, [primary], primary), { x: 100, y: 100, ...size });
  assert.deepEqual(resolveBounds({ x: 100, y: 100, width: 12, height: 16 }, [primary], primary), { x: 100, y: 100, width: MINI_MIN_WIDTH, height: MINI_MIN_HEIGHT });
  assert.deepEqual(resolveBounds({ x: Infinity, y: 20, width: 420, height: 350 }, [primary], primary), { ...defaultPosition(primary, { width: 420, height: 350 }), width: 420, height: 350 });
});

test("partially offscreen widgets clamp onto their display without losing their size", () => {
  assert.deepEqual(resolveBounds({ x: 1800, y: 900, width: 420, height: 350 }, [primary, second], primary), { x: 1500, y: 690, width: 420, height: 350 });
  const negative = { x: -1280, y: -120, width: 1280, height: 840 };
  assert.deepEqual(resolveBounds({ x: -1300, y: -140, width: 400, height: 300 }, [primary, negative], primary), { x: -1280, y: -120, width: 400, height: 300 });
});

test("removed monitors recover at the primary corner and oversized widgets fit small displays", () => {
  const dimensions = { width: 510, height: 470 };
  assert.deepEqual(resolveBounds({ x: 2000, y: 40, ...dimensions }, [primary], primary), { ...defaultPosition(primary, dimensions), ...dimensions });
  const tiny = { x: -200, y: 10, width: 200, height: 180 };
  assert.deepEqual(resolveBounds({ x: -100, y: 40, width: 2000, height: 900 }, [tiny], tiny), { ...tiny });
  assert.deepEqual(resolveBounds(undefined, [tiny], tiny), { ...tiny });
});

function fixture(savedBounds) {
  const saved = [];
  const visibility = [];
  const screen = new EventEmitter();
  let areas = [primary, second];
  screen.getAllDisplays = () => areas.map((workArea) => ({ workArea }));
  screen.getPrimaryDisplay = () => ({ workArea: areas[0] });
  class Window extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.bounds = Object.fromEntries(["x", "y", "width", "height"].map((key) => [key, options[key]]));
      this.minimumSize = [options.minWidth, options.minHeight];
      this.dead = false;
      this.visible = false;
      this.webContents = new EventEmitter();
      this.webContents.setWindowOpenHandler = () => {};
    }
    setAlwaysOnTop() {}
    setBackgroundColor() {}
    setMinimumSize(...dimensions) { this.minimumSize = dimensions; }
    setBounds(next) { this.bounds = { ...next }; this.emit("move"); this.emit("resize"); }
    getBounds() { return { ...this.bounds }; }
    isDestroyed() { return this.dead; }
    isVisible() { return this.visible; }
    show() { this.visible = true; this.emit("show"); }
    showInactive() { this.show(); this.inactive = true; }
    hide() { this.visible = false; this.emit("hide"); }
    destroy() { this.dead = true; this.emit("closed"); }
    loadFile() { return Promise.resolve(); }
  }
  const mini = createMini({ BrowserWindow: Window, screen, preloadPath: "preload.cjs", htmlPath: "mini.html", iconPath: "icon.png", getState: () => ({ bounds: savedBounds, theme: { colors: { page: "#fff" } } }), saveState: (next) => { saved.push(next); }, onVisibility: (shown) => visibility.push(shown) });
  mini.show();
  return { mini, saved, visibility, screen, setAreas: (next) => { areas = next; } };
}

test("native move and resize save all bounds, and hiding flushes an unfinished resize", () => {
  const { mini, saved, visibility } = fixture();
  assert.equal(mini.window.options.resizable, true);
  assert.equal(mini.window.options.thickFrame, true);
  assert.deepEqual(mini.window.minimumSize, [MINI_MIN_WIDTH, MINI_MIN_HEIGHT]);
  const moved = { x: 120, y: 90, width: 300, height: 230 };
  mini.window.setBounds(moved);
  mini.window.emit("moved");
  assert.deepEqual(saved.at(-1), { bounds: moved });
  const resized = { ...moved, width: 520, height: 460 };
  mini.window.setBounds(resized);
  mini.window.emit("resized");
  assert.deepEqual(saved.at(-1), { bounds: resized });
  mini.window.setBounds({ ...resized, width: 620 });
  mini.hide();
  assert.equal(saved.at(-1).bounds.width, 620);
  assert.deepEqual(visibility, [false]);
  mini.destroy();
});

test("display removal recovers an open widget and restores minimum size after a tiny display", () => {
  const { mini, saved, screen, setAreas } = fixture({ x: 2000, y: 40, width: 510, height: 470 });
  setAreas([primary]);
  screen.emit("display-removed");
  assert.deepEqual(saved.at(-1).bounds, { ...defaultPosition(primary, { width: 510, height: 470 }), width: 510, height: 470 });
  const tiny = { x: 0, y: 0, width: 200, height: 180 };
  setAreas([tiny]);
  screen.emit("display-metrics-changed");
  assert.deepEqual(mini.window.getBounds(), tiny);
  assert.deepEqual(mini.window.minimumSize, [200, 180]);
  setAreas([primary]);
  screen.emit("display-metrics-changed");
  assert.deepEqual(mini.window.minimumSize, [MINI_MIN_WIDTH, MINI_MIN_HEIGHT]);
  assert.equal(mini.window.getBounds().width, MINI_MIN_WIDTH);
  mini.destroy();
  assert.equal(screen.listenerCount("display-removed"), 0);
  assert.equal(screen.listenerCount("display-metrics-changed"), 0);
});

test("destroy flushes geometry and a recreated controller restores the new size", () => {
  const original = fixture();
  original.mini.window.setBounds({ x: 50, y: 60, width: 640, height: 480 });
  original.mini.destroy();
  const restored = fixture(original.saved.at(-1).bounds);
  assert.deepEqual(restored.mini.window.getBounds(), { x: 50, y: 60, width: 640, height: 480 });
  restored.mini.destroy();
});

test("startup defaults on and remains independent of a temporarily closed widget", () => {
  assert.equal(shouldOpenOnStartup({}), true);
  assert.equal(shouldOpenOnStartup({ miniOpen: false }), true);
  assert.equal(shouldOpenOnStartup({ miniOpen: false, miniLaunchOnStartup: true }), true);
  assert.equal(shouldOpenOnStartup({ miniOpen: true, miniLaunchOnStartup: false }), false);
});

test("closing during initial loading cancels the pending show, and reopening preserves keyboard focus", () => {
  const { mini } = fixture();
  mini.hide();
  mini.window.emit("ready-to-show");
  assert.equal(mini.isVisible(), false);
  mini.show();
  assert.equal(mini.isVisible(), true);
  assert.equal(mini.window.inactive, true);
  mini.destroy();
});
