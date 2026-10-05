"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { cleanSamples, DAY_MS } = require("./limit-pace.cjs");
const MAX_POINTS = 2500;
const MAX_BYTES = 8 * 1024 * 1024;

function createSampleLog(initial = {}, { now = Date.now } = {}) {
  const logs = new Map();
  function prune() {
    const time = now();
    for (const [id, list] of logs) {
      if (!list.length || list.at(-1).t < time - 30 * DAY_MS) logs.delete(id);
      else {
        const retained = list.filter(s => s.t >= time - 14 * DAY_MS).slice(-MAX_POINTS);
        // A lone older sample acts as the last-seen marker until 30 days.
        logs.set(id, retained.length ? retained : list.slice(-1));
      }
    }
  }
  function merge(id, samples) {
    const points = new Map((logs.get(id) || []).map(s => [s.t, s]));
    for (const s of cleanSamples(samples)) if (s.t <= now()) points.set(s.t, { t: s.t, p: s.p });
    logs.set(id, [...points.values()].sort((a, b) => a.t - b.t));
    prune();
  }
  if (initial && typeof initial === "object" && !Array.isArray(initial))
    for (const [id, list] of Object.entries(initial)) merge(id, list);
  return {
    merge,
    record(source, t = now()) {
      const last = logs.get(source.id)?.at(-1);
      if (last && source.usedPercent === last.p && t - last.t >= 0 && t - last.t < 30 * 60 * 1000) { prune(); return; }
      merge(source.id, [{ t, p: source.usedPercent }]);
    },
    samples(id) { return (logs.get(id) || []).map(s => ({ ...s })); },
    remove(id) { logs.delete(id); },
    snapshot() { prune(); return Object.fromEntries([...logs].map(([id, list]) => [id, list.map(s => ({ ...s }))])); },
  };
}

function createLimitHistory(file, options = {}) {
  let log = createSampleLog({}, options), writes = Promise.resolve();
  return {
    async load() {
      try {
        if ((await fs.stat(file)).size > MAX_BYTES) return;
        log = createSampleLog(JSON.parse(await fs.readFile(file, "utf8")), options);
      } catch { /* Missing or corrupt history starts empty. */ }
    },
    merge: (...args) => log.merge(...args),
    record: (...args) => log.record(...args),
    samples: id => log.samples(id),
    remove: id => log.remove(id),
    snapshot: () => log.snapshot(),
    save() {
      const data = JSON.stringify(log.snapshot());
      writes = writes.then(async () => {
        if (Buffer.byteLength(data) > MAX_BYTES) return;
        const temp = file + "." + randomUUID() + ".tmp";
        try {
          await fs.mkdir(path.dirname(file), { recursive: true });
          await fs.writeFile(temp, data, "utf8");
          await fs.rename(temp, file);
        } finally { await fs.rm(temp, { force: true }); }
      }).catch(() => {});
      return writes;
    },
  };
}

module.exports = { createSampleLog, createLimitHistory, MAX_POINTS, MAX_BYTES };
