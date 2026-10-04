const test = require("node:test");
const assert = require("node:assert/strict");
const { defaultPosition, isOnScreen, resolvePosition, MINI_WIDTH, MINI_HEIGHT } = require("./mini-window.cjs");

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
