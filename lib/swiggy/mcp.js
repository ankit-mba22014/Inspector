/**
 * Swiggy MCP client.
 *
 * Tool calls go to server-specific paths on the base host:
 *   POST https://mcp.swiggy.com/im       — Instamart
 *   POST https://mcp.swiggy.com/food     — Food
 *   POST https://mcp.swiggy.com/dineout  — Dineout
 */

const BASE = process.env.SWIGGY_BASE_URL || 'https://mcp.swiggy.com';

export class SwiggyMCPError extends Error {
  constructor(message, { kind, status, rpcCode, retryable, details, sessionId } = {}) {
    super(message);
    this.name = 'SwiggyMCPError';
    this.kind = kind;            // auth | bad_input | upstream | domain | internal | transport
    this.status = status;
    this.rpcCode = rpcCode;
    this.retryable = !!retryable;
    this.details = details;
    this.sessionId = sessionId;
  }
}

/**
 * Classifies a failure per Swiggy's error-codes page. A symbolic `error.code`
 * is on their roadmap but isn't emitted yet, so we go by HTTP status,
 * JSON-RPC code, and the message text.
 */
function classify({ status, rpcCode, message }) {
  const msg = (message || '').toLowerCase();

  if (status === 401 || rpcCode === -32001) {
    return { kind: 'auth', retryable: false };
  }
  if (status === 419) return { kind: 'auth', retryable: false };
  if (status === 429) return { kind: 'rate_limited', retryable: true };
  if (status === 504 || msg.includes('timeout')) {
    return { kind: 'upstream', retryable: true };
  }
  if (status === 502 || status === 503) return { kind: 'upstream', retryable: true };
  if (status === 500 || rpcCode === -32603) {
    return { kind: 'internal', retryable: true };
  }
  if (status === 400 && (msg.startsWith('invalid') || msg.startsWith('missing'))) {
    return { kind: 'bad_input', retryable: false };
  }
  // HTTP 200 with success:false — out of stock, min order not met, etc.
  return { kind: 'domain', retryable: false };
}

/**
 * Turns Swiggy's raw error text into something a shopper can act on.
 * Domain failures — out of stock, price moved, store shut — aren't bugs, and
 * shouldn't read like one.
 */
export function friendlyError(err) {
  const m = (err?.message || '').toLowerCase();

  if (err?.kind === 'auth') return 'Your Swiggy session has ended. Sign in again to continue.';
  if (err?.kind === 'rate_limited') return "Swiggy is busy right now. We'll retry in a moment.";
  if (err?.kind === 'upstream' || err?.kind === 'internal') {
    return "Swiggy didn't respond just then. Please try again.";
  }

  if (m.includes('out of stock') || m.includes('unavailable')) {
    return 'Something in your cart just went out of stock. Review the items and try again.';
  }
  if (m.includes('price') && m.includes('chang')) {
    return 'Prices changed while you were shopping. Check your cart before paying.';
  }
  if (m.includes('minimum')) {
    return 'This order is below Instamart\u2019s minimum. Add a little more to your cart.';
  }
  if (m.includes('closed') || m.includes('not serviceable') || m.includes('not available at')) {
    return "This store isn't delivering to your address right now. Try a different address.";
  }
  if (m.includes('address')) {
    return 'There\u2019s a problem with the delivery address. Pick a different one and try again.';
  }

  // Fall back to Swiggy's own wording — usually clearer than anything generic.
  return err?.message || 'Something went wrong. Please try again.';
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Exponential backoff with jitter, per Swiggy's recommended pattern. */
async function withRetry(fn, { maxAttempts = 4, budgetMs = 30000 } = {}) {
  const startedAt = Date.now();
  let attempt = 0;

  while (true) {
    try {
      return await fn();
    } catch (err) {
      attempt += 1;
      const outOfBudget = Date.now() - startedAt > budgetMs;
      if (attempt >= maxAttempts || outOfBudget || !err?.retryable) throw err;

      const base = 500 * 2 ** (attempt - 1);      // 500, 1000, 2000, 4000
      await sleep(base + Math.random() * base * 0.3);
    }
  }
}

/**
 * Calls a tool on a Swiggy MCP server.
 *
 * @param {'im'|'food'|'dineout'} server
 * @param {object} [opts] - { retry: false } for non-idempotent calls like checkout
 */
export async function callMCPTool(server, toolName, args, accessToken, opts = {}) {
  if (!accessToken) {
    throw new SwiggyMCPError('No Swiggy session', { kind: 'auth' });
  }

  const attempt = async () => {
    const res = await fetch(`${BASE}/${server}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: crypto.randomUUID(),
        method: 'tools/call',
        params: { name: toolName, arguments: args },
      }),
    });

    // Swiggy tags every call with a session id — worth logging, since support
    // can trace the whole request path from it.
    const sessionId = res.headers.get('x-session-id') || res.headers.get('mcp-session-id');

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const c = classify({ status: res.status, message: text });
      throw new SwiggyMCPError(
        `${toolName} failed (${res.status})`,
        { ...c, status: res.status, details: text.slice(0, 500), sessionId }
      );
    }

    const data = await res.json();

    if (data.error) {
      const c = classify({ rpcCode: data.error.code, message: data.error.message });
      throw new SwiggyMCPError(data.error.message || 'MCP transport error', {
        ...c, rpcCode: data.error.code, details: data.error, sessionId,
      });
    }

    const result = data.result;

    // Tool-level failures arrive as HTTP 200 with isError / success:false —
    // the envelope's own success flag isn't the thing to check.
    const sc = result?.structuredContent;
    if (result?.isError || sc?.success === false) {
      const e = sc?.error || {};
      const message =
        e.message ||
        result?.content?.find((c) => c.type === 'text')?.text ||
        `${toolName} returned an error`;
      const c = classify({ status: 200, message });
      throw new SwiggyMCPError(message, {
        ...c,
        details: { reportLink: e.reportLink, reportHint: e.reportHint, hint: sc?.hint },
        sessionId,
      });
    }

    // Swiggy signals upcoming breaking changes here — surface rather than swallow.
    const deprecation = result?._meta?.['swiggy.deprecation'];
    if (deprecation) {
      console.warn(`[swiggy] ${toolName} deprecation notice:`, deprecation);
    }

    if (sessionId) {
      console.log(JSON.stringify({
        event: 'mcp_tool_call', tool: toolName, session_id: sessionId, status: 'ok',
      }));
    }

    return result;
  };

  return opts.retry === false ? attempt() : withRetry(attempt);
}

/** Lists every tool a server exposes — useful for discovery. */
export async function listTools(server, accessToken) {
  const res = await fetch(`${BASE}/${server}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: crypto.randomUUID(), method: 'tools/list', params: {} }),
  });
  if (!res.ok) throw new SwiggyMCPError(`tools/list failed (${res.status})`, { status: res.status });
  const data = await res.json();
  if (data.error) throw new SwiggyMCPError(data.error.message, { rpcCode: data.error.code });
  return data.result;
}

