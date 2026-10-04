# Tokscale Desktop

This fork adds a Windows desktop application to Tokscale. It uses the original native Tokscale engine for reports, quotas, integrations, and interactive commands. The upstream CLI and source remain available in their original locations.

The application runs in a Windows window and loads its interface from bundled files. It does not need a browser, a local HTTP server, a Tokscale account, or a cloud database to view local reports. Provider quota requests and price lookups retain Tokscale's existing network behavior.

![Tokscale Desktop overview using generated demonstration activity](packages/desktop/assets/desktop-overview.png)

## Desktop views

| View | What is available |
| --- | --- |
| Overview | Estimated costs, all token buckets, cache share, activity chart, provider distribution |
| Subscription quotas | Original provider quota data, reset times, account labels, credits and spending controls when returned |
| Models | All six groupings, searchable and sortable rows, expanded source fields, worktree merging, JSON exports |
| Activity | Monthly and hourly reports, client and date filters |
| Projects & sessions | Saved Codex chat names, compact session/model rows, folder grouping, searchable details, and original TUI access |
| Insights | Contribution calendar, token averages, active-time measurements |
| Integrations | Source discovery, account setup commands and original integration workflows |
| Command center | Original interactive TUI, editable CLI arguments, command discovery, native terminal fallback |
| Settings | Dark/light/system themes, refresh intervals, report home, desktop preferences |

Version 0.3 improves readability, contrast, smaller-window layouts, and table navigation. Projects starts with sessions; saved Codex names come from its local read-only index and use the current name before the initial title. Sessions without saved names show as untitled. Workspace grouping remains available for folder aggregates. Custom dates apply after validation, and every report shows the selected dates explicitly. Overview exposes every token bucket; Insights preserves calendar gaps and computes the daily average across the recorded calendar span. Ctrl+K opens Command center.

## Connect Claude desktop, Antigravity, and OpenRouter

Open **Integrations** for the connection cards. Connected Claude desktop usage and OpenRouter balances also appear under **Subscription quotas**.

- **Claude desktop:** sign in to the existing Claude app, then click **Connect Claude desktop**. The desktop addition recognizes direct-download and Microsoft Store profiles, unlocks the existing OAuth cache with Windows DPAPI in memory, and queries Anthropic's subscription usage endpoint. No Claude Code helper or copied credential file is required. It also reads `plan-usage-history.json` and displays saved utilization snapshots for the latest organization. This is quota history; transcript token accounting remains handled by the original engine. Disconnect stops automatic desktop usage requests without signing out of Claude.
- **Antigravity:** open and sign in to Antigravity, click **Detect**, then **Sync usage**. These buttons invoke the original engine's status and sync commands directly. Its local service also supplies subscription quotas when available. No separate API key is required.
- **OpenRouter:** create a management key using the card's link, paste it into the masked field, and click **Connect OpenRouter**. The app reads purchased credits, total spending, and remaining credits from `GET /api/v1/credits`; ordinary inference keys cannot access this account endpoint. The key is verified before being saved, encrypted through Electron's Windows credential protection, and removed from this app when disconnected. The app does not change OpenRouter keys or billing settings.

Claude desktop and OpenRouter account readers are additions in this fork; the original Tokscale engine remains unchanged. Desktop storage and subscription endpoints are not stable public contracts, so errors remain visible and reconnecting may be necessary after provider updates. Claude rate-limit responses trigger a cooldown. No desktop reader refreshes or modifies Claude's own sign-in files.

The Windows Claude storage layout was checked against the installed app and its live usage endpoint. See the [Claude Account Switcher description](https://github.com/SnlperStripes/claude-account-switcher#how-it-works) for corroborating storage details and [OpenRouter's account credits reference](https://openrouter.ai/docs/api/api-reference/credits/get-remaining-credits) for the management-key requirement.

The screenshot contains invented activity, not a real user's usage. The application discovers local activity when opened normally.

![Account connection cards using synthetic provider replies](packages/desktop/assets/desktop-connections.png)

## Build and run

Node.js is required to develop the desktop package. Rust and Bun are needed only when rebuilding or developing the upstream engine; the desktop package bundles the published Windows engine.

```powershell
cd packages/desktop
npm install --workspaces=false
npm run build
npm start
```

Build a portable application or a Windows installer:

```powershell
npm run package
npm run package:installer
```

The generated files are in `packages/desktop/release`. The portable application can run without installation.

The packaged application targets Windows x64. Builds are unsigned.

## Verification

```powershell
npm test
npm run smoke
```

The smoke command generates isolated Codex and Claude sessions and checks the actual Electron renderer, native engine, and embedded PTY. Its report and screenshots are saved to a temporary folder printed on completion. It exercises totals, client filters, all six groupings, views, saved themes, successive commands, and the original TUI's rendering, resizing, keyboard input, persistence during navigation, and shutdown. It also checks renderer isolation and rejected non-HTTP external URLs.

To verify a packaged executable, supply an output folder, the generated fixture home, and the executable path to `npm run smoke -- OUTPUT HOME EXE`. The final portable build was checked with the same UI and terminal smoke checks. The focused test suite checks literal CLI argument handling, errors, timeout/cancellation, bounded output, exports, IPC validation, and the upstream report contracts.

## Original functionality

The desktop package pins the native engine version in its own `package.json`. It does not modify the upstream engine, its parsers, or its provider integrations. The original interactive terminal remains available inside the application, and the original CLI can also be launched in a native terminal. Advanced command arguments are passed directly to Tokscale rather than being interpreted by a command shell.

Use Tokscale's original help for the complete command syntax and supported options. The upstream [README](README.md) describes account integration, reports, data locations, exports, imports, and optional social features.

Local usage reports and subscription quotas are different kinds of data. Token and estimated cost reports are calculated from activity that Tokscale can read. Quotas depend on the provider and available authentication. Empty quota output does not prove that the account has no limits: the upstream engine can omit failed provider queries from its JSON output.

Some upstream capabilities are exposed through the embedded original terminal rather than individual desktop controls, including detailed session metadata, minute reports, task summarization, imports, social features, and automation. A custom report home applies to local reports; the upstream TUI and integration commands do not support that override. Hourly JSON currently omits reasoning tokens, so its token figures are labeled as partial; overview and model totals retain reasoning tokens.

Uploading data, signing in, enabling automatic submissions, and deleting submitted data are explicit actions. Opening the desktop application does not submit local usage to the social platform.

## Updating

Keep desktop changes in `packages/desktop` so they are easy to inspect when updating from `junhoyeo/tokscale`. Update the pinned engine package deliberately, check the JSON contracts, and verify reports and the interactive terminal before packaging a new desktop build.

The upstream GitHub Actions workflows still belong to Tokscale's existing release process. This fork does not use them to publish the desktop package.

## License

Tokscale and this desktop addition use the repository's [MIT license](LICENSE). The bundled dependencies retain their respective licenses. The desktop app icon is Tokscale's original mark.
