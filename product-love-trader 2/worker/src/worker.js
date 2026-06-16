// Cloudflare Worker: proxy between the static site and the Anthropic API.
// The API key lives here as a secret — never in the browser, never in the repo.
//
// Set up:
//   wrangler secret put ANTHROPIC_API_KEY      (required)
//   wrangler secret put PROXY_TOKEN            (optional shared token)
// Set ALLOWED_ORIGINS in wrangler.toml to your GitHub Pages origin(s).

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

function corsHeaders(origin, allowed) {
  const ok = allowed.includes("*") || allowed.includes(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin : allowed[0] || "",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, x-proxy-token",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export default {
  async fetch(request, env) {
    const allowed = (env.ALLOWED_ORIGINS || "*").split(",").map((s) => s.trim());
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin, allowed);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (request.method !== "POST")
      return new Response("Method not allowed", { status: 405, headers: cors });

    // Optional origin allowlist (defense-in-depth; CORS alone is not security).
    if (!allowed.includes("*") && origin && !allowed.includes(origin))
      return json({ error: "origin_not_allowed" }, 403, cors);

    // Optional shared token. If PROXY_TOKEN is set, the request must match.
    if (env.PROXY_TOKEN) {
      const tok = request.headers.get("x-proxy-token");
      if (tok !== env.PROXY_TOKEN) return json({ error: "bad_token" }, 401, cors);
    }

    if (!env.ANTHROPIC_API_KEY) return json({ error: "server_missing_key" }, 500, cors);

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: "invalid_json" }, 400, cors);
    }

    // Forward to Anthropic with the key injected server-side.
    const upstream = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });

    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { ...cors, "content-type": "application/json" },
    });
  },
};

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, "content-type": "application/json" },
  });
}
