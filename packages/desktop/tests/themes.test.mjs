import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { THEMES, COLOR_KEYS, resolveTheme } = createRequire(import.meta.url)(
  "../electron/themes.cjs",
);

// Chart series colours per scheme, as declared in renderer/styles.css.
const SERIES = {
  dark: ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181"],
  light: ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"],
};
const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

test("theme ids are unique, lowercase slugs with a name and scheme", () => {
  const ids = THEMES.map((theme) => theme.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const theme of THEMES) {
    assert.match(theme.id, /^[a-z][a-z0-9-]{1,30}$/);
    assert.notEqual(theme.id, "system");
    assert.ok(theme.name && theme.name.length <= 24, theme.id);
    assert.ok(["dark", "light"].includes(theme.scheme), theme.id);
  }
});

for (const theme of THEMES) {
  test(`theme "${theme.id}" is complete and readable`, () => {
    const c = theme.colors;
    assert.deepEqual(Object.keys(c).sort(), [...COLOR_KEYS].sort());
    for (const key of COLOR_KEYS) assert.match(c[key], /^#[0-9a-f]{6}$/, key);
    const dark = theme.scheme === "dark";
    assert.equal(luminance(c.page) < 0.2, dark, "page must match the scheme");
    const check = (fg, bg, min) =>
      assert.ok(
        contrast(c[fg] || fg, c[bg]) >= min,
        `${fg} on ${bg} is ${contrast(c[fg] || fg, c[bg]).toFixed(2)}:1, needs ${min}:1`,
      );
    for (const bg of ["page", "surface", "surface2"]) {
      check("text", bg, 10);
      check("text2", bg, 5.5);
      check("text3", bg, bg === "surface2" ? 3.6 : 4.2);
    }
    check("accent", "page", 3);
    check("accent", "surface", 3);
    // Borders and hover fills must be visible but quiet.
    check("line", "surface", 1.12);
    check("lineStrong", "surface", 1.3);
    assert.ok(contrast(c.line, c.surface) <= 2.2, "line is too loud");
    assert.ok(contrast(c.surface2, c.surface) >= 1.06, "surface2 is invisible on surface");
    assert.ok(contrast(c.surface2, c.surface) <= 1.6, "surface2 is too loud");
    // Primary buttons are `text` filled with `page`-coloured labels.
    check("page", "text", 10);
    // Chart marks must stay visible on cards.
    const floor = dark ? 3 : 2;
    for (const series of SERIES[theme.scheme]) check(series, "surface", floor);
  });
}

test("system resolves to the built-in dark or light theme", () => {
  assert.equal(resolveTheme("system", true).id, "dark");
  assert.equal(resolveTheme("system", false).id, "light");
  assert.equal(resolveTheme("oled", false).id, "oled");
  assert.equal(resolveTheme("no-such-theme", true).id, "dark");
});
