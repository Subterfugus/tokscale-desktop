const { test } = require("node:test");
const assert = require("node:assert/strict");
const { BUBBLES, bubbleId, opacityPercent, orderLimits, moveLimit } = require("./mini-options.cjs");
const security = require("./security.cjs");

const sources = ["a", "b", "c", "d"].map((id) => ({ id }));
const ids = (list) => list.map((source) => source.id).join("");

test("bubble ids are unique and unknown choices fall back to the scale", () => {
  assert.equal(new Set(BUBBLES.map((bubble) => bubble.id)).size, BUBBLES.length);
  for (const bubble of BUBBLES) assert.equal(bubbleId(bubble.id), bubble.id);
  assert.equal(bubbleId("dragon"), "scale");
  assert.equal(bubbleId(undefined), "scale");
});

test("opacity stays between the floor and solid", () => {
  assert.equal(opacityPercent(undefined), 100);
  assert.equal(opacityPercent("x"), 100);
  assert.equal(opacityPercent(64.6), 65);
  assert.equal(opacityPercent(5), 30);
  assert.equal(opacityPercent(400), 100);
});

test("limits follow the saved order and unplaced ones keep theirs at the end", () => {
  assert.equal(ids(orderLimits(sources, undefined)), "abcd");
  assert.equal(ids(orderLimits(sources, ["c", "a"])), "cabd");
  assert.equal(ids(orderLimits(sources, ["gone", "d", "b"])), "dbac");
  assert.deepEqual(orderLimits(null, ["a"]), []);
});

test("moving a limit returns the whole new order", () => {
  assert.deepEqual(moveLimit(sources, [], 0, 2), ["b", "c", "a", "d"]);
  assert.deepEqual(moveLimit(sources, ["d", "c"], 3, 0), ["b", "d", "c", "a"]);
  assert.deepEqual(moveLimit(sources, [], 1, 1), ["a", "b", "c", "d"]);
  assert.deepEqual(moveLimit(sources, [], 0, 9), ["a", "b", "c", "d"]);
});

test("settings accept only known bubbles, sane opacity and plain id lists", () => {
  assert.deepEqual(security.settings({ miniBubble: "heart", miniOpacity: 60, miniLimitOrder: ["b", "a", "b"] }),
    { miniBubble: "heart", miniOpacity: 60, miniLimitOrder: ["b", "a"] });
  assert.throws(() => security.settings({ miniBubble: "dragon" }), /bubble/);
  for (const miniOpacity of [10, 101, 55.5, "60", null]) assert.throws(() => security.settings({ miniOpacity }), /opacity/);
  for (const miniLimitOrder of ["a", [1], [""], ["x".repeat(301)], Array(201).fill("a")])
    assert.throws(() => security.settings({ miniLimitOrder }), /limit order/);
});
