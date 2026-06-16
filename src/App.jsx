import React, { useState, useEffect, useRef } from "react";
import { Search, TrendingUp, Wallet, Sliders, X, RefreshCw, AlertTriangle, Check, Trash2, Loader2, KeyRound, Download, Compass, Rocket } from "lucide-react";
import { PROXY_URL, PROXY_TOKEN } from "./config.js";

// ----- persistence (localStorage — this is a real web page, not a Claude artifact) -----
const KEY = "productlove:state:v1";
const APIKEY = "productlove:apikey";
const DEFAULTS = {
  startingCapital: 100000,
  cash: 100000,
  defaultPosition: 5000,
  requireMaterial: true,
  weights: { love: 30, reviews: 20, momentum: 20, breadth: 10, earliness: 20 },
  candidates: [],
  positions: [],
  closed: [],
  discoveries: [],
  log: [],
};
function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch (e) {}
  return { ...DEFAULTS };
}

const SUBS = [
  { key: "loveIntensity", w: "love", label: "Love intensity", hint: "How passionately people talk about it" },
  { key: "reviewQuality", w: "reviews", label: "Review quality", hint: "Rating strength × credible volume" },
  { key: "momentum", w: "momentum", label: "Momentum", hint: "Is attention accelerating" },
  { key: "sourceBreadth", w: "breadth", label: "Source breadth", hint: "Independent sources agreeing" },
  { key: "earliness", w: "earliness", label: "Earliness", hint: "Early in the adoption curve (your edge)" },
];

const MAT = {
  core: { c: "#3DD68C", label: "Core — is the company" },
  significant: { c: "#9BE36F", label: "Significant revenue share" },
  minor: { c: "#F5A623", label: "Minor — won't move the stock" },
  negligible: { c: "#FF6B6B", label: "Negligible — noise" },
};

// ----- api helpers -----
function extractText(data) {
  if (!data || !Array.isArray(data.content)) return "";
  return data.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
}
function parseLooseJSON(raw) {
  const clean = String(raw).replace(/```json/gi, "").replace(/```/g, "").trim();
  const s = clean.indexOf("{");
  const e = clean.lastIndexOf("}");
  const slice = s >= 0 && e >= 0 ? clean.slice(s, e + 1) : clean;
  return JSON.parse(slice);
}
async function callClaude(apiKey, system, user, maxTokens = 1000) {
  const usingProxy = !!PROXY_URL;
  if (!usingProxy && !apiKey) throw new Error("NO_KEY");
  const url = usingProxy ? PROXY_URL : "https://api.anthropic.com/v1/messages";
  const headers = { "content-type": "application/json" };
  if (usingProxy) {
    if (PROXY_TOKEN) headers["x-proxy-token"] = PROXY_TOKEN;
  } else {
    headers["x-api-key"] = apiKey;
    headers["anthropic-version"] = "2023-06-01";
    headers["anthropic-dangerous-direct-browser-access"] = "true";
  }
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: user }],
      tools: [{ type: "web_search_20250305", name: "web_search" }],
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error("HTTP_" + res.status + ":" + t.slice(0, 200));
  }
  const data = await res.json();
  return extractText(data);
}

const ANALYZE_SYS = `You are a financial research assistant. Given a PRODUCT name, use web search to evaluate it for a "products over brands" investing thesis: products people love early can lead the re-rating of the company that makes them.

Do all of this:
1. Identify the company that makes the product and whether that company (or its parent) is publicly traded. Give ticker + exchange. If only privately held, isPublic=false, ticker=null.
2. Judge how much people LOVE the product from reviews and discussion across multiple independent sources.
3. Judge how MATERIAL the product is to the parent company's total business: "core" (the product basically is the company), "significant", "minor", or "negligible".
4. If public, include approxPrice = most recent share price in USD (number).

Return ONLY a JSON object, no prose, no markdown fences, exactly this shape:
{"product":string,"company":string,"ticker":string|null,"exchange":string|null,"isPublic":boolean,"materiality":"core"|"significant"|"minor"|"negligible","materialityNote":string,"subscores":{"loveIntensity":int,"reviewQuality":int,"momentum":int,"sourceBreadth":int,"earliness":int},"evidence":[string,string,string],"rationale":string,"approxPrice":number|null}
All scores are integers 0-100. Max 3 short evidence bullets. rationale = one sentence.`;

const DISCOVER_SYS = `You are an equity-research scout for a "products over brands" thesis: products people love early lead the re-rating of the company that makes them. Your job is to PROACTIVELY discover investable opportunities — you are NOT given a product, you go find them.

Use web search across reviews, retailer pages, app stores, forums/communities, and trend data to surface 5-8 PRODUCTS that all of the following are true for:
1. Made by (or core to) a PUBLICLY TRADED company — give a real ticker + exchange. Exclude private companies. Exclude mega-cap products where the product is immaterial to the parent.
2. Show strong, credible LOVE early in the adoption curve: passionate reviews across multiple INDEPENDENT sources, with accelerating attention.
3. Imply HIGH GROWTH UPSIDE for the parent stock — the product is material enough to meaningfully re-rate the company (favor small/mid-caps, fast-growing segments, expanding TAM). Avoid consensus mega-caps and already-hyped names where the upside is priced in.

Prefer under-the-radar names with real evidence over obvious picks. Every opportunity must be currently publicly investable today.

Return ONLY a JSON object, no prose, no markdown fences, exactly this shape:
{"opportunities":[{"product":string,"company":string,"ticker":string,"exchange":string,"isPublic":true,"materiality":"core"|"significant"|"minor"|"negligible","materialityNote":string,"subscores":{"loveIntensity":int,"reviewQuality":int,"momentum":int,"sourceBreadth":int,"earliness":int},"growthScore":int,"upside":string,"evidence":[string,string],"rationale":string,"approxPrice":number}]}
All scores are integers 0-100. growthScore = your conviction in HIGH GROWTH UPSIDE for the stock. upside = one sentence naming the growth catalyst. Max 2 short evidence bullets each. rationale = one sentence. Return 5-8 opportunities, strongest growth upside first.`;

