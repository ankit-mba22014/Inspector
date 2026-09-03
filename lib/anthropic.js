const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isRetryable(status) {
  // 429 rate limited, 500/502/503 upstream, 529 overloaded — all transient.
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 529;
}

/**
 * Calls the Anthropic Messages API with exponential backoff + jitter on
 * transient failures — same retry shape as Swiggy MCP calls in
 * lib/swiggy/mcp.js, since Claude returns the same class of overload/rate
 * limit errors under load.
 */
export async function callClaude(body, { maxAttempts = 4 } = {}) {
  let attempt = 0;

  while (true) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });

    if (res.ok) return res.json();

    attempt += 1;
    if (attempt >= maxAttempts || !isRetryable(res.status)) {
      const err = await res.json().catch(() => ({}));
      const wrapped = new Error(err.error?.message || 'Claude API error');
      wrapped.status = res.status;
      throw wrapped;
    }

    const base = 500 * 2 ** (attempt - 1);   // 500, 1000, 2000
    await sleep(base + Math.random() * base * 0.3);
  }
}
