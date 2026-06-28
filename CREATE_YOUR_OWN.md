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

Do not commit real logs, backup files, Cloudflare account secrets, the owner write token, or a live Worker URL that you do not want people to associate with your logs. The checked-in `config.js` is blank so the public template runs in local-only mode until someone adds their own Worker URL.

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

Before deploying your own copy, replace the blank `config.js` with your own Worker URL. The API URL is public-read by design, so committing someone else's Worker URL may point your app at someone else's public logs. You still cannot write without their owner token, but your own deployment should use your own Worker/KV pair.

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

The API URL is public-read. It is not a write secret, but it can reveal where your public logs are served. The owner token is private and must never be committed.

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

Because the API is public-read, anyone who knows your Worker URL can read the shared log JSON. They still cannot write without your owner token.

For a public template, keep `config.js` blank and keep real deployment details outside the committed repo. Keep `config.example.js` and this guide so every cloner knows they must use their own Worker/KV pair.
