import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import { createAdminSupabase } from '@/lib/supabase/server';
import { getValidSwiggyToken } from '@/lib/swiggy/token';
import { instamart, SwiggyMCPError, friendlyError } from '@/lib/swiggy/mcp';
import { extractCart } from '@/lib/swiggy/normalise';
import { mockInstamart } from '@/lib/swiggy/mock';

export async function GET(req) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const swiggyToken = await getValidSwiggyToken(user.id);
  if (!swiggyToken) {
    return NextResponse.json({ cart: { items: [], lineItems: [], total: 0, isEmpty: true }, mode: 'mock' });
  }

  try {
    const cart = extractCart(await instamart.getCart(swiggyToken));
    return NextResponse.json({ cart, mode: 'live' });
  } catch (err) {
    return NextResponse.json({ error: friendlyError(err) }, { status: 500 });
  }
}

/**
 * POST — set the entire cart contents.
 *
 * IMPORTANT: Swiggy's update_cart REPLACES the whole cart with whatever items
 * you send. So every call must include the complete desired cart, not a delta.
 *
 * Body: { items: [...], addressId }  → cart becomes exactly these items
 */
export async function POST(req) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { items, addressId, addressChanged } = await req.json();

  if (!addressId) {
    return NextResponse.json({ error: 'A delivery address is required' }, { status: 400 });
  }

  const swiggyToken = await getValidSwiggyToken(user.id);

  if (!swiggyToken) {
    const list = items || [];
    await mockInstamart.updateCart(list);
    const res = await mockInstamart.getCart(list);
    return NextResponse.json({ cart: res.cart, mode: 'mock', needsSwiggyAuth: true });
  }

  // Build the FULL desired cart in one payload. Items with quantity 0 are
  // simply omitted, which is how removal works given replace semantics.
  const mcpItems = (items || [])
    .filter((i) => i.skuId && i.spinId && (i.quantity_count ?? 1) > 0)
    .map((i) => ({
      spinId: i.spinId,
      skuId: i.skuId,
      quantity: i.quantity_count ?? 1,
    }));

  let warning = null;

  try {
    // Switching address mid-cart leaves SKUs bound to the old store, so clear
    // first rather than letting mismatched items through.
    if (addressChanged) {
      try {
        await instamart.clearCart(swiggyToken);
      } catch (e) {
        console.warn('clear_cart before address switch failed:', e.message);
      }
    }

    if (mcpItems.length > 0) {
      await instamart.updateCart(mcpItems, addressId, swiggyToken);
    } else {
      await instamart.clearCart(swiggyToken);
    }
  } catch (err) {
    if (err.kind === 'auth') {
      return NextResponse.json({ error: 'Your Swiggy session has ended', needsSwiggyAuth: true }, { status: 401 });
    }
    console.error('update_cart failed:', err.message, err.details);
    warning = err.message;
  }

  try {
    const cart = extractCart(await instamart.getCart(swiggyToken));
    return NextResponse.json({ cart, mode: 'live', warning });
  } catch (err) {
    return NextResponse.json({ error: err.message, warning }, { status: 500 });
  }
}
