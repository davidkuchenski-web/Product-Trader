# Product Love proxy (Cloudflare Worker)

Keeps your Anthropic key server-side so you can share the site's URL without
sharing the key.

## Deploy
```bash
npm install -g wrangler        # if you don't have it
cd worker
wrangler login
wrangler secret put ANTHROPIC_API_KEY     # paste your key when prompted
# optional shared token (then set the same value as VITE_PROXY_TOKEN in the app):
# wrangler secret put PROXY_TOKEN
```
Edit `ALLOWED_ORIGINS` in `wrangler.toml` to your Pages origin
(e.g. `https://yourname.github.io`), then:
```bash
wrangler deploy
```
Wrangler prints a URL like `https://product-love-proxy.<you>.workers.dev`.

## Point the app at it
In `src/config.js` set:
```js
export const PROXY_URL = "https://product-love-proxy.<you>.workers.dev";
```
Commit, push, and the site now runs without anyone entering a key.

## Security notes
- The key is a Worker **secret** — not in the repo, not in the browser.
- `ALLOWED_ORIGINS` blocks other websites' browsers. It does **not** stop someone
  calling the Worker directly with curl. For that, either set `PROXY_TOKEN`
  (rotate it freely) or put Cloudflare Access / Turnstile in front.
- Watch spend in the Anthropic console; add a budget alert.
