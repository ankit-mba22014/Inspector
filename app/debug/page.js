'use client';

import { useState, useEffect } from 'react';
import { notFound } from 'next/navigation';
import { T, shell, responsiveCSS } from '../theme';

export default function DebugPage() {
  // NODE_ENV is inlined at build time, so this branch is fixed per
  // deployment — same as the backing /api/swiggy/debug route's own gate.
  if (process.env.NODE_ENV !== 'development') notFound();

  const [output, setOutput] = useState(null);
  const [loading, setLoading] = useState(false);
  const [addressId, setAddressId] = useState('');
  const [orderId, setOrderId] = useState('');
  const [addresses, setAddresses] = useState([]);

  // Load addresses first — most Instamart tools require an addressId
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/swiggy/debug?tool=get_addresses');
        const data = await res.json();
        const list = data?.raw?.structuredContent?.addresses || [];
        setAddresses(list);
        if (list[0]) setAddressId(list[0].id);
      } catch { /* ignore */ }
    })();
  }, []);

  const loadSnapshots = async (full) => {
    setLoading(true);
    setOutput(null);
    try {
      const params = new URLSearchParams({
        ...(orderId ? { orderId } : {}),
        ...(full ? { full: '1' } : {}),
      });
      const res = await fetch(`/api/swiggy/snapshots?${params}`);
      setOutput(await res.json());
    } catch (err) {
      setOutput({ error: err.message });
    } finally {
      setLoading(false);
    }
  };

  const presets = [
    { label: '📋 List all tools', tool: '__list__', needsAddress: false },
    { label: 'get_addresses', tool: 'get_addresses', needsAddress: false },
    { label: 'your_go_to_items', tool: 'your_go_to_items', needsAddress: true },
    { label: 'search_products (onion)', tool: 'search_products', extra: { query: 'onion' }, needsAddress: true },
    { label: 'get_cart', tool: 'get_cart', needsAddress: false },
    { label: 'get_orders', tool: 'get_orders', needsAddress: false },
    { label: 'get_payment_options', tool: 'get_payment_options', needsAddress: false },
    { label: 'track_order', tool: 'track_order', needsOrder: true },
    { label: 'get_delivery_status', tool: 'get_delivery_status', needsAddress: true, needsOrder: true },
    { label: 'get_order_details', tool: 'get_order_details', needsOrder: true },
  ];

  const run = async (preset) => {
    setLoading(true);
    setOutput(null);
    try {
      const params = new URLSearchParams({
        tool: preset.tool,
        ...(preset.extra || {}),
        ...(preset.needsAddress && addressId ? { addressId } : {}),
        ...(preset.needsOrder && orderId ? { orderId } : {}),
      });
      const res = await fetch(`/api/swiggy/debug?${params}`);
      setOutput(await res.json());
    } catch (err) {
      setOutput({ error: err.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={shell.page} className="ins-page">
      <style>{responsiveCSS}</style>
      <div style={{ ...shell.card, maxWidth: 760 }} className="ins-card">
        <header style={shell.header}>
          <div>
            <h1 style={shell.brand}>MCP debug</h1>
            <p style={shell.tagline}>Raw responses from Swiggy Instamart</p>
          </div>
        </header>

        <main style={shell.body}>
          {addresses.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <label style={{ fontSize: 12, color: T.muted, display: 'block', marginBottom: 6 }}>
                addressId (required by most tools)
              </label>
              <select
                value={addressId}
                onChange={(e) => setAddressId(e.target.value)}
                style={{
                  width: '100%', padding: '9px 12px', borderRadius: 8,
                  border: `1px solid ${T.hairline}`, fontSize: 13, fontFamily: 'inherit',
                }}
              >
                {addresses.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.addressTag} — {a.id}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div style={{ marginBottom: 16 }}>
            <label style={{ fontSize: 12, color: T.muted, display: 'block', marginBottom: 6 }}>
              orderId (for tracking tools)
            </label>
            <input
              value={orderId}
              onChange={(e) => setOrderId(e.target.value)}
              placeholder="245674266114186"
              style={{
                width: '100%', padding: '9px 12px', borderRadius: 8,
                border: `1px solid ${T.hairline}`, fontSize: 13, fontFamily: 'inherit',
              }}
            />
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 18 }}>
            {presets.map((p) => (
              <button
                key={p.label}
                onClick={() => run(p)}
                disabled={loading}
                style={{
                  background: T.orangeSoft, border: `1px solid ${T.hairline}`,
                  color: T.ink, borderRadius: 8, padding: '8px 12px',
                  fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div style={{
            border: `1px solid ${T.hairline}`, borderRadius: 10,
            padding: 12, marginBottom: 18,
          }}>
            <p style={{ fontSize: 12, color: T.muted, marginBottom: 8, lineHeight: 1.5 }}>
              Tracking responses are recorded automatically while an order is live,
              so the shapes can be read back afterwards.
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => loadSnapshots(false)}
                style={{
                  background: T.orangeSoft, border: `1px solid ${T.hairline}`,
                  color: T.ink, borderRadius: 8, padding: '8px 12px',
                  fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                Tracking timeline
              </button>
              <button
                onClick={() => loadSnapshots(true)}
                style={{
                  background: '#fff', border: `1px solid ${T.hairline}`,
                  color: T.ink, borderRadius: 8, padding: '8px 12px',
                  fontSize: 13, cursor: 'pointer', fontFamily: 'inherit',
                }}
              >
                Full payloads
              </button>
            </div>
          </div>

          {loading && <p style={{ color: T.muted, fontSize: 14 }}>Calling Swiggy…</p>}

          {output && (
            <pre style={{
              background: '#1C1C1C', color: '#E9E9EB', padding: 16,
              borderRadius: 10, fontSize: 12, overflowX: 'auto',
              lineHeight: 1.5, maxHeight: 520,
            }}>
              {JSON.stringify(output, null, 2)}
            </pre>
          )}
        </main>
      </div>
    </div>
  );
}
