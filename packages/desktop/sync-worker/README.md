# Tokscale Desktop sync store

A small Cloudflare Worker that lets your own computers share their daily usage totals. Each computer running Tokscale Desktop uploads one snapshot of its own days and reads the others; the app adds them together in its reports.

It runs on your Cloudflare account. This folder contains no account details, domain or secret, so it is safe in a public repository. Anyone else who wants sync deploys their own copy.

## What is stored

Per computer: a name you choose, and for each day a list of `client`, `model`, `provider`, the five token counts, estimated cost and message count. Chat content, session names, folder paths and credentials are never uploaded.

Every request must carry the access token. Without it the Worker answers `401` and nothing else; if no token is configured it answers `503` to everyone.

## Deploy

You need Node.js and a Cloudflare account. Run these from `packages/desktop`; the config path is given explicitly because `npx` runs from the package folder.

```bash
npx wrangler login
```

```bash
npx wrangler deploy --config sync-worker/wrangler.toml
```

The first deploy creates the D1 database named in `wrangler.toml`. To serve it from your own domain instead of the default `workers.dev` address, pass the domain on the command line so it never lands in the repository:

```bash
npx wrangler deploy --config sync-worker/wrangler.toml --domain sync.example.com
```

Then create a long random access token and store it as a secret. Keep a copy for the app.

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

```bash
npx wrangler secret put SYNC_TOKEN --config sync-worker/wrangler.toml
```

The token must be at least 32 characters.

## Connect the app

On each computer open **Settings → Sync across computers** and enter the address (for example `https://sync.example.com`), the access token and a name for that computer. The app stores the token encrypted with Windows credential protection.

To change the token, run `wrangler secret put SYNC_TOKEN` again and reconnect each computer.

## API

All paths require `Authorization: Bearer <token>`.

| Request | Result |
| --- | --- |
| `GET /v1/devices` | `{ devices: [{ id, name, updatedAt }] }` |
| `GET /v1/devices/:id` | `{ id, name, updatedAt, days }` |
| `PUT /v1/devices/:id` with `{ name, days }` | Replaces that computer's snapshot |
| `DELETE /v1/devices/:id` | Removes that computer |

`days` maps `YYYY-MM-DD` to rows of `{ client, modelId, providerId, tokens: { input, output, cacheRead, cacheWrite, reasoning }, cost, messages }`. Snapshots are stored one row per computer and calendar year, and a year is rewritten only when its contents change.

## Tests

`npm test` in `packages/desktop` runs `tests/sync-worker.test.mjs` against an in-memory database.
