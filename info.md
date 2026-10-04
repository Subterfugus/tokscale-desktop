# Tokscale Desktop — project handoff

This file gives Claude Code and other contributors the context needed to edit this project. Read `AGENTS.md` for repository instructions and `DESKTOP.md` for the desktop feature and verification guide. This handoff describes the current implementation; verify the source before changing behavior.

## Purpose and current state

This is a fork of [junhoyeo/tokscale](https://github.com/junhoyeo/tokscale), with a native Windows desktop interface added in `packages/desktop`. The fork is [Subterfugus/tokscale-desktop](https://github.com/Subterfugus/tokscale-desktop). The local branch is `desktop-ui`; `origin` points to the fork and `upstream` points to the original project.

The user wants an easy desktop experience while retaining Tokscale's original capabilities. Priorities include connecting Claude desktop, Antigravity, and OpenRouter without complicated setup. Claude desktop is the user's intended Claude connection; do not assume they mean only the standalone Claude Code CLI.

The desktop package is currently version `0.3.0` and pins the published Windows Tokscale engine at `4.17.0`. The application is Electron with a React interface, loads bundled files through `file://`, and does not require a local web server. The original interactive terminal is available through xterm and node-pty. Windows portable builds and optional NSIS installers are supported; current builds are unsigned.

## Where to edit

| File or directory | Responsibility |
| --- | --- |
| `packages/desktop/renderer/main.jsx` | Main interface, navigation, report views, filters, settings, embedded terminal |
| `packages/desktop/renderer/styles.css` | Interface styling and themes |
| `packages/desktop/renderer/connections.jsx` | Claude desktop, Antigravity, and OpenRouter connection cards |
| `packages/desktop/renderer/report-data.js` | Token totals and normalization of public CLI report schemas |
| `packages/desktop/electron/main.cjs` | Electron lifecycle, IPC handlers, preferences, native engine and terminal integration |
| `packages/desktop/electron/preload.cjs` | Limited renderer bridge exposed as `window.tokscale` |
| `packages/desktop/electron/runner.cjs` | Native command execution, cancellation, output limits, and argument handling |
| `packages/desktop/electron/security.cjs` | IPC and external URL validation |
| `packages/desktop/electron/claude-desktop.cjs` | Existing desktop sign-in detection and read-only subscription usage access |
| `packages/desktop/electron/accounts.cjs` | OpenRouter credits endpoint and encrypted key storage |
| `packages/desktop/electron/session-titles.cjs` | Read-only saved Codex names; maps database IDs and rollout filename stems |
| `packages/desktop/electron/provider-cache.cjs` | Short-lived provider response caching and in-flight request coalescing |
| `packages/desktop/electron/preferences.cjs` | Ordered settings patches and backup of unreadable saved preferences |
| `packages/desktop/electron/*.test.cjs` | Runtime and account reader tests |
| `packages/desktop/tests/` | Report contract tests and synthetic usage fixtures |
| `packages/desktop/electron/ui-checks.cjs` | Actual renderer and embedded terminal smoke checks |
| `packages/desktop/scripts/` | Build and smoke scripts |
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

Smoke checks create isolated synthetic usage records, a synthetic Codex title index, and mock account replies. They run the real Electron interface hidden in the background, exercise the native engine and PTY, and print the temporary result folder. They do not prove that a real provider account connection works. Inspect `smoke.json` and generated screenshots when a UI change needs visual verification. Avoid repeated desktop interaction while the user is using the PC; use code-based checks and hidden smoke runs for routine verification.

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

## Interface fixes in version 0.3

Projects opens with session grouping and saved Codex chat names. Read the Codex index's nonblank `name` first, then `title`; blank fields should show an untitled session, never a guessed title from conversation text. The engine's session key is often the rollout **filename stem**, while the index key is the thread UUID. Map `rollout_path` stems as well as IDs. Keep workspace grouping as folder aggregates, which can include several chats.

Custom dates are drafts until **Apply range** passes validation. Report filters show their exact date span. Sorting must retain the same expanded record; numeric timing and computed token columns require numeric accessors. Larger tables paginate. Connection cards preserve the last successful values while refreshing and invalidate stale asynchronous results. Provider requests share in-flight work and cache success briefly; explicit refresh bypasses the cache.

Insights fills calendar gaps and aligns weekdays. The graph's `summary.totalDays` counts recorded dates, so the daily token average uses the inclusive first-to-last recorded calendar span. The embedded terminal guards cancellation during startup, and its smoke checks deliberately delay returning a terminal ID to exercise that race. Ctrl+K opens Command center.
