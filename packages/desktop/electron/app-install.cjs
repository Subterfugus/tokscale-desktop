"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { REPOSITORY, assetName } = require("./app-update.cjs");

const FILE = /^Tokscale-Desktop-\d{1,5}\.\d{1,5}\.\d{1,5}-x64\.exe$/;
const HOST = /(^|\.)(github\.com|githubusercontent\.com)$/;

// Downloads one release's portable build next to the running one. The file is
// kept only if its size and SHA-256 match what GitHub published for it.
async function downloadUpdate({ version, size, sha256, dir, fetchImpl = fetch, onProgress = () => {}, signal }) {
  const name = assetName(version);
  const target = path.join(dir, name), temp = target + ".download";
  const response = await fetchImpl(`${REPOSITORY}/releases/download/desktop-v${version}/${name}`, {
    method: "GET", redirect: "follow", signal, headers: { "User-Agent": "Tokscale-Desktop" },
  });
  if (!response.ok || !response.body?.getReader) throw new Error(`The download failed (HTTP ${response.status}).`);
  const from = new URL(response.url || REPOSITORY);
  if (from.protocol !== "https:" || !HOST.test(from.hostname)) throw new Error("The download came from an unexpected address.");
  const hash = createHash("sha256");
  let received = 0, matched = false;
  const file = await fs.open(temp, "w");
  try {
    const reader = response.body.getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > size) throw new Error("The download did not match the published file.");
        hash.update(value);
        await file.write(value);
        try { onProgress(received / size); } catch {}
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    matched = received === size && hash.digest("hex") === sha256;
  } finally {
    await file.close();
    if (!matched) await fs.rm(temp, { force: true });
  }
  if (!matched) throw new Error("The download did not match the published file.");
  await fs.rename(temp, target);
  return target;
}

// The build a freshly updated app may remove: another version's portable file
// in its own folder, never anything else a command line could name.
function replacedFile(value, own) {
  if (typeof value !== "string" || typeof own !== "string" || !path.isAbsolute(value)) return null;
  const old = path.normalize(value), mine = path.normalize(own);
  if (!FILE.test(path.basename(old)) || !FILE.test(path.basename(mine))) return null;
  if (path.dirname(old).toLowerCase() !== path.dirname(mine).toLowerCase()) return null;
  if (old.toLowerCase() === mine.toLowerCase()) return null;
  return old;
}

module.exports = { downloadUpdate, replacedFile };
