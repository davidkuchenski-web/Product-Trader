# Product Love proxy (Vercel serverless function)

Keeps your Anthropic key server-side so you can share the site's URL without
sharing the key. Use this if you don't want a Cloudflare account — Vercel hosts
the static app **and** this function together, so there's no second deploy and
no CORS to configure.

## Deploy (no CLI needed)
1. Go to <https://vercel.com>, **Sign up with GitHub** (free).
2. **Add New → Project**, import this repo. Vercel auto-detects Vite and builds
   `dist/`; the `api/` folder becomes serverless functions automatically.
3. In **Settings → Environment Variables**, add:
   - `ANTHROPIC_API_KEY` = your key (this is the secret; it stays on the server)
   - `VITE_PROXY_URL` = `/api/claude` (tells the app to use the proxy)
   - *(optional)* `PROXY_TOKEN` = a shared token, and set the same value as
     `VITE_PROXY_TOKEN`
   - *(optional)* `ALLOWED_ORIGINS` = your domain(s), comma-separated
4. **Deploy.** The app now runs with no key in anyone's browser.

> Changing `VITE_PROXY_URL` later requires a **redeploy** — it's baked into the
> bundle at build time. `ANTHROPIC_API_KEY` is read at request time, so rotating
> it only needs a redeploy if you want the change to take effect immediately.

## Security notes
- The key is a server-side env var — not in the repo, not in the browser.
- `ALLOWED_ORIGINS` blocks other websites' browsers but not direct `curl`. For
  that, set `PROXY_TOKEN` (rotate freely) or put Vercel auth in front.
- Watch spend in the Anthropic console; add a budget alert.

## Other hosts
The same pattern works on Netlify Functions, Deno Deploy, etc. — any place that
runs a small POST handler that injects `ANTHROPIC_API_KEY` and forwards the body
to `https://api.anthropic.com/v1/messages`. See `worker/` for the Cloudflare
version.
