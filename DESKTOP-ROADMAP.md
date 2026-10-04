# Desktop feature proposals

These are proposals, not implemented features or promises of provider API access. They extend the existing reports, connections, themes, tray, and mini window rather than repeating them.

## First priorities

1. **Data coverage and connection health.** A Sources page should show which apps were detected, which files were read, the oldest and newest recorded dates, the last successful scan, and why a source is missing. Explain account limits, recorded token usage, estimated cost, and actual account spending separately. Include a safe diagnostic export that excludes credentials and chat content. This would make discrepancies such as Claude's chart versus transcript totals much easier to understand.

2. **Budgets and spending alerts.** Set daily or monthly budgets across all activity, or per client, model, and workspace. Show remaining budget, spend pace, and a month-end estimate. Keep transcript-based estimated cost distinct from actual OpenRouter account spending; alerts need a clearly stated data source. Forecasts should show their observed date range and become unavailable when there is insufficient history.

3. **Usage-limit history and pace.** Record quota snapshots locally, chart each provider's rolling window, and show reset countdowns alongside current percentages. Estimate when a limit might be reached from recent observations, with uncertainty. Add user-selected warning thresholds and quiet hours to the existing notifications. Explain when data is stale or the provider does not expose a limit. Quota percentages cannot be converted into exact tokens or dollars without a provider-supplied relationship.

4. **Period comparisons.** Compare today with yesterday, this week with last week, and a custom range with the preceding range of equal length. Show changes in cost, tokens, messages, cache share, and model mix. Align partial periods so an incomplete day or month is not compared misleadingly with a completed one.

## Next layer

5. **Session and workspace detail pages.** Selecting a session should open a usage timeline, model breakdown, token buckets, cache share, and estimated cost. Workspace pages should aggregate sessions, support user-assigned labels, and retain saved chat names. Avoid implying that tokens measure quality or productivity.

6. **Custom dashboard and mini window.** Choose which metrics and providers to pin, select compact or expanded layouts, set an independent mini refresh interval, and optionally display OpenRouter's remaining balance. Offer a shortcut to show or hide the mini window and an always-on-top switch. Unsupported account data should remain clearly unavailable.

7. **Report export and saved views.** Add CSV export alongside JSON, a shareable report image, and named combinations of filters, grouping, and visible columns. Include the date range, data coverage, engine version, token definitions, and whether cost is estimated in exports. Preview any export that would include local paths or session names.

8. **Safe updates and configuration backup.** Show desktop and engine versions separately; check for a new desktop build, preview release notes, and let the user choose when to replace the running app. Back up themes, filters, mini layout, and budgets without exporting provider credentials. Keep a usable previous build for rollback and test saved-setting migrations before upgrading the engine.

## A useful completion standard

The app should answer four questions without opening Terminal: What have I used? How much will it cost? How close am I to a limit? How complete and current is the data? Prioritize coverage and health, budgets, and limit history before adding more visual customization.
