// Vercel serverless function: proxy between the static site and the Anthropic API.
// The API key lives here as an environment variable — never in the browser,
// never in the repo. This mirrors worker/src/worker.js for hosts that aren't
// Cloudflare.
//
// Set up (Vercel dashboard → Project → Settings → Environment Variables):
//   ANTHROPIC_API_KEY   (required) your Anthropic key
//   PROXY_TOKEN         (optional) shared token; if set, callers must match it
//   ALLOWED_ORIGINS     (optional) comma-separated origins; defaults to "*"
//
// Point the app at this function by setting VITE_PROXY_URL=/api/claude
// (same-origin when the whole app is hosted on Vercel — no CORS needed).

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

function corsHeaders(origin, allowed) {
  const ok = allowed.includes("*") || allowed.includes(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin || "*" : allowed[0] || "",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, x-proxy-token",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export default async function handler(req, res) {
  const allowed = (process.env.ALLOWED_ORIGINS || "*").split(",").map((s) => s.trim());
  const origin = req.headers.origin || "";
  const cors = corsHeaders(origin, allowed);
  for (const [k, v] of Object.entries(cors)) res.setHeader(k, v);

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

  // Optional origin allowlist (defense-in-depth; CORS alone is not security).
  if (!allowed.includes("*") && origin && !allowed.includes(origin))
    return res.status(403).json({ error: "origin_not_allowed" });

  // Optional shared token. If PROXY_TOKEN is set, the request must match.
  if (process.env.PROXY_TOKEN) {
    if (req.headers["x-proxy-token"] !== process.env.PROXY_TOKEN)
      return res.status(401).json({ error: "bad_token" });
  }

  if (!process.env.ANTHROPIC_API_KEY)
    return res.status(500).json({ error: "server_missing_key" });

  // Vercel parses JSON bodies automatically when content-type is application/json.
  const body = req.body;
  if (!body || typeof body !== "object")
    return res.status(400).json({ error: "invalid_json" });

  // Forward to Anthropic with the key injected server-side.
  const upstream = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
  });

  const text = await upstream.text();
  res.status(upstream.status);
  res.setHeader("content-type", "application/json");
  return res.send(text);
}
