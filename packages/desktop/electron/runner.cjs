const { spawn } = require("node:child_process");
const security = require("./security.cjs");
function runCommand(
  engine,
  input,
  {
    env = process.env,
    timeout = 120000,
    maxBytes = 64 * 1024 * 1024,
    register = () => {},
    unregister = () => {},
  } = {},
) {
  const validated = security.args(input);
  return new Promise((resolve, reject) => {
    const child = spawn(engine, validated, {
      shell: false,
      windowsHide: true,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    register(child);
    const out = [],
      err = [];
    let bytes = 0,
      failure;
    const timer = setTimeout(() => {
      failure = new Error(
        "Tokscale command timed out. Use the interactive terminal for long-running commands.",
      );
      child.kill();
    }, timeout);
    timer.unref();
    function collect(target, data) {
      bytes += data.length;
      if (bytes > maxBytes) {
        failure = new Error(
          "Output exceeds 64 MB. Export from the interactive terminal instead.",
        );
        child.kill();
        return;
      }
      target.push(data);
    }
    child.stdout.on("data", (d) => collect(out, d));
    child.stderr.on("data", (d) => collect(err, d));
    child.once("error", (e) => {
      clearTimeout(timer);
      unregister(child);
      reject(e);
    });
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      unregister(child);
      if (failure) reject(failure);
      else
        resolve({
          stdout: Buffer.concat(out).toString("utf8"),
          stderr: Buffer.concat(err).toString("utf8"),
          code: code ?? (signal ? 130 : 1),
        });
    });
  });
}
module.exports = { runCommand };
