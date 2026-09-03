'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { T, shell, responsiveCSS } from '../theme';
import PaymentIcon from '@/components/PaymentIcon';

// Instamart's documented minimum for MCP checkout
const MIN_ORDER = 99;

export default function CartPage() {
  const [cart, setCart] = useState(null);
  const [addresses, setAddresses] = useState([]);
  const [selectedAddress, setSelectedAddress] = useState(null);
  const [showAddressPicker, setShowAddressPicker] = useState(false);
  const [pending, setPending] = useState(null);
  const [missing, setMissing] = useState([]);
  const [mode, setMode] = useState(null);   // unknown until the first response

  const [loading, setLoading] = useState(true);
  const [updatingSku, setUpdatingSku] = useState(null);
  const [error, setError] = useState(null);
  const [warning, setWarning] = useState(null);

  // Add-an-item search
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [searching, setSearching] = useState(false);

  // Payment
  const [payment, setPayment] = useState(null);        // options from Swiggy
  const [selectedPayment, setSelectedPayment] = useState(null);
  const [loadingPayments, setLoadingPayments] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [awaiting, setAwaiting] = useState(null);      // { order, qrDataUrl }
  const [paymentStatusMsg, setPaymentStatusMsg] = useState(null);
  const [isMobile, setIsMobile] = useState(false);
  const [isAndroid, setIsAndroid] = useState(false);
  const [tappedId, setTappedId] = useState(null);
  const [needsSwiggyAuth, setNeedsSwiggyAuth] = useState(false);

  // UPI intent links are app deep links — they only work on a phone.
  // Desktop must use the scan-QR flow instead.
  useEffect(() => {
    const ua = navigator.userAgent;
    setIsMobile(/android|iphone|ipad|ipod/i.test(ua));
    setIsAndroid(/android/i.test(ua));
  }, []);

  const router = useRouter();

  useEffect(() => {
    const raw = sessionStorage.getItem('inspector_pending_cart');
    if (!raw) { router.push('/'); return; }
    const parsed = JSON.parse(raw);
    setPending(parsed);
    buildCart(parsed.items, null);
  }, []);

  // Android honours window.location.href to an app scheme even outside a
  // direct tap, so it can open automatically. iOS blocks that and shows an
  // ugly error for an unhandled scheme — the tap-to-pay anchor stays the
  // only path there.
  useEffect(() => {
    if (awaiting && isAndroid && awaiting.upiUrl) {
      window.location.href = awaiting.upiUrl;
    }
  }, [awaiting, isAndroid]);

  // Cookies are sent automatically, so requests need no auth plumbing.
  const authHeaders = async () => ({ 'Content-Type': 'application/json' });

  // ---- Build the initial cart from the scan ----
  const buildCart = async (items, addressId) => {
    setLoading(true);
    setError(null);
    try {
      const headers = await authHeaders();

      const searchRes = await fetch('/api/products/search', {
        method: 'POST', headers,
        body: JSON.stringify({ items: items.map((i) => i.name), addressId }),
      });
      const searchData = await searchRes.json();
      if (!searchRes.ok) {
        if (searchData.needsSwiggyAuth || searchRes.status === 401) setNeedsSwiggyAuth(true);
        throw new Error(searchData.error);
      }

      setMode(searchData.mode);
      if (searchData.addresses) setAddresses(searchData.addresses);
      if (searchData.address) setSelectedAddress(searchData.address);
      setMissing(searchData.resolved.filter((r) => !r.found).map((r) => r.query));

      const found = searchData.resolved
        .filter((r) => r.found)
        .map((r) => ({ ...r.product, quantity_count: 1 }));

      const builtCart = await syncCart(found, searchData.address?.id, headers, found);

      // Fetch payment options as soon as the cart is known, so the picker is
      // ready the moment the user finishes reviewing — no extra tap to reach
      // it. Skip it below the order minimum; there's nothing to pay for yet.
      if ((builtCart?.total ?? 0) >= MIN_ORDER) {
        loadPaymentOptions();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Swiggy's update_cart REPLACES the whole cart, so every change sends the
   * complete desired contents. `reasonSource` carries the "why this brand"
   * notes, which Swiggy's cart response doesn't echo back.
   */
  const syncCart = async (items, addressId, headers, reasonSource = null) => {
    const h = headers || (await authHeaders());
    const res = await fetch('/api/cart', {
      method: 'POST', headers: h,
      body: JSON.stringify({ items, addressId: addressId ?? selectedAddress?.id }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    const reasons = Object.fromEntries(
      [...(reasonSource || []), ...(cart?.items || [])]
        .filter((i) => i.chosenBecause)
        .map((i) => [i.skuId, i.chosenBecause])
    );

    setWarning(data.warning || null);
    setCart({
      ...data.cart,
      items: (data.cart.items || []).map((i) => ({
        ...i,
        chosenBecause: reasons[i.skuId] || null,
      })),
    });
    return data.cart;
  };

  // ---- Quantity ----
  const setQty = async (item, newQty) => {
    if (newQty < 0) return;
    setUpdatingSku(item.skuId);
    try {
      const next = (cart?.items || [])
        .map((i) => (i.skuId === item.skuId ? { ...i, quantity_count: newQty } : i))
        .filter((i) => i.quantity_count > 0);
      await syncCart(next);
    } catch (err) {
      setWarning(err.message);
    } finally {
      setUpdatingSku(null);
    }
  };

  // ---- Add an item the scan missed ----
  const runSearch = async (e) => {
    e?.preventDefault?.();
    const q = searchQuery.trim();
    if (q.length < 2) return;
    setSearching(true);
    try {
      const headers = await authHeaders();
      const res = await fetch('/api/products/lookup', {
        method: 'POST', headers,
        body: JSON.stringify({ query: q, addressId: selectedAddress?.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setSearchResults(data.results || []);
    } catch (err) {
      setWarning(err.message);
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  };

  const addProduct = async (product) => {
    setUpdatingSku(product.skuId);
    try {
      const existing = cart?.items || [];
      const already = existing.find((i) => i.skuId === product.skuId);
      const next = already
        ? existing.map((i) =>
            i.skuId === product.skuId ? { ...i, quantity_count: i.quantity_count + 1 } : i
          )
        : [...existing, { ...product, quantity_count: 1 }];

      await syncCart(next);
      setSearchQuery('');
      setSearchResults(null);
      setSearchOpen(false);
    } catch (err) {
      setWarning(err.message);
    } finally {
      setUpdatingSku(null);
    }
  };

  // ---- Address ----
  const changeAddress = (addr) => {
    setSelectedAddress(addr);
    setShowAddressPicker(false);
    // Prices and availability differ by store, so any payment choice made
    // against the old address is no longer valid.
    setPayment(null);
    setSelectedPayment(null);
    if (pending) buildCart(pending.items, addr.id);
  };

  // ---- Payment ----
  const loadPaymentOptions = async () => {
    setLoadingPayments(true);
    setError(null);
    try {
      const res = await fetch('/api/payment-options');
      const data = await res.json();
      if (!res.ok) {
        if (data.needsSwiggyAuth || res.status === 401) setNeedsSwiggyAuth(true);
        throw new Error(data.error);
      }
      setPayment(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingPayments(false);
    }
  };

  // `method` lets a tap-to-pay tile fire checkout with its own option
  // immediately, without waiting on the selectedPayment state to settle;
  // the desktop flow still calls this with no argument and falls back to
  // whatever's selected.
  const placeOrder = async (method) => {
    const pay = method || selectedPayment;
    if (!pay) return;
    setPlacing(true);
    setError(null);
    setPaymentStatusMsg(null);

    try {
      const headers = await authHeaders();
      const body = {
        items: cart.items,
        totalAmount: cart.total,
        scanId: pending?.scanId,
        addressId: selectedAddress?.id,
      };

      if (pay.kind === 'cash') {
        body.paymentMethod = 'Cash';
      } else if (pay.kind === 'upi-intent') {
        body.paymentMethod = 'UPI';
        body.intentApp = pay.id;   // echoed byte-for-byte
      } else if (pay.kind === 'upi-qr') {
        body.paymentMethod = 'UPI';
        body.generateUPIQR = true;
      }

      const res = await fetch('/api/checkout', {
        method: 'POST', headers, body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.hint ? `${data.error} — ${data.hint}` : data.error);

      // Cash is placed outright; UPI comes back PENDING_PAYMENT.
      if (!data.order.pendingPayment) {
        sessionStorage.removeItem('inspector_pending_cart');
        router.push(`/order/${data.order.orderId}`);
        return;
      }

      setAwaiting({ ...data.order, qrDataUrl: data.qrDataUrl, qrImage: data.qrImage });

      // iOS only allows app-scheme navigation from a direct tap, so we can't
      // redirect here — render a real anchor on the awaiting-payment screen
      // and let the user tap it themselves.
      pollPayment(data.order);
    } catch (err) {
      setError(err.message);
      setPlacing(false);
    }
  };

  // Tapping an app tile pays with it immediately — no separate "select then
  // confirm" step. `placing` already guards against a second tap landing
  // mid-checkout.
  const handleTapToPay = (opt) => {
    if (placing) return;
    setSelectedPayment(opt);
    setTappedId(opt.id);
    placeOrder(opt);
  };

  /**
   * check_payment_status is a long-poll (~19s server-held). We honour the
   * cadence and cap checkout handed back, and finalise once if we hit the cap
   * while still pending.
   */
  const pollPayment = async (order) => {
    const startedAt = Date.now();
    const interval = Math.max(order.pollingIntervalInMs || 5000, 3000);
    const cap = order.maxTimeToPollForInMs || 300000;

    const finish = (msg) => {
      setPaymentStatusMsg(msg);
      setAwaiting(null);
      setPlacing(false);
    };

    const tick = async () => {
      const headers = await authHeaders();

      if (Date.now() - startedAt > cap) {
        try {
          const res = await fetch('/api/payment-status', {
            method: 'POST', headers,
            body: JSON.stringify({ paasId: order.paasId, orderId: order.orderId, finalize: true }),
          });
          const data = await res.json();
          finish(data.humanMessage || 'The payment window closed before it completed.');
        } catch {
          finish('The payment window closed before it completed.');
        }
        return;
      }

      try {
        const res = await fetch('/api/payment-status', {
          method: 'POST', headers,
          body: JSON.stringify({ paasId: order.paasId, orderId: order.orderId }),
        });
        const data = await res.json();

        if (data.terminal && data.success) {
          sessionStorage.removeItem('inspector_pending_cart');
          router.push(`/order/${order.orderId}`);
          return;
        }
        if (data.terminal) {
          finish(data.humanMessage || 'The payment did not complete.');
          return;
        }
      } catch {
        // transient — retry on the next tick
      }

      setTimeout(tick, interval);
    };

    setTimeout(tick, interval);
  };

  const items = cart?.items || [];
  const lineItems = cart?.lineItems || [];

  return (
    <div style={shell.page} className="ins-page">
      <style>{responsiveCSS}</style>
      <div style={shell.card} className="ins-card">

        <header style={shell.header}>
          <div>
            <h1 style={shell.brand}>Your cart</h1>
            <p style={shell.tagline}>
              {mode === null
                ? 'Checking Instamart…'
                : mode === 'mock'
                  ? 'Sample data — sign in to Swiggy for live prices'
                  : 'Live from Swiggy Instamart'}
            </p>
          </div>
          <button onClick={() => router.push('/')} style={shell.ghostBtn}>Back</button>
        </header>

        <main style={shell.body}>
          {awaiting ? (
            <div style={{ textAlign: 'center', padding: '4px 0' }}>
              {(() => {
                // Desktop pays by scanning; mobile pays by opening the chosen
                // UPI app, since you can't scan your own screen.
                const qr = awaiting.qrDataUrl || awaiting.qrImage;
                const openUrl = awaiting.upiUrl || awaiting.bridgeUrl;

                if (isMobile) {
                  return (
                    <>
                      <div style={{
                        width: 54, height: 54, borderRadius: '50%', background: T.orangeSoft,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        margin: '0 auto 16px', fontSize: 24,
                      }}>📲</div>
                      <p style={{ fontSize: 17, fontWeight: 700, color: T.ink, marginBottom: 8 }}>
                        Approve ₹{cart?.total} in {selectedPayment?.label || 'your UPI app'}
                      </p>
                      <p style={{ fontSize: 14, color: T.muted, lineHeight: 1.55, marginBottom: 20 }}>
                        Complete the payment, then come back — this page updates on its own.
                      </p>
                      {openUrl && (
                        <a
                          href={openUrl}
                          style={{
                            display: 'block', background: T.orange, color: '#fff',
                            borderRadius: 10, padding: '14px', fontSize: 15, fontWeight: 700,
                            textDecoration: 'none', marginBottom: 12,
                          }}
                        >
                          Pay ₹{cart?.total} in {selectedPayment?.label || 'your UPI app'}
                        </a>
                      )}
                      {awaiting.bridgeUrl && (
                        <a
                          href={awaiting.bridgeUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{
                            display: 'block', color: T.muted, fontSize: 13, fontWeight: 600,
                            textDecoration: 'underline', marginBottom: 16,
                          }}
                        >
                          Didn't open? Pay on Swiggy's page
                        </a>
                      )}
                      {mode === 'live' && (
                        <p style={{ fontSize: 12, color: T.muted, lineHeight: 1.5, marginBottom: 0 }}>
                          This places a real order on your Swiggy account.
                        </p>
                      )}
                    </>
                  );
                }

                if (qr) {
                  return (
                    <>
                      <p style={{ fontSize: 17, fontWeight: 700, color: T.ink, marginBottom: 6 }}>
                        Scan to pay ₹{cart?.total}
                      </p>
                      <p style={{ fontSize: 13, color: T.muted, marginBottom: 16, lineHeight: 1.5 }}>
                        Open any UPI app on your phone and scan this code.
                      </p>
                      <img
                        src={qr}
                        alt="Scan this code with a UPI app to pay"
                        style={{
                          width: 230, height: 230, display: 'block', margin: '0 auto 16px',
                          borderRadius: 12, border: `1px solid ${T.hairline}`,
                          padding: 8, background: '#fff',
                        }}
                      />
                    </>
                  );
                }

                // Couldn't get the code out of Swiggy's page — say so plainly
                // rather than showing a QR that wouldn't work.
                return (
                  <>
                    <p style={{ fontSize: 17, fontWeight: 700, color: T.ink, marginBottom: 6 }}>
                      Pay ₹{cart?.total}
                    </p>
                    <p style={{ fontSize: 13, color: T.muted, marginBottom: 16, lineHeight: 1.5 }}>
                      Swiggy shows the payment code on their own page. Open it, pay,
                      and come back — this page updates the moment it goes through.
                    </p>
                    {awaiting.bridgeUrl && (
                      <a
                        href={awaiting.bridgeUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          display: 'block', background: T.orange, color: '#fff',
                          borderRadius: 10, padding: '14px', fontSize: 15, fontWeight: 700,
                          textDecoration: 'none', marginBottom: 16,
                        }}
                      >
                        Open the payment page
                      </a>
                    )}
                  </>
                );
              })()}

              <div style={{
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                background: T.orangeSoft, borderRadius: 10, padding: '12px 16px',
                fontSize: 13, color: T.orangeDeep, fontWeight: 600,
              }}>
                <span style={{
                  width: 8, height: 8, borderRadius: '50%', background: T.orange,
                  display: 'inline-block', animation: 'insPulse 1.4s ease-in-out infinite',
                }} />
                Waiting for payment…
              </div>
              <style>{`@keyframes insPulse { 0%,100% { opacity: 1 } 50% { opacity: 0.25 } }`}</style>

              <p style={{ fontSize: 12, color: T.muted, marginTop: 16, lineHeight: 1.5 }}>
                Order {awaiting.orderId} · this page updates automatically once you pay
              </p>
            </div>
          ) : (
          <>
          {paymentStatusMsg && (
            <div style={{ background: T.redSoft, color: T.red, padding: '12px 14px', borderRadius: 10, marginBottom: 16, fontSize: 13, lineHeight: 1.5 }}>
              {paymentStatusMsg}
            </div>
          )}

          {loading && (
            <div style={{ textAlign: 'center', padding: '40px 0', color: T.muted, fontSize: 14 }}>
              Finding your items on Instamart…
            </div>
          )}

          {error && (
            needsSwiggyAuth ? (
              <div style={{ background: T.amberSoft, borderRadius: 12, padding: 16, marginBottom: 16 }}>
                <p style={{ fontSize: 14, fontWeight: 600, color: T.ink, margin: '0 0 4px' }}>
                  Your Swiggy session has ended
                </p>
                <p style={{ fontSize: 13, color: T.inkSoft, margin: '0 0 14px', lineHeight: 1.5 }}>
                  Sessions last five days, and signing in elsewhere can end them early.
                  Sign in again and your cart will be rebuilt.
                </p>
                <a href="/api/auth/swiggy/login" style={{
                  display: 'block', textAlign: 'center', background: T.orange, color: '#fff',
                  padding: '11px', borderRadius: 10, fontSize: 14, fontWeight: 700, textDecoration: 'none',
                }}>
                  Sign in again
                </a>
              </div>
            ) : (
              <div style={{ background: T.redSoft, color: T.red, padding: '12px 14px', borderRadius: 10, marginBottom: 16, fontSize: 13, lineHeight: 1.5 }}>
                {error}
              </div>
            )
          )}

          {warning && (
            <div style={{ background: T.amberSoft, color: T.amber, padding: '10px 14px', borderRadius: 10, marginBottom: 16, fontSize: 12, lineHeight: 1.45 }}>
              {warning}
            </div>
          )}

          {!loading && (
            <>
              {/* Address */}
              {selectedAddress && (
                <div style={{ marginBottom: 18 }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, border: `1px solid ${T.hairline}`, borderRadius: 12, padding: '12px 14px' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: T.muted, marginBottom: 4 }}>
                        Delivering to
                      </div>
                      <div style={{ fontSize: 14, fontWeight: 600, color: T.ink }}>{selectedAddress.label}</div>
                      <div style={{ fontSize: 12, color: T.muted, marginTop: 2, lineHeight: 1.45 }}>
                        {selectedAddress.fullAddress.length > 80
                          ? selectedAddress.fullAddress.slice(0, 80) + '…'
                          : selectedAddress.fullAddress}
                      </div>
                    </div>
                    {addresses.length > 1 && (
                      <button
                        onClick={() => setShowAddressPicker(!showAddressPicker)}
                        style={{ background: 'transparent', border: 'none', color: T.orange, fontSize: 13, fontWeight: 600, cursor: 'pointer', padding: 0, flexShrink: 0, fontFamily: 'inherit' }}
                      >
                        {showAddressPicker ? 'Cancel' : 'Change'}
                      </button>
                    )}
                  </div>

                  {showAddressPicker && (
                    <div style={{ marginTop: 8 }}>
                      {addresses.map((a) => {
                        const active = a.id === selectedAddress?.id;
                        return (
                          <button
                            key={a.id}
                            onClick={() => changeAddress(a)}
                            style={{
                              display: 'block', width: '100%', textAlign: 'left',
                              border: `1.5px solid ${active ? T.orange : T.hairline}`,
                              background: active ? T.orangeSoft : '#fff',
                              borderRadius: 10, padding: '10px 12px', marginBottom: 6,
                              cursor: 'pointer', fontFamily: 'inherit',
                            }}
                          >
                            <div style={{ fontSize: 13, fontWeight: 600, color: T.ink }}>
                              {a.label}{active ? ' · current' : ''}
                            </div>
                            <div style={{ fontSize: 12, color: T.muted, marginTop: 2, lineHeight: 1.4 }}>
                              {a.fullAddress.length > 80 ? a.fullAddress.slice(0, 80) + '…' : a.fullAddress}
                            </div>
                          </button>
                        );
                      })}
                      <p style={{ fontSize: 11, color: T.muted, marginTop: 4 }}>
                        Prices and availability differ by location.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Items */}
              {items.length > 0 ? (
                <div style={{ border: `1px solid ${T.hairline}`, borderRadius: 14, padding: '0 14px', marginBottom: 14 }}>
                  {items.map((item, i) => {
                    const busy = updatingSku === item.skuId;
                    const atMax = item.maxQuantity != null && item.quantity_count >= item.maxQuantity;
                    return (
                      <div key={item.skuId || i} style={{
                        display: 'flex', alignItems: 'center', gap: 12, padding: '14px 0',
                        borderBottom: i < items.length - 1 ? `1px solid ${T.hairline}` : 'none',
                        opacity: busy ? 0.5 : 1,
                      }}>
                        {item.imageUrl && (
                          <img src={item.imageUrl} alt="" style={{ width: 46, height: 46, objectFit: 'contain', borderRadius: 8, flexShrink: 0 }} />
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 500, color: T.ink, lineHeight: 1.3 }}>{item.name}</div>
                          <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>
                            {item.quantity}
                            {item.mrp && item.mrp > item.price && (
                              <span style={{ marginLeft: 6, textDecoration: 'line-through' }}>₹{item.mrp}</span>
                            )}
                          </div>
                          {item.chosenBecause && (
                            <div style={{ fontSize: 11, color: T.green, marginTop: 3 }}>{item.chosenBecause}</div>
                          )}
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'center', border: `1px solid ${T.orange}`, borderRadius: 8, overflow: 'hidden' }}>
                            <button
                              onClick={() => setQty(item, item.quantity_count - 1)}
                              disabled={busy}
                              aria-label={`Reduce ${item.name}`}
                              style={{ background: '#fff', border: 'none', color: T.orange, width: 26, height: 28, fontSize: 16, cursor: 'pointer', fontFamily: 'inherit' }}
                            >
                              −
                            </button>
                            <span style={{ minWidth: 22, textAlign: 'center', fontSize: 13, fontWeight: 700, color: T.orange }}>
                              {item.quantity_count}
                            </span>
                            <button
                              onClick={() => setQty(item, item.quantity_count + 1)}
                              disabled={busy || atMax}
                              aria-label={`Add another ${item.name}`}
                              style={{ background: '#fff', border: 'none', color: atMax ? T.hairline : T.orange, width: 26, height: 28, fontSize: 16, cursor: atMax ? 'default' : 'pointer', fontFamily: 'inherit' }}
                            >
                              +
                            </button>
                          </div>
                          <div style={{ fontSize: 14, fontWeight: 600, color: T.ink, minWidth: 44, textAlign: 'right' }}>
                            ₹{(item.price || 0) * (item.quantity_count || 1)}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ background: T.amberSoft, color: T.amber, padding: 14, borderRadius: 10, marginBottom: 14, fontSize: 13 }}>
                  Your cart is empty. Search below to add items.
                </div>
              )}

              {missing.length > 0 && (
                <div style={{ fontSize: 12, color: T.muted, marginBottom: 12, lineHeight: 1.5 }}>
                  Couldn't match on Instamart: {missing.join(', ')} — search for them below.
                </div>
              )}

              {/* Add an item */}
              <div style={{ marginBottom: 18 }}>
                {!searchOpen ? (
                  <button
                    onClick={() => setSearchOpen(true)}
                    style={{
                      width: '100%', background: '#fff', border: `1.5px dashed ${T.hairline}`,
                      borderRadius: 12, padding: '13px', fontSize: 14, fontWeight: 600,
                      color: T.orange, cursor: 'pointer', fontFamily: 'inherit',
                    }}
                  >
                    + Add another item
                  </button>
                ) : (
                  <div style={{ border: `1px solid ${T.hairline}`, borderRadius: 12, padding: 14 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: T.muted }}>
                        Add an item
                      </span>
                      <button
                        onClick={() => { setSearchOpen(false); setSearchResults(null); setSearchQuery(''); }}
                        style={{ background: 'none', border: 'none', color: T.muted, fontSize: 13, cursor: 'pointer', padding: 0, fontFamily: 'inherit' }}
                      >
                        Close
                      </button>
                    </div>

                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && runSearch(e)}
                        placeholder="Atta, dal, paneer…"
                        autoFocus
                        style={{
                          flex: 1, border: `1px solid ${T.hairline}`, borderRadius: 8,
                          padding: '10px 12px', fontSize: 14, fontFamily: 'inherit', outline: 'none',
                        }}
                      />
                      <button
                        onClick={runSearch}
                        disabled={searching || searchQuery.trim().length < 2}
                        style={{
                          background: T.orange, color: '#fff', border: 'none', borderRadius: 8,
                          padding: '10px 16px', fontSize: 14, fontWeight: 600,
                          cursor: 'pointer', fontFamily: 'inherit',
                          opacity: searching || searchQuery.trim().length < 2 ? 0.5 : 1,
                        }}
                      >
                        {searching ? '…' : 'Search'}
                      </button>
                    </div>

                    {searchResults && searchResults.length === 0 && !searching && (
                      <p style={{ fontSize: 13, color: T.muted, marginTop: 12 }}>
                        Nothing found for &ldquo;{searchQuery}&rdquo; at this address.
                      </p>
                    )}

                    {searchResults && searchResults.length > 0 && (
                      <div style={{ marginTop: 12 }}>
                        {searchResults.map((r) => (
                          <button
                            key={r.skuId}
                            onClick={() => addProduct(r)}
                            disabled={updatingSku === r.skuId}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                              textAlign: 'left', background: '#fff', border: `1px solid ${T.hairline}`,
                              borderRadius: 10, padding: '10px 12px', marginBottom: 6,
                              cursor: 'pointer', fontFamily: 'inherit',
                              opacity: updatingSku === r.skuId ? 0.5 : 1,
                            }}
                          >
                            {r.imageUrl && (
                              <img src={r.imageUrl} alt="" style={{ width: 36, height: 36, objectFit: 'contain', borderRadius: 6, flexShrink: 0 }} />
                            )}
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 13, fontWeight: 500, color: T.ink, lineHeight: 1.3 }}>{r.name}</div>
                              <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>
                                {r.quantity} · ₹{r.price}
                                {r.isBestSeller && <span style={{ color: T.green }}> · Bestseller</span>}
                              </div>
                            </div>
                            <span style={{ color: T.orange, fontSize: 20, flexShrink: 0 }}>+</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Bill */}
              {lineItems.length > 0 && (
                <div style={{ border: `1px solid ${T.hairline}`, borderRadius: 12, padding: '12px 14px', marginBottom: 16 }}>
                  {lineItems.map((l, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: 13, color: T.muted }}>
                      <span>{l.label}</span>
                      <span style={{ color: l.amount === 0 ? T.green : T.inkSoft }}>{l.value}</span>
                    </div>
                  ))}
                </div>
              )}

              {items.length > 0 && (
                <>
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '14px 16px', background: T.orangeSoft, borderRadius: 12, marginBottom: 18 }}>
                    <span style={{ fontSize: 15, fontWeight: 700, color: T.ink }}>To pay</span>
                    <span style={{ fontSize: 18, fontWeight: 700, color: T.orangeDeep }}>₹{cart.total}</span>
                  </div>

                  {cart.total < MIN_ORDER ? (
                    <div style={{
                      background: T.amberSoft, color: T.amber, padding: '12px 14px',
                      borderRadius: 10, marginBottom: 16, fontSize: 13, lineHeight: 1.5,
                    }}>
                      Instamart needs a minimum order of ₹{MIN_ORDER}. Add ₹{MIN_ORDER - cart.total} more
                      to place this one.
                    </div>
                  ) : !payment ? (
                    <div style={{ textAlign: 'center', padding: '16px 0', color: T.muted, fontSize: 13 }}>
                      {loadingPayments ? 'Loading payment options…' : null}
                    </div>
                  ) : (
                    <>
                      {(() => {
                        // Phones get UPI app intents; desktop gets scan-QR.
                        // Cash shows on both when Swiggy offers it.
                        const upi = isMobile ? payment.mobile : payment.desktop;
                        const methods = [...(upi || []), ...(payment.cash || [])];

                        if (methods.length === 0) {
                          return (
                            <div style={{ background: T.amberSoft, borderRadius: 12, padding: 16 }}>
                              <p style={{ fontSize: 14, fontWeight: 600, color: T.ink, marginBottom: 6 }}>
                                No payment methods available
                              </p>
                              <p style={{ fontSize: 13, color: T.inkSoft, lineHeight: 1.5, marginBottom: 12 }}>
                                {payment.message ||
                                  'Swiggy returned no payment options for this cart.'}
                              </p>
                              <button onClick={loadPaymentOptions} style={{ ...shell.ghostBtn, width: '100%', padding: 10 }}>
                                Try again
                              </button>
                            </div>
                          );
                        }

                        // ---- Mobile: horizontal tap-to-pay row + cash below ----
                        if (isMobile) {
                          const upiMethods = payment.mobile || [];
                          const cashMethods = payment.cash || [];

                          return (
                            <>
                              {upiMethods.length > 0 && (
                                <>
                                  <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: T.muted, marginBottom: 10 }}>
                                    Pay ₹{cart.total} with
                                  </p>
                                  <div style={{
                                    display: 'flex', gap: 14, overflowX: 'auto',
                                    paddingBottom: 6, marginBottom: 16, WebkitOverflowScrolling: 'touch',
                                  }}>
                                    {upiMethods.map((opt) => {
                                      const isTapped = placing && tappedId === opt.id;
                                      return (
                                        <button
                                          key={opt.id}
                                          onClick={() => handleTapToPay(opt)}
                                          disabled={placing}
                                          style={{
                                            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                                            flexShrink: 0, width: 72, border: 'none', background: 'none',
                                            fontFamily: 'inherit', padding: 0,
                                            cursor: placing ? 'not-allowed' : 'pointer',
                                            opacity: placing && !isTapped ? 0.4 : 1,
                                          }}
                                        >
                                          {isTapped ? (
                                            <span style={{
                                              width: 40, height: 40, display: 'flex',
                                              alignItems: 'center', justifyContent: 'center',
                                            }}>
                                              <span style={{
                                                width: 18, height: 18, borderRadius: '50%',
                                                border: `2px solid ${T.orange}`, borderTopColor: 'transparent',
                                                display: 'inline-block', animation: 'insSpin 0.7s linear infinite',
                                              }} />
                                            </span>
                                          ) : (
                                            <PaymentIcon id={opt.id} label={opt.label} size={40} />
                                          )}
                                          <span style={{ fontSize: 11, fontWeight: 600, color: T.ink, textAlign: 'center', lineHeight: 1.25 }}>
                                            {opt.label}
                                          </span>
                                        </button>
                                      );
                                    })}
                                  </div>
                                  <style>{`@keyframes insSpin { to { transform: rotate(360deg) } }`}</style>
                                </>
                              )}

                              {cashMethods.map((opt) => {
                                const isTapped = placing && tappedId === opt.id;
                                return (
                                  <button
                                    key={opt.id}
                                    onClick={() => handleTapToPay(opt)}
                                    disabled={placing}
                                    style={{
                                      ...shell.successBtn, width: '100%', marginBottom: 6,
                                      opacity: placing && !isTapped ? 0.5 : 1,
                                      cursor: placing ? 'not-allowed' : 'pointer',
                                    }}
                                  >
                                    {isTapped ? 'Placing order…' : `Place order · ₹${cart.total} on delivery`}
                                  </button>
                                );
                              })}

                              {mode === 'live' && (
                                <p style={{ fontSize: 12, color: T.muted, textAlign: 'center', marginTop: 10, lineHeight: 1.5 }}>
                                  Delivering to {selectedAddress?.label}. This places a real order on your Swiggy account.
                                </p>
                              )}
                            </>
                          );
                        }

                        // ---- Desktop: scan-QR path, unchanged ----
                        return (
                          <>
                            <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: T.muted, marginBottom: 8 }}>
                              Pay with
                            </p>

                            {methods.map((opt) => {
                              const active = selectedPayment?.id === opt.id;
                              return (
                                <button
                                  key={opt.id}
                                  onClick={() => setSelectedPayment(opt)}
                                  style={{
                                    display: 'flex', alignItems: 'center', gap: 10,
                                    width: '100%', textAlign: 'left',
                                    border: `1.5px solid ${active ? T.orange : T.hairline}`,
                                    background: active ? T.orangeSoft : '#fff',
                                    borderRadius: 10, padding: '12px 14px', marginBottom: 6,
                                    cursor: 'pointer', fontFamily: 'inherit',
                                  }}
                                >
                                  <span style={{ fontSize: 18, flexShrink: 0 }}>
                                    {opt.kind === 'cash' ? '💵' : opt.kind === 'upi-qr' ? '📷' : '📱'}
                                  </span>
                                  <span style={{ flex: 1 }}>
                                    <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: T.ink }}>
                                      {opt.label}
                                    </span>
                                    {opt.kind === 'upi-qr' && (
                                      <span style={{ display: 'block', fontSize: 12, color: T.muted, marginTop: 2 }}>
                                        Scan with any UPI app on your phone
                                      </span>
                                    )}
                                    {opt.kind === 'cash' && (
                                      <span style={{ display: 'block', fontSize: 12, color: T.muted, marginTop: 2 }}>
                                        Pay the delivery partner
                                      </span>
                                    )}
                                  </span>
                                </button>
                              );
                            })}

                            <button
                              onClick={() => placeOrder()}
                              disabled={placing || !selectedPayment}
                              style={{
                                ...shell.successBtn,
                                marginTop: 12,
                                opacity: placing || !selectedPayment ? 0.5 : 1,
                                cursor: selectedPayment ? 'pointer' : 'not-allowed',
                              }}
                            >
                              {placing
                                ? 'Placing order…'
                                : selectedPayment
                                  ? selectedPayment.kind === 'cash'
                                    ? `Place order · ₹${cart.total} on delivery`
                                    : `Pay ₹${cart.total}`
                                  : 'Select a payment method'}
                            </button>

                            {mode === 'live' && (
                              <p style={{ fontSize: 12, color: T.muted, textAlign: 'center', marginTop: 10, lineHeight: 1.5 }}>
                                Delivering to {selectedAddress?.label}. This places a real order on your Swiggy account.
                              </p>
                            )}
                          </>
                        );
                      })()}
                    </>
                  )}
                </>
              )}
            </>
          )}
          </>
          )}
        </main>
      </div>
    </div>
  );
}
