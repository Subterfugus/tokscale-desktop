import { useEffect, useState } from "react";
import { safeMessage } from "./format.js";

export const api = window.tokscale;
const cache = new Map();

async function jsonRun(args) {
  const r = await api.run([
    "--no-spinner",
    ...args.filter((arg) => arg !== "--no-spinner"),
  ]);
  if (r.code !== 0)
    throw new Error(
      safeMessage(
        r.stderr || r.stdout || `Tokscale exited with code ${r.code}`,
      ),
    );
  try {
    return JSON.parse(r.stdout);
  } catch {
    throw new Error(
      "Tokscale returned an unreadable report. Open Terminal to inspect the original command.",
    );
  }
}

export function useReport(args, epoch, enabled = true, graph = false) {
  const key = JSON.stringify([graph, args]);
  const [state, setState] = useState({
    key,
    data: null,
    loading: true,
    error: null,
  });
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const cached = cache.get(key);
    if (cached?.epoch === epoch && cached.data) {
      setState({ key, data: cached.data, error: null, loading: false });
      return;
    }
    setState({ key, data: cached?.data || null, loading: true, error: null });
    let task = cached?.epoch === epoch ? cached?.promise : null;
    if (!task) {
      task = graph ? api.getGraph(args) : jsonRun(args);
      cache.set(key, { epoch, promise: task, data: cached?.data });
      if (cache.size > 40) {
        const oldest = [...cache].find(
          ([oldKey, value]) => oldKey !== key && !value.promise,
        );
        if (oldest) cache.delete(oldest[0]);
      }
    }
    task.then(
      (data) => {
        if (cache.get(key)?.promise === task)
          cache.set(key, { epoch: cache.get(key).epoch, data });
        if (alive) setState({ key, data, error: null, loading: false });
      },
      (error) => {
        if (cache.get(key)?.promise === task)
          cache.set(key, { epoch: -1, data: cached?.data });
        if (alive)
          setState({
            key,
            data: cached?.data || null,
            loading: false,
            error: error.message,
          });
      },
    );
    return () => {
      alive = false;
    };
  }, [key, epoch, enabled]);
  // A different date/client selection must never flash the previous report
  // under the new filter labels while its effect is being scheduled.
  return state.key === key
    ? state
    : { key, data: null, loading: true, error: null };
}
