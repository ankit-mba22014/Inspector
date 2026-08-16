/**
 * Swiggy MCP response normalisation.
 *
 * Every tool result is wrapped:
 *   { content: [{type:'text', text}], structuredContent: { success, data, message } }
 *
 * The real payload usually sits at structuredContent.data.
 */

export function unwrap(raw) {
  if (!raw) return {};
  const sc = raw.structuredContent || raw;
  return sc.data || sc;
}

export function summaryText(raw) {
  return raw?.content?.find((c) => c.type === 'text')?.text || '';
}

// ---------- Addresses ----------
// Shape: structuredContent.addresses[] = { id, addressLine, addressTag, addressCategory }
// (addresses sit directly on structuredContent, NOT under .data)

export function extractAddresses(raw) {
  const sc = raw?.structuredContent || raw || {};
  const list = sc.addresses || sc.data?.addresses || [];
  return list
    .map((a) => ({
      id: a.id || a.addressId,
      label: a.addressTag || a.addressCategory || 'Address',
      fullAddress: a.addressLine || a.fullAddress || '',
    }))
    .filter((a) => a.id);
}

// ---------- Products ----------
// Shape: data.products[] = {
//   displayName, brand, inStock, productId,
//   variations: [{ spinId, skuId, quantityDescription, price:{mrp, offerPrice},
//                  isInStockAndAvailable, imageUrl }]
// }

/** "187k" → 187000, "2.8k" → 2800, "271" → 271 */
function parseCount(v) {
  if (!v) return 0;
  const s = String(v).trim().toLowerCase();
  const n = parseFloat(s);
  if (!Number.isFinite(n)) return 0;
  if (s.endsWith('k')) return n * 1000;
  if (s.endsWith('m')) return n * 1000000;
  return n;
}

/** Flattens a product + one of its variations into a single cart-ready item. */
function toItem(product, variation) {
  if (!variation) return null;

  const badgeTypes = (product.badges || []).map((b) => b.type || '');

  return {
    // update_cart requires BOTH ids
    spinId: variation.spinId,
    skuId: variation.skuId,
    sku_id: variation.skuId, // legacy alias used elsewhere in the app
    productId: product.productId,
    name: variation.displayName || product.displayName || '',
    brand: variation.brandName || product.brand || '',
    quantity: variation.quantityDescription || '',
    price: variation.price?.offerPrice ?? variation.price?.mrp ?? null,
    mrp: variation.price?.mrp ?? null,
    imageUrl: variation.imageUrl || null,
    inStock: variation.isInStockAndAvailable !== false,
    maxQuantity: variation.maxQuantity ?? null,

    // Popularity / trust signals, used to pick a sensible brand when the user
    // has no purchase history for this item.
    rating: parseFloat(variation.rating?.value) || null,
    ratingCount: parseCount(variation.rating?.count),
    isBestSeller: badgeTypes.includes('BADGE_TYPE_BEST_SELLER'),
    previouslyBought: badgeTypes.includes('BADGE_TYPE_PREVIOUSLY_BOUGHT'),
    isPromoted: product.isPromoted === true || badgeTypes.includes('BADGE_TYPE_AD'),
  };
}

/** Picks the cheapest in-stock variation of a product. */
function bestVariation(product) {
  const vars = (product.variations || []).filter((v) => v.isInStockAndAvailable !== false);
  if (vars.length === 0) return null;
  return vars.reduce((best, v) => {
    const p = v.price?.offerPrice ?? v.price?.mrp ?? Infinity;
    const bp = best.price?.offerPrice ?? best.price?.mrp ?? Infinity;
    return p < bp ? v : best;
  });
}

/** All in-stock products from a search result, flattened to cart-ready items. */
export function extractProducts(raw) {
  const data = unwrap(raw);
  const products = data.products || data.results || data.items || [];
  return products
    .filter((p) => p.inStock !== false)
    .map((p) => toItem(p, bestVariation(p)))
    .filter((i) => i && i.skuId);
}

/**
 * Scores a candidate product for a search query.
 *
 * Relevance dominates (an onion must be an onion), then we prefer brands the
 * platform's own signals say are trusted: previously bought by this user,
 * bestsellers, and well-rated items with enough reviews to mean something.
 * Sponsored placements are pushed down — an ad is not a recommendation.
 */
