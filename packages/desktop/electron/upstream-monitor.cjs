"use strict";

const REPOSITORY = "https://github.com/junhoyeo/tokscale";
const ENDPOINT = "https://api.github.com/repos/junhoyeo/tokscale/commits?per_page=1";
const INTERVAL_MS = 60 * 60 * 1000;
const MIN_CHECK_MS = 60 * 1000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const sha = value => typeof value === "string" && /^[a-f0-9]{40}$/i.test(value);
const timestamp = value => Number.isFinite(value) && value >= 0 ? value : null;
const title = value => typeof value === "string"
  ? value.split(/[\r\n]/, 1)[0].replace(/[\x00-\x1f\x7f]/g, " ").trim().slice(0, 180)
  : "";

function validateState(value = {}) {
  return {
    sha: sha(value.sha) ? value.sha.toLowerCase() : null,
    previousSha: sha(value.previousSha) ? value.previousSha.toLowerCase() : null,
    title: title(value.title),
    checkedAt: timestamp(value.checkedAt),
    changedAt: timestamp(value.changedAt),
    retryAt: timestamp(value.retryAt),
    etag: typeof value.etag === "string" && value.etag.length <= 256 && !/[\r\n]/.test(value.etag) ? value.etag : null,
  };
}

async function readJson(response) {
  if (Number(response.headers.get("content-length")) > MAX_RESPONSE_BYTES)
    throw new Error("GitHub returned an unexpectedly large response.");
  if (!response.body?.getReader) {
    const content = await response.text();
    if (Buffer.byteLength(content) > MAX_RESPONSE_BYTES) throw new Error("GitHub response exceeded the size limit.");
    return JSON.parse(content);
  }
  const reader = response.body.getReader();
  let size = 0;
  const chunks = [];
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error("GitHub response exceeded the size limit.");
      chunks.push(Buffer.from(value));
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function createUpstreamMonitor({ store, fetchImpl = fetch, notify = () => {}, onStatus = () => {}, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let state = validateState(), error = null, inflight = null, controller = null;
  let running = false, generation = 0, timer = null, loaded = false;
  const safe = (fn, value) => { try { fn(value); } catch {} };
  const snapshot = () => ({
    ...state, error, checking: Boolean(inflight), repository: REPOSITORY,
    url: state.previousSha && state.sha ? `${REPOSITORY}/compare/${state.previousSha}...${state.sha}` : state.sha ? `${REPOSITORY}/commit/${state.sha}` : REPOSITORY,
  });
  const publish = () => safe(onStatus, snapshot());

  async function load() {
    if (loaded) return;
    const result = await store.load();
    state = validateState(result.values);
    loaded = true;
  }

  async function check(attempt) {
    try {
      await load();
      if (attempt !== generation) return;
      if (state.retryAt && now() < state.retryAt) {
        error = "GitHub limited update checks. The app will retry later.";
        return;
      }
      if (state.checkedAt !== null && now() - state.checkedAt < MIN_CHECK_MS) return;
      const requestController = new AbortController();
      controller = requestController;
      const timeout = setTimeout(() => requestController.abort(), 10000);
      let response;
      try {
        response = await fetchImpl(ENDPOINT, {
          method: "GET", redirect: "error", signal: requestController.signal,
          headers: {
            Accept: "application/vnd.github+json", "User-Agent": "Tokscale-Desktop",
            "X-GitHub-Api-Version": "2022-11-28",
            ...(state.sha && state.etag ? { "If-None-Match": state.etag } : {}),
          },
        });
        if (attempt !== generation) return;
        if (response.status === 403 || response.status === 429) {
          const retry = response.headers.get("retry-after");
          const retryTime = retry && (/^\d+$/.test(retry) ? now() + Number(retry) * 1000 : Date.parse(retry));
          const reset = Number(response.headers.get("x-ratelimit-reset")) * 1000;
          const retryAt = Math.min(now() + 24 * INTERVAL_MS, Math.max(now() + INTERVAL_MS, retryTime || 0, reset || 0));
          state = validateState(await store.save({ ...state, retryAt }));
          throw new Error("GitHub limited update checks. The app will retry later.");
        }
        if (response.status === 304 && state.sha) {
          state = validateState(await store.save({ ...state, checkedAt: now(), retryAt: null }));
          error = null;
          return;
        }
        if (!response.ok) throw new Error(`GitHub update check failed (HTTP ${response.status}).`);
        const commits = await readJson(response);
        if (!Array.isArray(commits) || !sha(commits[0]?.sha)) throw new Error("GitHub returned an invalid commit response.");
        if (attempt !== generation) return;
        const latest = commits[0], oldSha = state.sha, newSha = latest.sha.toLowerCase();
        const changed = Boolean(oldSha && oldSha !== newSha);
        const next = {
          ...state, sha: newSha, title: title(latest.commit?.message), checkedAt: now(), retryAt: null,
          previousSha: changed ? oldSha : state.previousSha,
          changedAt: changed ? now() : state.changedAt,
          etag: response.headers.get("etag"),
        };
        // Save before notifying so restarting the portable app cannot repeat it.
        state = validateState(await store.save(next));
        error = null;
        if (changed && attempt === generation)
          safe(notify, { title: "Original Tokscale repository updated", body: state.title || "New changes are available on GitHub.", url: snapshot().url });
      } finally {
        clearTimeout(timeout);
      }
    } catch (failure) {
      if (attempt === generation)
        error = failure?.name === "AbortError" ? "GitHub update check timed out. The app will retry later." : failure?.message?.startsWith("GitHub") ? failure.message : "Couldn't check GitHub. The app will retry later.";
    }
  }

  function poll() {
    if (inflight) return inflight;
    const attempt = generation;
    const task = Promise.resolve().then(() => check(attempt)).finally(() => {
      if (inflight === task) { inflight = null; controller = null; publish(); }
    }).then(snapshot);
    inflight = task;
    publish();
    return task;
  }
  function schedule(attempt) {
    if (!running || attempt !== generation) return;
    const delay = Math.max(INTERVAL_MS, (state.retryAt || 0) - now());
    timer = setTimer(() => {
      timer = null;
      if (running && attempt === generation) poll().then(() => schedule(attempt));
    }, delay);
    timer?.unref?.();
  }
  return {
    snapshot, poll,
    start() { if (running) return; running = true; const attempt = ++generation; poll().then(() => schedule(attempt)); },
    stop() { running = false; generation++; clearTimer(timer); timer = null; controller?.abort(); inflight = null; publish(); },
  };
}

module.exports = { createUpstreamMonitor, validateState, readJson, REPOSITORY, ENDPOINT, INTERVAL_MS };
