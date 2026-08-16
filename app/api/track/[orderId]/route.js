import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import { createAdminSupabase } from '@/lib/supabase/server';
import { getValidSwiggyToken } from '@/lib/swiggy/token';
import { instamart, SwiggyMCPError, friendlyError } from '@/lib/swiggy/mcp';
import {
  extractDeliveryStatus, extractTracking, extractAddresses,
  extractOrderCoords, extractOrders,
} from '@/lib/swiggy/normalise';
import { mockInstamart } from '@/lib/swiggy/mock';

/**
 * track_order needs the delivery coordinates, and the cart that carries them
 * is cleared once the order is placed. We capture them at checkout, but orders
 * placed before that existed — or from another device — won't have them, so we
 * fall back to the order's own record on Swiggy and cache what we find.
 */
async function resolveCoords({ supabase, userId, orderId, swiggyToken }) {
  const { data: row } = await supabase
    .from('order_history')
    .select('delivery_lat, delivery_lng, delivery_address_id, items, total_amount')
    .eq('user_id', userId)
    .eq('swiggy_order_id', orderId)
    .maybeSingle();

  if (row?.delivery_lat != null && row?.delivery_lng != null) {
    return { lat: row.delivery_lat, lng: row.delivery_lng, addressId: row.delivery_address_id, row, source: 'stored' };
  }

  // The order's own detail record carries the delivery address.
  let coords = null;
  try {
    coords = extractOrderCoords(await instamart.getOrderDetails(orderId, swiggyToken));
  } catch (e) {
    console.warn('get_order_details unavailable:', e.message);
  }

  // Otherwise look for it in the recent orders list.
  if (!coords) {
    try {
      const orders = extractOrders(await instamart.getOrders({ count: 10 }, swiggyToken));
      const match = orders.find((o) => String(o.orderId) === String(orderId));
      if (match?.lat != null && match?.lng != null) {
        coords = { lat: match.lat, lng: match.lng };
      }
    } catch (e) {
      console.warn('get_orders unavailable:', e.message);
    }
  }

  // Last resort: the account's default address. Approximate, but it's the same
  // city, which is enough for track_order to accept the call.
  let addressId = row?.delivery_address_id || null;
  if (!addressId) {
    try {
      const addresses = extractAddresses(await instamart.getAddresses(swiggyToken));
      addressId = addresses[0]?.id || null;
    } catch { /* non-fatal */ }
  }

  if (coords) {
    // Cache it so later polls skip all of this
    await supabase
      .from('order_history')
      .update({
        delivery_lat: coords.lat,
        delivery_lng: coords.lng,
        delivery_address_id: addressId,
      })
      .eq('user_id', userId)
      .eq('swiggy_order_id', orderId);
  }

  return { lat: coords?.lat ?? null, lng: coords?.lng ?? null, addressId, row, source: coords ? 'order_record' : 'none' };
}

/**
 * Records what a tracking tool returned, so the response shapes can be studied
 * after the fact rather than caught live during a ten-minute delivery.
 * Development aid — see migration 004.
 */
async function snapshot({ supabase, userId, orderId, tool, payload, statusText, riderFound }) {
  if (process.env.NODE_ENV !== 'development' || !payload) return;
  try {
    await supabase.from('tracking_snapshots').insert({
      user_id: userId,
      swiggy_order_id: orderId,
      tool,
      status_text: statusText || null,
      rider_found: !!riderFound,
      payload,
    });
  } catch (e) {
    // Never let a debugging aid break tracking
    console.warn('Could not save tracking snapshot:', e.message);
  }
}

