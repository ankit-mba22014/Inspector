'use client';

import { useState, useEffect, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { T, shell, responsiveCSS } from '../../theme';

function formatRemaining(ms) {
  if (ms == null) return null;
  const mins = Math.round(ms / 60000);
  if (mins <= 0) return 'Any moment';
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  return `${hrs} hr ${mins % 60} min`;
}

/** Straight-line distance in km — good enough for "how far away is the rider". */
function distanceKm(a, b) {
  if (!a || !b) return null;
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(h));
}

/**
 * A minimal map: rider and destination plotted on a shared bounding box.
 * Deliberately not a tile map — we have no maps key, and drawing streets we
 * can't verify would imply more precision than the data supports.
 */
function RiderMap({ rider, destination }) {
  const hasRider = rider?.lat != null && rider?.lng != null;
  if (!hasRider || !destination) return null;

  const pts = [
    { ...destination, kind: 'home' },
    { lat: rider.lat, lng: rider.lng, kind: 'rider' },
  ];

  const lats = pts.map((p) => p.lat);
  const lngs = pts.map((p) => p.lng);
  const pad = 0.0012;
  const minLat = Math.min(...lats) - pad;
  const maxLat = Math.max(...lats) + pad;
  const minLng = Math.min(...lngs) - pad;
  const maxLng = Math.max(...lngs) + pad;

  const W = 300;
  const H = 170;
  const x = (lng) => ((lng - minLng) / (maxLng - minLng || 1)) * W;
  const y = (lat) => H - ((lat - minLat) / (maxLat - minLat || 1)) * H;

  const home = pts[0];
  const rid = pts[1];

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label="Rider position relative to your address"
      style={{
        width: '100%', height: 'auto', borderRadius: 12,
        border: `1px solid ${T.hairline}`, background: '#FAFAFA', marginBottom: 14,
      }}
    >
      <line
        x1={x(rid.lng)} y1={y(rid.lat)} x2={x(home.lng)} y2={y(home.lat)}
        stroke={T.orange} strokeWidth="2" strokeDasharray="5 4" opacity="0.6"
      />

      <circle cx={x(home.lng)} cy={y(home.lat)} r="7" fill={T.green} />
      <text x={x(home.lng)} y={y(home.lat) - 12} textAnchor="middle" fontSize="10" fill={T.muted}>
        You
      </text>

      <circle cx={x(rid.lng)} cy={y(rid.lat)} r="13" fill={T.orange} opacity="0.18" />
      <circle cx={x(rid.lng)} cy={y(rid.lat)} r="7" fill={T.orange} />
      <text x={x(rid.lng)} y={y(rid.lat) - 14} textAnchor="middle" fontSize="10" fill={T.muted}>
        Rider
      </text>
    </svg>
  );
}

