# Product Love

Tooling for one investing thesis: *products people love early lead the re-rating
of the company that makes them.* Three parts:

```
src/        the app — analyze a product, score the love, paper-trade, log signals
worker/     Cloudflare Worker proxy — share the site without sharing your API key
backtest/   Python harness — measure whether the love score actually predicts returns
```

## 1. The app (static, browser-only)
```bash
npm install
npm run dev            # http://localhost:5173
```
Two ways in:
- **Analyze** — name a product and a research agent (Claude + live web search) finds
  the company, checks it's publicly investable, scores how loved it is, and flags
  **materiality** (a beloved product inside a mega-cap is a weak signal).
- **Discover** — don't name anything; send a scout agent to crawl reviews,
  communities, and trend data for loved products behind **publicly traded** companies
  with **high growth upside**. It returns a ranked shortlist (strongest upside first),
  each with the love subscores plus a growth-upside score, ready to watch or paper-buy.
  Add an optional theme (e.g. *wearables*, *beauty*) to focus the hunt.

Tune the weights, paper-buy, track P&L. Everything persists in your browser. Every
analysis and discovery is logged; export it from **Tune → Export signals** to feed
the backtest.

### Deploy to GitHub Pages
1. Push to GitHub with the default branch `main`.
2. **Settings → Pages → Source: GitHub Actions**.
3. Each push to `main` builds and publishes to `https://<you>.github.io/<repo>/`.
   `vite.config.js` uses `base: "./"`, so the subpath just works.

### Two ways to supply the API key
- **Bring-your-own-key (default):** each user pastes their Anthropic key in **Tune**.
  It lives only in their browser. Never commit a key to the repo.
- **Shared proxy (no key in the browser):** deploy a tiny backend that holds the
  key server-side, then set `VITE_PROXY_URL` (build-time env var — see
  `.env.example`). Now the site runs with no key in the browser — good for
  sharing the URL. Two ready-made proxies are included:
  - **Vercel** (no Cloudflare account needed; hosts the app + proxy together) —
    see `api/README.md`.
  - **Cloudflare Worker** — see `worker/README.md`.

## 2. The proxy
Holds your key server-side, with an origin allowlist and an optional shared token.
- `api/` — Vercel serverless function (`api/README.md`)
- `worker/` — Cloudflare Worker (`worker/README.md`)

## 3. The backtest — see `backtest/README.md`
```bash
cd backtest
pip install -r requirements.txt
python backtest.py --synthetic                  # demo the pipeline, no data
python backtest.py --signals product-love-signals.csv
```
Reports the Information Coefficient (does score predict forward excess return?), a
score-quintile study, and a top-N rotation vs SPY with an equity curve.

## Honest limits
- Prices in the app are web-sourced approximations, delayed — paper only.
- A live search gives sentiment *now*, not history, so the truest backtest is
  forward: accumulate the app's log over time and re-run. That growing log is your
  proprietary out-of-sample dataset.
- Nothing here is investment advice. You define the criteria; the tools run them.