const im = (tool, args, token, opts) => callMCPTool('im', tool, args, token, opts);

export const instamart = {
  // --- Discover ---
  getAddresses: (token) => im('get_addresses', {}, token),
  createAddress: (address, token) => im('create_address', address, token),
  searchProducts: (query, addressId, token) => im('search_products', { query, addressId }, token),
  yourGoToItems: (addressId, token) => im('your_go_to_items', { addressId }, token),

  // --- Cart ---
  getCart: (token) => im('get_cart', {}, token),
  // Replaces the entire cart with the items given. Idempotent on session.
  updateCart: (items, selectedAddressId, token) =>
    im('update_cart', { items, selectedAddressId }, token),
  clearCart: (token) => im('clear_cart', {}, token),

  // --- Payment ---
  getPaymentOptions: (token) => im('get_payment_options', {}, token),

  /**
   * Creates the order.
   *
   *   Cash:          { addressId, paymentMethod: 'Cash' }
   *   UPI app:       { addressId, paymentMethod: 'UPI', intentApp: '<method id>' }
   *   UPI scan-QR:   { addressId, paymentMethod: 'UPI', generateUPIQR: true }
   *
   * NOT idempotent — never blind-retry. On failure, check get_orders first.
   */
  checkout: ({ addressId, paymentMethod, intentApp, generateUPIQR }, token) => {
    const args = { addressId };
    if (paymentMethod) args.paymentMethod = paymentMethod;
    if (intentApp) args.intentApp = intentApp;
    if (generateUPIQR) args.generateUPIQR = true;
    return im('checkout', args, token, { retry: false });
  },

  // Long-poll the server holds ~19s. Never tight-loop.
  checkPaymentStatus: (paasId, orderId, token) =>
    im('check_payment_status', orderId ? { paasId, orderId } : { paasId }, token),

  // Instamart takes orderId + paasId (Food's signature differs). Idempotent.
  confirmOrder: (orderId, paasId, token) =>
    im('confirm_order', paasId ? { orderId, paasId } : { orderId }, token),

  // --- Track ---
  trackOrder: (orderId, lat, lng, token) => im('track_order', { orderId, lat, lng }, token),
  getDeliveryStatus: (orderId, addressId, token) =>
    im('get_delivery_status', { orderId, addressId }, token),
  getOrders: (opts, token) => im('get_orders', opts || {}, token),
  getOrderDetails: (orderId, token) => im('get_order_details', { orderId }, token),

  reportError: (tool, errorMessage, token) =>
    im('report_error', { tool, errorMessage }, token),
};
