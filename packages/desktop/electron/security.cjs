const path = require("node:path");
const { THEMES } = require("./themes.cjs");
function args(value) {
  if (
    !Array.isArray(value) ||
    value.length > 256 ||
    value.some(
      (v) => typeof v !== "string" || v.length > 16384 || v.includes("\0"),
    )
  )
    throw new Error("Invalid engine arguments");
  return [...value];
}
function dimensions(cols, rows) {
  if (
    !Number.isInteger(cols) ||
    !Number.isInteger(rows) ||
    cols < 10 ||
    cols > 1000 ||
    rows < 5 ||
    rows > 500
  )
    throw new Error("Invalid terminal size");
  return { cols, rows };
}
function exportRequest(value) {
  if (
    !value ||
    typeof value.name !== "string" ||
    typeof value.content !== "string" ||
    value.content.length > 64 * 1024 * 1024
  )
    throw new Error("Invalid export");
  const name = value.name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 180);
  if (!name || name === "." || name === "..")
    throw new Error("Invalid export filename");
  return { name, content: value.content };
}
function externalUrl(value) {
  if (typeof value !== "string" || value.length > 8192)
    throw new Error("Invalid URL");
  const url = new URL(value);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw new Error("Only HTTP and HTTPS links are supported");
  return url.href;
}
function settings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid settings");
  const encoded = JSON.stringify(value);
  if (encoded.length > 65536) throw new Error("Settings are too large");
  const result = JSON.parse(encoded);
  for (const key of ["__proto__", "constructor", "prototype"])
    delete result[key];
  if (value.home !== undefined) {
    if (
      typeof value.home !== "string" ||
      value.home.includes("\0") ||
      value.home.length > 32760 ||
      (value.home && !path.isAbsolute(value.home))
    )
      throw new Error("Invalid home path");
    result.home = value.home;
  }
  for (const key of ["refreshSeconds", "refreshInterval"])
    if (value[key] !== undefined) {
      if (
        !Number.isFinite(value[key]) ||
        value[key] < 0 ||
        value[key] > (key === "refreshInterval" ? 86400000 : 86400)
      )
        throw new Error("Invalid refresh interval");
      result[key] = value[key];
    }
  for (const key of ["theme", "defaultPeriod"])
    if (value[key] !== undefined) {
      if (typeof value[key] !== "string" || value[key].length > 64)
        throw new Error("Invalid preference");
      result[key] = value[key];
    }
  if (value.theme !== undefined && value.theme !== 'system' && !THEMES.some(theme => theme.id === value.theme)) throw new Error('Unknown appearance setting');
  if (value.defaultPeriod !== undefined && !['today','yesterday','week','month','all'].includes(value.defaultPeriod)) throw new Error('Unknown default date range');
  if (value.tokenTypes !== undefined) {
    const known = ['input','output','cacheRead','cacheWrite','reasoning'];
    if (!Array.isArray(value.tokenTypes) || !value.tokenTypes.length || value.tokenTypes.some(type => !known.includes(type))) throw new Error('Unknown token type');
    result.tokenTypes = known.filter(type => value.tokenTypes.includes(type));
  }
  if (value.miniTheme !== undefined && !['match','system'].includes(value.miniTheme) && !THEMES.some(theme => theme.id === value.miniTheme)) throw new Error('Unknown mini window theme');
  for (const key of [
    "launchAtLogin",
    "minimizeToTray",
    "limitNotifications",
    "upstreamNotifications",
    "miniEnabled",
    "miniLaunchOnStartup",
    "miniOnAiApps",
    "miniMicro",
    "includeGeminiThoughts",
    "claudeDesktopConnected",
  ])
    if (value[key] !== undefined) {
      if (typeof value[key] !== "boolean")
        throw new Error("Invalid preference");
      result[key] = value[key];
    }
  if (value.miniHiddenLimits !== undefined) {
    const ids = value.miniHiddenLimits;
    if (!Array.isArray(ids) || ids.length > 200 || ids.some(id => typeof id !== "string" || !id || id.length > 300))
      throw new Error("Invalid mini window limits");
    result.miniHiddenLimits = [...new Set(ids)];
  }
  if (value.miniMicroBounds !== undefined) {
    const bounds = value.miniMicroBounds;
    if (!bounds || typeof bounds !== "object" || Array.isArray(bounds) || !Number.isFinite(bounds.x) || !Number.isFinite(bounds.y))
      throw new Error("Invalid mini bubble position");
    result.miniMicroBounds = { x: Math.round(bounds.x), y: Math.round(bounds.y) };
  }
  return result;
}
function quoteWindowsArg(value) {
  return (
    '"' + value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/g, "$1$1") + '"'
  );
}
module.exports = {
  args,
  dimensions,
  exportRequest,
  externalUrl,
  settings,
  quoteWindowsArg,
};