export async function GET(req, { params }) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { orderId } = await params;
  const swiggyToken = await getValidSwiggyToken(user.id);

  if (!swiggyToken) {
    const t = await mockInstamart.trackOrder();
    return NextResponse.json({
      status: t.status, etaMinutes: t.etaMinutes, rider: t.rider,
      pollIntervalSec: 15, mode: 'mock', receivedAt: Date.now(),
    });
  }

  const supabase = createAdminSupabase();

  try {
    const { lat, lng, addressId, row, source } =
      await resolveCoords({ supabase, userId: user.id, orderId, swiggyToken });

    // Cheap ETA poller — also sets its own cadence and terminal flags.
    let delivery = null;
    if (addressId) {
      try {
        const rawDelivery = await instamart.getDeliveryStatus(orderId, addressId, swiggyToken);
        delivery = extractDeliveryStatus(rawDelivery);
        await snapshot({
          supabase, userId: user.id, orderId,
          tool: 'get_delivery_status',
          payload: rawDelivery,
          statusText: delivery?.statusText,
        });
      } catch (e) {
        console.warn('get_delivery_status unavailable:', e.message);
      }
    }

    // Rider detail and richer status.
    let tracking = null;
    let rawTracking = null;
    let trackError = null;

    if (lat != null && lng != null) {
      try {
        rawTracking = await instamart.trackOrder(orderId, lat, lng, swiggyToken);
        tracking = extractTracking(rawTracking);

        await snapshot({
          supabase, userId: user.id, orderId,
          tool: 'track_order',
          payload: rawTracking,
          statusText: tracking?.statusText,
          riderFound: !!tracking?.rider,
        });

        console.log('[track] ' + JSON.stringify({
          orderId,
          status: tracking?.statusText,
          riderFound: !!tracking?.rider,
          terminal: tracking?.isTerminal,
        }));
      } catch (e) {
        trackError = e.message;
        console.warn('track_order failed:', e.message);
      }
    } else {
      trackError = 'Could not determine the delivery coordinates for this order';
      console.warn('[track] no coordinates for order', orderId);
    }

    // statusText is a plain string now; pollingIntervalSeconds === -1 is Swiggy
    // telling us the order is finished and polling should stop.
    const statusText = tracking?.statusText || delivery?.statusText || '';
    const delivered =
      delivery?.delivered === true || /deliver/i.test(statusText);
    const cancelled =
      delivery?.cancelled === true || /cancel/i.test(statusText);
    const terminal = delivered || cancelled || tracking?.isTerminal === true;

    if (delivered || cancelled) {
      await supabase
        .from('order_history')
        .update({ status: cancelled ? 'cancelled' : 'delivered', updated_at: new Date().toISOString() })
        .eq('user_id', user.id)
        .eq('swiggy_order_id', orderId);
    }

    return NextResponse.json({
      orderId,
      receivedAt: Date.now(),

      deliveryBy: delivery?.deliveryBy ?? null,
      serverNow: delivery?.serverNow ?? null,
      etaText: delivery?.etaText || null,
      statusText: statusText || null,

      status: statusText || (delivered ? 'DELIVERED' : 'IN_PROGRESS'),
      delivered,
      cancelled,
      terminal,

      rider: tracking?.rider || null,
      destination: lat != null && lng != null ? { lat, lng } : null,

      // Swiggy's own item list is better than our record — real names, real
      // prices, and it reflects any substitution made at the store.
      items: tracking?.items?.length ? tracking.items : null,
      itemCount: tracking?.itemCount ?? (Array.isArray(row?.items) ? row.items.length : null),
      total: row?.total_amount ?? null,
      store: tracking?.store || null,
      deliveryInfo: tracking?.deliveryInfo || null,
      placedAt: tracking?.placedAt || null,

      pollIntervalSec: tracking?.pollSeconds || delivery?.pollIntervalSec || 45,
      liveEtaDisabled: delivery?.disabled === true,
      trackingAvailable: lat != null && lng != null,
      trackError,

      // Raw payload in development so response shapes can be confirmed rather
      // than guessed at.
      raw: process.env.NODE_ENV === 'development' ? rawTracking : undefined,
      mode: 'live',
    });
  } catch (err) {
    if (err instanceof SwiggyMCPError && err.kind === 'auth') {
      return NextResponse.json({ error: 'Your Swiggy session has ended', needsSwiggyAuth: true }, { status: 401 });
    }
    return NextResponse.json({ error: friendlyError(err) }, { status: 500 });
  }
}