function composite(sub, w) {
  let num = 0, den = 0;
  SUBS.forEach((s) => {
    const wt = w[s.w] || 0;
    num += (sub?.[s.key] || 0) * wt;
    den += wt;
  });
  return den ? Math.round(num / den) : 0;
}
const money = (n) => "$" + (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
const money2 = (n) => "$" + (Number(n) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const uid = () => Math.random().toString(36).slice(2, 10);

function Ring({ score, size = 96 }) {
  const r = size / 2 - 7;
  const c = 2 * Math.PI * r;
  const off = c * (1 - score / 100);
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#2C3845" strokeWidth="7" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#FF4D7E" strokeWidth="7"
        strokeLinecap="round" strokeDasharray={c} strokeDashoffset={off}
        style={{ transition: "stroke-dashoffset .7s cubic-bezier(.2,.8,.2,1)" }} />
      <text x="50%" y="50%" dy="0.32em" textAnchor="middle" fill="#E6EBF0"
        style={{ transform: "rotate(90deg)", transformOrigin: "center", font: "600 26px JetBrains Mono, monospace" }}>
        {score}
      </text>
    </svg>
  );
}

function Bar({ label, hint, val }) {
  return (
    <div className="bar">
      <div className="bar-top">
        <span className="bar-label">{label}</span>
        <span className="bar-val">{val}</span>
      </div>
      <div className="bar-track"><div className="bar-fill" style={{ width: `${val}%` }} /></div>
      <div className="bar-hint">{hint}</div>
    </div>
  );
}

export default function App() {
  const [s, setS] = useState(loadState);
  const [apiKey, setApiKey] = useState(() => { try { return localStorage.getItem(APIKEY) || ""; } catch (e) { return ""; } });
  const [keyDraft, setKeyDraft] = useState("");
  const [tab, setTab] = useState("analyze");
  const [query, setQuery] = useState("");
  const [discoverQuery, setDiscoverQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [result, setResult] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const saveRef = useRef(null);

  const save = (next) => {
    setS(next);
    clearTimeout(saveRef.current);
    saveRef.current = setTimeout(() => {
      try { localStorage.setItem(KEY, JSON.stringify(next)); } catch (e) {}
    }, 200);
  };
  function saveKey() {
    const k = keyDraft.trim();
    try { localStorage.setItem(APIKEY, k); } catch (e) {}
    setApiKey(k); setKeyDraft(""); setErr("");
  }

  const portfolioValue = s.positions.reduce((a, p) => a + p.shares * (p.lastPrice || p.entryPrice), 0);
  const equity = s.cash + portfolioValue;
  const totalPnl = equity - s.startingCapital;
  const realized = s.closed.reduce((a, c) => a + c.realizedPnl, 0);
  const gain = (n) => (n >= 0 ? "#3DD68C" : "#FF6B6B");

  function handleErr(e) {
    const m = String(e.message || e);
    if (m === "NO_KEY") { setErr("Add your Anthropic API key in the Tune tab first — that's what powers the research."); setTab("tune"); }
    else if (m.startsWith("HTTP_401")) setErr("The API rejected that key (401). Check it in Tune.");
    else if (m.startsWith("HTTP_429")) setErr("Rate limited (429). Wait a moment and try again.");
    else if (m.startsWith("HTTP_")) setErr("API error: " + m.slice(5));
    else setErr("Couldn't read the research result. Try a more specific product name.");
  }

  function logEntry(j) {
    const sub = j.subscores || {};
    return { ts: j.analyzedAt || Date.now(), product: j.product, company: j.company, ticker: j.ticker || "", exchange: j.exchange || "", isPublic: !!j.isPublic, materiality: j.materiality, score: j.score, loveIntensity: sub.loveIntensity || 0, reviewQuality: sub.reviewQuality || 0, momentum: sub.momentum || 0, sourceBreadth: sub.sourceBreadth || 0, earliness: sub.earliness || 0, approxPrice: j.approxPrice || "" };
  }

  async function analyze() {
    const name = query.trim();
    if (!name || busy) return;
    setBusy(true); setErr(""); setResult(null);
    try {
      const txt = await callClaude(apiKey, ANALYZE_SYS, `Product: ${name}`);
      const j = parseLooseJSON(txt);
      j.id = uid();
      j.score = composite(j.subscores, s.weights);
      j.analyzedAt = Date.now();
      setResult(j);
      save({ ...s, log: [logEntry(j), ...s.log].slice(0, 1000) });
    } catch (e) { handleErr(e); } finally { setBusy(false); }
  }

  async function discover() {
    if (busy) return;
    setBusy(true); setErr("");
    const theme = discoverQuery.trim();
    const ask = theme
      ? `Focus the hunt on this theme/sector: ${theme}. Find the strongest opportunities within it.`
      : `No theme given — scan broadly for the strongest opportunities across consumer products, hardware, software, and brands.`;
    try {
      const txt = await callClaude(apiKey, DISCOVER_SYS, ask, 4000);
      const j = parseLooseJSON(txt);
      const list = Array.isArray(j.opportunities) ? j.opportunities : [];
      const found = list
        .filter((o) => o && o.product && o.ticker)
        .map((o) => ({ ...o, isPublic: o.isPublic !== false, id: uid(), score: composite(o.subscores, s.weights), analyzedAt: Date.now() }))
        .sort((a, b) => (b.growthScore || 0) - (a.growthScore || 0));
      if (found.length === 0) { setErr("The scout didn't return any usable opportunities. Try again or narrow the theme."); }
      const entries = found.map(logEntry);
      save({ ...s, discoveries: found, log: [...entries, ...s.log].slice(0, 1000) });
    } catch (e) { handleErr(e); } finally { setBusy(false); }
  }
  function clearDiscoveries() { save({ ...s, discoveries: [] }); }

  function addToWatchlist(c) {
    if (s.candidates.some((x) => x.ticker && x.ticker === c.ticker)) return;
    save({ ...s, candidates: [{ ...c }, ...s.candidates] });
  }
  function removeCandidate(id) { save({ ...s, candidates: s.candidates.filter((c) => c.id !== id) }); }

  function paperBuy(c, dollars) {
    const price = c.approxPrice;
    if (!price || price <= 0) { setErr("No price for " + (c.ticker || c.company) + " yet — refresh it in Portfolio."); return; }
    const spend = Math.min(dollars, s.cash);
    const shares = Math.floor((spend / price) * 1000) / 1000;
    if (shares <= 0) { setErr("Not enough cash for even a fractional share at " + money2(price) + "."); return; }
    const pos = { id: uid(), ticker: c.ticker, company: c.company, product: c.product, shares, entryPrice: price, lastPrice: price, entryDate: Date.now(), score: c.score, materiality: c.materiality };
    save({ ...s, cash: s.cash - shares * price, positions: [pos, ...s.positions], candidates: s.candidates.filter((x) => x.id !== c.id) });
    setTab("portfolio");
  }
  function sell(p) {
    const exit = p.lastPrice || p.entryPrice;
    const realizedPnl = p.shares * (exit - p.entryPrice);
    save({ ...s, cash: s.cash + p.shares * exit, positions: s.positions.filter((x) => x.id !== p.id), closed: [{ ...p, exitPrice: exit, exitDate: Date.now(), realizedPnl }, ...s.closed] });
  }
  async function refreshPrices() {
    if (refreshing || s.positions.length === 0) return;
    setRefreshing(true); setErr("");
    const updated = [...s.positions];
    try {
      for (let i = 0; i < updated.length; i++) {
        const txt = await callClaude(apiKey, 'Return ONLY a JSON object {"price": number} with the most recent share price in USD for the given ticker. No prose.', `Ticker: ${updated[i].ticker}`);
        const j = parseLooseJSON(txt);
        if (j.price && j.price > 0) updated[i] = { ...updated[i], lastPrice: j.price };
      }
      save({ ...s, positions: updated });
    } catch (e) { handleErr(e); save({ ...s, positions: updated }); }
    setRefreshing(false);
  }
  function setWeight(wkey, v) {
    const weights = { ...s.weights, [wkey]: v };
    const candidates = s.candidates.map((c) => ({ ...c, score: composite(c.subscores, weights) }));
    const discoveries = (s.discoveries || []).map((c) => ({ ...c, score: composite(c.subscores, weights) }));
    save({ ...s, weights, candidates, discoveries });
    if (result) setResult({ ...result, score: composite(result.subscores, weights) });
  }
  function resetAll() { save({ ...DEFAULTS }); setResult(null); setQuery(""); setTab("analyze"); }

  function exportCSV() {
    if (s.log.length === 0) { setErr("No analyses logged yet — analyze a few products first."); return; }
    const cols = ["date", "ts", "product", "company", "ticker", "exchange", "isPublic", "materiality", "score", "loveIntensity", "reviewQuality", "momentum", "sourceBreadth", "earliness", "approxPrice"];
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [cols.join(",")];
    s.log.forEach((e) => {
      const date = new Date(e.ts).toISOString().slice(0, 10);
      lines.push([date, e.ts, e.product, e.company, e.ticker, e.exchange, e.isPublic, e.materiality, e.score, e.loveIntensity, e.reviewQuality, e.momentum, e.sourceBreadth, e.earliness, e.approxPrice].map(esc).join(","));
    });
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "product-love-signals.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="root">
      <style>{CSS}</style>

      <header className="hdr">
        <div className="hdr-id">
          <div className="hdr-mark">♥</div>
          <div>
            <div className="hdr-title">PRODUCT&nbsp;LOVE</div>
            <div className="hdr-sub">paper bench · products over brands</div>
          </div>
        </div>
        <div className="hdr-stats">
          <div className="stat"><div className="stat-k">Equity</div><div className="stat-v">{money(equity)}</div></div>
          <div className="stat"><div className="stat-k">Total P&L</div><div className="stat-v" style={{ color: gain(totalPnl) }}>{totalPnl >= 0 ? "+" : ""}{money(totalPnl)}</div></div>
        </div>
      </header>

      <nav className="tabs">
        {[
          ["analyze", "Analyze", Search],
          ["discover", "Discover", Compass],
          ["watchlist", `Watchlist${s.candidates.length ? " · " + s.candidates.length : ""}`, TrendingUp],
          ["portfolio", `Portfolio${s.positions.length ? " · " + s.positions.length : ""}`, Wallet],
          ["tune", "Tune", Sliders],
        ].map(([id, label, Icon]) => (
          <button key={id} className={"tab" + (tab === id ? " on" : "")} onClick={() => setTab(id)}>
            <Icon size={15} /> <span>{label}</span>
          </button>
        ))}
      </nav>

      {err && <div className="err"><AlertTriangle size={14} /> {err} <button onClick={() => setErr("")} className="err-x"><X size={13} /></button></div>}

      <main className="main">
        {tab === "analyze" && (
          <div className="col">
            <div className="search">
              <input className="search-in" placeholder="Name a product — e.g. Oura Ring, Rhode lip, Labubu, Notion…" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") analyze(); }} />
              <button className="search-go" onClick={analyze} disabled={busy}>{busy ? <Loader2 size={16} className="spin" /> : <Search size={16} />}{busy ? "Researching" : "Analyze"}</button>
            </div>
            <p className="micro">An agent searches reviews and sources, finds the company behind the product, and scores it. Public-company prices are approximate and delayed — paper only.</p>
            {!PROXY_URL && !apiKey && <div className="warn" style={{ marginTop: 4 }}><KeyRound size={14} /> Add your Anthropic API key in <b>&nbsp;Tune&nbsp;</b> to enable research. It stays in your browser only.</div>}

            {result && <ResultCard c={result} requireMaterial={s.requireMaterial} onWatch={() => addToWatchlist(result)} onBuy={() => paperBuy(result, s.defaultPosition)} watched={s.candidates.some((x) => x.ticker && x.ticker === result.ticker)} posSize={s.defaultPosition} cash={s.cash} />}
            {!result && !busy && (
              <div className="empty"><div className="empty-h">Start with a product, not a ticker.</div><div className="empty-p">The thesis: people fall for the product before the market re-rates the company. Find the love early, check it's investable and material, then paper-buy.</div></div>
            )}
          </div>
        )}

        {tab === "discover" && (
          <div className="col">
            <div className="search">
              <input className="search-in" placeholder="Optional theme — e.g. wearables, beauty, AI hardware, restaurants…" value={discoverQuery} onChange={(e) => setDiscoverQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") discover(); }} />
              <button className="search-go" onClick={discover} disabled={busy}>{busy ? <Loader2 size={16} className="spin" /> : <Compass size={16} />}{busy ? "Scanning" : "Discover"}</button>
            </div>
            <p className="micro">An agent crawls reviews, communities, and trend data to surface loved products from <b>publicly traded</b> companies with <b>high growth upside</b> — strongest upside first. Leave the theme blank to scan broadly. Prices are approximate and delayed — paper only.</p>
            {!PROXY_URL && !apiKey && <div className="warn" style={{ marginTop: 4 }}><KeyRound size={14} /> Add your Anthropic API key in <b>&nbsp;Tune&nbsp;</b> to enable the scout. It stays in your browser only.</div>}

            {s.discoveries?.length > 0 && (
              <div className="disc-bar">
                <span className="disc-count">{s.discoveries.length} {s.discoveries.length === 1 ? "opportunity" : "opportunities"} found</span>
                <button className="disc-clear" onClick={clearDiscoveries}><X size={13} /> Clear</button>
              </div>
            )}
            {s.discoveries?.map((c) => (
              <ResultCard key={c.id} c={c} requireMaterial={s.requireMaterial} onWatch={() => addToWatchlist(c)} onBuy={() => paperBuy(c, s.defaultPosition)} watched={s.candidates.some((x) => x.ticker && x.ticker === c.ticker)} posSize={s.defaultPosition} cash={s.cash} />
            ))}
            {(!s.discoveries || s.discoveries.length === 0) && !busy && (
              <div className="empty"><div className="empty-h">Let the scout hunt for you.</div><div className="empty-p">Instead of naming a product, send an agent to crawl the web for loved products behind publicly traded companies with real growth upside. Review what it finds, then watch or paper-buy.</div></div>
            )}
            {busy && (!s.discoveries || s.discoveries.length === 0) && (
              <div className="empty"><div className="empty-h"><Loader2 size={16} className="spin" /> Scanning the web…</div><div className="empty-p">Searching reviews and trend data across sources. This takes a bit longer than a single analysis.</div></div>
            )}
          </div>
        )}

        {tab === "watchlist" && (
          <div className="col">
            {s.candidates.length === 0 ? (
              <div className="empty"><div className="empty-h">Watchlist is empty.</div><div className="empty-p">Analyze a product and save it here to track the score as you tune your weights.</div></div>
            ) : s.candidates.map((c) => (
              <div key={c.id} className="row">
                <Ring score={c.score} size={62} />
                <div className="row-mid">
                  <div className="row-top"><span className="row-prod">{c.product}</span>{c.ticker && <span className="tick">{c.ticker}</span>}</div>
                  <div className="row-co">{c.company}</div>
                  <MatBadge m={c.materiality} />
                </div>
                <div className="row-act">
                  {c.isPublic ? <button className="btn-buy sm" onClick={() => paperBuy(c, s.defaultPosition)}>Buy {money(s.defaultPosition)}</button> : <span className="priv">Private</span>}
                  <button className="icon-btn" onClick={() => removeCandidate(c.id)}><Trash2 size={15} /></button>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === "portfolio" && (
          <div className="col">
            <div className="pf-summary">
              <div><div className="stat-k">Cash</div><div className="stat-v sm">{money(s.cash)}</div></div>
              <div><div className="stat-k">Holdings</div><div className="stat-v sm">{money(portfolioValue)}</div></div>
              <div><div className="stat-k">Realized</div><div className="stat-v sm" style={{ color: gain(realized) }}>{realized >= 0 ? "+" : ""}{money(realized)}</div></div>
              <button className="btn-refresh" onClick={refreshPrices} disabled={refreshing || s.positions.length === 0}>{refreshing ? <Loader2 size={14} className="spin" /> : <RefreshCw size={14} />} Mark to market</button>
            </div>
            {s.positions.length === 0 ? (
              <div className="empty"><div className="empty-h">No open positions.</div><div className="empty-p">Paper-buy from Analyze or your Watchlist. Then mark to market to see how the love thesis plays out.</div></div>
            ) : s.positions.map((p) => {
              const last = p.lastPrice || p.entryPrice; const val = p.shares * last; const pnl = p.shares * (last - p.entryPrice); const pct = ((last - p.entryPrice) / p.entryPrice) * 100;
              return (
                <div key={p.id} className="pos">
                  <div className="pos-l">
                    <div className="row-top"><span className="tick big">{p.ticker}</span><MatBadge m={p.materiality} small /></div>
                    <div className="row-co">{p.product} · {p.company}</div>
                    <div className="pos-meta">{p.shares} sh @ {money2(p.entryPrice)} → {money2(last)}</div>
                  </div>
                  <div className="pos-r">
                    <div className="pos-val">{money(val)}</div>
                    <div className="pos-pnl" style={{ color: gain(pnl) }}>{pnl >= 0 ? "+" : ""}{money(pnl)} ({pct >= 0 ? "+" : ""}{pct.toFixed(1)}%)</div>
                    <button className="btn-sell" onClick={() => sell(p)}>Sell</button>
                  </div>
                </div>
              );
            })}
            {s.closed.length > 0 && (
              <div className="closed">
                <div className="closed-h">Closed</div>
                {s.closed.map((c) => (
                  <div key={c.id} className="closed-row"><span className="tick">{c.ticker}</span><span className="closed-prod">{c.product}</span><span style={{ color: gain(c.realizedPnl), fontFamily: "JetBrains Mono, monospace" }}>{c.realizedPnl >= 0 ? "+" : ""}{money(c.realizedPnl)}</span></div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "tune" && (
          <div className="col">
            <div className="panel">
              <div className="panel-h">Research access</div>
              {PROXY_URL ? (
                <div className="panel-sub">Using a shared proxy — no key needed in this browser. Requests route through your Worker, which holds the key server-side.</div>
              ) : (<>
                <div className="panel-sub">Powers the research agent. Stored only in this browser (localStorage) — never sent anywhere but Anthropic, never in your repo.</div>
                <div className="search">
                  <input className="search-in" type="password" placeholder={apiKey ? "Key saved ✓ — paste to replace" : "sk-ant-…"} value={keyDraft} onChange={(e) => setKeyDraft(e.target.value)} />
                  <button className="search-go" onClick={saveKey} disabled={!keyDraft.trim()}><KeyRound size={15} />Save</button>
                </div>
              </>)}
            </div>

            <div className="panel">
              <div className="panel-h">Score weights</div>
              <div className="panel-sub">How much each signal counts toward the Product Love Score. Changes recompute every saved candidate instantly.</div>
              {SUBS.map((sub) => (
                <div key={sub.w} className="slider">
                  <div className="slider-top"><span>{sub.label}</span><span className="slider-val">{s.weights[sub.w]}</span></div>
                  <input type="range" min="0" max="100" value={s.weights[sub.w]} onChange={(e) => setWeight(sub.w, Number(e.target.value))} />
                  <div className="bar-hint">{sub.hint}</div>
                </div>
              ))}
            </div>

            <div className="panel">
              <div className="panel-h">Trading</div>
              <div className="field"><label>Starting capital</label><input type="number" value={s.startingCapital} onChange={(e) => save({ ...s, startingCapital: Number(e.target.value) })} /></div>
              <div className="field"><label>Default position size</label><input type="number" value={s.defaultPosition} onChange={(e) => save({ ...s, defaultPosition: Number(e.target.value) })} /></div>
              <label className="toggle"><input type="checkbox" checked={s.requireMaterial} onChange={(e) => save({ ...s, requireMaterial: e.target.checked })} /><span>Warn when a product isn't material to its parent company</span></label>
            </div>

            <div className="panel">
              <div className="panel-h">Backtest data</div>
              <div className="panel-sub">{s.log.length} {s.log.length === 1 ? "analysis" : "analyses"} logged. Export to feed the Python backtest harness — each row is a timestamped signal it can test against forward returns.</div>
              <button className="btn-export" onClick={exportCSV}><Download size={15} /> Export signals (CSV)</button>
            </div>

            <button className="btn-reset" onClick={resetAll}><Trash2 size={14} /> Reset bench to {money(DEFAULTS.startingCapital)}</button>
            <p className="micro">A paper sandbox for testing a thesis. Prices are web-sourced approximations, not live quotes, and nothing here is investment advice — you set the criteria.</p>
          </div>
        )}
      </main>
    </div>
  );
}

function MatBadge({ m, small }) {
  const x = MAT[m] || MAT.minor;
  return <span className={"mat" + (small ? " small" : "")} style={{ color: x.c, borderColor: x.c + "55", background: x.c + "12" }}>{x.label}</span>;
}

function ResultCard({ c, requireMaterial, onWatch, onBuy, watched, posSize, cash }) {
  const weak = requireMaterial && (c.materiality === "minor" || c.materiality === "negligible");
  return (
    <div className="card">
      <div className="card-head">
        <Ring score={c.score} />
        <div className="card-id">
          <div className="card-prod">{c.product}</div>
          <div className="card-co">{c.company}{c.ticker ? <span className="tick big">{c.ticker}</span> : <span className="priv">Private</span>}{c.exchange && <span className="exch">{c.exchange}</span>}</div>
          <MatBadge m={c.materiality} />
          {c.approxPrice && <div className="price">≈ {money2(c.approxPrice)} <span className="approx">approx</span></div>}
        </div>
      </div>
      <div className="rationale">{c.rationale}</div>
      {(c.upside || typeof c.growthScore === "number") && (
        <div className="upside">
          <div className="upside-h"><Rocket size={13} /> Growth upside{typeof c.growthScore === "number" ? <span className="upside-score">{c.growthScore}</span> : null}</div>
          {c.upside && <div className="upside-t">{c.upside}</div>}
        </div>
      )}
      <div className="bars">{SUBS.map((sub) => <Bar key={sub.key} label={sub.label} hint={sub.hint} val={c.subscores?.[sub.key] || 0} />)}</div>
      {c.evidence?.length > 0 && (
        <div className="evidence"><div className="ev-h">Signals found</div>{c.evidence.filter(Boolean).map((e, i) => <div key={i} className="ev"><Check size={13} /> {e}</div>)}</div>
      )}
      <div className="mat-note">{c.materialityNote}</div>
      {weak && <div className="warn"><AlertTriangle size={14} /> Loved, but it's a small piece of {c.company}. The product can win without moving the stock — your edge needs materiality.</div>}
      <div className="card-actions">
        <button className="btn-watch" onClick={onWatch} disabled={watched}>{watched ? "On watchlist" : "Add to watchlist"}</button>
        {c.isPublic ? <button className={"btn-buy" + (weak ? " caution" : "")} onClick={onBuy} disabled={!c.approxPrice || posSize > cash + 0.01}>{weak ? "Buy anyway " : "Paper buy "}{money(posSize)}</button> : <button className="btn-buy" disabled>Not publicly investable</button>}
      </div>
    </div>
  );
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=Inter:wght@400;500;600&family=JetBrains+Mono:wght@400;500;600&display=swap');
* { box-sizing: border-box; }
body { margin: 0; }
.root { min-height: 100vh; background: #0F141A; color: #E6EBF0; font-family: Inter, system-ui, sans-serif; -webkit-font-smoothing: antialiased; }
.spin { animation: sp 1s linear infinite; } @keyframes sp { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spin { animation: none; } }
.hdr { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 18px 18px 14px; max-width: 760px; margin: 0 auto; flex-wrap: wrap; }
.hdr-id { display: flex; align-items: center; gap: 12px; }
.hdr-mark { width: 38px; height: 38px; display: grid; place-items: center; border-radius: 11px; background: linear-gradient(145deg,#FF4D7E,#C2255C); color: #fff; font-size: 19px; box-shadow: 0 4px 16px #FF4D7E40; }
.hdr-title { font-family: 'Space Grotesk', sans-serif; font-weight: 700; letter-spacing: .14em; font-size: 15px; }
.hdr-sub { color: #8A97A6; font-size: 11px; letter-spacing: .03em; }
.hdr-stats { display: flex; gap: 22px; }
.stat-k { color: #8A97A6; font-size: 10px; letter-spacing: .12em; text-transform: uppercase; }
.stat-v { font-family: 'JetBrains Mono', monospace; font-weight: 600; font-size: 21px; }
.stat-v.sm { font-size: 16px; }
.tabs { display: flex; gap: 4px; padding: 0 14px; max-width: 760px; margin: 0 auto; border-bottom: 1px solid #1E2730; overflow-x: auto; }
.tab { display: flex; align-items: center; gap: 6px; background: none; border: none; color: #8A97A6; padding: 11px 12px; font-size: 13px; font-weight: 500; cursor: pointer; border-bottom: 2px solid transparent; white-space: nowrap; font-family: inherit; }
.tab.on { color: #FF4D7E; border-bottom-color: #FF4D7E; }
.tab:hover { color: #E6EBF0; }
.main { max-width: 760px; margin: 0 auto; padding: 18px 14px 60px; }
.col { display: flex; flex-direction: column; gap: 14px; }
.err { max-width: 760px; margin: 12px auto 0; background: #FF6B6B14; border: 1px solid #FF6B6B44; color: #FFB4B4; padding: 9px 12px; border-radius: 9px; font-size: 13px; display: flex; align-items: center; gap: 8px; }
.err-x { margin-left: auto; background: none; border: none; color: #FFB4B4; cursor: pointer; display: flex; }
.search { display: flex; gap: 8px; }
.search-in { flex: 1; background: #181F28; border: 1px solid #2C3845; color: #E6EBF0; padding: 13px 14px; border-radius: 11px; font-size: 14px; font-family: inherit; min-width: 0; }
.search-in:focus { outline: none; border-color: #FF4D7E; }
.search-in::placeholder { color: #5C6878; }
.search-go { display: flex; align-items: center; gap: 7px; background: #FF4D7E; color: #fff; border: none; padding: 0 18px; border-radius: 11px; font-weight: 600; font-size: 14px; cursor: pointer; font-family: inherit; white-space: nowrap; }
.search-go:disabled { opacity: .6; cursor: default; }
.micro { color: #6B7886; font-size: 11.5px; line-height: 1.5; margin: 0; }
.empty { border: 1px dashed #2C3845; border-radius: 14px; padding: 28px 22px; text-align: center; margin-top: 6px; }
.empty-h { font-family: 'Space Grotesk', sans-serif; font-weight: 600; font-size: 16px; margin-bottom: 7px; }
.empty-p { color: #8A97A6; font-size: 13px; line-height: 1.55; max-width: 420px; margin: 0 auto; }
.card { background: #161D26; border: 1px solid #28323E; border-radius: 16px; padding: 18px; }
.card-head { display: flex; gap: 16px; align-items: center; }
.card-id { flex: 1; min-width: 0; }
.card-prod { font-family: 'Space Grotesk', sans-serif; font-weight: 700; font-size: 20px; line-height: 1.15; }
.card-co { color: #8A97A6; font-size: 13px; margin: 4px 0 8px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.tick { font-family: 'JetBrains Mono', monospace; font-weight: 600; color: #E6EBF0; background: #222D38; padding: 2px 7px; border-radius: 6px; font-size: 12px; }
.tick.big { font-size: 13px; }
.exch { font-size: 11px; color: #5C6878; }
.priv { font-size: 12px; color: #F5A623; font-weight: 500; }
.price { font-family: 'JetBrains Mono', monospace; font-size: 14px; margin-top: 8px; }
.approx { color: #5C6878; font-size: 10px; }
.mat { display: inline-block; font-size: 11px; font-weight: 600; padding: 3px 9px; border-radius: 999px; border: 1px solid; }
.mat.small { font-size: 10px; padding: 2px 7px; }
.rationale { margin: 14px 0 4px; font-size: 14px; line-height: 1.5; color: #C9D2DC; }
.upside { background: #102019; border: 1px solid #1F4A36; border-radius: 10px; padding: 10px 12px; margin: 12px 0 2px; }
.upside-h { display: flex; align-items: center; gap: 7px; font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: #3DD68C; font-weight: 600; }
.upside-score { font-family: 'JetBrains Mono', monospace; background: #3DD68C; color: #06120C; border-radius: 6px; padding: 1px 7px; font-size: 11px; letter-spacing: 0; }
.upside-t { font-size: 13px; line-height: 1.5; color: #C9D2DC; margin-top: 7px; }
.disc-bar { display: flex; align-items: center; justify-content: space-between; }
.disc-count { font-size: 12px; color: #8A97A6; }
.disc-clear { display: flex; align-items: center; gap: 5px; background: none; border: 1px solid #2C3845; color: #8A97A6; padding: 5px 10px; border-radius: 8px; font-size: 12px; cursor: pointer; font-family: inherit; }
.disc-clear:hover { color: #FF6B6B; border-color: #FF6B6B44; }
.bars { display: grid; grid-template-columns: 1fr 1fr; gap: 12px 18px; margin: 16px 0; }
.bar-top { display: flex; justify-content: space-between; align-items: baseline; }
.bar-label { font-size: 12px; font-weight: 500; }
.bar-val { font-family: 'JetBrains Mono', monospace; font-size: 12px; color: #8A97A6; }
.bar-track { height: 5px; background: #222D38; border-radius: 3px; margin: 5px 0 3px; overflow: hidden; }
.bar-fill { height: 100%; background: linear-gradient(90deg,#FF4D7E,#FF7DA0); border-radius: 3px; transition: width .6s cubic-bezier(.2,.8,.2,1); }
.bar-hint { font-size: 10.5px; color: #5C6878; line-height: 1.3; }
.evidence { background: #11171F; border-radius: 10px; padding: 12px 13px; margin-bottom: 12px; }
.ev-h { font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: #6B7886; margin-bottom: 8px; }
.ev { display: flex; gap: 8px; align-items: flex-start; font-size: 13px; color: #C9D2DC; line-height: 1.45; margin-bottom: 6px; }
.ev svg { color: #3DD68C; flex-shrink: 0; margin-top: 2px; }
.mat-note { font-size: 12.5px; color: #8A97A6; line-height: 1.5; margin-bottom: 12px; }
.warn { display: flex; gap: 8px; align-items: center; background: #F5A62314; border: 1px solid #F5A62344; color: #F5C572; padding: 10px 12px; border-radius: 10px; font-size: 12.5px; line-height: 1.45; margin-bottom: 14px; }
.card-actions { display: flex; gap: 9px; }
.btn-watch { flex: 1; background: #222D38; border: 1px solid #2C3845; color: #E6EBF0; padding: 11px; border-radius: 10px; font-weight: 600; font-size: 13px; cursor: pointer; font-family: inherit; }
.btn-watch:disabled { color: #5C6878; cursor: default; }
.btn-buy { flex: 1; background: #FF4D7E; border: none; color: #fff; padding: 11px; border-radius: 10px; font-weight: 600; font-size: 13px; cursor: pointer; font-family: inherit; }
.btn-buy:disabled { opacity: .45; cursor: default; }
.btn-buy.caution { background: #F5A623; color: #1A1206; }
.btn-buy.sm { flex: none; padding: 8px 12px; font-size: 12px; }
.row { display: flex; align-items: center; gap: 13px; background: #161D26; border: 1px solid #28323E; border-radius: 13px; padding: 12px 14px; }
.row-mid { flex: 1; min-width: 0; }
.row-top { display: flex; align-items: center; gap: 8px; }
.row-prod { font-weight: 600; font-size: 14px; }
.row-co { color: #8A97A6; font-size: 12px; margin: 3px 0 6px; }
.row-act { display: flex; align-items: center; gap: 8px; }
.icon-btn { background: none; border: none; color: #6B7886; cursor: pointer; padding: 6px; display: flex; }
.icon-btn:hover { color: #FF6B6B; }
.pf-summary { display: flex; gap: 18px; align-items: center; background: #161D26; border: 1px solid #28323E; border-radius: 13px; padding: 14px 16px; flex-wrap: wrap; }
.btn-refresh { margin-left: auto; display: flex; align-items: center; gap: 7px; background: #222D38; border: 1px solid #2C3845; color: #E6EBF0; padding: 9px 13px; border-radius: 9px; font-size: 12.5px; font-weight: 500; cursor: pointer; font-family: inherit; }
.btn-refresh:disabled { opacity: .5; cursor: default; }
.pos { display: flex; justify-content: space-between; gap: 12px; background: #161D26; border: 1px solid #28323E; border-radius: 13px; padding: 13px 15px; }
.pos-meta { font-family: 'JetBrains Mono', monospace; font-size: 11px; color: #6B7886; margin-top: 5px; }
.pos-r { text-align: right; }
.pos-val { font-family: 'JetBrains Mono', monospace; font-weight: 600; font-size: 15px; }
.pos-pnl { font-family: 'JetBrains Mono', monospace; font-size: 12px; margin: 3px 0 7px; }
.btn-sell { background: none; border: 1px solid #3A4654; color: #C9D2DC; padding: 5px 14px; border-radius: 8px; font-size: 12px; font-weight: 500; cursor: pointer; font-family: inherit; }
.btn-sell:hover { border-color: #FF6B6B; color: #FF6B6B; }
.closed { margin-top: 8px; }
.closed-h { font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: #6B7886; margin-bottom: 8px; }
.closed-row { display: flex; align-items: center; gap: 12px; padding: 8px 4px; border-bottom: 1px solid #1E2730; font-size: 13px; }
.closed-prod { color: #8A97A6; flex: 1; }
.panel { background: #161D26; border: 1px solid #28323E; border-radius: 14px; padding: 16px 18px; }
.panel-h { font-family: 'Space Grotesk', sans-serif; font-weight: 600; font-size: 15px; margin-bottom: 4px; }
.panel-sub { color: #8A97A6; font-size: 12px; line-height: 1.5; margin-bottom: 16px; }
.slider { margin-bottom: 16px; }
.slider-top { display: flex; justify-content: space-between; font-size: 13px; font-weight: 500; margin-bottom: 7px; }
.slider-val { font-family: 'JetBrains Mono', monospace; color: #FF4D7E; }
input[type=range] { width: 100%; accent-color: #FF4D7E; }
.field { margin-bottom: 14px; }
.field label { display: block; font-size: 12px; color: #8A97A6; margin-bottom: 6px; }
.field input { width: 100%; background: #11171F; border: 1px solid #2C3845; color: #E6EBF0; padding: 10px 12px; border-radius: 9px; font-family: 'JetBrains Mono', monospace; font-size: 14px; }
.field input:focus { outline: none; border-color: #FF4D7E; }
.toggle { display: flex; align-items: center; gap: 10px; font-size: 13px; color: #C9D2DC; cursor: pointer; }
.toggle input { accent-color: #FF4D7E; width: 16px; height: 16px; }
.btn-reset { display: flex; align-items: center; justify-content: center; gap: 8px; background: none; border: 1px solid #3A2630; color: #FF8FA8; padding: 11px; border-radius: 10px; font-size: 13px; font-weight: 500; cursor: pointer; font-family: inherit; }
.btn-reset:hover { background: #FF6B6B14; }
.btn-export { display: flex; align-items: center; justify-content: center; gap: 8px; width: 100%; background: #222D38; border: 1px solid #2C3845; color: #E6EBF0; padding: 11px; border-radius: 10px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: inherit; }
.btn-export:hover { border-color: #FF4D7E; }
@media (max-width: 560px) { .hdr-stats { gap: 16px; } .stat-v { font-size: 18px; } .bars { grid-template-columns: 1fr; } }
`;
