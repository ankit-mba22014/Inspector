import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import { createAdminSupabase } from '@/lib/supabase/server';
import { getValidSwiggyToken } from '@/lib/swiggy/token';
import { instamart, SwiggyMCPError, friendlyError } from '@/lib/swiggy/mcp';
import { extractPaymentStatus, paymentOutcomeMessage } from '@/lib/swiggy/normalise';

/**
 * One status read of an in-flight UPI payment.
 *
 * We drive our own poll loop (no Swiggy widget here), so we own the cadence
 * and the final confirm_order. check_payment_status is a long-poll the server
 * holds for ~19s — the client spaces calls per the interval checkout returned.
 */
export async function POST(req) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { paasId, orderId, finalize } = await req.json();
  const supabase = createAdminSupabase();
  const swiggyToken = await getValidSwiggyToken(user.id);

  if (!swiggyToken) {
    return NextResponse.json({
      status: 'success', terminal: true, success: true, confirmed: true,
      humanMessage: paymentOutcomeMessage('success'), mode: 'mock',
    });
  }

  const markOrder = (status) =>
    supabase
      .from('order_history')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('user_id', user.id)
      .eq('swiggy_order_id', orderId);

  try {
    // Hit our polling cap while still pending — finalise once. The backend
    // marks it failed if payment never resolved, and reconciles a late success.
    if (finalize && orderId) {
      try {
        await instamart.confirmOrder(orderId, paasId, swiggyToken);
      } catch (e) {
        console.warn('confirm_order at cap failed:', e.message);
      }
      await markOrder('payment_timeout');
      return NextResponse.json({
        status: 'timeout', terminal: true, success: false, failed: true,
        humanMessage: 'The payment window closed before it completed. Any amount debited will be refunded.',
        mode: 'live',
      });
    }

    const payment = extractPaymentStatus(
      await instamart.checkPaymentStatus(paasId, orderId, swiggyToken)
    );

    if (payment.terminal && payment.success && !payment.confirmed) {
      // Auto-confirm didn't run server-side, so finalise it ourselves.
      try {
        await instamart.confirmOrder(orderId, paasId, swiggyToken);
        payment.confirmed = true;
      } catch (e) {
        console.error('confirm_order after success failed:', e.message);
      }
    }

    if (payment.terminal) {
      await markOrder(payment.success ? (payment.orderStatus || 'placed') : payment.status);
    }

    return NextResponse.json({
      ...payment,
      humanMessage: payment.terminal ? paymentOutcomeMessage(payment.status) : null,
      mode: 'live',
    });
  } catch (err) {
    if (err instanceof SwiggyMCPError && err.kind === 'auth') {
      // A payment may still be in flight — say so rather than implying it failed.
      return NextResponse.json(
        {
          error: 'Your Swiggy session ended while the payment was processing. Check the Swiggy app to confirm whether it went through.',
          needsSwiggyAuth: true,
        },
        { status: 401 }
      );
    }
    return NextResponse.json({ error: friendlyError(err) }, { status: 500 });
  }
}
