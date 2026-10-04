const fs = require("node:fs/promises");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { createDecipheriv } = require("node:crypto");

async function desktopRoots(env = process.env) {
  const roots = [
    path.join(env.APPDATA || "", "Claude"),
    path.join(env.LOCALAPPDATA || "", "Claude"),
  ];
  try {
    const packages = path.join(env.LOCALAPPDATA, "Packages");
    for (const item of await fs.readdir(packages, { withFileTypes: true }))
      if (item.isDirectory() && item.name.startsWith("Claude_"))
        roots.push(path.join(packages, item.name, "LocalCache/Roaming/Claude"));
  } catch {}
  return roots.filter((root) => path.isAbsolute(root));
}
async function readJson(file) {
  if ((await fs.stat(file)).size > 4 * 1024 * 1024)
    throw new Error("Desktop data is too large to read.");
  return JSON.parse(await fs.readFile(file, "utf8"));
}
function history(data, organization) {
  return (Array.isArray(data?.samples) ? data.samples : [])
    .filter(
      (sample) =>
        (!organization || sample.org === organization) &&
        Number.isFinite(sample.t),
    )
    .map((sample) => ({
      timestamp: sample.t,
      fiveHour: Number.isFinite(sample.u?.fh) ? sample.u.fh : null,
      sevenDay: Number.isFinite(sample.u?.sd) ? sample.u.sd : null,
    }))
    .filter((sample) => sample.fiveHour != null || sample.sevenDay != null)
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-1000);
}
function selectToken(cache, account, now = Date.now()) {
  const candidates = Object.entries(cache)
    .filter(
      ([key, value]) =>
        key.startsWith("acct:" + account + "|") &&
        key.includes("user:profile") &&
        typeof value?.token === "string" &&
        value.expiresAt > now,
    )
    .sort((a, b) => b[1].expiresAt - a[1].expiresAt);
  if (!candidates.length)
    throw new Error(
      "Claude desktop sign-in has expired. Open Claude and sign in again.",
    );
  return candidates[0][1].token;
}
function decryptCache(encoded, key) {
  const blob = Buffer.from(encoded, "base64");
  if (
    key.length !== 32 ||
    blob.length < 31 ||
    blob.subarray(0, 3).toString() !== "v10"
  )
    throw new Error("Claude desktop encryption format is unsupported.");
  const decipher = createDecipheriv("aes-256-gcm", key, blob.subarray(3, 15));
  decipher.setAuthTag(blob.subarray(-16));
  const plain = Buffer.concat([
    decipher.update(blob.subarray(15, -16)),
    decipher.final(),
  ]);
  try {
    return JSON.parse(plain.toString("utf8"));
  } finally {
    plain.fill(0);
  }
}
function unprotect(blob, env = process.env) {
  // DPAPI is scoped to the current Windows user. Sensitive output stays in memory.
  const script =
    "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $p=[Security.Cryptography.ProtectedData]::Unprotect($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($p)); [Array]::Clear($p,0,$p.Length)";
  return new Promise((resolve, reject) => {
    const child = spawn(
      path.join(
        env.SystemRoot || "C:\\Windows",
        "System32/WindowsPowerShell/v1.0/powershell.exe",
      ),
      [
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(script, "utf16le").toString("base64"),
      ],
      { windowsHide: true, shell: false, stdio: ["pipe", "pipe", "ignore"] },
    );
    let output = "",
      settled = false;
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error("Windows could not unlock the Claude desktop sign-in."));
    }, 10000);
    function finish(error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(Buffer.from(output, "base64"));
      output = "";
    }
    child.stdout.on("data", (data) => {
      output += data.toString();
      if (output.length > 8192) {
        child.kill();
        finish(new Error("Unexpected Windows credential response."));
      }
    });
    child.stdin.on("error", () => {});
    child.once("error", () =>
      finish(new Error("Windows could not unlock the Claude desktop sign-in.")),
    );
    child.once("close", (code) =>
      finish(
        code === 0
          ? null
          : new Error("Windows could not unlock the Claude desktop sign-in."),
      ),
    );
    child.stdin.end(blob.toString("base64"));
  });
}
function usage(data) {
  const labels = {
    five_hour: "5-hour usage",
    seven_day: "Weekly usage",
    seven_day_opus: "Weekly Opus",
    seven_day_sonnet: "Weekly Sonnet",
    seven_day_fable: "Weekly Fable",
  };
  const metrics = Object.entries(data || {})
    .filter(([, value]) => value && Number.isFinite(value.utilization))
    .map(([key, value]) => ({
      label: labels[key] || key.replaceAll("_", " "),
      used_percent: value.utilization,
      resets_at: typeof value.resets_at === "string" ? value.resets_at : null,
    }));
  const extra = data?.extra_usage;
  const spend =
    extra &&
    Number.isFinite(extra.used_credits) &&
    Number.isFinite(extra.monthly_limit)
      ? { spent: extra.used_credits / 100, limit: extra.monthly_limit / 100 }
      : null;
  if (!metrics.length && !spend)
    throw new Error("Claude returned no quota windows for this account.");
  return { metrics, spend };
}
function createClaudeDesktop({
  env = process.env,
  fetchImpl = fetch,
  unlock = unprotect,
}) {
  let retryAt = 0;
  async function find() {
    for (const root of await desktopRoots(env)) {
      try {
        const config = await readJson(path.join(root, "config.json"));
        if (config["oauth:tokenCacheV2"] && config.lastKnownAccountUuid)
          return { root, config };
      } catch {}
    }
    return null;
  }
  async function status() {
    const desktop = await find();
    if (!desktop) return { detected: false, samples: [] };
    let samples = [];
    try {
      const ledger = await readJson(
        path.join(desktop.root, "plan-usage-history.json"),
      );
      const latest = Array.isArray(ledger.samples)
        ? [...ledger.samples].sort((a, b) => b.t - a.t)[0]
        : null;
      samples = history(ledger, latest?.org);
    } catch {}
    return { detected: true, samples };
  }
  return {
    status,
    async refresh() {
      if (Date.now() < retryAt)
        throw new Error(
          "Claude is rate limiting requests. Retry after " +
            new Date(retryAt).toLocaleTimeString() +
            ".",
        );
      const desktop = await find();
      if (!desktop)
        throw new Error(
          "Claude desktop sign-in was not found. Open Claude, sign in, then connect again.",
        );
      let token;
      try {
        const state = await readJson(path.join(desktop.root, "Local State"));
        const protectedKey = Buffer.from(
          state.os_crypt?.encrypted_key || "",
          "base64",
        );
        if (protectedKey.subarray(0, 5).toString() !== "DPAPI")
          throw new Error("Unsupported key");
        const key = await unlock(protectedKey.subarray(5), env);
        try {
          token = selectToken(
            decryptCache(desktop.config["oauth:tokenCacheV2"], key),
            desktop.config.lastKnownAccountUuid,
          );
        } finally {
          key.fill(0);
        }
      } catch {
        throw new Error(
          "Claude desktop sign-in could not be read. Open Claude and sign in again; its storage format may have changed.",
        );
      }
      let response;
      try {
        response = await fetchImpl(
          "https://api.anthropic.com/api/oauth/usage",
          {
            method: "GET",
            headers: {
              Authorization: "Bearer " + token,
              "anthropic-beta": "oauth-2025-04-20",
            },
            redirect: "error",
            signal: AbortSignal.timeout(20000),
          },
        );
      } catch {
        throw new Error(
          "Claude could not be reached. Try again when you are online.",
        );
      } finally {
        token = null;
      }
      if (response.status === 429) {
        retryAt =
          Date.now() +
          Math.min(
            3600,
            Math.max(60, Number(response.headers?.get("retry-after")) || 300),
          ) *
            1000;
        throw new Error(
          "Claude is rate limiting requests. Try again in a few minutes.",
        );
      }
      if (response.status === 401 || response.status === 403)
        throw new Error(
          "Claude rejected the desktop sign-in. Open Claude and sign in again.",
        );
      if (!response.ok)
        throw new Error(
          "Claude usage is currently unavailable. Try again later.",
        );
      let result;
      try {
        result = usage(await response.json());
      } catch {
        throw new Error(
          "Claude returned no readable quota data. Its usage format may have changed.",
        );
      }
      const local = await status();
      return {
        ...local,
        ...result,
        source: "Claude desktop login",
        checkedAt: new Date().toISOString(),
      };
    },
  };
}
module.exports = {
  history,
  selectToken,
  decryptCache,
  usage,
  desktopRoots,
  createClaudeDesktop,
};
