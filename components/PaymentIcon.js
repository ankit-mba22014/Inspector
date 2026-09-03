'use client';

import { useEffect, useState } from 'react';

// Keyed by the intent scheme (the part of opt.id before "://"), not by
// Swiggy's label — labels aren't always present, schemes are.
const APP_META = {
  gpay: { slug: 'gpay', name: 'Google Pay', color: '#4285F4' },
  tez: { slug: 'gpay', name: 'Google Pay', color: '#4285F4' },
  phonepe: { slug: 'phonepe', name: 'PhonePe', color: '#5F259F' },
  paytmmp: { slug: 'paytm', name: 'Paytm', color: '#00BAF2' },
  bhim: { slug: 'bhim', name: 'BHIM', color: '#00639B' },
  credpay: { slug: 'cred', name: 'CRED', color: '#0F0F0F' },
  super: { slug: 'supermoney', name: 'super.money', color: '#6C4EF5' },
};

// Try .svg then .png before giving up — icons may not all be in the same format.
const EXTENSIONS = ['svg', 'png'];

function schemeFromId(id) {
  return String(id || '').split('://')[0].toLowerCase();
}

export default function PaymentIcon({ id, label, size = 40 }) {
  const meta = APP_META[schemeFromId(id)];
  const [extIndex, setExtIndex] = useState(0);

  // Server-rendered <img src> starts fetching from the raw HTML before
  // hydration attaches onError — a fast local 404 can resolve in that gap and
  // get missed entirely. Holding off until mount means the element (and its
  // fetch) is only ever created client-side, in the same commit as the
  // handler, so nothing can fail before we're listening for it.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted || !meta || extIndex >= EXTENSIONS.length) {
    const name = label || meta?.name || 'Pay';
    const initial = name.trim().charAt(0).toUpperCase() || '?';
    return (
      <span
        aria-hidden="true"
        style={{
          width: size, height: size, borderRadius: '50%', flexShrink: 0,
          background: meta?.color || '#8A8A8A', color: '#fff',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: size * 0.42, fontWeight: 700, lineHeight: 1,
        }}
      >
        {initial}
      </span>
    );
  }

  return (
    <img
      src={`/payment/${meta.slug}.${EXTENSIONS[extIndex]}`}
      alt={label || meta.name}
      width={size}
      height={size}
      style={{ borderRadius: '50%', objectFit: 'contain', flexShrink: 0 }}
      onError={() => setExtIndex((i) => i + 1)}
    />
  );
}
