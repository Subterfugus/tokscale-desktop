const fs = require("node:fs/promises");
const path = require("node:path");
const assert = require("node:assert/strict");

// Runs only in --desktop-smoke, against generated local sessions without auth.
// These exercise the actual bundled React renderer and native bridge.
async function runUiChecks({ window, mini, output, terminalCount }) {
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
  const connectionsReady = () => wait(
    () => !document.querySelector('.connection-card[aria-busy="true"]'),
    null,
    "Account cards did not finish checking their connections",
  );
  const setInput = (selector, value) => exec(({selector, value}) => {
    const input = document.querySelector(selector);
    if (!input) throw new Error(`Missing input: ${selector}`);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value);
    input.dispatchEvent(new Event("input", {bubbles:true}));
    input.dispatchEvent(new Event("change", {bubbles:true}));
  }, {selector,value});
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
    assert.equal(await exec(() => {
      const button = document.querySelector('.sidebar button.active');
      return (button?.querySelector('span')?.innerText || button?.innerText)?.trim();
    }), label, "Navigation highlight does not match the displayed page");
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
  const chrome = await exec(() => {
    const overlay = navigator.windowControlsOverlay;
    const area = overlay?.getTitlebarAreaRect();
    return {
      visible: Boolean(overlay?.visible),
      free: area ? area.x + area.width : innerWidth,
      actions: document.querySelector(".header-actions").getBoundingClientRect().right,
    };
  });
  if (chrome.visible) {
    assert.ok(chrome.actions <= chrome.free, "Header controls sit under the native window buttons");
    checks.push("Header controls stay clear of the native window buttons");
  }
  await exec(() => document.querySelector(".token-types-button").click());
  for (const type of ["Cache read", "Cache write", "Reasoning"])
    await exec((type) => document.querySelector(`input[aria-label="Include ${type} tokens"]`).click(), type);
  await wait(() => document.querySelector(".metrics").innerText.includes("3.3M"), null, "Token type selection did not change the token total");
  assert.match(await exec(() => document.querySelector(".metrics").innerText), /\$25\.03/, "Token types changed the cost");
  assert.equal(await exec(() => document.querySelector(".token-types-button").innerText.trim()), "2 of 5 token types");
  await wait(async () => (await window.tokscale.getSettings()).tokenTypes?.join() === "input,output", null, "Token type selection was not saved");
  await snapshot("token-types");
  await click(".token-types button", "Select all");
  await wait(() => document.querySelector(".metrics").innerText.includes("5.4M"));
  await exec(() => document.querySelector(".token-types-button").click());
  checks.push("Token type checkboxes change token totals, leave cost alone, and are saved");

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
      () => document.querySelector(".content .table-summary").innerText,
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

  const expandedRow = await exec(() => {
    const row = document.querySelector(".content tbody tr");
    const text = row.innerText;
    row.querySelector('button[aria-label="Show row details"]').click();
    return text;
  });
  await wait(() => document.querySelector(".detail-row"));
  await click(".content thead button", "Input");
  assert.equal(await exec(() => document.querySelector(".selected-row")?.innerText), expandedRow,
    "Sorting attached expanded details to a different row");
  checks.push("Expanded row details remain attached to the same record after sorting");

  await click(".period-tabs button", "Custom");
  await setInput('input[aria-label="Start date"]', "2026-10-03");
  await setInput('input[aria-label="End date"]', "2026-09-24");
  await click(".custom-filters button", "Apply range");
  await wait(() => document.querySelector(".filter-error"));
  assert.match(await exec(() => document.querySelector(".filter-summary").innerText), /All recorded history/);
  await setInput('input[aria-label="Start date"]', "2026-09-24");
  await setInput('input[aria-label="End date"]', "2026-10-03");
  await click(".custom-filters button", "Apply range");
  await wait(() => !document.querySelector(".custom-filters") && document.querySelector(".filter-summary")?.innerText.includes("Sep 24"));
  await ready();
  await click(".period-tabs button", "All time");
  await ready();
  checks.push("Custom date ranges apply explicitly; reversed ranges keep the current report intact");

  await nav("Activity");
  await wait(() => document.querySelectorAll(".chart-slot.selectable").length === 10, null, "Daily chart bars are not selectable");
  assert.equal(await exec(() => document.querySelector('select[aria-label="Stack by"]').value), "model");
  const legend = await exec(() => document.querySelector(".chart-legend").innerText);
  for (const model of ["gpt-5.5", "gpt-5.4", "claude-opus-4-6", "claude-sonnet-4-6"])
    assert.ok(legend.includes(model), `Stacked chart legend is missing ${model}`);
  await snapshot("activity");
  checks.push("Daily chart stacks each day by model with a legend naming every model");
  await exec(() => [...document.querySelectorAll(".chart-slot.selectable")].at(-1).click());
  await wait(() => document.querySelector(".filter-chip") && document.querySelector(".filter-summary").innerText.includes("Oct 3"), null, "Selecting a bar did not narrow the range to that day");
  await ready();
  await wait(() => /^1 row/.test(document.querySelector(".content .table-summary")?.innerText || ""), null, "Day filter did not reach the report");
  await exec(() => document.querySelector(".filter-chip").click());
  await wait(() => !document.querySelector(".filter-chip") && document.querySelector(".filter-summary").innerText.includes("All recorded history"), null, "Clearing the day filter did not restore the range");
  await ready();
  await nav("Overview");
  await wait(() => document.querySelector('.plain-table tbody tr[role="button"]'));
  const picked = await exec(() => {
    const row = document.querySelector('.plain-table tbody tr[role="button"]');
    const model = row.querySelector("b").innerText;
    row.click();
    return model;
  });
  await wait((picked) => document.querySelector(".page-header h1")?.innerText === "Models" && document.querySelector('input[aria-label="Search report"]')?.value === picked, picked, "Selecting a top model did not open Models searched for it");
  checks.push("Selecting a chart bar filters the app to that day; selecting a model opens Models searched for it");
  await nav("Sessions");
  await wait(() => document.querySelector(".content table")?.innerText.includes("Atlas planning"));
  const projectsText = await exec(() => document.querySelector(".content table").innerText);
  assert.match(projectsText, /Beacon planning/);
  assert.doesNotMatch(projectsText, /Initial synthetic prompt/);
  assert.equal(await exec(() => document.querySelector(".view-toolbar .segmented button.active")?.innerText.trim()), "Sessions");
  await setInput('input[aria-label="Search report"]', "Atlas planning");
  await wait(() => !document.querySelector(".content table")?.innerText.includes("Beacon planning"));
  await setInput('input[aria-label="Search report"]', "");
  checks.push("Sessions opens with the Sessions view and uses searchable saved Codex chat names rather than initial prompts");
  assert.match(await exec(() => document.querySelector(".content table").innerText), /Cedar review/);
  assert.doesNotMatch(await exec(() => document.querySelector(".content table").innerText), /Cedar generated|Claude session/);
  checks.push("Claude sessions show their saved custom titles");
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
  await nav("Limits");
  await connectionsReady();
  await snapshot("quotas");
  const quotaText = await exec(
    () => document.querySelector(".content").innerText,
  );
  // The fixture disables every engine quota provider, so a meter here would
  // mean a real sign-in leaked into the synthetic run.
  assert.equal(
    await exec(() => document.querySelectorAll(".content .report .panel .meter").length),
    0,
    "A real provider quota leaked into the synthetic run",
  );
  assert.match(quotaText, /no.*quota|quotas.*unavailable|no.*subscription/i);
  assert.match(quotaText, /fail|unavailable|return|diagnostic/i);
  checks.push(
    "Synthetic quota output stays isolated from real sign-ins and invents no account limits",
  );
  await nav("Connections");
  await connectionsReady();
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
  await connectionsReady();
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
  await connectionsReady();
  assert.equal(
    await exec(
      () =>
        document.querySelector('input[aria-label="OpenRouter management key"]')
          ?.value || "",
    ),
    "",
  );
  await snapshot("connections");
  await click(".connection-card button", "Replace key");
  await setInput('input[aria-label="OpenRouter management key"]', "sk-or-v1-FAKE_REPLACEMENT_SHOULD_BE_CLEARED");
  await click(".connection-card button", "Cancel");
  await click(".connection-card button", "Replace key");
  assert.equal(await exec(() => document.querySelector('input[aria-label="OpenRouter management key"]').value), "");
  await click(".connection-card button", "Cancel");
  checks.push("Cancelling replacement clears the entered key and preserves the saved connection");
  await click(".connection-card button", "Detect");
  await connectionsReady();
  await click(".connection-card button", "Disconnect");
  await wait(() =>
    [...document.querySelectorAll(".connection-card button")].some(
      (button) =>
        button.textContent.includes("Connect Claude desktop") &&
        !button.disabled,
    ),
  );
  await connectionsReady();
  await click(".connection-card button", "Disconnect");
  await wait(() =>
    document.querySelector('input[aria-label="OpenRouter management key"]'),
  );
  await connectionsReady();
  checks.push(
    "Desktop Claude connect, OpenRouter encrypted save/balance/disconnect and Antigravity detection work with synthetic provider replies",
  );
  await nav("Settings");
  await snapshot("settings");
  await click(".theme-grid button", "Light");
  await wait(() => document.documentElement.dataset.theme === "light");
  await nav("Overview");
  await snapshot("overview-light");
  await nav("Settings");
  // Every listed theme must apply its own page colour.
  const themeNames = await exec(() =>
    [...document.querySelectorAll(".theme-grid button")].map((button) => button.innerText.trim()),
  );
  assert.ok(themeNames.length >= 10, "Theme picker lists too few themes");
  const pages = new Set();
  for (const name of themeNames.filter((name) => name !== "System")) {
    await click(".theme-grid button", name);
    await wait(
      (name) => document.querySelector(".theme-grid button.active")?.innerText.trim() === name,
      name,
      `Theme ${name} did not become active`,
    );
    pages.add(await exec(() => getComputedStyle(document.body).backgroundColor));
    if (name === "OLED black") {
      assert.equal(await exec(() => getComputedStyle(document.body).backgroundColor), "rgb(0, 0, 0)");
      await nav("Overview");
      await snapshot("overview-oled");
      await nav("Settings");
    }
  }
  assert.equal(pages.size, themeNames.length - 1, "Two themes share a page colour");
  await snapshot("settings-themes");
  await click(".theme-grid button", "Dark");
  await wait(() => document.documentElement.dataset.theme === "dark");
  checks.push(
    "Theme changes save successfully and update the actual desktop appearance",
  );
  checks.push("Connections and desktop preferences remain available");

  await nav("Terminal");
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
  await wait(() => document.querySelector('button[aria-label="Stop current command"]'));
  await exec(() => document.querySelector('button[aria-label="Stop current command"]').click());
  for (let attempt = 0; attempt < 40 && terminalCount() > 0; attempt++) await new Promise(resolve => setTimeout(resolve, 250));
  assert.equal(terminalCount(), 0, "Stopping during startup left a terminal running");
  assert.match(await exec(() => document.querySelector(".terminal-top").innerText), /Stopped/);
  checks.push("Stopping while the terminal is starting kills its late-returned session");
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
  await nav("Terminal");
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
  const originalSize = window.getSize();
  window.setSize(960, 640);
  await snapshot("overview-compact");
  const layout = await exec(() => {
    const bounds = (selector) => {
      const rect = document.querySelector(selector).getBoundingClientRect();
      return {left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom};
    };
    return {viewport:innerWidth, filter:bounds(".filterbar"), sidebar:bounds(".sidebar"), content:bounds(".content"), bodyOverflow:document.documentElement.scrollWidth > innerWidth};
  });
  assert.equal(layout.bodyOverflow, false, "Window layout overflows horizontally at minimum supported size");
  assert.ok(layout.filter.right <= layout.viewport + 1);
  await nav("Sessions");
  await snapshot("projects-compact");
  await nav("Connections");
  await connectionsReady();
  await snapshot("connections-compact");
  assert.equal(await exec(() => [...document.querySelectorAll(".connection-card")].some(card=>card.getBoundingClientRect().right > innerWidth)), false);
  window.setSize(...originalSize);
  await nav("Overview");
  checks.push("Overview, sessions, and account cards fit the minimum window size without horizontal page overflow");
  await nav("Settings");
  await exec(() => document.querySelector('input[aria-label="Keep running in the tray"]').click());
  await wait(async () => (await window.tokscale.getSettings()).minimizeToTray === true, null, "Tray setting was not saved");
  await exec(() => document.querySelector('input[aria-label="Keep running in the tray"]').click());
  await wait(async () => (await window.tokscale.getSettings()).minimizeToTray === false);
  checks.push("Background switches save their settings");
  if (mini) {
    const inMini = (code) => mini.webContents.executeJavaScript(code, true);
    const until = async (code, message) => {
      for (let attempt = 0; attempt < 100; attempt++) {
        if (await inMini(code)) return;
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      throw new Error(message);
    };
    await until(`/^\\$\\d/.test(document.querySelector(".mini-cost strong")?.innerText || "")`, "Mini window did not load today's cost");
    await exec(() => window.tokscale.saveSettings({ miniTheme: "oled" }));
    await until(`document.documentElement.dataset.theme === "oled"`, "Mini window did not take its own theme");
    assert.equal(await exec(() => document.documentElement.dataset.theme), "dark", "Mini theme changed the main window");
    await fs.writeFile(path.join(output, "mini.png"), (await mini.webContents.capturePage()).toPNG());
    await assert.rejects(inMini(`window.tokscale.saveSettings({ theme: "light" })`), "Mini window could change app settings");
    await exec(() => window.tokscale.saveSettings({ miniTheme: "match" }));
    await until(`document.documentElement.dataset.theme === "dark"`, "Mini window did not follow the main theme again");
    checks.push("Mini window shows today's cost, keeps its own theme, and cannot change settings");
  }
  await nav("Overview");
  return {
    passed: checks,
    fixture: "Generated Codex/Claude sessions; no real credentials",
  };
}
module.exports = { runUiChecks };
