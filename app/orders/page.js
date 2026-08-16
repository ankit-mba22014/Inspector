'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { T, shell, responsiveCSS } from '../theme';

const STATUS = {
  placed: { label: 'Placed', color: T.orangeDeep, bg: T.orangeSoft },
  awaiting_payment: { label: 'Awaiting payment', color: T.amber, bg: T.amberSoft },
  payment_failed: { label: 'Payment failed', color: T.red, bg: T.redSoft },
  payment_timeout: { label: 'Payment timed out', color: T.red, bg: T.redSoft },
  cancelled: { label: 'Cancelled', color: T.red, bg: T.redSoft },
  delivered: { label: 'Delivered', color: T.green, bg: T.greenSoft },
};

function when(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days === 0) return `Today, ${d.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}`;
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export default function OrdersPage() {
  const [orders, setOrders] = useState(null);
  const [error, setError] = useState(null);
  const router = useRouter();

  useEffect(() => {
    fetch('/api/orders')
      .then(async (r) => {
        const data = await r.json();
        if (r.status === 401) { router.push('/welcome'); return; }
        if (!r.ok) throw new Error(data.error);
        setOrders(data.orders);
      })
      .catch((e) => setError(e.message));
  }, []);

  return (
    <div style={shell.page} className="ins-page">
      <style>{responsiveCSS}</style>
      <div style={shell.card} className="ins-card">

        <header style={shell.header}>
          <div>
            <h1 style={shell.brand}>Your orders</h1>
            <p style={shell.tagline}>Placed through Inspector</p>
          </div>
          <button onClick={() => router.push('/')} style={shell.ghostBtn}>Home</button>
        </header>

        <main style={shell.body}>
          {error && (
            <div style={{ background: T.redSoft, color: T.red, padding: '12px 14px', borderRadius: 10, fontSize: 13 }}>
              {error}
            </div>
          )}

          {!orders && !error && (
            <p style={{ textAlign: 'center', padding: '40px 0', color: T.muted, fontSize: 14 }}>
              Loading…
            </p>
          )}

          {orders?.length === 0 && (
            <div style={{ textAlign: 'center', padding: '40px 20px' }}>
              <p style={{ fontSize: 15, color: T.ink, fontWeight: 600, marginBottom: 6 }}>
                No orders yet
              </p>
              <p style={{ fontSize: 13, color: T.muted, marginBottom: 20, lineHeight: 1.5 }}>
                Scan your fridge and Inspector will work out what to reorder.
              </p>
              <button onClick={() => router.push('/')} style={shell.primaryBtn}>
                Scan your fridge
              </button>
            </div>
          )}

          {orders?.map((o) => {
            const s = STATUS[o.status] || { label: o.status, color: T.muted, bg: '#F4F4F5' };
            const live = !['delivered', 'cancelled', 'payment_failed', 'payment_timeout'].includes(o.status);
            return (
              <button
                key={o.orderId}
                onClick={() => router.push(`/order/${o.orderId}`)}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  border: `1px solid ${T.hairline}`, borderRadius: 12,
                  padding: '14px 16px', marginBottom: 8, background: '#fff',
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{
                    fontSize: 11, fontWeight: 700, color: s.color, background: s.bg,
                    padding: '3px 9px', borderRadius: 999,
                  }}>
                    {s.label}
                  </span>
                  <span style={{ fontSize: 12, color: T.muted }}>{when(o.placedAt)}</span>
                </div>

                <div style={{ fontSize: 14, color: T.ink, lineHeight: 1.4 }}>
                  {o.items.length > 0
                    ? o.items.join(', ') + (o.itemCount > o.items.length ? ` +${o.itemCount - o.items.length} more` : '')
                    : `${o.itemCount} items`}
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
                  <span style={{ fontSize: 12, color: T.muted }}>
                    {live ? 'Tap to track' : `Order ${o.orderId}`}
                  </span>
                  {o.total != null && (
                    <span style={{ fontSize: 14, fontWeight: 600, color: T.ink }}>₹{o.total}</span>
                  )}
                </div>
              </button>
            );
          })}
        </main>
      </div>
    </div>
  );
}
