// Leave PROXY_URL empty for bring-your-own-key mode (each user pastes their own
// Anthropic key, stored only in their browser).
//
// Set PROXY_URL to your deployed Cloudflare Worker URL to run the site with no key
// in the browser — the key lives in the Worker. See worker/README.md.
export const PROXY_URL = "";

// Only used if your Worker has PROXY_TOKEN set. Note: anything here ships in the
// public bundle, so treat it as a rotate-able throttle, not a real secret.
export const PROXY_TOKEN = "";
