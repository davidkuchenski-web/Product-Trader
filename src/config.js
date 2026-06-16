// Both values come from build-time env vars (set them in your host's dashboard
// or a local .env file — see .env.example). They are baked into the bundle at
// build time by Vite, so only put public, non-secret values here.
//
// Leave VITE_PROXY_URL unset for bring-your-own-key mode (each user pastes their
// own Anthropic key, stored only in their browser).
//
// Set VITE_PROXY_URL to a deployed proxy to run the site with no key in the
// browser — the key lives on the server. Use "/api/claude" for the bundled
// Vercel function (see api/README.md), or a full Worker URL (see worker/README.md).
export const PROXY_URL = import.meta.env.VITE_PROXY_URL || "";

// Only used if your proxy enforces a shared token. Note: anything here ships in
// the public bundle, so treat it as a rotate-able throttle, not a real secret.
export const PROXY_TOKEN = import.meta.env.VITE_PROXY_TOKEN || "";
