// The theme list is shared with the main process, which colours the native
// title bar from the same values.
import themes from "../electron/themes.cjs";

export const { THEMES, resolveTheme } = themes;
// colors.surface2 -> --surface-2, colors.lineStrong -> --line-strong
export const cssVariable = (key) =>
  "--" + key.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase()).replace(/(\d)/, "-$1");
