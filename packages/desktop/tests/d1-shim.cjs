const { DatabaseSync } = require("node:sqlite");

// An in-memory stand-in for the parts of Cloudflare D1 the sync worker uses.
function createD1() {
  const db = new DatabaseSync(":memory:");
  const statement = (sql, params = []) => ({
    bind: (...values) => statement(sql, values),
    first: async () => db.prepare(sql).get(...params) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...params) }),
    execute: () => db.prepare(sql).run(...params),
  });
  let writes = 0;
  return {
    prepare: (sql) => statement(sql),
    batch: async (statements) => {
      writes += statements.length;
      return statements.map((entry) => entry.execute());
    },
    get writes() {
      return writes;
    },
  };
}

// Routes fetch() calls for one origin to a worker, as Cloudflare would.
function workerFetch(worker, env, origin = "https://sync.example.test") {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    if (!String(url).startsWith(origin + "/")) throw new Error("Unexpected address " + url);
    calls.push(`${options.method || "GET"} ${String(url).slice(origin.length)}`);
    return worker.fetch(new Request(url, options), env);
  };
  return { fetchImpl, calls, origin };
}

module.exports = { createD1, workerFetch };
