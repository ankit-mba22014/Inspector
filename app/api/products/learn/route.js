import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import { createAdminSupabase } from '@/lib/supabase/server';

/**
 * Records a manual correction: automatic matching couldn't find `query`,
 * the user searched and picked `product` themselves — remember the pick so
 * the same word matches directly next time. See extractProducts/pickBestMatch
 * in products/search/route.js for where this gets read back.
 */
export async function POST(req) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const { query, product } = await req.json();
  const itemQuery = typeof query === 'string' ? query.trim().toLowerCase() : '';

  if (!itemQuery || !product?.skuId || !product?.spinId) {
    return NextResponse.json(
      { error: 'query, product.skuId and product.spinId are required' },
      { status: 400 }
    );
  }

  const supabase = createAdminSupabase();
  const { error } = await supabase
    .from('user_preferences')
    .upsert({
      user_id: user.id,
      item_query: itemQuery,
      sku_id: product.skuId,
      spin_id: product.spinId,
      brand: product.brand || null,
      product_name: product.name || null,
      last_synced_at: new Date().toISOString(),
    }, { onConflict: 'user_id,item_query' });

  if (error) {
    console.error('learn upsert failed:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
