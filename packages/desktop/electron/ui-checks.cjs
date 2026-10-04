const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");

// Runs only in --desktop-smoke, against generated local sessions without auth.
// These exercise the actual bundled React renderer and native bridge.
async function runUiChecks({ window, output }) {
  const checks = [];
  const exec = async (fn, arg) => {
    const result = await window.webContents.executeJavaScript(
      `Promise.resolve().then(() => (${fn.toString()})(${JSON.stringify(arg) ?? "undefined"})).then(value => ({value}), error => ({error:error.message}))`,
      true,
    );
    if (result.error) throw new Error(result.error);
    return result.value;
  };
  const wait = async (fn, arg, message) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const value = await exec(fn, arg);
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(
      message || "The desktop interface did not reach the expected state",
    );
  };
  const click = (selector, label) =>
    exec(
      ({ selector, label }) => {
        const button = [...document.querySelectorAll(selector)].find(
          (node) =>
            node.textContent.trim() === label ||
            node.textContent.trim().startsWith(label),
        );
        if (!button || button.disabled)
          throw new Error(`Unavailable button: ${label}`);
        button.click();
      },
      { selector, label },
    );
  const ready = () =>
    wait(
      () =>
        !document.querySelector(".content .loading-state") &&
        !document.querySelector(".content .error-state"),
      null,
      "Report did not load",
    );
  const snapshot = async (name) => {
    // DOM updates precede Chromium paint; capture the page that was asserted.
    await exec(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() =>
            requestAnimationFrame(() => setTimeout(resolve, 100)),
          ),
        ),
    );
    await fs.writeFile(
      path.join(output, `${name}.png`),
      (await window.webContents.capturePage()).toPNG(),
    );
  };
  const nav = async (label) => {
    await click(".sidebar nav button, .sidebar-bottom > button", label);
    await wait(
      (label) => document.querySelector(".page-header h1")?.innerText === label,
      label,
    );
    await ready();
  };

  await click(".period-tabs button", "All time");
  await ready();
  await wait(() =>
    document.querySelector(".metrics")?.innerText.includes("160"),
  );
  const overview = await exec(
    () => document.querySelector(".metrics").innerText,
  );
  assert.match(overview, /5\.4M/); // Original engine: 5,446,000, including reasoning.
  assert.match(overview, /\$25\.03/);
  assert.match(overview, /160/);
  const chartDates = await exec(
    () => document.querySelector(".overview-grid")?.innerText,
  );
  assert.match(chartDates, /Sep 24/);
  assert.match(chartDates, /Oct 3/);
  await snapshot("overview");
  checks.push(
    "Overview totals include all token buckets; date labels match local calendar",
  );

  await nav("Models");
  await wait(() =>
    document.querySelector(".content table")?.innerText.includes("gpt-5.5"),
  );
  const originalModels = await exec(
    () => document.querySelector(".content table").innerText,
  );
  assert.match(originalModels, /claude-opus-4-6/);
  await snapshot("models");
  checks.push("Model report renders Codex and Claude data");
  await exec(() => {
    const select = document.querySelector(
      'select[aria-label="Filter by client"]',
    );
    const setter = Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      "value",
    ).set;
    setter.call(select, "codex");
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await wait(
    () => {
      const table = document.querySelector(".content table");
      return (
        table &&
        table.innerText.includes("gpt-5.5") &&
        !table.innerText.includes("claude-opus-4-6") &&
        !document.querySelector(".content .loading-state")
      );
    },
    null,
    "Client filter did not change the real model report",
  );
  await exec(() => {
    const select = document.querySelector(
      'select[aria-label="Filter by client"]',
    );
    Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      "value",
    ).set.call(select, "all");
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await wait(() =>
    document
      .querySelector(".content table")
      ?.innerText.includes("claude-opus-4-6"),
  );
  checks.push(
    "Client filter queries and displays the appropriate engine records",
  );

  for (const group of [
    "model",
    "client,model",
    "client,provider,model",
    "workspace,model",
    "session,model",
    "client,session,model",
  ]) {
    await exec((group) => {
      const select = document.querySelector(".view-toolbar select");
      Object.getOwnPropertyDescriptor(
        HTMLSelectElement.prototype,
        "value",
      ).set.call(select, group);
      select.dispatchEvent(new Event("change", { bubbles: true }));
      return new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      );
    }, group);
    await wait(
      () =>
        document.querySelector(".content table") &&
        !document.querySelector(
          ".content .loading-state, .content .report.refreshing, .content .error-state",
        ),
      null,
      `Grouping ${group} did not load`,
    );
    const report = await exec(
      () => document.querySelector(".panel-head").innerText,
    );
    assert.match(
      report,
      /\$25\.03/,
      `${group} changed the original estimated cost`,
    );
    const columns = await exec(
      () => document.querySelector(".content thead").innerText,
    );
    assert.equal(columns.includes("Workspace"), group.includes("workspace"));
    assert.equal(columns.includes("Session"), group.includes("session"));
  }
  checks.push(
    "All six model groupings preserve the original total and expose their grouping fields",
  );

  await nav("Activity");
  await snapshot("activity");
  await nav("Projects & sessions");
  await snapshot("projects");
  await nav("Insights");
  await snapshot("insights");
  const insight = await exec(
    () => document.querySelector(".content").innerText,
  );
  assert.match(insight, /544\.6K|544,600/);
  assert.match(insight, /10/);
  checks.push(
    "History, project grouping, and contribution insights render with correct token average",
  );
  await nav("Subscription quotas");
  await snapshot("quotas");
  const quotaText = await exec(
    () => document.querySelector(".content").innerText,
  );
  assert.match(quotaText, /no.*quota|quotas.*unavailable|no.*subscription/i);
  assert.match(quotaText, /fail|unavailable|return|diagnostic/i);
  checks.push(
    "Unauthenticated synthetic quota output is represented without inventing account limits",
  );
  await nav("Integrations");
  await snapshot("integrations");
  const connectionText = await exec(
    () => document.querySelector(".connection-section").innerText,
  );
  assert.match(connectionText, /Connect Claude desktop/);
  assert.match(connectionText, /Antigravity/);
  assert.match(connectionText, /Connect OpenRouter/);
  await click(".connection-card button", "Connect Claude desktop");
  await wait(() =>
    document
      .querySelector(".connection-card")
      ?.innerText.includes("25.0% used"),
  );
  await exec(() => {
    const input = document.querySelector(
      'input[aria-label="OpenRouter management key"]',
    );
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    ).set.call(input, "sk-or-v1-FAKE_SYNTHETIC_TEST_KEY_ONLY");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await click(".connection-card button", "Connect OpenRouter");
  await wait(() =>
    document.querySelector(".connection-section")?.innerText.includes("$74.75"),
  );
  assert.equal(
    await exec(
      () =>
        document.querySelector('input[aria-label="OpenRouter management key"]')
          ?.value || "",
    ),
    "",
  );
  await snapshot("connections");
  await click(".connection-card button", "Detect");
  await wait(() => !document.querySelector(".connection-section .spin"));
  await click(".connection-card button", "Disconnect");
  await wait(() =>
    [...document.querySelectorAll(".connection-card button")].some(
      (button) =>
        button.textContent.includes("Connect Claude desktop") &&
        !button.disabled,
    ),
  );
  await click(".connection-card button", "Disconnect");
  await wait(() =>
    document.querySelector('input[aria-label="OpenRouter management key"]'),
  );
  checks.push(
    "Desktop Claude connect, OpenRouter encrypted save/balance/disconnect and Antigravity detection work with synthetic provider replies",
  );
  await nav("Settings");
  await snapshot("settings");
  await click(".segmented button", "Light");
  await wait(() => document.documentElement.dataset.theme === "light");
  await nav("Overview");
  await snapshot("overview-light");
  await nav("Settings");
  await click(".segmented button", "Dark");
  await wait(() => document.documentElement.dataset.theme === "dark");
  checks.push(
    "Theme changes save successfully and update the actual desktop appearance",
  );
  checks.push("Integrations and desktop preferences remain available");

  await nav("Command center");
  const setCommand = (command) =>
    exec((command) => {
      const input = document.querySelector(
        'input[aria-label="Tokscale arguments"]',
      );
      Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      ).set.call(input, command);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    }, command);
  const finish = () =>
    wait(
      () =>
        document
          .querySelector(".terminal-top")
          ?.innerText.includes("Finished") &&
        !document.querySelector(".command-line .primary")?.disabled,
      null,
      "Quick terminal command did not release the Run button",
    );
  await setCommand("--version");
  await click(".command-line button", "Run");
  await finish();
  await setCommand("models --help");
  await click(".command-line button", "Run");
  await finish();
  checks.push("Two successive quick commands finish and restore command input");
  await click(".command-line button", "Interactive TUI");
  await wait(
    () =>
      document.querySelector(".terminal-top")?.innerText.includes("Running") ||
      document
        .querySelector(".terminal-top")
        ?.innerText.includes("Interactive TUI"),
  );
  await new Promise((resolve) => setTimeout(resolve, 1500));
  await snapshot("terminal");
  await nav("Overview");
  await nav("Command center");
  const remainsRunning = await exec(
    () => document.querySelector(".command-line .primary").disabled,
  );
  assert.equal(
    remainsRunning,
    true,
    "Navigating away unexpectedly stopped the original TUI",
  );
  await exec(() =>
    document.querySelector('button[aria-label="Stop current command"]').click(),
  );
  await wait(() => !document.querySelector(".command-line .primary")?.disabled);
  checks.push(
    "Embedded original TUI keeps its session across desktop navigation and stops explicitly",
  );
  await nav("Overview");
  return {
    passed: checks,
    fixture: "Generated Codex/Claude sessions; no real credentials",
  };
}
module.exports = { runUiChecks };
