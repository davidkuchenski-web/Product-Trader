#!/usr/bin/env python3
"""
Product Love — backtest harness
================================

Tests one question: does a high "Product Love Score" at time T predict that the
stock outperforms the market over the following weeks/months?

It does NOT trade live and NOT give advice. It measures signal.

INPUT  : a CSV of timestamped signals (export it from the app's Tune tab).
         Required columns: date, ticker, score
         Optional        : the five subscores, company, materiality, isPublic
PRICES : pulled from Yahoo Finance via yfinance when you run it locally.
         If yfinance is unavailable/offline, pass --synthetic to demo the engine
         on generated prices (clearly labelled; not real).

What it reports
---------------
1. Forward excess returns   : stock return minus SPY, at 1/3/6/12-month horizons.
2. Information Coefficient   : Spearman rank corr between score and forward excess
                              return. Positive & stable across horizons = the
                              thesis has predictive content.
3. Score-bucket study       : average forward excess return per score quintile.
                              You want this monotonic (higher score -> higher
                              forward return).
4. Strategy simulation      : monthly rotation into the top-N loved names, equal
                              weight, vs SPY buy-and-hold. CAGR, vol, Sharpe, max
                              drawdown, and an equity-curve chart.

Usage
-----
    pip install -r requirements.txt
    python backtest.py --signals product-love-signals.csv
    python backtest.py --synthetic            # no data needed, demos the pipeline
    python backtest.py --signals my.csv --top-n 5 --horizons 21,63,126,252

Honest caveat
-------------
The hard part of this thesis is HISTORICAL signal data — a live web search tells
you sentiment now, not what it was 18 months ago. So the cleanest real test is
forward: let the app log analyses over time, export periodically, and re-run this.
That accumulating log is your proprietary out-of-sample dataset.
"""

import argparse
import sys
from datetime import timedelta

import numpy as np
import pandas as pd

TRADING_DAYS = 252
DEFAULT_HORIZONS = [21, 63, 126, 252]  # ~1, 3, 6, 12 months
BENCH = "SPY"


# --------------------------------------------------------------------------- #
# Data loading
# --------------------------------------------------------------------------- #
def load_signals(path):
    df = pd.read_csv(path)
    df.columns = [c.strip().lower() for c in df.columns]
    need = {"date", "ticker", "score"}
    missing = need - set(df.columns)
    if missing:
        sys.exit(f"signals CSV missing columns: {missing}")
    df["date"] = pd.to_datetime(df["date"]).dt.tz_localize(None)
    df["ticker"] = df["ticker"].astype(str).str.upper().str.strip()
    df["score"] = pd.to_numeric(df["score"], errors="coerce")
    df = df.dropna(subset=["ticker", "score"])
    df = df[df["ticker"].ne("") & df["ticker"].ne("NAN")]
    return df.sort_values("date").reset_index(drop=True)


def make_sample_signals(n=120, seed=7):
    """A believable sample so the harness runs with no input file."""
    rng = np.random.default_rng(seed)
    tickers = ["AAPL", "NKE", "SBUX", "LULU", "CROX", "ELF", "CELH",
               "DECK", "MNST", "ETSY", "CHWY", "PTON"]
    start = pd.Timestamp("2022-01-01")
    rows = []
    for _ in range(n):
        t = rng.choice(tickers)
        d = start + timedelta(days=int(rng.integers(0, 760)))
        score = int(np.clip(rng.normal(60, 18), 1, 99))
        rows.append({"date": d, "ticker": t, "score": score})
    return pd.DataFrame(rows).sort_values("date").reset_index(drop=True)


def fetch_prices_yf(tickers, start, end):
    import yfinance as yf  # imported lazily so --synthetic needs no network
    data = yf.download(tickers, start=start, end=end, progress=False, auto_adjust=True)
    px = data["Close"] if "Close" in data else data
    if isinstance(px, pd.Series):
        px = px.to_frame(tickers[0])
    return px


def fetch_prices_synthetic(tickers, start, end, signals):
    """Generate prices where loved names drift slightly higher — to prove the
    pipeline recovers a positive signal. NOT REAL DATA."""
    rng = np.random.default_rng(11)
    idx = pd.date_range(start, end, freq="B")
    avg_score = signals.groupby("ticker")["score"].mean()
    out = {}
    for t in tickers:
        s = avg_score.get(t, 50)
        # annual drift nudged by how loved the product is, plus noise
        mu = 0.04 + (s - 50) / 50 * 0.20
        sigma = 0.32
        daily = rng.normal(mu / TRADING_DAYS, sigma / np.sqrt(TRADING_DAYS), len(idx))
        out[t] = 100 * np.exp(np.cumsum(daily))
    return pd.DataFrame(out, index=idx)


