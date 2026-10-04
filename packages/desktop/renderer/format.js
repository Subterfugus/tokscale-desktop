export const money = (v) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(Number(v) || 0);
export const number = (v) =>
  new Intl.NumberFormat("en-US").format(Number(v) || 0);
export const compact = (v) =>
  new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Number(v) || 0);
export const pct = (v) => `${(Number(v) || 0).toFixed(1)}%`;
export const pretty = (s) =>
  (Array.isArray(s)
    ? s.map((item) => pretty(item)).join(", ")
    : String(s || "Unknown")
  )
    .replace(/[-_]/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase());
// Engine identifiers are lowercase slugs; a few need their real spelling.
const NAMES = {
  openai: "OpenAI",
  openrouter: "OpenRouter",
  xai: "xAI",
  github: "GitHub",
  opencode: "OpenCode",
};
export const brand = (s) =>
  Array.isArray(s)
    ? s.map(brand).join(", ")
    : NAMES[String(s || "").toLowerCase()] || pretty(s);
const parseDate = (s) =>
  new Date(
    /^\d{4}-\d{2}-\d{2}$/.test(s)
      ? s + "T12:00:00"
      : /^\d{4}-\d{2}$/.test(s)
        ? s + "-01T12:00:00"
        : s,
  );
export const dateLabel = (s) => {
  const d = parseDate(s);
  return isNaN(d)
    ? String(s)
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};
export const monthLabel = (s) => {
  const d = parseDate(s);
  return isNaN(d)
    ? String(s)
    : d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
};
export const longDate = (s) => {
  const d = parseDate(s);
  return isNaN(d)
    ? String(s)
    : d.toLocaleDateString(undefined, {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      });
};
export const dateTime = (s) => {
  const d = new Date(s);
  return isNaN(d)
    ? String(s)
    : d.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
};
export const clock = (d) =>
  d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
export const hours = (ms) => `${((Number(ms) || 0) / 3600000).toFixed(1)}h`;
export const safeMessage = (s) =>
  String(s || "").replace(
    /(Bearer\s+|(?:api[_-]?key|token|secret|authorization)[=:]\s*)[^\s,;]+/gi,
    "$1[hidden]",
  );
