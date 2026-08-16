import { NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { extractPaymentFromBridge } from '@/lib/swiggy/bridge';
import { currentUser } from '@/lib/auth';
import { createAdminSupabase } from '@/lib/supabase/server';
import { getValidSwiggyToken } from '@/lib/swiggy/token';
import { instamart, SwiggyMCPError, friendlyError } from '@/lib/swiggy/mcp';
import {
  extractAddresses, extractCart, extractOrder, extractOrders, summaryText,
} from '@/lib/swiggy/normalise';
import { mockInstamart } from '@/lib/swiggy/mock';

// Swiggy's documented Instamart bounds for MCP checkout.
const MIN_ORDER = 99;
const MAX_ORDER = 1000;

export async function POST(req) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const supabase = createAdminSupabase();
  const { items, totalAmount, scanId, addressId, paymentMethod, intentApp, generateUPIQR } =
    await req.json();

  if (!Array.isArray(items) || items.length === 0) {
    return NextResponse.json({ error: 'Your cart is empty' }, { status: 400 });
  }

  if (totalAmount != null) {
    if (totalAmount < MIN_ORDER) {
      return NextResponse.json(
        { error: `Instamart needs a minimum order of ₹${MIN_ORDER}. Add a little more to your cart.` },
        { status: 400 }
      );
    }
    if (totalAmount > MAX_ORDER) {
      return NextResponse.json(
        {
          error: `Orders above ₹${MAX_ORDER} can't be placed here. Your cart is already synced — open the Swiggy app to finish this one.`,
        },
        { status: 400 }
      );
    }
  }

  const swiggyToken = await getValidSwiggyToken(user.id);

  if (!swiggyToken) {
    const order = extractOrder(await mockInstamart.checkout());
    return NextResponse.json({ order, mode: 'mock' });
  }

  let resolvedAddressId = addressId;
  if (!resolvedAddressId) {
    const addresses = extractAddresses(await instamart.getAddresses(swiggyToken));
    resolvedAddressId = addresses[0]?.id;
  }
  if (!resolvedAddressId) {
    return NextResponse.json({ error: 'No delivery address available' }, { status: 400 });
  }

  // Grab the delivery coordinates while the cart still exists — track_order
  // needs them, and checkout clears the cart.
  let lat = null;
  let lng = null;
  try {
    const cart = extractCart(await instamart.getCart(swiggyToken));
    const d = cart.selectedAddressDetails;
    lat = d?.lat ?? d?.location?.latitude ?? null;
    lng = d?.lng ?? d?.location?.longitude ?? null;
  } catch (e) {
    console.warn('Could not read delivery coordinates before checkout:', e.message);
  }

  const placedAtStart = Date.now();

  try {
    const raw = await instamart.checkout(
      { addressId: resolvedAddressId, paymentMethod, intentApp, generateUPIQR },
      swiggyToken
    );
    const order = extractOrder(raw);
    order.instruction = summaryText(raw)?.slice(0, 400) || null;

    // --- Building the desktop payment surface ---
    //
    // A QR is only worth showing if it encodes a real UPI intent — a QR of an
    // https link just opens a browser. Swiggy's `upiIntentUrl` is normally an
    // opaque deeplink-redirect URL, so we check the scheme rather than assume,
    // and otherwise pull the genuine intent string out of their payment page.
    const isUpiIntent = (u) => typeof u === 'string' && /^(upi|tez|phonepe|paytmmp|gpay|bhim):/i.test(u);

    let qrDataUrl = null;
    let qrImage = null;
    let upiUrl = isUpiIntent(order.upiIntentUrl) ? order.upiIntentUrl : null;

    if (order.pendingPayment) {
      if (!upiUrl && order.bridgeUrl) {
        const found = await extractPaymentFromBridge(order.bridgeUrl);
        upiUrl = found.upiUrl;
        qrImage = found.qrImage;   // their own QR image, if no intent string
      }

      if (upiUrl) {
        try {
          qrDataUrl = await QRCode.toDataURL(upiUrl, {
            width: 320, margin: 1, errorCorrectionLevel: 'M',
            color: { dark: '#1C1C1C', light: '#FFFFFF' },
          });
        } catch (e) {
          console.error('QR generation failed:', e.message);
        }
      }

      console.log('[checkout] payment surface:', {
        isQrFlow: order.isQrFlow,
        intentFromCheckout: isUpiIntent(order.upiIntentUrl),
        intentFromBridge: !!upiUrl && !isUpiIntent(order.upiIntentUrl),
        renderedOwnQr: !!qrDataUrl,
        reusedTheirQrImage: !!qrImage,
      });
    }

    await supabase.from('order_history').insert({
      user_id: user.id,
      scan_id: scanId || null,
      swiggy_order_id: order.orderId,
      items,
      total_amount: totalAmount,
      status: order.pendingPayment ? 'awaiting_payment' : 'placed',
      delivery_lat: lat,
      delivery_lng: lng,
      delivery_address_id: resolvedAddressId,
    });

    return NextResponse.json({
      order: { ...order, upiUrl },
      qrDataUrl,
      qrImage,
      mode: 'live',
    });
  } catch (err) {
    if (err instanceof SwiggyMCPError && err.kind === 'auth') {
      return NextResponse.json({ error: 'Your Swiggy session has ended', needsSwiggyAuth: true }, { status: 401 });
    }

    // Checkout is not idempotent. On an infrastructure failure the order may
    // still have gone through, so check before letting the user try again —
    // blind retrying risks charging them twice.
    if (err instanceof SwiggyMCPError && (err.kind === 'upstream' || err.kind === 'internal')) {
      await new Promise((r) => setTimeout(r, 3000));
      try {
        const recent = extractOrders(await instamart.getOrders({ count: 5 }, swiggyToken));
        const placed = recent.find((o) => {
          const t = o.placedAt ? new Date(o.placedAt).getTime() : 0;
          return t >= placedAtStart - 60_000;
        });

        if (placed) {
          await supabase.from('order_history').insert({
            user_id: user.id,
            scan_id: scanId || null,
            swiggy_order_id: placed.orderId,
            items,
            total_amount: totalAmount,
            status: placed.status || 'placed',
          });
          return NextResponse.json({
            order: { orderId: placed.orderId, status: placed.status || 'placed', pendingPayment: false },
            mode: 'live',
            recovered: true,
          });
        }
      } catch (checkErr) {
        console.error('Could not verify whether the order went through:', checkErr.message);
      }
    }

    console.error('Checkout failed:', err.message, err.details, 'session:', err.sessionId);

    // Swiggy asks integrators to file a report on unexpected failures so their
    // team can trace it. Best-effort — never let this mask the original error.
    if (err.kind === 'internal' || err.kind === 'upstream') {
      try {
        await instamart.reportError('checkout', err.message, swiggyToken);
      } catch { /* reporting is not worth failing the request over */ }
    }
    return NextResponse.json(
      { error: friendlyError(err), hint: err.details?.hint, sessionId: err.sessionId },
      { status: 500 }
    );
  }
}