# --------------------------------------------------------------------------- #
# Analytics
# --------------------------------------------------------------------------- #
def daily_index(px):
    return px.asfreq("D").ffill()


def price_on(px_daily, ticker, when):
    if ticker not in px_daily.columns:
        return np.nan
    when = pd.Timestamp(when).normalize()
    if when < px_daily.index[0] or when > px_daily.index[-1]:
        return np.nan
    return px_daily.at[when, ticker]


def forward_returns(signals, px, horizons):
    pxd = daily_index(px)
    rows = []
    for _, sig in signals.iterrows():
        t, d, score = sig["ticker"], sig["date"], sig["score"]
        p0 = price_on(pxd, t, d)
        b0 = price_on(pxd, BENCH, d)
        if not (np.isfinite(p0) and np.isfinite(b0)):
            continue
        rec = {"date": d, "ticker": t, "score": score}
        for h in horizons:
            when = d + timedelta(days=int(round(h * 365 / TRADING_DAYS)))
            p1, b1 = price_on(pxd, t, when), price_on(pxd, BENCH, when)
            if np.isfinite(p1) and np.isfinite(b1):
                rec[f"stock_{h}"] = p1 / p0 - 1
                rec[f"excess_{h}"] = (p1 / p0 - 1) - (b1 / b0 - 1)
            else:
                rec[f"stock_{h}"] = np.nan
                rec[f"excess_{h}"] = np.nan
        rows.append(rec)
    return pd.DataFrame(rows)


def ic_table(fr, horizons):
    out = []
    for h in horizons:
        col = f"excess_{h}"
        sub = fr[["score", col]].dropna()
        ic = sub["score"].corr(sub[col], method="spearman") if len(sub) > 4 else np.nan
        out.append({"horizon_days": h, "n": len(sub),
                    "IC_spearman": round(ic, 3) if pd.notna(ic) else None,
                    "mean_excess": round(sub[col].mean(), 4) if len(sub) else None})
    return pd.DataFrame(out)


def bucket_table(fr, horizons, q=5):
    fr = fr.copy()
    try:
        fr["bucket"] = pd.qcut(fr["score"], q, labels=[f"Q{i+1}" for i in range(q)], duplicates="drop")
    except ValueError:
        fr["bucket"] = pd.cut(fr["score"], q, labels=[f"Q{i+1}" for i in range(q)])
    cols = [f"excess_{h}" for h in horizons]
    tbl = fr.groupby("bucket", observed=True)[cols].mean().round(4)
    tbl.insert(0, "n", fr.groupby("bucket", observed=True).size())
    return tbl


def strategy_sim(signals, px, top_n=5, lookback_days=90):
    """Monthly: hold the top-N most-loved names seen in the trailing window,
    equal weight. Compare to SPY buy & hold."""
    pxd = daily_index(px)
    rets = pxd.pct_change().fillna(0)
    start = signals["date"].min().normalize()
    end = pxd.index[-1]
    rebal = pd.date_range(start, end, freq="MS")
    if len(rebal) < 2:
        return None

    equity, bench_eq = [1.0], [1.0]
    dates = [rebal[0]]
    held_log = []
    for i in range(len(rebal) - 1):
        r0, r1 = rebal[i], rebal[i + 1]
        window = signals[(signals["date"] <= r0) &
                         (signals["date"] > r0 - timedelta(days=lookback_days))]
        picks = (window.sort_values("date")
                       .drop_duplicates("ticker", keep="last")
                       .nlargest(top_n, "score")["ticker"].tolist())
        picks = [p for p in picks if p in rets.columns]
        held_log.append((r0.date(), picks))
        span = rets.loc[(rets.index > r0) & (rets.index <= r1)]
        if len(span) == 0:
            continue
        port = span[picks].mean(axis=1) if picks else pd.Series(0, index=span.index)
        bench = span[BENCH] if BENCH in span.columns else pd.Series(0, index=span.index)
        for d in span.index:
            equity.append(equity[-1] * (1 + port.loc[d]))
            bench_eq.append(bench_eq[-1] * (1 + bench.loc[d]))
            dates.append(d)
    curve = pd.DataFrame({"strategy": equity, "benchmark": bench_eq}, index=pd.DatetimeIndex(dates))
    return curve, held_log


