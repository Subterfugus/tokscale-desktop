"use strict";
// Polls subscription usage limits, keeps tray status text and raises
// threshold / reset notifications. Dependency-free; timers are injectable.

const DEFAULT_THRESHOLDS = [75, 90];
const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const TOOLTIP_LIMIT = 127;

function clampPercent(value) {
  return Math.min(100, Math.max(0, value));
}

function normalizeSources(list) {
  const out = [];
  if (!Array.isArray(list)) return out;
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const percent = typeof item.usedPercent === "number" ? item.usedPercent : NaN;
    if (!Number.isFinite(percent)) continue;
    const provider = String(item.provider == null ? "" : item.provider);
    const label = String(item.label == null ? "" : item.label);
    out.push({
      id: item.id == null ? `${provider}:${label}` : String(item.id),
      provider,
      label,
      usedPercent: clampPercent(percent),
      resetsAt: item.resetsAt == null ? null : item.resetsAt,
    });
  }
  return out;
}

function formatStatus(sources) {
  const groups = new Map();
  for (const source of normalizeSources(sources)) {
    const name = source.provider || "Other";
    if (!groups.has(name)) groups.set(name, []);
    const label = source.label.replace(/\s+usage$/i, "").trim();
    const text = `${label ? label + " " : ""}${Math.round(source.usedPercent)}%`;
    groups.get(name).push(text);
  }
  return [...groups.keys()]
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((name) => `${name}: ${groups.get(name).join(", ")}`);
}

function tooltip(lines, appName) {
  const text = [String(appName == null ? "" : appName), ...(Array.isArray(lines) ? lines : [])]
    .filter((part, index) => index === 0 || part !== "")
    .join("\n");
  if (text.length <= TOOLTIP_LIMIT) return text;
  return text.slice(0, TOOLTIP_LIMIT - 1) + "…";
}

function resetText(resetsAt) {
  if (resetsAt == null || resetsAt === "") return null;
  const date = resetsAt instanceof Date ? resetsAt : new Date(resetsAt);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString([], { dateStyle: "short", timeStyle: "short" });
}

function errorMessage(error) {
  const text = String((error && error.message) || error || "Unknown error")
    .replace(/\s+/g, " ")
    .trim();
  return (text || "Unknown error").slice(0, 120);
}

function createLimitMonitor(options = {}) {
  const {
    getSources,
    notify = () => {},
    onStatus = () => {},
    isEnabled = () => true,
    intervalMs = DEFAULT_INTERVAL_MS,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    now = Date.now,
  } = options;
  const thresholds = (
    Array.isArray(options.thresholds) && options.thresholds.length
      ? options.thresholds.filter((t) => Number.isFinite(t))
      : DEFAULT_THRESHOLDS
  )
    .slice()
    .sort((a, b) => a - b);
  if (!thresholds.length) thresholds.push(...DEFAULT_THRESHOLDS);
  if (typeof getSources !== "function") throw new TypeError("getSources is required");

  const memory = new Map(); // source id -> highest announced threshold
  let sources = [];
  let checkedAt = null;
  let error = null;
  let running = false;
  let generation = 0;
  let revision = 0;
  let timer = null;
  let inflight = null;

  const safe = (fn, arg) => {
    try {
      return fn(arg);
    } catch {
      return undefined;
    }
  };

  function enabled() {
    return !!safe(isEnabled);
  }

  function snapshot() {
    return {
      sources: sources.map((s) => ({ ...s })),
      checkedAt,
      error,
      lines: formatStatus(sources),
    };
  }

  function evaluate(list) {
    const canNotify = enabled();
    for (const source of list) {
      const { id, provider, label, usedPercent: pct } = source;
      const name = `${provider} ${label}`.trim();
      if (pct < thresholds[0]) {
        if (memory.has(id)) {
          memory.delete(id);
          if (canNotify) {
            safe(notify, {
              title: `${name} has reset`,
              body: `Usage is now ${Math.round(pct)}%.`,
            });
          }
        }
        continue;
      }
      let reached = thresholds[0];
      for (const t of thresholds) if (pct >= t) reached = t;
      const previous = memory.has(id) ? memory.get(id) : -Infinity;
      if (reached <= previous) continue;
      memory.set(id, reached);
      if (!canNotify) continue;
      const shown = Math.round(pct);
      const when = resetText(source.resetsAt);
      safe(notify, {
        title: reached >= 90 ? `${name} almost used up (${shown}%)` : `${name} at ${shown}%`,
        body: when ? `Resets ${when}` : "Usage resets on a rolling schedule.",
      });
    }
  }

  async function run(myGeneration, myRevision) {
    let list = null;
    let failure = null;
    try {
      const result = await getSources();
      list = normalizeSources(Array.isArray(result) ? result : result?.sources);
      if (!Array.isArray(result) && result?.error) failure = errorMessage(result.error);
    } catch (e) {
      failure = errorMessage(e);
    }
    if (myGeneration !== generation || myRevision !== revision) return snapshot();
    checkedAt = now();
    error = failure;
    // A partial result replaces the old list so a failed or disconnected
    // account is never mixed silently with freshly checked providers.
    if (list !== null) {
      sources = list;
      evaluate(list);
    }
    const snap = snapshot();
    safe(onStatus, snap);
    return snap;
  }

  function poll() {
    if (inflight) return inflight;
    const task = run(generation, revision).finally(() => {
      if (inflight === task) inflight = null;
    });
    inflight = task;
    return task;
  }

  function invalidate(keep = () => false) {
    revision++;
    inflight = null;
    sources = sources.filter(keep);
    checkedAt = null;
    error = null;
    for (const id of memory.keys())
      if (!sources.some((source) => source.id === id)) memory.delete(id);
    safe(onStatus, snapshot());
  }

  function schedule(myGeneration) {
    if (!running || myGeneration !== generation) return;
    timer = setTimer(() => {
      timer = null;
      if (!running || myGeneration !== generation) return;
      poll().then(() => schedule(myGeneration), () => schedule(myGeneration));
    }, intervalMs);
    if (timer && typeof timer.unref === "function") timer.unref();
  }

  function start() {
    if (running) return;
    running = true;
    const myGeneration = ++generation;
    poll().then(() => schedule(myGeneration), () => schedule(myGeneration));
  }

  function stop() {
    running = false;
    generation++;
    inflight = null;
    if (timer != null) {
      safe(clearTimer, timer);
      timer = null;
    }
  }

  return { start, stop, poll, snapshot, invalidate };
}

module.exports = { createLimitMonitor, formatStatus, tooltip };
