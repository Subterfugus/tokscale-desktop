const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const os = require("node:os");
const security = require("./security.cjs");
const { runCommand } = require("./runner.cjs");
test("CLI argv remain literal, Unicode and shell operators preserved", async () => {
  const input = [
    "space words",
    "中文",
    "& echo compromised",
    "%USERPROFILE%",
    'quote"end\\',
  ];
  const result = await runCommand(process.execPath, [
    "-e",
    "process.stdout.write(JSON.stringify(process.argv.slice(1)))",
    ...input,
  ]);
  assert.equal(result.code, 0);
  assert.deepEqual(JSON.parse(result.stdout), input);
});
test("parser failures preserve stderr and nonzero status", async () => {
  const result = await runCommand(process.execPath, [
    "-e",
    'process.stderr.write("synthetic parser failure");process.exit(2)',
  ]);
  assert.equal(result.code, 2);
  assert.equal(result.stderr, "synthetic parser failure");
});
test("missing executable rejects rather than pretending successful output", async () => {
  await assert.rejects(
    runCommand(
      path.join(os.tmpdir(), "tokscale-test-missing-" + Date.now() + ".exe"),
      [],
    ),
    /ENOENT/,
  );
});
test("timed-out commands terminate and release child tracking", async () => {
  const children = new Set();
  await assert.rejects(
    runCommand(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
      timeout: 50,
      register: (child) => children.add(child),
      unregister: (child) => children.delete(child),
    }),
    /timed out/,
  );
  assert.equal(children.size, 0);
});
test("cancelled runs finish with a nonzero status", async () => {
  const result = await runCommand(
    process.execPath,
    ["-e", "setInterval(()=>{},1000)"],
    { register: (child) => setTimeout(() => child.kill(), 50) },
  );
  assert.notEqual(result.code, 0);
});
test("oversized output terminates with actionable error", async () => {
  await assert.rejects(
    runCommand(
      process.execPath,
      [
        "-e",
        'process.stdout.write("a".repeat(100000));setInterval(()=>{},1000)',
      ],
      { maxBytes: 1000 },
    ),
    /Output exceeds/,
  );
});
test("exports use sanitized names and preserve exact content in synthetic folder", async () => {
  const value = security.exportRequest({
    name: "../../synthetic-report.csv",
    content: 'name,value\r\n"Synthetic",42\r\n',
  });
  assert.equal(value.name.includes("/"), false);
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), "tokscale-desktop-export-test-"),
  );
  try {
    await fs.writeFile(path.join(dir, value.name), value.content, "utf8");
    assert.equal(
      await fs.readFile(path.join(dir, value.name), "utf8"),
      value.content,
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
  assert.throws(() => security.exportRequest({ name: "..", content: "" }));
});
test("IPC validates types, NUL, sizes, URLs and absolute home folders", () => {
  assert.throws(() => security.args("not argv"));
  assert.throws(() => security.args(["bad\0arg"]));
  assert.throws(() => security.dimensions(-2, 30));
  assert.throws(() => security.externalUrl("file:///C:/Windows"));
  assert.throws(() => security.externalUrl("javascript:alert(1)"));
  assert.throws(() =>
    security.externalUrl("https://password:secret@example.com"),
  );
  assert.equal(
    security.externalUrl("https://github.com/junhoyeo/tokscale"),
    "https://github.com/junhoyeo/tokscale",
  );
  assert.throws(() => security.settings({ home: "relative" }));
  assert.throws(() => security.settings({ refreshInterval: -1 }));
  assert.deepEqual(
    security.settings({
      theme: "dark",
      futurePreference: 3,
      includeGeminiThoughts: true,
    }),
    { theme: "dark", futurePreference: 3, includeGeminiThoughts: true },
  );
});

test("micro preferences validate boolean mode and finite bubble coordinates", () => {
  assert.deepEqual(security.settings({ miniMicro: true, miniMicroBounds: { x: 10.4, y: -20.7, width: 64 } }), { miniMicro: true, miniMicroBounds: { x: 10, y: -21 } });
  assert.throws(() => security.settings({ miniMicro: "true" }), /Invalid/);
  for (const miniMicroBounds of [null, { x: NaN, y: 0 }, { x: "1", y: 2 }, { x: 1 }])
    assert.throws(() => security.settings({ miniMicroBounds }), /Invalid/);
});