export default function OrderTracking() {
  const { id } = useParams();
  const router = useRouter();

  const [tracking, setTracking] = useState(null);
  const [error, setError] = useState(null);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [now, setNow] = useState(Date.now());
  const timerRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch(`/api/track/${id}`);
        const data = await res.json();
        if (cancelled) return;

        if (res.status === 401) {
          // Session gone — the order is still fine, we just can't read it.
          setError(data.error || 'Your Swiggy session has ended. Sign in again to keep tracking this order.');
          setNeedsAuth(true);
          return;
        }
        if (!res.ok) { setError(data.error); return; }
        setTracking(data);

        // `terminal` covers pollingIntervalSeconds === -1, which is Swiggy
        // telling us the order is finished and to stop asking.
        if (data.delivered || data.cancelled || data.terminal) return;

        // Swiggy asks for no faster than every 10s.
        const nextIn = Math.max(data.liveEtaDisabled ? 90 : data.pollIntervalSec || 45, 10) * 1000;
        timerRef.current = setTimeout(poll, nextIn);
      } catch {
        if (!cancelled) timerRef.current = setTimeout(poll, 60000);
      }
    };

    poll();
    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [id]);

  // Local ticker so the countdown moves between polls
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 20000);
    return () => clearInterval(t);
  }, []);

  // Swiggy sends its own clock alongside the deadline, so correct for drift
  // rather than trusting this device's time.
  const remaining = (() => {
    if (!tracking?.deliveryBy || !tracking?.serverNow || !tracking?.receivedAt) return null;
    const drift = tracking.serverNow - tracking.receivedAt;
    return tracking.deliveryBy - (now + drift);
  })();

  const countdown = formatRemaining(remaining);
  const delivered = tracking?.delivered;
  const cancelled = tracking?.cancelled;
  const rider = tracking?.rider;

  const riderDistance =
    rider?.lat != null && tracking?.destination
      ? distanceKm({ lat: rider.lat, lng: rider.lng }, tracking.destination)
      : null;

  return (
    <div style={shell.page} className="ins-page">
      <style>{responsiveCSS}</style>
      <div style={shell.card} className="ins-card">

        <header style={shell.header}>
          <div>
            <h1 style={shell.brand}>
              {delivered ? 'Delivered' : cancelled ? 'Order cancelled' : 'On the way'}
            </h1>
            <p style={shell.tagline}>Order {id}</p>
          </div>
          <button onClick={() => router.push('/')} style={shell.ghostBtn}>Home</button>
        </header>

        <main style={shell.body}>
          {error && (
            <div style={{
              background: needsAuth ? T.amberSoft : T.redSoft,
              color: needsAuth ? T.amber : T.red,
              padding: '12px 14px', borderRadius: 10, marginBottom: 16, fontSize: 13, lineHeight: 1.5,
            }}>
              {error}
              {needsAuth && (
                <a href="/api/auth/swiggy/login" style={{
                  display: 'block', textAlign: 'center', background: T.orange, color: '#fff',
                  padding: '10px', borderRadius: 8, fontSize: 13, fontWeight: 700,
                  textDecoration: 'none', marginTop: 12,
                }}>
                  Sign in again
                </a>
              )}
            </div>
          )}

          {!tracking && !error && (
            <div style={{ textAlign: 'center', padding: '40px 0', color: T.muted, fontSize: 14 }}>
              Loading your order…
            </div>
          )}

          {tracking && (
            <>
              {delivered ? (
                <div style={{ background: T.greenSoft, border: `1px solid ${T.green}`, borderRadius: 14, padding: 28, textAlign: 'center', marginBottom: 18 }}>
                  <div style={{ fontSize: 32, marginBottom: 10 }}>🎉</div>
                  <p style={{ fontWeight: 700, color: T.green, fontSize: 17, marginBottom: 4 }}>
                    Your order arrived
                  </p>
                  <p style={{ fontSize: 13, color: T.muted }}>Enjoy!</p>
                </div>
              ) : cancelled ? (
                <div style={{ background: T.redSoft, borderRadius: 14, padding: 24, textAlign: 'center', marginBottom: 18 }}>
                  <p style={{ fontWeight: 700, color: T.red, fontSize: 16, marginBottom: 6 }}>
                    This order was cancelled
                  </p>
                  <p style={{ fontSize: 13, color: T.inkSoft, lineHeight: 1.5 }}>
                    If you were charged, a refund follows automatically.
                  </p>
                </div>
              ) : (
                <>
                  <RiderMap rider={rider} destination={tracking.destination} />

                  <div style={{ border: `1px solid ${T.hairline}`, borderRadius: 14, padding: 22, textAlign: 'center', marginBottom: 14 }}>
                    <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: T.muted, marginBottom: 8 }}>
                      Arriving in
                    </p>
                    <p style={{ fontSize: 38, fontWeight: 700, color: T.orangeDeep, lineHeight: 1, marginBottom: 8 }}>
                      {countdown || tracking.etaText || '—'}
                    </p>
                    {tracking.statusText && (
                      <p style={{ fontSize: 14, color: T.inkSoft }}>{tracking.statusText}</p>
                    )}
                    {tracking.deliveryInfo?.label && (
                      <p style={{ fontSize: 12, color: T.muted, marginTop: 6 }}>
                        {tracking.deliveryInfo.label}
                      </p>
                    )}
                  </div>
                </>
              )}

              {rider && !delivered && !cancelled && (
                <div style={{
                  border: `1px solid ${T.hairline}`, borderRadius: 14, padding: 16,
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  gap: 12, marginBottom: 14,
                }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 11, color: T.muted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 4 }}>
                      Delivery partner
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 600, color: T.ink }}>
                      {rider.name || 'Assigned'}
                    </div>
                    {riderDistance != null && (
                      <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>
                        {riderDistance < 1
                          ? `${Math.round(riderDistance * 1000)} m away`
                          : `${riderDistance.toFixed(1)} km away`}
                      </div>
                    )}
                  </div>
                  {rider.phone && (
                    <a
                      href={`tel:${rider.phone}`}
                      style={{
                        background: T.orangeSoft, color: T.orangeDeep, textDecoration: 'none',
                        borderRadius: 999, padding: '9px 18px', fontSize: 13, fontWeight: 700,
                        flexShrink: 0,
                      }}
                    >
                      Call
                    </a>
                  )}
                </div>
              )}

              {!delivered && !cancelled && !rider && (
                <div style={{
                  border: `1px solid ${T.hairline}`, borderRadius: 12, padding: 14,
                  marginBottom: 14, fontSize: 13, color: T.muted, lineHeight: 1.5,
                }}>
                  {tracking.trackError
                    ? `Rider details couldn't be loaded: ${tracking.trackError}`
                    : 'A delivery partner is usually assigned shortly before your order leaves the store. Their name and number will appear here.'}
                </div>
              )}

              {/* Dev-only — the comment always said so, but nothing actually
                  enforced it, so this rendered (collapsed) in production too. */}
              {process.env.NODE_ENV === 'development' && tracking.raw && !rider && (
                <details style={{ marginBottom: 14 }}>
                  <summary style={{
                    fontSize: 12, color: T.muted, cursor: 'pointer', padding: '8px 0',
                  }}>
                    Raw track_order response (development only)
                  </summary>
                  <pre style={{
                    background: '#1C1C1C', color: '#E9E9EB', padding: 12, borderRadius: 8,
                    fontSize: 11, overflowX: 'auto', maxHeight: 320, lineHeight: 1.5,
                  }}>
                    {JSON.stringify(tracking.raw, null, 2)}
                  </pre>
                </details>
              )}

              {tracking.items?.length > 0 ? (
                <div style={{ border: `1px solid ${T.hairline}`, borderRadius: 12, padding: '4px 14px', marginBottom: 16 }}>
                  {tracking.items.map((item, i) => (
                    <div key={i} style={{
                      display: 'flex', justifyContent: 'space-between', gap: 12,
                      padding: '10px 0', fontSize: 13,
                      borderBottom: i < tracking.items.length - 1 ? `1px solid ${T.hairline}` : 'none',
                    }}>
                      <span style={{ color: T.inkSoft, minWidth: 0 }}>{item.name}</span>
                      {item.price != null && (
                        <span style={{ color: T.ink, fontWeight: 600, flexShrink: 0 }}>{item.price}</span>
                      )}
                    </div>
                  ))}
                  {tracking.total != null && (
                    <div style={{
                      display: 'flex', justifyContent: 'space-between',
                      padding: '11px 0', borderTop: `1px solid ${T.hairline}`,
                      fontSize: 14, fontWeight: 700, color: T.ink,
                    }}>
                      <span>Total</span>
                      <span>₹{tracking.total}</span>
                    </div>
                  )}
                </div>
              ) : (tracking.itemCount || tracking.total) ? (
                <div style={{
                  display: 'flex', justifyContent: 'space-between',
                  border: `1px solid ${T.hairline}`, borderRadius: 12,
                  padding: '12px 14px', marginBottom: 16, fontSize: 13, color: T.muted,
                }}>
                  <span>{tracking.itemCount} {tracking.itemCount === 1 ? 'item' : 'items'}</span>
                  {tracking.total != null && (
                    <span style={{ color: T.ink, fontWeight: 600 }}>₹{tracking.total}</span>
                  )}
                </div>
              ) : null}

              {tracking.store?.name && (
                <p style={{ fontSize: 12, color: T.muted, textAlign: 'center', marginBottom: 14, lineHeight: 1.5 }}>
                  From {tracking.store.name}
                  {tracking.placedAt ? ` · placed ${tracking.placedAt}` : ''}
                </p>
              )}

              <button
                onClick={() => router.push('/')}
                style={{ ...shell.ghostBtn, width: '100%', padding: 13 }}
              >
                Scan another fridge
              </button>

              {!delivered && !cancelled && (
                <>
                  <p style={{ fontSize: 12, color: T.muted, textAlign: 'center', marginTop: 12, lineHeight: 1.5 }}>
                    Updates automatically. You can also follow this order in the Swiggy app.
                  </p>
                  {/* There's no cancel tool in the MCP, so point at the people
                      who can actually do it rather than leaving a dead end. */}
                  <p style={{ fontSize: 12, color: T.muted, textAlign: 'center', marginTop: 8, lineHeight: 1.5 }}>
                    Need to cancel? Call Swiggy on{' '}
                    <a href="tel:08067466729" style={{ color: T.orange, fontWeight: 600 }}>
                      080-6746 6729
                    </a>
                    . Instamart orders often can&apos;t be cancelled once placed.
                  </p>
                </>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
