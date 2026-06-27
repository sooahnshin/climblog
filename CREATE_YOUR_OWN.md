# Create Your Own ClimbLog

This guide explains how to fork or clone ClimbLog and run your own instance.

The important separation is:

```text
Git repo:
  app/template code only

GitHub Pages:
  static frontend files only

Cloudflare Worker:
  public-read / owner-write API

Cloudflare KV:
  your actual training logs

Cloudflare Worker secret:
  your owner write token

Your phone/Mac browser:
  saved owner token + local cache
```

Do not commit real logs, backup files, Cloudflare account secrets, or the owner write token. It is OK for the repo to include a live `config.js` for the owner's own deployed app because that file only contains a public-read API URL. Template users still need to replace it with their own Worker URL.

## Prerequisites

- A GitHub account for hosting the static frontend with GitHub Pages.
- A Cloudflare account for the Worker, KV namespace, and Worker secret.
- Node.js/npm available locally so you can run Wrangler with `npx`.

Log in to Cloudflare before running the setup commands:

```sh
npx wrangler login
```

## 1. Fork Or Clone

Create your own copy of the repo.

This repo can be both someone's live personal app and a reusable template. If the repo includes a real `config.js`, treat it as the original owner's live frontend config, not as your config.

Before deploying your own copy, replace `config.js` with your own Worker URL. The API URL is public-read by design, so a stale `config.js` may point your app at someone else's public logs. You still cannot write without their owner token, but your own deployment should use your own Worker/KV pair.

## 2. Create Cloudflare KV

Create a KV namespace for ClimbLog data:

```sh
npx wrangler kv namespace create CLIMBLOG_KV
```

Wrangler prints a block like:

```toml
[[kv_namespaces]]
binding = "CLIMBLOG_KV"
id = "your-kv-namespace-id"
```

The Worker stores one shared document under this KV key:

```text
logs.v1
```

## 3. Configure Wrangler

Copy the example config:

```sh
cp worker/wrangler.example.toml wrangler.toml
```

Edit `wrangler.toml`:

```toml
name = "climblog-api"
main = "worker/worker.js"
compatibility_date = "2026-06-27"

[[kv_namespaces]]
binding = "CLIMBLOG_KV"
id = "your-kv-namespace-id"
```

If your copied config still has a placeholder `preview_id`, either replace it with a separate preview namespace ID or delete the `preview_id` line. You only need `id` for the deployed app.

`wrangler.toml` is ignored by this repo because it contains deployment-specific IDs.

## 4. Create The Owner Token

Generate a long random token:

```sh
openssl rand -base64 32
```

Use that output as the owner write token. Anyone with this token can write to your logs, so keep it private.

Store it as a Worker secret:

```sh
npx wrangler secret put CLIMBLOG_WRITE_TOKEN
```

If Cloudflare asks whether to create the Worker first, saying yes is fine.

## 5. Deploy The Worker

Deploy the API:

```sh
npx wrangler deploy
```

Wrangler prints a URL like:

```text
https://climblog-api.<your-subdomain>.workers.dev
```

Test public read in a browser:

```text
https://climblog-api.<your-subdomain>.workers.dev/logs
```

Expected initial response:

```json
{
  "version": 1,
  "updatedAt": "",
  "logs": []
}
```

## 6. Configure The Frontend

Create `config.js` from the example if it does not already exist:

```sh
cp config.example.js config.js
```

Set your Worker URL in `config.js`:

```js
"use strict";

window.CLIMBLOG_CONFIG = {
  apiUrl: "https://climblog-api.<your-subdomain>.workers.dev"
};
```

The API URL is public. The owner token is not.

For a repo that is both a live app and a reusable template, keep both files:

- `config.js` points the owner's deployed frontend at the owner's Worker.
- `config.example.js` is the placeholder cloners copy and edit for their own Worker.

## 7. Deploy GitHub Pages

Push the repo to GitHub, then configure Pages:

```text
Settings -> Pages -> Build and deployment -> Deploy from branch
Branch: main
Folder: / (root)
```

Open:

```text
https://<github-username>.github.io/climblog/
```

## 8. Unlock Owner Mode

Open ClimbLog on your phone or Mac, click `Unlock owner`, and paste the same owner token you stored in Cloudflare.

The token is saved only in that browser's local storage for your ClimbLog site. Public visitors do not have the token, so they can read the heatmap and logs but cannot write.

## 9. Verify Sync

1. Unlock owner mode on your first device.
2. Add one log.
3. Click `Sync now`.
4. Open `/logs` on your Worker URL and confirm the log appears in JSON.
5. Open ClimbLog on your second device.
6. Refresh or click `Sync now`.
7. Confirm the same log appears.

## Template Caveat

Because the API is public-read, your Worker URL is not secret. If someone clones a repo that still points at your Worker URL, their copy may read your public logs. They still cannot write without your owner token.

If you want the same repo to act as your live app and as a template, committing your real `config.js` is acceptable as long as you are comfortable with the Worker URL being public. Keep `config.example.js` and this guide so every cloner knows they must replace `config.js` before deploying.
