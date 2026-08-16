import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import { createAdminSupabase } from '@/lib/supabase/server';

/**
 * Development aid — reads back what the tracking tools returned during a
 * delivery, so response shapes can be studied afterwards instead of being
 * caught live.
 *
 *   /api/swiggy/snapshots                      most recent across all orders
 *   /api/swiggy/snapshots?orderId=245674...    one order's timeline
 *   /api/swiggy/snapshots?riderOnly=1          only snapshots containing a rider
 */
export async function GET(req) {
  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const params = new URL(req.url).searchParams;
  const supabase = createAdminSupabase();

  let q = supabase
    .from('tracking_snapshots')
    .select('swiggy_order_id, tool, status_text, rider_found, payload, captured_at')
    .eq('user_id', user.id)
    .order('captured_at', { ascending: true })
    .limit(60);

  if (params.get('orderId')) q = q.eq('swiggy_order_id', params.get('orderId'));
  if (params.get('riderOnly')) q = q.eq('rider_found', true);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // A summary first — usually enough to see what changed and when
  const timeline = (data || []).map((s) => ({
    at: s.captured_at,
    tool: s.tool,
    status: s.status_text,
    riderFound: s.rider_found,
    // The keys present at this moment, which is how we spot a rider appearing
    keys: Object.keys(s.payload?.structuredContent?.data || s.payload?.structuredContent || {}),
  }));

  return NextResponse.json({
    count: data?.length || 0,
    everFoundRider: (data || []).some((s) => s.rider_found),
    timeline,
    snapshots: params.get('full') ? data : undefined,
  });
}
