const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { downloadUpdate, replacedFile } = require("./app-install.cjs");

const body = Buffer.from("portable build ".repeat(2000));
const sha256 = createHash("sha256").update(body).digest("hex");
const response = (content = body, extra = {}) => ({
  ok: true, status: 200,
  url: "https://release-assets.githubusercontent.com/file",
  body: new Blob([content.subarray(0, 9000), content.subarray(9000)]).stream(),
  ...extra,
});
const folder = () => fs.mkdtempSync(path.join(os.tmpdir(), "tokscale-update-"));
const request = (dir, result, extra = {}) => {
  const calls = [], progress = [];
  return {
    calls, progress,
    run: () => downloadUpdate({
      version: "0.4.7", size: body.length, sha256, dir, onProgress: p => progress.push(p),
      fetchImpl: async (...args) => { calls.push(args); return result; }, ...extra,
    }),
  };
};

test("a matching download is saved under the release's file name", async () => {
  const dir = folder(), r = request(dir, response());
  const file = await r.run();
  assert.equal(file, path.join(dir, "Tokscale-Desktop-0.4.7-x64.exe"));
  assert.deepEqual(fs.readFileSync(file), body);
  assert.deepEqual(fs.readdirSync(dir), ["Tokscale-Desktop-0.4.7-x64.exe"]);
  assert.equal(r.calls[0][0], "https://github.com/Subterfugus/tokscale-desktop/releases/download/desktop-v0.4.7/Tokscale-Desktop-0.4.7-x64.exe");
  assert.equal(r.calls[0][1].headers.Authorization, undefined);
  assert.equal(r.progress.at(-1), 1);
  fs.rmSync(dir, { recursive: true });
});

test("a wrong hash, wrong size, failed request or foreign host leaves nothing behind", async () => {
  const dir = folder();
  const tampered = Buffer.from(body); tampered[5] ^= 1;
  for (const [result, extra, message] of [
    [response(tampered), {}, /did not match/],
    [response(body.subarray(0, 100)), {}, /did not match/],
    [response(Buffer.concat([body, body])), {}, /did not match/],
    [response(body, { ok: false, status: 404 }), {}, /HTTP 404/],
    [response(body, { url: "https://example.com/file" }), {}, /unexpected address/],
    [response(body, { url: "http://github.com/file" }), {}, /unexpected address/],
    [response(), { sha256: "0".repeat(64) }, /did not match/],
  ]) await assert.rejects(request(dir, result, extra).run(), message);
  assert.deepEqual(fs.readdirSync(dir), []);
  fs.rmSync(dir, { recursive: true });
});

test("only another version's build in the same folder may be removed", () => {
  const own = "C:\\Users\\me\\Desktop\\Tokscale-Desktop-0.4.7-x64.exe";
  assert.equal(replacedFile("C:\\Users\\me\\Desktop\\Tokscale-Desktop-0.4.6-x64.exe", own), "C:\\Users\\me\\Desktop\\Tokscale-Desktop-0.4.6-x64.exe");
  assert.equal(replacedFile("c:\\users\\me\\desktop\\Tokscale-Desktop-0.4.6-x64.exe", own), "c:\\users\\me\\desktop\\Tokscale-Desktop-0.4.6-x64.exe");
  for (const value of [
    own, undefined, "", "Tokscale-Desktop-0.4.6-x64.exe",
    "C:\\Users\\me\\Documents\\Tokscale-Desktop-0.4.6-x64.exe",
    "C:\\Users\\me\\Desktop\\..\\Documents\\Tokscale-Desktop-0.4.6-x64.exe",
    "C:\\Users\\me\\Desktop\\notes.txt",
    "C:\\Users\\me\\Desktop\\Tokscale-Desktop-0.4.6-x64.exe.bak",
  ]) assert.equal(replacedFile(value, own), null, String(value));
  assert.equal(replacedFile("C:\\Users\\me\\Desktop\\Tokscale-Desktop-0.4.6-x64.exe", "C:\\Users\\me\\Desktop\\electron.exe"), null);
});