function scoreCandidate(item, query) {
  const n = (item.name || '').toLowerCase();
  const q = (query || '').toLowerCase().trim();
  if (!n || !q) return -Infinity;

  const stem = q.replace(/(es|s)$/, '');

  // --- Relevance ---
  let relevance = 0;
  if (n === q || n === stem) relevance += 100;
  if (n.startsWith(q) || n.startsWith(stem)) relevance += 50;
  if (n.includes(q) || n.includes(stem)) relevance += 25;

  // Things that merely mention the word (onion-flavoured crisps, etc.)
  const noise = ['chips', 'stix', 'rings', 'makhana', 'namkeen', 'flavour',
                 'flavor', 'snack', 'kodubale', 'murukku', 'combo', 'sauce mix'];
  if (noise.some((w) => n.includes(w))) relevance -= 60;

  // Shorter names tend to be the plain staple rather than a variant
  relevance -= Math.min(n.length / 12, 8);

  if (relevance <= 0) return relevance; // irrelevant — don't bother ranking it

  // --- Popularity / trust ---
  let trust = 0;

  // The user has bought this exact product before — strongest signal there is
  if (item.previouslyBought) trust += 45;

  // Platform bestseller
  if (item.isBestSeller) trust += 25;

  // Rating, weighted by how many people rated it. A 4.6 from 2 people
  // shouldn't beat a 4.4 from 187,000.
  if (item.rating) {
    const confidence = Math.min(Math.log10(Math.max(item.ratingCount, 1)) / 5, 1); // 0–1
    trust += (item.rating - 3.5) * 12 * confidence;
  }

  // Sponsored results are paid placement, not merit
  if (item.isPromoted) trust -= 30;

  // "Organic certified" variants are usually pricier substitutes for a staple
  if (n.includes('organic')) trust -= 8;

  return relevance + trust;
}

/** Chooses the single best product for a search query. */
export function pickBestMatch(raw, query) {
  const candidates = extractProducts(raw);
  if (candidates.length === 0) return null;

  const scored = candidates
    .map((item) => ({ item, score: scoreCandidate(item, query) }))
    .sort((a, b) => b.score - a.score);

  if (scored[0].score <= 0) return null;

  const winner = scored[0].item;

  // Why this product was chosen — surfaced in the UI so the pick is explainable
  winner.chosenBecause = winner.previouslyBought
    ? 'You have bought this before'
    : winner.isBestSeller
      ? 'Bestseller on Instamart'
      : winner.rating && winner.ratingCount > 500
        ? `Rated ${winner.rating} by ${winner.ratingCount >= 1000 ? Math.round(winner.ratingCount / 1000) + 'k' : winner.ratingCount} people`
        : null;

  return winner;
}

/** Returns the top N ranked candidates for a query, for user-facing search. */
export function rankProducts(raw, query, limit = 8) {
  return extractProducts(raw)
    .map((item) => ({ item, score: scoreCandidate(item, query) }))
    .filter((s) => s.score > -40) // keep loosely-related results, drop pure noise
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.item);
}

// ---------- Cart ----------
// Shape: data = { cartTotalAmount, items[], billBreakdown:{toPay:{value}}, cartAbsent }

const num = (v) => {
  if (v == null) return null;
  const n = typeof v === 'string' ? parseFloat(v.replace(/[^\d.]/g, '')) : v;
  return Number.isFinite(n) ? n : null;
};

export function extractCart(raw) {
  const data = unwrap(raw);

  // Real shape: items[] = { spinId, skuId, productId, itemName, itemVariant,
  //   quantity, mrp, discountedFinalPrice, imageUrl, maxQuantity, isInStockAndAvailable }
  const items = (data.items || []).map((i) => ({
    spinId: i.spinId,
    skuId: i.skuId,
    sku_id: i.skuId,
    productId: i.productId,
    name: i.itemName || i.displayName || i.name || '',
    quantity: i.itemVariant || i.quantityDescription || '',
    price: num(i.discountedFinalPrice) ?? num(i.mrp) ?? null,
    mrp: num(i.mrp) ?? null,
    quantity_count: i.quantity ?? 1,
    maxQuantity: i.maxQuantity ?? null,
    inStock: i.isInStockAndAvailable !== false,
    imageUrl: i.imageUrl || null,
  }));

  // billBreakdown.lineItems = [{ label, value: "₹264.00" | "FREE" }]
  const lineItems = (data.billBreakdown?.lineItems || []).map((l) => ({
    label: l.label,
    value: l.value,
    amount: /free/i.test(l.value) ? 0 : num(l.value),
  }));

  const total =
    num(data.billBreakdown?.toPay?.value) ??
    num(data.cartTotalAmount) ??
    items.reduce((s, i) => s + (i.price || 0) * (i.quantity_count || 1), 0);

  return {
    items,
    lineItems,
    total,
    cartId: data.cartId || null,
    selectedAddressId: data.selectedAddress || null,
    selectedAddressDetails: data.selectedAddressDetails || null,
    isEmpty: data.cartAbsent === true || items.length === 0,
  };
}

