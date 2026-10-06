"use strict";

const { readJson } = require("./upstream-monitor.cjs");

const REPOSITORY = "https://github.com/Subterfugus/tokscale-desktop";
const ENDPOINT = "https://api.github.com/repos/Subterfugus/tokscale-desktop/releases?per_page=30";
const TAG = /^desktop-v(\d{1,5})\.(\d{1,5})\.(\d{1,5})$/;
const INTERVAL_MS = 6 * 60 * 60 * 1000;
const MIN_CHECK_MS = 60 * 1000;
const assetName = value => `Tokscale-Desktop-${value}-x64.exe`;
const MAX_ASSET_BYTES = 1024 * 1024 * 1024;
const version = value => typeof value === "string" && /^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(value) ? value : null;
const timestamp = value => Number.isFinite(value) && value >= 0 ? value : null;
const parts = value => value.split(".").map(Number);
function newer(a, b) {
  const x = parts(a), y = parts(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}

function validateState(value = {}) {
  return {
    latest: version(value.latest),
    notified: version(value.notified),
    checkedAt: timestamp(value.checkedAt),
    retryAt: timestamp(value.retryAt),
    size: Number.isInteger(value.size) && value.size > 0 && value.size <= MAX_ASSET_BYTES ? value.size : null,
    sha256: typeof value.sha256 === "string" && /^[a-f0-9]{64}$/.test(value.sha256) ? value.sha256 : null,
  };
}

// Size and SHA-256 of a release's portable build, as GitHub recorded them at
// upload. Without both the app can only link to the release page.
function releaseAsset(releases, wanted) {
  const release = (Array.isArray(releases) ? releases : []).find(item => item?.tag_name === `desktop-v${wanted}`);
  const asset = (Array.isArray(release?.assets) ? release.assets : []).find(item => item?.name === assetName(wanted));
  const state = validateState({ size: asset?.size, sha256: typeof asset?.digest === "string" ? asset.digest.replace(/^sha256:/, "") : null });
  return state.size && state.sha256 ? { size: state.size, sha256: state.sha256 } : { size: null, sha256: null };
}

// The newest published desktop release; drafts, prereleases and the CLI's
// own tags are skipped.
function latestRelease(releases) {
  let best = null;
  for (const release of Array.isArray(releases) ? releases : []) {
    const match = typeof release?.tag_name === "string" && !release.draft && !release.prerelease && TAG.exec(release.tag_name);
    if (!match) continue;
    const found = match.slice(1).map(Number).join(".");
    if (!best || newer(found, best)) best = found;
  }
  return best;
}

function createAppUpdate({ current, store, fetchImpl = fetch, notify = () => {}, onStatus = () => {}, now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout }) {
  if (!version(current)) throw new TypeError("current version is required");
  let state = validateState(), error = null, inflight = null, controller = null;
  let running = false, generation = 0, timer = null, loaded = false;
  const safe = (fn, value) => { try { fn(value); } catch {} };
  const snapshot = () => {
    const available = state.latest && newer(state.latest, current) ? state.latest : null;
    return {
      current, latest: state.latest, available, checkedAt: state.checkedAt, error, checking: Boolean(inflight),
      asset: available && state.size && state.sha256 ? { size: state.size, sha256: state.sha256 } : null,
      // Built from the validated version, never from a link in the response.
      url: available ? `${REPOSITORY}/releases/tag/desktop-v${available}` : `${REPOSITORY}/releases`,
    };
  };
  const publish = () => safe(onStatus, snapshot());

  async function check(attempt) {
    try {
      if (!loaded) { state = validateState((await store.load()).values); loaded = true; }
      if (attempt !== generation) return;
      if (state.retryAt && now() < state.retryAt) {
        error = "GitHub limited update checks. The app will retry later.";
        return;
      }
      if (state.checkedAt !== null && now() - state.checkedAt < MIN_CHECK_MS) return;
      const requestController = new AbortController();
      controller = requestController;
      const timeout = setTimeout(() => requestController.abort(), 10000);
      try {
        const response = await fetchImpl(ENDPOINT, {
          method: "GET", redirect: "error", signal: requestController.signal,
          headers: { Accept: "application/vnd.github+json", "User-Agent": "Tokscale-Desktop", "X-GitHub-Api-Version": "2022-11-28" },
        });
        if (attempt !== generation) return;
        if (response.status === 403 || response.status === 429) {
          state = validateState(await store.save({ ...state, retryAt: now() + INTERVAL_MS }));
          throw new Error("GitHub limited update checks. The app will retry later.");
        }
        if (!response.ok) throw new Error(`GitHub update check failed (HTTP ${response.status}).`);
        const releases = await readJson(response);
        if (!Array.isArray(releases)) throw new Error("GitHub returned an invalid release list.");
        if (attempt !== generation) return;
        const latest = latestRelease(releases);
        const announce = Boolean(latest && newer(latest, current) && latest !== state.notified);
        // Save before notifying so restarting the app cannot repeat it.
        state = validateState(await store.save({ latest, ...releaseAsset(releases, latest), notified: announce ? latest : state.notified, checkedAt: now(), retryAt: null }));
        error = null;
        if (announce && attempt === generation)
          safe(notify, { title: `Tokscale Desktop ${latest} is available`, body: `You have ${current}. Click to open the download page.`, url: snapshot().url });
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
    timer = setTimer(() => {
      timer = null;
      if (running && attempt === generation) poll().then(() => schedule(attempt));
    }, Math.max(INTERVAL_MS, (state.retryAt || 0) - now()));
    timer?.unref?.();
  }
  return {
    snapshot, poll,
    start() { if (running) return; running = true; const attempt = ++generation; poll().then(() => schedule(attempt)); },
    stop() { running = false; generation++; clearTimer(timer); timer = null; controller?.abort(); inflight = null; publish(); },
  };
}

module.exports = { createAppUpdate, validateState, latestRelease, releaseAsset, assetName, newer, REPOSITORY, ENDPOINT, INTERVAL_MS };
