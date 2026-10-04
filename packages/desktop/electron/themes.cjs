// One list drives the renderer's colours, the Settings picker, and the native
// title bar. `scheme` selects the chart palette and the native light/dark mode.
// Every entry must pass tests/themes.test.mjs.
const core = [
  {
    id: "dark",
    name: "Dark",
    scheme: "dark",
    colors: {
      page: "#111110",
      surface: "#1a1a19",
      surface2: "#242422",
      line: "#2c2c2a",
      lineStrong: "#3b3b38",
      text: "#f3f2ee",
      text2: "#c3c2b7",
      text3: "#898781",
      accent: "#d97757",
    },
  },
  {
    id: "light",
    name: "Light",
    scheme: "light",
    colors: {
      page: "#f4f3ee",
      surface: "#fcfcfb",
      surface2: "#eeede7",
      line: "#e1e0d9",
      lineStrong: "#cdccc4",
      text: "#141413",
      text2: "#52514e",
      text3: "#6f6d68",
      accent: "#c2603f",
    },
  },
  {
    id: "oled",
    name: "OLED black",
    scheme: "dark",
    colors: {
      page: "#000000",
      surface: "#000000",
      surface2: "#161616",
      line: "#222222",
      lineStrong: "#333333",
      text: "#f2f2f2",
      text2: "#b9b9b9",
      text3: "#858585",
      accent: "#d97757",
    },
  },
];
const THEMES = [
  ...core,
  ...require("./themes-dark.cjs"),
  ...require("./themes-light.cjs"),
];
const COLOR_KEYS = Object.keys(core[0].colors);
// "system" follows the Windows light/dark setting.
function resolveTheme(id, prefersDark) {
  return (
    THEMES.find((theme) => theme.id === id) ||
    THEMES.find((theme) => theme.id === (prefersDark ? "dark" : "light"))
  );
}
module.exports = { THEMES, COLOR_KEYS, resolveTheme };