// ---------- Orders ----------

/**
 * checkout response.
 *
 * UPI  → { orderId, transactionId, paasId, upiIntentUrl, bridgeUrl, isQrFlow,
 *          pollingIntervalInMs, maxTimeToPollForInMs, paymentMethod, status:"PENDING_PAYMENT" }
 * Cash → { orderId, status, paymentMethod:"Cash", cartTotal }
 */
export function extractOrder(raw) {
  const d = unwrap(raw);
  const status = d.status || 'PLACED';

  return {
    orderId: d.orderId,
    transactionId: d.transactionId || null,
    paasId: d.paasId || null,

    // An opaque HTTPS link to Swiggy's own payment page — it shows a scannable
    // QR on desktop and an "open your UPI app" button on mobile, for both the
    // app-intent and scan-QR choices. Always read this rather than parsing the
    // message, and don't render a QR ourselves.
    bridgeUrl: d.bridgeUrl || null,
    upiIntentUrl: d.upiIntentUrl || null,
    isQrFlow: d.isQrFlow === true,

    pollingIntervalInMs: d.pollingIntervalInMs || 5000,
    maxTimeToPollForInMs: d.maxTimeToPollForInMs || 300000,
    paymentMethod: d.paymentMethod || null,
    cartTotal: d.cartTotal ?? null,
    status,
    pendingPayment: String(status).toUpperCase() === 'PENDING_PAYMENT',
  };
}

/**
 * check_payment_status.
 *
 * Read the outcome from data.status — a terminal payment *failure* still
 * returns success:true at the envelope level.
 */
export function extractPaymentStatus(raw) {
  const d = unwrap(raw);
  const status = String(d.status || 'pending').toLowerCase();

  return {
    status,
    terminal: d.terminal === true,
    success: d.isTerminalSuccess === true,
    failed: d.isTerminalFailure === true,
    // On success Swiggy usually confirms the order server-side. When this is
    // false we still need to call confirm_order ourselves.
    confirmed: d.confirmed === true,
    orderStatus: d.orderStatus || null,
    message: raw?.structuredContent?.message || summaryText(raw) || null,
  };
}

/** Human-readable explanation for each terminal payment outcome. */
export function paymentOutcomeMessage(status) {
  switch (status) {
    case 'success':
    case 'paid':
      return 'Payment successful — your order is confirmed.';
    case 'failed':
      return "The payment didn't go through. Any amount debited is refunded within about 4 days.";
    case 'refund-initiated':
      return 'Your money was debited but a refund has already been started. The order was not placed — please don\'t retry.';
    case 'cancelled':
      return 'The order was cancelled. If you were charged, a refund follows.';
    case 'cart_changed':
      return 'Prices or stock changed while paying, so the order was not placed. Review your cart and try again.';
    default:
      return 'The payment is still processing.';
  }
}

// ---------- Tracking ----------

/**
 * get_delivery_status — the widget-grade ETA poller.
 * { orderId, deliveryBy, serverNow, pollIntervalSec, etaText,
 *   cancelled, delivered, statusText, disabled }
 */
export function extractDeliveryStatus(raw) {
  const d = unwrap(raw);
  return {
    orderId: d.orderId || null,
    deliveryBy: d.deliveryBy ?? null,
    serverNow: d.serverNow ?? null,
    pollIntervalSec: d.pollIntervalSec || 45,
    etaText: d.etaText || null,
    statusText: d.statusText || null,
    delivered: d.delivered === true,
    cancelled: d.cancelled === true,
    // User isn't whitelisted for live ETA — stop polling
    disabled: d.disabled === true,
  };
}

/**
 * track_order.
 *
 * `status` arrives as an object — { statusMessage: "Order Delivered" } — not a
 * string, so anything comparing it directly silently never matches.
 *
 * Rider details aren't in the response for a completed order. Whether they
 * appear mid-delivery is still unconfirmed, so everything here tolerates
 * their absence.
 */
