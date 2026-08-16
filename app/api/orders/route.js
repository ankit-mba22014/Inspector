import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import { createAdminSupabase } from '@/lib/supabase/server';

/**
 * The user's own order history.
 *
 * Read from our records rather than Swiggy's, so it stays available when a
 * Swiggy session has expired — and because these are specifically the orders
 * placed through Inspector.
 */
export async function GET() {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const supabase = createAdminSupabase();
  const { data, error } = await supabase
    .from('order_history')
    .select('swiggy_order_id, items, total_amount, status, placed_at')
    .eq('user_id', user.id)
    .order('placed_at', { ascending: false })
    .limit(20);

  if (error) {
    console.error('Could not read order history:', error);
    return NextResponse.json({ error: 'Could not load your orders' }, { status: 500 });
  }

  return NextResponse.json({
    orders: (data || []).map((o) => ({
      orderId: o.swiggy_order_id,
      itemCount: Array.isArray(o.items) ? o.items.length : 0,
      items: (o.items || []).slice(0, 3).map((i) => i.name).filter(Boolean),
      total: o.total_amount,
      status: o.status,
      placedAt: o.placed_at,
    })),
  });
}
