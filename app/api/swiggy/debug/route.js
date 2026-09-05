import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import { createAdminSupabase } from '@/lib/supabase/server';
import { getValidSwiggyToken } from '@/lib/swiggy/token';
import { callMCPTool, listTools } from '@/lib/swiggy/mcp';

/**
 * Development helper — raw MCP responses.
 *   /api/swiggy/debug?tool=get_addresses
 *   /api/swiggy/debug?tool=__list__          (enumerates every available tool)
 */
export async function GET(req) {
  // 404, not 401/403 — don't even reveal this endpoint exists in production.
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  const user = await currentUser();
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });

  const swiggyToken = await getValidSwiggyToken(user.id);
  if (!swiggyToken) {
    return NextResponse.json({ error: 'No valid Swiggy token — connect Swiggy first' }, { status: 400 });
  }

  const url = new URL(req.url);
  const tool = url.searchParams.get('tool') || 'get_addresses';
  const server = url.searchParams.get('server') || 'im';

  try {
    if (tool === '__list__') {
      const raw = await listTools(server, swiggyToken);
      // Return just names + required args to keep it readable
      const summary = (raw.tools || []).map((t) => ({
        name: t.name,
        description: t.description?.slice(0, 120),
        required: t.inputSchema?.required || [],
      }));
      return NextResponse.json({ server, toolCount: summary.length, tools: summary });
    }

    const args = {};
    for (const [k, v] of url.searchParams.entries()) {
      if (k !== 'tool' && k !== 'server') args[k] = v;
    }

    // track_order needs coordinates. Rather than making the caller paste them,
    // look them up from the order we recorded at checkout.
    if (tool === 'track_order' && args.orderId && (!args.lat || !args.lng)) {
      const { data: row } = await createAdminSupabase()
        .from('order_history')
        .select('delivery_lat, delivery_lng')
        .eq('user_id', user.id)
        .eq('swiggy_order_id', args.orderId)
        .maybeSingle();

      if (row?.delivery_lat != null) {
        args.lat = row.delivery_lat;
        args.lng = row.delivery_lng;
      } else {
        return NextResponse.json({
          tool,
          error: 'No stored coordinates for this order. Pass &lat=&lng= explicitly.',
        }, { status: 400 });
      }
    }

    const raw = await callMCPTool(server, tool, args, swiggyToken);
    return NextResponse.json({ tool, args, raw });
  } catch (err) {
    return NextResponse.json(
      { tool, error: err.message, code: err.code, details: err.details },
      { status: 500 }
    );
  }
}
