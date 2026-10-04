# Tokscale Desktop — project handoff

This file gives Claude Code and other contributors the context needed to edit this project. Read `AGENTS.md` for repository instructions and `DESKTOP.md` for the desktop feature and verification guide. This handoff describes the current implementation; verify the source before changing behavior.

## Purpose and current state

This is a fork of [junhoyeo/tokscale](https://github.com/junhoyeo/tokscale), with a native Windows desktop interface added in `packages/desktop`. The fork is [Subterfugus/tokscale-desktop](https://github.com/Subterfugus/tokscale-desktop). The local branch is `desktop-ui`; `origin` points to the fork and `upstream` points to the original project.

The user wants an easy desktop experience while retaining Tokscale's original capabilities. Priorities include connecting Claude desktop, Antigravity, and OpenRouter without complicated setup. Claude desktop is the user's intended Claude connection; do not assume they mean only the standalone Claude Code CLI.

The desktop package is currently version `0.4.0` and pins the published Windows Tokscale engine at `4.17.0`. The application is Electron with a React interface, loads bundled files through `file://`, and does not require a local web server. The original interactive terminal is available through xterm and node-pty. Windows portable builds and optional NSIS installers are supported; current builds are unsigned.

## Where to edit

| File or directory | Responsibility |
| --- | --- |
| `packages/desktop/renderer/main.jsx` | App shell: sidebar navigation, header, date and client filters, keyboard shortcuts, refresh timer |
| `packages/desktop/renderer/ui.jsx` | Shared components (buttons, cards, notices, popovers, toasts) and the sortable, paginated data table |
| `packages/desktop/renderer/charts.jsx` | Bar chart (optionally stacked, with legend and tooltip), share bar, meter, and activity heatmap |
| `packages/desktop/renderer/views/reports.jsx` | Overview, Models, Activity, Sessions, and Insights pages |
| `packages/desktop/renderer/views/accounts.jsx` | Limits and Connections pages |
| `packages/desktop/renderer/views/terminal.jsx` | Terminal page: argument line, Commands popover, xterm session handling |
| `packages/desktop/renderer/views/settings.jsx` | Settings page and ordered preference saves |
| `packages/desktop/renderer/connections.jsx` | Claude desktop, Antigravity, and OpenRouter connection cards |
| `packages/desktop/renderer/format.js` | Number, money, date, and message formatting helpers |
| `packages/desktop/renderer/use-report.js` | `window.tokscale` handle and `useReport`, which loads reports, caches them, and shares in-flight requests |
| `packages/desktop/renderer/styles.css` | All styling and first-paint color defaults; chart series colors per light/dark scheme; declares the bundled Source Serif 4 font |
| `packages/desktop/electron/themes.cjs`, `themes-dark.cjs`, `themes-light.cjs` | The theme list (Dark, Light, OLED black and the additional palettes). Shared by the renderer (applied as CSS variables, listed in the Settings picker via `renderer/themes.js`), the main process (native title-bar colors), and settings validation. Every theme must pass the contrast rules in `tests/themes.test.mjs` |
| `packages/desktop/electron/limit-monitor.cjs` | Dependency-free poller: normalizes limit sources, formats tray status lines and tooltip, raises 75% / 90% and reset notifications; 5-minute interval, injectable timers. Tested in `limit-monitor.test.cjs` |
| `packages/desktop/electron/mini-window.cjs` | Mini window creation (300x230, frameless, always on top), saved-position validation against connected displays, hide-on-close. Tested in `mini-window.test.cjs` |
| `packages/desktop/renderer/mini.jsx`, `mini.html`, `mini.css` | Mini window page: today's cost, tokens, messages and Claude limit meters; refreshes every minute while visible. Built as a second bundle by `scripts/build.mjs` |
| `packages/desktop/renderer/themes.js` | Renderer side of the shared theme list: `resolveTheme` and CSS variable names |
| `packages/desktop/tests/themes.test.mjs` | Theme list contract: unique ids, complete colour keys, contrast minimums, chart series visibility per scheme |
| `packages/desktop/renderer/report-data.js` | Token totals and normalization of public CLI report schemas |
| `packages/desktop/electron/main.cjs` | Electron lifecycle, IPC handlers, preferences, native engine and terminal integration; window options (`titleBarStyle: "hidden"` with `titleBarOverlay`, 960x640 minimum) and `nativeTheme.themeSource` |
| `packages/desktop/electron/preload.cjs` | Limited renderer bridge exposed as `window.tokscale` |
| `packages/desktop/electron/runner.cjs` | Native command execution, cancellation, output limits, and argument handling |
| `packages/desktop/electron/security.cjs` | IPC and external URL validation |
| `packages/desktop/electron/claude-desktop.cjs` | Existing desktop sign-in detection and read-only subscription usage access |
| `packages/desktop/electron/accounts.cjs` | OpenRouter credits endpoint and encrypted key storage |
| `packages/desktop/electron/session-titles.cjs` | Read-only saved Codex names (maps database IDs and rollout filename stems) and saved Claude titles from transcript metadata (keyed by transcript filename stem) |
| `packages/desktop/electron/provider-cache.cjs` | Short-lived provider response caching and in-flight request coalescing |
| `packages/desktop/electron/preferences.cjs` | Ordered settings patches and backup of unreadable saved preferences |
| `packages/desktop/electron/*.test.cjs` | Runtime and account reader tests |
| `packages/desktop/tests/` | Report contract tests and synthetic usage fixtures |
| `packages/desktop/electron/ui-checks.cjs` | Actual renderer and embedded terminal smoke checks |
| `packages/desktop/scripts/` | Build and smoke scripts; `build.mjs` also emits the bundled `.woff2` font into `dist-renderer` |
| `crates/tokscale-core/src/sessions/claudecode.rs` | Upstream Claude transcript parser and response deduplication |
| `crates/tokscale-core/src/scanner.rs` | Upstream source discovery |
| `crates/tokscale-cli/src/main.rs` | Upstream CLI flags and date filter construction |

Prefer keeping desktop changes in `packages/desktop`. Editing upstream Rust source does **not** change the bundled published engine automatically. An engine change needs a separate rebuild and packaging decision.

## Develop, verify, and package

Run these commands from the repository root in PowerShell:

```powershell
cd packages/desktop
npm install --workspaces=false
npm run build
npm start
```

After editing renderer source, build again; `npm start` loads the compiled renderer. `npm run dev` builds and starts the app but is not a live-reloading development server.

For changes that affect runtime behavior, reports, or connections:

```powershell
npm test
npm run smoke
```

Smoke checks create isolated synthetic usage records, a synthetic Codex title index, and mock account replies. They run the real Electron interface hidden in the background, exercise the native engine and PTY, and print the temporary result folder. They do not prove that a real provider account connection works. The fixture writes `usage.disabledProviders` (every engine usage provider id, listed in `USAGE_PROVIDERS` in `tests/fixture.mjs`) into its Tokscale `settings.json`, because some providers read sign-ins from the Windows Credential Manager, which a fixture home cannot redirect. The Limits check is strict and fails if a quota meter appears. Inspect `smoke.json` and generated screenshots when a UI change needs visual verification. Avoid repeated desktop interaction while the user is using the PC; use code-based checks and hidden smoke runs for routine verification.

To package:

```powershell
npm run package
# Optional installer instead of the portable build:
npm run package:installer
```

Artifacts are generated in `packages/desktop/release`. Updating the source does not update an already-running portable executable: rebuild, package, and launch the new artifact when delivering app changes.

Standalone engine invocation from `packages/desktop`:

```powershell
& '.\node_modules\@tokscale\cli-win32-x64-msvc\bin\tokscale.exe' --no-spinner models --json --client claude --week
```

Always place `--no-spinner` **before** the subcommand in automated invocations. Preserve direct argument-array execution; do not interpolate user arguments into shell command strings.

## Connection behavior and boundaries

- **Claude desktop:** detects direct-download and Microsoft Store profiles, reads the existing OAuth cache, decrypts it in memory using Windows DPAPI and AES-GCM, and queries the subscription usage endpoint. It also reads `plan-usage-history.json` for saved utilization snapshots. The app does not refresh or modify Claude's sign-in files. Disconnect disables this app's automatic requests without signing the user out of Claude.
- **Claude token reports:** remain based on transcripts discovered by the original engine. Connecting the account adds quota information; it does not import every cloud chat or supply a complete account-wide historical token total. Chat history can contain useful usage metadata, so verify actual storage and schemas rather than declaring desktop token tracking impossible.
- **Antigravity:** Detect and Sync use the original engine's status and sync commands and its local service. The user signs in through Antigravity itself.
- **OpenRouter:** the user wants account credits and spending. This fork reads `GET /api/v1/credits` using a management key, verifies it before storing it, and encrypts the saved key with Electron safeStorage. An ordinary inference key is insufficient for this endpoint. No real OpenRouter account key was supplied during development; its behavior was tested with synthetic replies.

Keep credentials out of renderer state, logs, screenshots, fixtures, exports, and Git. Preserve fixed provider endpoints, bounded requests, actionable errors, and the Claude rate-limit cooldown. Desktop authentication storage and subscription endpoint schemas can change; avoid treating them as guaranteed public contracts.

## Token accounting: important investigation

A local investigation on October 4, 2026 reproduced the installed Claude desktop Code usage chart's total exactly by summing every assistant usage entry in the transcript files. Deduplicating the same entries by response identity produced the engine's smaller total exactly. This demonstrated duplicate counting in that chart for the inspected data, rather than omitted cache tokens in Tokscale.

Claude transcripts can contain multiple records for one streamed response, including thinking, text, and tool-use blocks. These entries can repeat the response's usage. The upstream parser keys responses by `message.id` plus `requestId` (with fallbacks), and merges duplicate usage using the maximum for each token field. Do not remove this deduplication to make totals match an inflated chart.

There is a [matching upstream bug report](https://github.com/anthropics/claude-code/issues/97258). It is a reported issue, not an official acknowledgment of every affected version. The local investigation establishes the chart discrepancy; it does not establish inflated billing or subscription limits.

For public model reports, include all five normalized buckets: `input`, `output`, `cacheRead`, `cacheWrite`, and `reasoning`. Model reports have no top-level `totalReasoning`, so derive reasoning from the entries. Cache reads on **distinct requests** legitimately count even when they reuse the same context; duplicate transcript records for **one request** must be merged.

The default interface period is Month, meaning the current calendar month. Week means today plus the previous six calendar dates. Match client filters, source coverage, and dates before comparing trackers. Hourly JSON omits reasoning and is labeled accordingly. The graph's `summary.averagePerDay` represents USD per day, not tokens per day.

## Interface in version 0.4

Version 0.4 redesigned the renderer. Pages are grouped in the sidebar as Reports (Overview, Models, Activity, Sessions, Insights), Accounts (Limits, Connections), and Tools (Terminal), with Settings below. Old names: Subscription quotas is now Limits, Projects & sessions is Sessions, Integrations is Connections, Command center is Terminal. The internal page ids (`usage`, `projects`, `integrations`, `commands`) were kept. The window uses the native Windows title-bar buttons, and `nativeTheme.themeSource` follows the Appearance setting (light, dark, or system). There is one header row and one filter row; the custom title bar, breadcrumb, footer bar, and filter summary bar were removed. Titles and headline figures use Source Serif 4, bundled from the `@fontsource-variable/source-serif-4` dev dependency (OFL); other text uses Segoe UI. The minimum window size is 960x640.

Shortcuts: Ctrl+K opens Terminal, Ctrl+R refreshes (report, Limits, and Connections pages only), Ctrl+, opens Settings, and Ctrl+1 to Ctrl+8 open the pages in sidebar order (Overview through Terminal). Export outcomes are shown as toasts rather than `alert()` dialogs; connection cards, settings, and report errors still use inline notices.

Sessions has a Sessions / Workspaces toggle. The six-way grouping select is only on Models. Sessions opens with session grouping and saved Codex chat names. Read the Codex index's nonblank `name` first, then `title`; blank fields should show an untitled session, never a guessed title from conversation text. The engine's session key is often the rollout **filename stem**, while the index key is the thread UUID. Map `rollout_path` stems as well as IDs. Workspaces remain folder aggregates, which can include several chats.

Terminal fills the page and stays mounted while hidden so a running TUI survives navigation. Its Commands popover is parsed from the engine's own `--help`, with a short fallback list until that returns. Limits shows the Claude desktop and OpenRouter cards above the engine's `usage --json` results; Connections shows all three connection cards and the local client list.

Custom dates are drafts until **Apply range** passes validation. The filter row shows the exact date span. Sorting must retain the same expanded record; numeric timing and computed token columns require numeric accessors (`sortValue`). Larger tables paginate (50 rows per page). Connection cards preserve the last successful values while refreshing and invalidate stale asynchronous results. `useReport` shares in-flight requests per argument set and keeps a small cache keyed by the refresh epoch, so an explicit refresh bypasses it; the main process separately caches provider responses briefly.

Constraints to preserve in the later additions:

- **Mini window IPC:** `handle()` in `main.cjs` accepts a call from the mini window only when the channel is in `MINI_API` (`getSettings`, `run`, `connectionStatus`, `claudeDesktopRefresh`, `miniControl`) and the sender frame URL is the mini page. Every other channel stays main-window only. Add a channel to the list only when the mini window truly needs it. The mini window shares the main preload, runs sandboxed with context isolation, and denies navigation and new windows.
- **Theme list:** `electron/themes.cjs` (with `themes-dark.cjs` and `themes-light.cjs`) is the single source for the renderer (CSS variables and the Settings picker via `renderer/themes.js`), the main process (title-bar colours, `nativeTheme.themeSource`) and settings validation in `security.cjs` (`theme` and `miniTheme`). `system` and `match` (mini only) are not themes and must not be added as ids. A new theme needs every colour key and must pass `tests/themes.test.mjs`; chart series colours are declared per scheme in `styles.css` and are checked there against each theme's card colour.
- **Stacked charts:** colour follows the entity. `stackModel` in `charts.jsx` ranks keys by chart-wide total, gives the six largest a series slot and folds the rest into Other, so a model, provider or client keeps its colour on every bar. Only daily reports carry the per-row breakdown, so hourly and monthly charts do not stack. Legend entries set the client filter only when stacked by client; the engine can filter by client and date only, so model and provider selections open Models with a search instead.
- **Day filter:** `focusDay` in `main.jsx` saves the prior date range once and sets a one-day custom range; the `.filter-chip` restores it.
- **Session titles:** titles come only from saved metadata (Codex index `name` then `title`; Claude transcript `custom-title`, then `ai-title`, then `summary` lines). Never derive a title from message text. Claude rows are keyed by transcript filename stem, which is the engine's `sessionId`. Reads are bounded (file count, size, line length) and read-only.
- **Tray and background:** `limitSources` merges the Claude desktop reading with `usage --json` (skipping the engine's Claude rows when Claude desktop is connected). `limit-monitor.cjs` remembers the highest announced threshold per limit so a notification fires once per crossing, and announces a reset when usage falls back below 75%. `applyLoginItem` runs only for packaged, non-smoke runs and registers `PORTABLE_EXECUTABLE_FILE` when present, with `--hidden`. A hidden start shows the window if no tray icon could be created.
- **Smoke isolation:** keep `usage.disabledProviders` in the fixture complete when the engine adds a usage provider; otherwise a real sign-in can leak into the Limits check.

Insights fills calendar gaps and aligns weekdays. The graph's `summary.totalDays` counts recorded dates, so the daily token average uses the inclusive first-to-last recorded calendar span. The embedded terminal guards cancellation during startup, and its smoke checks deliberately delay returning a terminal ID to exercise that race.

## Pending work (requested by the user on October 4, 2026; not started)

1. **Mini window: make it easy to move.** Only the thin `.mini-bar` strip at the top is a drag region today (`renderer/mini.css`, `-webkit-app-region: drag`). The whole window should be draggable, with only the buttons and any interactive controls marked `no-drag`.
2. **Mini window: make it resizable.** `electron/mini-window.cjs` creates it at a fixed 300x230 with `resizable: false`. Allow resizing with a sensible minimum size, save width and height alongside the position (`miniBounds` currently holds only `x` and `y`; `isOnScreen` and `resolvePosition` assume the fixed size and their tests in `mini-window.test.cjs` must follow), and make the layout in `renderer/mini.jsx` and `mini.css` adapt instead of assuming a fixed height.
3. **Mini window only shows Claude.** The user reported this. Cause of the limits part: `loadLimits()` in `renderer/mini.jsx` only calls `claudeDesktopRefresh`, and it renders at most two meters (`limits.slice(0, 2)`). The tray already has every provider through `limitSources()` and the limit monitor in `electron/main.cjs`. Likely fix: add one read-only channel to `MINI_API` that returns the monitor's latest snapshot (which already leaves Copilot out), and render all of those sources, which also needs the resizable layout from item 2. Before fixing, confirm with the user whether "only Claude" also refers to the cost and token figures: those come from `models --json --today` with no client filter, so they should cover every client; verify that against real data rather than assuming.

State at the time of this note: all desktop work from October 4 (UI overhaul, themes, tray limit warnings, click-through filtering, stacked charts, mini window, launch at login, Claude session titles, token-type checkboxes, Copilot hidden from Limits and the tray) is uncommitted on the `desktop-ui` branch. The user runs the portable build copied to their Desktop (`Tokscale-Desktop-0.4.0-x64.exe`); after a change, rebuild with `npm run package`, stop the running app, replace that file and relaunch it.