export function extractTracking(raw) {
  const outer = raw?.structuredContent || raw || {};
  const d = outer.data || outer;
  const order = d.order || d;

  // Status is an object here but a plain string elsewhere — normalise both.
  const statusNode = order.status ?? d.status;
  const statusText =
    (typeof statusNode === 'object' && statusNode !== null
      ? statusNode.statusMessage || statusNode.message || statusNode.text
      : statusNode) ||
    order.statusText ||
    d.statusText ||
    null;

  const riderSource =
    order.deliveryPartner || order.rider || order.deliveryExecutive ||
    order.de || order.assignee || order.deliveryPartnerInfo ||
    d.deliveryPartner || d.rider || d.de || d.deliveryPartnerInfo || null;

  const rider = riderSource
    ? {
        name:
          riderSource.name || riderSource.deliveryPartnerName ||
          riderSource.firstName || riderSource.deName || null,
        phone:
          riderSource.phone || riderSource.mobile ||
          riderSource.phoneNumber || riderSource.contactNumber || null,
        lat: riderSource.lat ?? riderSource.latitude ?? riderSource.location?.lat ?? null,
        lng: riderSource.lng ?? riderSource.longitude ?? riderSource.location?.lng ?? null,
      }
    : null;

  const hasRider = rider && (rider.name || rider.phone || rider.lat != null);

  // -1 is Swiggy telling us the order is terminal and to stop polling.
  const pollSeconds = d.pollingIntervalSeconds ?? order.pollingIntervalSeconds ?? null;

  return {
    orderId: order.orderId || d.orderId || null,
    statusText,
    // Kept as a string so callers can match on it safely
    status: statusText,
    isTerminal: pollSeconds === -1,
    pollSeconds: pollSeconds != null && pollSeconds > 0 ? pollSeconds : null,

    // Swiggy's own item list — real names and prices, better than our record
    items: (order.items || d.items || []).map((i) => ({
      name: i.name || i.itemName || '',
      quantity: i.quantity ?? 1,
      price: i.price ?? null,
    })),
    itemCount: d.itemCount ?? order.itemCount ?? null,

    orderTitle: d.orderTitle || null,
    orderSubtitle: d.orderSubtitle || null,
    placedAt: d.placedAt || null,
    store: d.storeInfo
      ? { name: d.storeInfo.name || null, address: d.storeInfo.address || null }
      : null,
    deliveryInfo: d.deliveryInfo
      ? {
          label: d.deliveryInfo.addressLabel || null,
          fullAddress: d.deliveryInfo.fullAddress || null,
        }
      : null,

    rider: hasRider ? rider : null,
    message: summaryText(raw) || null,
  };
}

/** Digs coordinates out of whatever shape an order's address arrives in. */
function coordsFrom(node) {
  if (!node || typeof node !== 'object') return null;

  const lat =
    node.lat ?? node.latitude ?? node.location?.lat ?? node.location?.latitude ?? null;
  const lng =
    node.lng ?? node.longitude ?? node.location?.lng ?? node.location?.longitude ?? null;

  if (lat != null && lng != null) return { lat: Number(lat), lng: Number(lng) };
  return null;
}

/** Searches an order object for delivery coordinates, wherever they sit. */
export function extractOrderCoords(raw) {
  const outer = raw?.structuredContent || raw || {};
  const d = outer.data || outer;
  const order = d.order || d;

  const candidates = [
    order.deliveryAddress,
    order.address,
    order.selectedAddressDetails,
    order.customerAddress,
    d.deliveryAddress,
    d.address,
    d.selectedAddressDetails,
    order,
    d,
  ];

  for (const cand of candidates) {
    const c = coordsFrom(cand);
    if (c) return c;
  }
  return null;
}

/** get_orders — list of recent orders. */// ---------- Payment options ----------

/**
 * get_payment_options.
 *
 * data = {
 *   platforms: {
 *     mobile:  { methods: [{ id: "<upi app package>", label: "Google Pay" }] },
 *     desktop: { methods: [{ id: "PayWithQR", label: "Scan QR to pay" }] }
 *   },
 *   cod: { paymentMethod: "Cash", label: "Cash on Delivery" },
 *   allMethods: [ ... ]
 * }
 *
 * `platforms` is omitted entirely when UPI isn't available for this cart.
 */
export function extractPaymentOptions(raw) {
  const d = unwrap(raw);

  const mobile = (d.platforms?.mobile?.methods || []).map((m) => ({
    id: m.id,
    label: m.label || m.name || m.id,
    kind: 'upi-intent',
    surface: 'mobile',
  }));

  const desktop = (d.platforms?.desktop?.methods || []).map((m) => ({
    id: m.id,
    label: m.label || m.name || 'Scan QR to pay',
    kind: 'upi-qr',
    surface: 'desktop',
  }));

  const cash = d.cod
    ? [{
        id: d.cod.paymentMethod || 'Cash',
        label: d.cod.label || 'Cash on delivery',
        kind: 'cash',
        surface: 'any',
      }]
    : [];

  return {
    mobile,
    desktop,
    cash,
    hasUpi: mobile.length > 0 || desktop.length > 0,
    message: raw?.structuredContent?.message || summaryText(raw) || null,
  };
}
