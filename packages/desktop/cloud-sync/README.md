# Claude cloud sessions in sync

Claude Code cloud sessions (Claude Code on the web, and sessions started from the Claude app) run on short-lived machines. Their transcripts never reach your computer, so Tokscale Desktop cannot count them by itself. `tokscale-cloud-sync.mjs` runs on the cloud machine instead: after each turn it totals that session's Claude Code usage with the same engine the app uses and uploads it to your [sync store](../sync-worker/README.md). The app then shows every cloud session together as one more computer named **Claude cloud**.

The script makes no model requests and uses none of your Claude usage. It uploads only what sync already uploads: per day, the client, model, provider, token counts, estimated cost and message count.

## Requirements

- A sync store deployed from `packages/desktop/sync-worker` at a version that accepts cloud sessions. If you deployed it before this script existed, deploy it again; your data is kept.
- A Claude cloud environment you can edit.

## Setup

In your cloud environment's settings:

1. Add these environment variables:

   ```
   TOKSCALE_SYNC_URL=https://your-sync-address
   TOKSCALE_SYNC_TOKEN=your-access-token
   TOKSCALE_SYNC_TIMEZONE=America/Chicago
   ```

   Use the same address and token you entered in the app. `TOKSCALE_SYNC_TIMEZONE` is your own timezone, so days start at your midnight rather than the cloud machine's (UTC).

2. Under network access, add your sync address's host to the allowed domains and keep package managers allowed (the script runs the engine through `npx`).

3. Set the setup script to:

   ```bash
   curl -fsSL https://raw.githubusercontent.com/Subterfugus/tokscale-desktop/main/packages/desktop/cloud-sync/tokscale-cloud-sync.mjs -o /tmp/tokscale-cloud-sync.mjs
   node /tmp/tokscale-cloud-sync.mjs install
   ```

   `install` copies the script to `~/.claude/tokscale-cloud-sync.mjs` and adds a `Stop` hook to `~/.claude/settings.json` that runs it after every turn.

New sessions in that environment upload from then on. The upload runs at the end of each turn, after the reply is sent; it takes a few seconds, and an unchanged total is not sent again. Each run writes one line to the session's hook log saying what it sent or why it failed.

To track only some repositories instead, skip the setup script and add the same `Stop` hook to those repositories' `.claude/settings.json`, with the script checked in next to it.

## How sessions are stored

Each session is stored as its own part of the `claude-cloud` computer (`PUT /v1/devices/claude-cloud/sessions/<session id>`), and a later upload from the same session replaces its earlier part. Reading `claude-cloud` returns all parts added together, so the app needs no changes to show them and the store's limit of 50 computers is not used up by sessions. Removing **Claude cloud** in the app removes every session's part.

## Running it by hand

```bash
node tokscale-cloud-sync.mjs
```

uploads the current session's usage now and prints what it sent. It reads the session id from `CLAUDE_CODE_REMOTE_SESSION_ID`.
