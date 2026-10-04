import { spawn } from "node:child_process";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createFixture } from "../tests/fixture.mjs";
const root = fileURLToPath(new URL("..", import.meta.url));
const output = process.argv[2]
  ? path.resolve(process.argv[2])
  : await mkdtemp(path.join(os.tmpdir(), "tokscale-desktop-smoke-"));
const home = process.argv[3]
  ? path.resolve(process.argv[3])
  : await mkdtemp(path.join(os.tmpdir(), "tokscale-desktop-synthetic-home-"));
if (!process.argv[3]) await createFixture(home);
await mkdir(output, { recursive: true });
const exe = process.argv[4]
  ? path.resolve(process.argv[4])
  : path.join(root, "node_modules/electron/dist/electron.exe");
const args = process.argv[4] ? [] : [root];
const smokeId = randomUUID();
const code = await new Promise((resolve, reject) => {
  const child = spawn(
    exe,
    [
      ...args,
      "--desktop-smoke",
      "--smoke-home=" + home,
      "--smoke-output=" + output,
      "--smoke-id=" + smokeId,
    ],
    { shell: false, windowsHide: true, stdio: "inherit" },
  );
  const timer = setTimeout(() => {
    child.kill();
    reject(new Error("Desktop smoke timed out"));
  }, 180000);
  child.once("error", (error) => {
    clearTimeout(timer);
    reject(error);
  });
  child.once("exit", (code) => {
    clearTimeout(timer);
    resolve(code);
  });
});
if (code !== 0) throw new Error("Desktop smoke failed; see " + output);
const result = JSON.parse(
  await readFile(path.join(output, "smoke.json"), "utf8"),
);
if (result.smokeId !== smokeId)
  throw new Error("Smoke report did not come from the launched process");
console.log(
  JSON.stringify(
    {
      version: result.version.stdout.trim(),
      terminal: result.terminal.code,
      tui: result.tui,
      uiChecks: result.uiChecks,
      security: result.blockedUrl && result.requireType === "undefined",
      screenshot: path.join(output, "desktop.png"),
    },
    null,
    2,
  ),
);