def perf_stats(curve_series):
    rets = curve_series.pct_change().dropna()
    if len(rets) == 0:
        return {}
    years = (curve_series.index[-1] - curve_series.index[0]).days / 365.25
    cagr = curve_series.iloc[-1] ** (1 / years) - 1 if years > 0 else np.nan
    vol = rets.std() * np.sqrt(TRADING_DAYS)
    sharpe = (rets.mean() * TRADING_DAYS) / vol if vol else np.nan
    roll_max = curve_series.cummax()
    max_dd = ((curve_series - roll_max) / roll_max).min()
    return {"CAGR": round(cagr, 4), "vol": round(vol, 4),
            "Sharpe": round(sharpe, 2), "max_drawdown": round(max_dd, 4),
            "total_return": round(curve_series.iloc[-1] - 1, 4)}


# --------------------------------------------------------------------------- #
# Charts
# --------------------------------------------------------------------------- #
def save_charts(buckets, horizons, curve, outdir="."):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    h = horizons[len(horizons) // 2]
    fig, ax = plt.subplots(figsize=(7, 4))
    col = f"excess_{h}"
    vals = buckets[col]
    ax.bar(vals.index.astype(str), vals.values,
           color=["#2C3845" if v < 0 else "#FF4D7E" for v in vals.values])
    ax.axhline(0, color="#888", lw=0.8)
    ax.set_title(f"Avg forward excess return by score quintile ({h}d)")
    ax.set_ylabel("excess vs SPY")
    fig.tight_layout(); fig.savefig(f"{outdir}/buckets.png", dpi=130); plt.close(fig)

    if curve is not None:
        fig, ax = plt.subplots(figsize=(8, 4))
        ax.plot(curve.index, curve["strategy"], color="#FF4D7E", lw=1.6, label="Loved top-N")
        ax.plot(curve.index, curve["benchmark"], color="#8A97A6", lw=1.4, label="SPY")
        ax.set_title("Strategy vs benchmark (growth of $1)")
        ax.legend(); ax.set_ylabel("equity")
        fig.tight_layout(); fig.savefig(f"{outdir}/equity_curve.png", dpi=130); plt.close(fig)


# --------------------------------------------------------------------------- #
def main():
    ap = argparse.ArgumentParser(description="Backtest the product-love thesis.")
    ap.add_argument("--signals", help="CSV exported from the app")
    ap.add_argument("--synthetic", action="store_true", help="demo on generated prices")
    ap.add_argument("--top-n", type=int, default=5)
    ap.add_argument("--horizons", default=",".join(map(str, DEFAULT_HORIZONS)),
                    help="comma-separated trading-day horizons")
    ap.add_argument("--outdir", default=".")
    args = ap.parse_args()

    horizons = [int(x) for x in args.horizons.split(",")]

    if args.signals:
        signals = load_signals(args.signals)
        print(f"Loaded {len(signals)} signals from {args.signals}")
    else:
        signals = make_sample_signals()
        args.synthetic = True
        print(f"No --signals given: using {len(signals)} SAMPLE signals (synthetic demo).")

    tickers = sorted(set(signals["ticker"]) | {BENCH})
    start = signals["date"].min() - timedelta(days=30)
    end = signals["date"].max() + timedelta(days=int(max(horizons) * 365 / TRADING_DAYS) + 40)

    if args.synthetic:
        print(">>> SYNTHETIC PRICES — illustrative only, not real market data.")
        px = fetch_prices_synthetic(tickers, start, end, signals)
    else:
        print(f"Fetching prices for {len(tickers)} tickers via yfinance…")
        px = fetch_prices_yf(tickers, start, end)
        if BENCH not in px.columns:
            sys.exit("Could not fetch benchmark SPY.")

    fr = forward_returns(signals, px, horizons)
    if fr.empty:
        sys.exit("No signals could be matched to price history. Check tickers/dates.")

    print("\n=== 1. Information Coefficient (score vs forward excess return) ===")
    print(ic_table(fr, horizons).to_string(index=False))

    print("\n=== 2. Forward excess return by score quintile ===")
    buckets = bucket_table(fr, horizons)
    print(buckets.to_string())

    sim = strategy_sim(signals, px, top_n=args.top_n)
    curve = None
    if sim:
        curve, held = sim
        print(f"\n=== 3. Strategy: monthly top-{args.top_n} loved names vs SPY ===")
        print("Strategy:", perf_stats(curve["strategy"]))
        print("Benchmark:", perf_stats(curve["benchmark"]))

    save_charts(buckets, horizons, curve, args.outdir)
    fr.to_csv(f"{args.outdir}/forward_returns.csv", index=False)
    print(f"\nWrote {args.outdir}/forward_returns.csv, buckets.png, equity_curve.png")
    print("\nRead the IC row first: positive and stable across horizons = the love")
    print("score carries predictive content. Flat/negative = the thesis needs work.")


if __name__ == "__main__":
    main()
