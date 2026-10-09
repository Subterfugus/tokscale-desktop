# Tokscale Desktop — project handoff

This file gives Claude Code and other contributors the context needed to edit this project. Read `AGENTS.md` for repository instructions and `DESKTOP.md` for the desktop feature and verification guide. This handoff describes the current implementation; verify the source before changing behavior.

## Purpose and current state

This is a fork of [junhoyeo/tokscale](https://github.com/junhoyeo/tokscale), with a native Windows desktop interface added in `packages/desktop`. The fork is [Subterfugus/tokscale-desktop](https://github.com/Subterfugus/tokscale-desktop). The local branch is `desktop-ui`; `origin` points to the fork and `upstream` points to the original project.

The user wants an easy desktop experience while retaining Tokscale's original capabilities. Priorities include connecting Claude desktop, Antigravity, and OpenRouter without complicated setup. Claude desktop is the user's intended Claude connection; do not assume they mean only the standalone Claude Code CLI.

The desktop package is currently version `0.4.11` (0.4.9 was a throwaway updater test release cut from the `desktop-updater-test` branch, so real versions continue from 0.4.10) and pins the published Windows Tokscale engine at `4.17.0`. The application is Electron with a React interface, loads bundled files through `file://`, and does not require a local web server. The original interactive terminal is available through xterm and node-pty. Windows portable builds and optional NSIS installers are supported; current builds are unsigned.

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
| `packages/desktop/electron/limit-monitor.cjs` | Dependency-free poller: normalizes limit sources, formats tray status lines and tooltip, raises 75% / 90% and reset notifications; 5-minute interval, injectable timers. Attaches `pace` to each source in its snapshot. Tested in `limit-monitor.test.cjs` |
| `packages/desktop/electron/limit-pace.cjs` | Pure weekly pace calculation: active-time weighting, projection, daily budget, run-out time. Tested in `limit-pace.test.cjs` |
| `packages/desktop/electron/mini-window.cjs` | Resizable mini window (default 300x230, minimum 280x230, frameless, always on top), saved full bounds with legacy position migration and recovery on display changes, hide-on-close. Also owns the 64x64 bubble mode: collapse, expand, pointer-driven moves and the eased window glide. Tested in `mini-window.test.cjs` and `mini-ipc.test.cjs` |
| `packages/desktop/renderer/mini.jsx`, `mini.html`, `mini.css` | Mini window page: today's all-client cost, tokens, messages and every available shared provider limit; refreshes every minute while visible. Built as a second bundle by `scripts/build.mjs` |
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

- **Mini window IPC:** `handle()` in `main.cjs` accepts a call from the mini window only when the channel is in `MINI_API` (`getSettings`, `run`, `connectionStatus`, `limitSnapshot`, `miniControl`) and the sender frame URL is the mini page. Every other channel stays main-window only. Add a channel to the list only when the mini window truly needs it. The mini window shares the main preload, runs sandboxed with context isolation, and denies navigation and new windows.
- **Theme list:** `electron/themes.cjs` (with `themes-dark.cjs` and `themes-light.cjs`) is the single source for the renderer (CSS variables and the Settings picker via `renderer/themes.js`), the main process (title-bar colours, `nativeTheme.themeSource`) and settings validation in `security.cjs` (`theme` and `miniTheme`). `system` and `match` (mini only) are not themes and must not be added as ids. A new theme needs every colour key and must pass `tests/themes.test.mjs`; chart series colours are declared per scheme in `styles.css` and are checked there against each theme's card colour.
- **Stacked charts:** colour follows the entity. `stackModel` in `charts.jsx` ranks keys by chart-wide total, gives the six largest a series slot and folds the rest into Other, so a model, provider or client keeps its colour on every bar. Only daily reports carry the per-row breakdown, so hourly and monthly charts do not stack. Legend entries set the client filter only when stacked by client; the engine can filter by client and date only, so model and provider selections open Models with a search instead.
- **Day filter:** `focusDay` in `main.jsx` saves the prior date range once and sets a one-day custom range; the `.filter-chip` restores it.
- **Session titles:** titles come only from saved metadata (Codex index `name` then `title`; Claude transcript `custom-title`, then `ai-title`, then `summary` lines). Never derive a title from message text. Claude rows are keyed by transcript filename stem, which is the engine's `sessionId`. Reads are bounded (file count, size, line length) and read-only.
- **Tray and background:** `limitSources` merges the Claude desktop reading with `usage --json` (skipping the engine's Claude rows when Claude desktop is connected). `limit-monitor.cjs` remembers the highest announced threshold per limit so a notification fires once per crossing, and announces a reset when usage falls back below 75%. `applyLoginItem` runs only for packaged, non-smoke runs and registers `PORTABLE_EXECUTABLE_FILE` when present, with `--hidden`. A hidden start shows the window if no tray icon could be created.
- **Smoke isolation:** keep `usage.disabledProviders` in the fixture complete when the engine adds a usage provider; otherwise a real sign-in can leak into the Limits check.

Insights fills calendar gaps and aligns weekdays. The graph's `summary.totalDays` counts recorded dates, so the daily token average uses the inclusive first-to-last recorded calendar span. The embedded terminal guards cancellation during startup, and its smoke checks deliberately delay returning a terminal ID to exercise that race.

## Mini window fixes completed in version 0.4.1

The October 4 pending mini-window work is complete:

- The background and summary area are draggable. Buttons, native resize edges, and the keyboard-accessible scrolling limits panel are marked `no-drag` so they remain usable.
- The window resizes from a 280x230 minimum, starts at 300x230, and saves `miniBounds` as `{x,y,width,height}`. Legacy `{x,y}` settings still load. Bounds recover when monitors are removed or their work areas change. The renderer scrolls at compact sizes and uses two limit columns at wider sizes.
- `limitSnapshot` reads the tray's shared monitor. Every returned finite percentage limit is displayed, with provider name and reset time when reported. The mini no longer calls the Claude refresh endpoint directly; that channel is no longer allowed from the mini frame. The monitor shares requests, refreshes an old snapshot on demand, marks failed checks, and invalidates late results after connection changes.
- Today's totals remain an unfiltered `models --json --today` report, honoring the selected report home. Real local data checked on October 4 included both Claude and Codex. Account quotas and recorded tokens remain different data sources. OpenRouter's account dollar balance is not a percentage quota and is not added as an invented meter.

The 0.4 interface work is committed; the previous note saying it was uncommitted was stale. This patch retains the published engine at 4.17.0. Routine verification uses focused tests and hidden smoke runs; synthetic mini checks include six limits across Claude, Codex and Antigravity without accessing live credentials.

The delivered portable build is `Tokscale-Desktop-0.4.5-x64.exe` on the user's Desktop. Rebuild and package after source changes before replacing and relaunching the delivered executable.

### Dragging regression fixed in version 0.4.4

The installed 0.4.3 widget returned HTCLIENT (1) for its header and summary in a native `WM_NCHITTEST` query, despite its parent CSS saying `drag`. `mini.css` now explicitly inherits `app-region` on ordinary descendants, preserving drag on labels and no-drag inside buttons. The scrolling limits panel contributes one fixed no-drag rectangle; its descendants reset to `initial` (`none`). Electron does not clip descendant drag-region rectangles to the overflow viewport, so inheriting no-drag on scrolling rows allowed hidden rows to disable dragging above the panel. This was reproduced in isolated and full-main-process probes. Do not reintroduce no-drag regions on scroll children.

Hidden smoke checks use `native-hit-test.cjs` to query Windows at real label/icon and fixed scrollport locations, at both compact and expanded sizes, with limits scrolled to the top and bottom. Drag areas must return HTCAPTION (2), and interactive content must return HTCLIENT (1). The probe never moves the pointer or displays a test window. Do not replace this with checks of only the parent computed CSS, or reset scrolling solely to make a native check pass.

## Widget startup and AI desktop apps (version 0.4.3)

The user's installation enables **Launch at login**, **Keep running in the tray**, **Open widget on startup**, and **Show widget when AI apps open**. Windows starts the portable Desktop executable with `--hidden`; the main window stays in the tray and the small widget opens. Startup uses `miniLaunchOnStartup` (default true). **Show mini window** in Settings and the tray checkbox are the `miniEnabled` preference (default true): it says whether the mini window may appear at all, and changing it shows or hides the window at once. It is never written from visibility: closing the mini window only hides it until startup or an AI app brings it back, and neither of those can show it while `miniEnabled` is false. The old `miniOpen` preference, which mirrored visibility, is gone. Maximizing the main window collapses a visible, expanded mini window to its bubble (a `maximize` handler in `createWindow`); it does not expand again on its own. The mini window's own open-app button (`miniControl("main")`) does the same after showing the main window; that button is what the user meant by maximizing. Closing the widget therefore does not disable its next startup.

`electron/ai-app-watcher.cjs` runs the packaged `watch-ai-apps.ps1` helper hidden, with no shell interpolation or execution-policy change. Every 1.5 seconds it checks visible desktop process IDs, executable paths, and the foreground window handle. It opens the widget when Codex, Claude, or ChatGPT starts or regains foreground focus. Codex's Store package runs as `ChatGPT.exe`; its `OpenAI.Codex_*` path identifies it. CLI helpers under `bin`, `.codex`, `claude-code`, `node_modules`, or `vendor` are excluded. No chat text, window titles, command lines, or sign-in data are read by this observer.

The widget uses `showInactive()` so it does not interrupt typing. Closing it keeps it hidden until the next supported app activation or launch. `miniOnAiApps` (default true) controls the observer; Settings shows an error if detection fails, and the helper retries after 30 seconds. Quitting Tokscale stops the helper. App detection needs Tokscale to remain running, so tray mode and Windows startup matter. Hidden smoke checks never start the native observer; unit tests cover transitions, lifecycle, failure recovery, framing, and desktop-versus-CLI classification.

Version 0.4.5 adds T3 Code to this same observer and Settings description. The installed app was verified as `AppData/Local/Programs/t3code/T3 Code (Alpha).exe`; its process name is `T3 Code (Alpha)`. Both the Windows process filter and executable classifier include that name, plus `T3 Code` and `t3code` desktop executable aliases. The separate `t3-resource-monitor.exe` helper and CLI executables in `bin` remain excluded. T3 Code uses the existing launch/focus transitions and 1.5-second interval; no additional background helper is created.

## Original repository update notifications (version 0.4.2)

`electron/upstream-monitor.cjs` watches the default-branch head of `junhoyeo/tokscale` through a fixed public GitHub commits endpoint. It checks at startup and hourly while the app runs, including when the main window is hidden in the tray. Settings contains an enabled-by-default **Upstream update notifications** switch, **Check now**, the last successful check time, and a link to the latest commit or detected comparison.

**App updates.** `electron/app-update.cjs` (tested in `app-update.test.cjs`) checks the fork for a newer desktop release: it reads the public releases list of `Subterfugus/tokscale-desktop`, keeps only published tags of the form `desktop-vX.Y.Z` (drafts, prereleases and the CLI's `vX.Y.Z` tags are ignored) and compares the highest with `app.getVersion()`. It checks at startup and every 6 hours and saves its state in `app-update.json` (userData). There is no toast, at the user's request: when a newer version exists an accent-coloured arrow icon (`.update-ready`) appears in the main window's page header and in the mini window's bar, and clicking it opens the release page, whose link is built from the validated version. The mini window opens it through `miniControl("update")` and never supplies a link itself. **One-click update** (`electron/app-install.cjs`, tested in `app-install.test.cjs`): when the app runs as the portable build (`PORTABLE_EXECUTABLE_FILE` is set) and the release has an asset named exactly `Tokscale-Desktop-X.Y.Z-x64.exe` with a size and a 'sha256:` digest in the GitHub API response, the status is `installable` and clicking the icon calls `installUpdate()` in `main.cjs`. That downloads the asset next to the running file, keeps it only if size and SHA-256 match, releases the single-instance lock, starts the new file with `--replaces=<old path>` and quits. The new build waits up to 20 seconds for the lock, then sends the old file to the Recycle Bin (`replacedFile` only accepts another version's portable file in its own folder). Launch at login re-points itself on that start. If anything fails, or the build is not portable, or the asset has no digest, the icon opens the release page instead. Progress is broadcast in `install: { phase, percent, error }`. The first real update (0.4.6 to 0.4.7, October 6) downloaded, restarted and retired the old file correctly. The restarted build passes `--hidden` on when the main window was not visible at the time. After that update some limits stayed stale until refreshed by hand; the likely cause was the limit monitor and the Limits page each running `usage --json` at the same moment on a visible start, so `run()` in `main.cjs` now shares one in-flight run between identical quota requests. Which limits were stale was not confirmed. Settings has an **App updates** card with the `appUpdateChecks` switch (on by default), **Check for updates** and, when a newer version exists, **Download**. The check finds nothing until a release tagged `desktop-vX.Y.Z` is published on the fork; a new build must be published that way, with a higher `version` in `packages/desktop/package.json`, for existing copies to see it.

The first successful check silently establishes a baseline. Later head changes produce one Windows notification with a short commit subject; clicking it opens the GitHub comparison. Multiple commits between checks produce one alert. This checks code changes on the default branch, not every issue, pull request, or branch. It does not merge changes or replace the bundled engine.

Commit identity, ETag, check time, and rate-limit retry deadline are saved separately in `upstream-updates.json` under Electron userData using the ordered preference store. Save succeeds before the notification is emitted, preventing repeated notices across restarts. Requests share in-flight work, have a minimum manual-check interval, a ten-second timeout and bounded response size, and honor rate-limit backoff. Stopping the watcher aborts requests and rejects late results. Failures remain visible in Settings, and later checks retry.

The main window alone may call `upstreamStatus` and `upstreamCheck`; `onUpstreamStatus` subscribes to progress. These channels are not added to `MINI_API`. Monitoring uses no GitHub credentials and sends no usage or chat content. Smoke mode uses a fixed synthetic baseline and never polls GitHub or raises real notifications. Keep running in the tray and launch at login are separate user settings; no checks occur after the app quits.

## Sync across computers (version 0.4.11)

Usage is combined across the user's own computers through a private store the user deploys on their own Cloudflare account. The Worker and its setup are in `packages/desktop/sync-worker`; it contains no account details, domain or secret, because the repository is public. A custom domain is passed to `wrangler deploy --domain` and the access token is the `SYNC_TOKEN` Worker secret. Run wrangler with `--config sync-worker/wrangler.toml` from `packages/desktop`: `npx` runs from the package folder and otherwise does not find the config.

- **What is uploaded.** One snapshot per computer: for each day, rows of client, model, provider, the five token buckets, cost and messages, taken from the engine's unfiltered graph for the default home. Nothing session-level leaves the computer, so workspace and session groupings, hourly reports and active-time figures stay local, and are empty when another computer is selected. The user said on October 9 that Cloudflare seeing token counts is fine but the public must not, so there is a bearer token and no client-side encryption.
- **Store.** `worker.js` keeps `devices` and `device_years` in D1, creating the tables on first use. A snapshot is split into one row per calendar year (a D1 row is capped at 2 MB) and a year is rewritten only when its hash changes. Every route needs the token; a missing or short secret closes the store with 503.
- **App side.** `electron/sync.cjs` owns the connection (`sync-connection.json`, token encrypted with `safeStorage`), this computer's identity (`sync-device.json`, kept across disconnects) and a local copy of every computer's days (`sync-cache.json`), so reports combine offline. It syncs at startup and every 5 minutes, downloads a computer only when its `updatedAt` changed, and uploads only when the hash of its own snapshot changed.
- **Deleted transcripts.** Clients delete old transcripts and the engine reports only what is on disk. `archivedDays` keeps any client's day that this computer uploaded before and no longer sees locally, per client and day; the local scan wins wherever it still has that client's day. If `sync-cache.json` is lost, the store's copy is read back before uploading, so a smaller scan never overwrites history.
- **Reports.** `electron/sync-data.cjs` is pure and does the merging in the main process: `getGraph` and `run` take an optional computer id, and `mergeGraph`, `mergeModels` and `mergeMonthly` rebuild the totals the engine derives. The renderer passes the id through the `ReportComputer` context in `use-report.js`, which is part of the report cache key. The mini window passes none and so shows all computers. Reports with `--home` are never combined, which is also why the smoke check resets the report home before its sync steps.
- **Tests.** `sync-data.test.cjs`, `sync.test.cjs` and `tests/sync-worker.test.mjs` run the real Worker against `tests/d1-shim.cjs` (D1 over `node:sqlite`). Smoke uses `syntheticSyncStore` in `ui-checks.cjs` and never touches the network.

## Mini window options (version 0.4.10)

`electron/mini-options.cjs` (tested in `mini-options.test.cjs`) is shared by Settings, the mini window and settings validation, and imported by the renderer the same way as `themes.cjs`.

- **Bubble choice.** `miniBubble` is one of the ids in `BUBBLES` (default `scale`). `renderer/bubbles.jsx` draws each one as `BubbleArt`, used by both the bubble and the picker in Settings. Every design is decorative only, in the accent colour on the page colour, with no eyes, creatures or usage data. Movement is transitions only: each `Part` rests untransformed and eases to a `--hover` or `--drag` pose set as CSS variables (`.bubble-part` in `styles.css`), so nothing loops and nothing jumps. The user rejected looping animation and data-carrying bubbles earlier.
- **Opacity.** `miniOpacity` is a whole percentage from 30 to 100 (default 100). `mini-window.cjs` applies it with `setOpacity`, to the expanded window and the bubble alike. The mini renderer reports the pointer entering and leaving through `miniControl("solid" | "faded")`, and the window is fully solid while the pointer is over it. Hiding the window clears the hover state.
- **Limit order.** `miniLimitOrder` is a list of source ids. `orderLimits` puts listed limits first in that order and leaves the rest in their usual order after them, so new accounts appear at the end. Settings reorders with drag and drop or the arrow buttons on each row (`moveLimit` returns the full new order). Only the mini window uses the order; the Limits page and the tray do not.
- **Themes.** Bubblegum (light) and Raspberry (dark) are the two pink themes added on October 6, alongside the older Blossom.

## Weekly pace and widget bubble (version 0.4.6)

**Weekly pace.** `electron/limit-pace.cjs` computes a `pace` object for weekly limits only (label matches weekly / seven-day and `resetsAt` is in the future); every other source gets `pace: null`. The window is the 7 days before `resetsAt`, and used-since-reset is `usedPercent`. The calculation is deliberately a straight line in calendar time, at the user's request on October 5: no working-hours weighting, no learned profile, no recent-rate blend. Days are fractions of 24 hours, so a 5am reset counts its last morning as 5/24 of a day. `expectedPercent` is elapsed days / 7, the rate is used / elapsed days, and `projectedPercent` is used + rate × days left. The object is `{ status: "under" | "on-track" | "over", expectedPercent, projectedPercent, dailyBudgetPercent, daysLeft, runsOutAt }`. `over` means projected to reach 100% before reset; `under` means projected below 80%. With under a day left, `dailyBudgetPercent` is the whole remainder. It needs no history: the app no longer records usage samples, and deletes a leftover `limit-history.json` at startup.

The limit monitor recomputes pace against the current time on every `snapshot()`, so the widget, tray menu and any other snapshot reader agree. The renderer shows pace through the optional `pace` prop on `Meter` (a tick at `expectedPercent` plus a line built by `paceSummary` in `format.js`).

The Limits page and the Claude desktop card show the same pace: `metricPace` in `format.js` imports `limit-pace.cjs` directly (it is a pure function of label, percentage, reset time and now) and feeds `Meter`, so no snapshot or id matching is involved.

**Choosing widget limits.** `miniHiddenLimits` is an array of limit source ids (`provider:account:label`, lower-cased) that the mini window leaves out. It is a hide-list so newly connected limits appear by default. Settings → Mini window lists the current snapshot's limits as checkboxes; the tray and the Limits page ignore the setting.

**Bubble mode.** The shrink button in the widget header collapses the same BrowserWindow to a 64x64 non-resizable bubble; clicking the bubble expands it. `miniMicro` and `miniMicroBounds` are main-owned preferences (stripped from renderer `saveSettings`), and `miniBounds` always means the expanded bounds. The renderer switches layout on `settings.miniMicro`, calls `miniControl("micro" | "expand")`, and drags the bubble with pointer events through `miniMoveBy(dx, dy)`, which only works in bubble mode. The bubble has no CSS drag region because drag regions swallow clicks; a pointer movement under 4px counts as a click.

The transition is two parts: the renderer fades the widget contents (`LEAVE_MS` in `mini.jsx`), then `glide()` in `mini-window.cjs` eases the native bounds over `animationMs` (190 in the app, 0 in smoke and unit tests). The bubble is decorative only and shows no usage data (the user asked for that, and for no eyes or creatures): on the widget theme's page colour it draws a small balance scale in the accent colour (chosen by the user from a gallery on October 5) that sits level and still at rest; hovering tips the beam a few degrees and dragging tips it the other way, with the pans staying level. It uses transitions only (no looping animation) because the user found a constant rock too busy and the jump into a keyframe loop looked like a cut. It fills the window with no border or radius so the system's rounded corners are the only outline.

Gotchas found while building this: on fractionally scaled displays Windows can return a bubble 1px off (64x65), so size checks allow 2px; and the smoke check must run with `ELECTRON_RUN_AS_NODE` unset, which some agent shells set. The animated path is not covered by smoke; it was checked by eye in the packaged app.

## Proposed next features

See [DESKTOP-ROADMAP.md](DESKTOP-ROADMAP.md) for priorities: source coverage and account health, budgets, quota history, period comparisons, session detail pages, a configurable dashboard and mini window, report export and saved views, and safe updates/configuration backup. These are proposals, not implemented work.
