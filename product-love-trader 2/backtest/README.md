# Product Love — backtest harness

Measures whether a high Product Love Score at time T predicts the stock beating
the market afterward. No live trading, no advice — just signal.

## Run
```bash
pip install -r requirements.txt
python backtest.py --synthetic                      # demo, no data needed
python backtest.py --signals product-love-signals.csv
python backtest.py --signals my.csv --top-n 5 --horizons 21,63,126,252
```
Export `product-love-signals.csv` from the app's **Tune → Export signals**.

## Signal CSV schema
Required: `date, ticker, score`. Optional: the five subscores, `company`,
`materiality`, `isPublic`, `approxPrice`. The app's export already matches this.

## What you get
- **IC table** — Spearman correlation of score vs forward excess return at each
  horizon. Positive and stable = the score predicts. Read this first.
- **Quintile table** — average forward excess return per score bucket; you want it
  to climb from Q1 to Q5.
- **Strategy sim** — monthly rotation into the top-N loved names vs SPY: CAGR,
  vol, Sharpe, max drawdown, plus `equity_curve.png` and `buckets.png`.
- `forward_returns.csv` — the per-signal detail, for your own slicing.

## The data reality
Live web search gives you sentiment *now*, not history — so a clean backtest needs
**historical** signals. Two honest paths:
1. **Forward log (recommended):** let the app accumulate analyses, export
   periodically, re-run this. The growing log is genuine out-of-sample data.
2. **Historical signals:** if you buy/scrape dated signal history (App Store /
   Play ratings over time, Product Hunt launches, review-velocity series), feed it
   in the same CSV shape.

`--synthetic` builds prices where loved names drift higher on purpose, so you can
watch the pipeline recover a positive IC. Those numbers are illustrative, not real.
