import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import { createAdminSupabase } from '@/lib/supabase/server';
import { getValidSwiggyToken } from '@/lib/swiggy/token';
import { instamart, friendlyError } from '@/lib/swiggy/mcp';
import { rankProducts } from '@/lib/swiggy/normalise';
import { mockInstamart } from '@/lib/swiggy/mock';

/**
 * Free-text product search for the cart's "add an item" box.
 * Unlike /api/products/search (which auto-picks one match per detected item),
 * this returns a ranked list so the user chooses.
 */
export async function POST(req) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { query, addressId } = await req.json();
  if (!query || query.trim().length < 2) {
    return NextResponse.json({ results: [] });
  }

  const swiggyToken = await getValidSwiggyToken(user.id);

  if (!swiggyToken) {
    const res = await mockInstamart.searchProducts(query);
    return NextResponse.json({ results: res.results, mode: 'mock' });
  }

  if (!addressId) {
    return NextResponse.json({ error: 'A delivery address is required' }, { status: 400 });
  }

  try {
    const raw = await instamart.searchProducts(query.trim(), addressId, swiggyToken);
    return NextResponse.json({ results: rankProducts(raw, query, 8), mode: 'live' });
  } catch (err) {
    const unauth = err.kind === 'auth';
    return NextResponse.json(
      { error: err.message, needsSwiggyAuth: unauth },
      { status: unauth ? 401 : 500 }
    );
  }
}
