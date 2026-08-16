/**
 * Dynamic Client Registration (RFC 7591) against Swiggy MCP.
 *
 * Per Swiggy's docs: "You don't need to apply for or manage a client identity.
 * Swiggy MCP supports Dynamic Client Registration at POST /auth/register."
 *
 * We register once and cache the resulting client_id in the database so we
 * don't re-register on every login.
 */

import { createAdminSupabase } from '@/lib/supabase/server';

const BASE = process.env.SWIGGY_BASE_URL || 'https://mcp.swiggy.com';
const REGISTER_URL = `${BASE}/auth/register`;

/**
 * Returns a usable client_id, registering with Swiggy via DCR if we don't
 * have one cached yet.
 */
export async function getOrRegisterClientId() {
  const supabase = createAdminSupabase();

  // Check cache first
  const { data: cached } = await supabase
    .from('swiggy_client')
    .select('client_id, client_secret')
    .eq('id', 'default')
    .maybeSingle();

  if (cached?.client_id) {
    return { clientId: cached.client_id, clientSecret: cached.client_secret };
  }

  // Register fresh
  const res = await fetch(REGISTER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Inspector',
      redirect_uris: [process.env.SWIGGY_REDIRECT_URI],
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none', // public client using PKCE
      scope: 'mcp:tools mcp:resources',
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`DCR registration failed (${res.status}): ${text}`);
  }

  const reg = await res.json();
  // Expected: { client_id, client_secret?, client_id_issued_at, ... }

  await supabase.from('swiggy_client').upsert({
    id: 'default',
    client_id: reg.client_id,
    client_secret: reg.client_secret || null,
    registered_at: new Date().toISOString(),
    raw_response: reg,
  });

  return { clientId: reg.client_id, clientSecret: reg.client_secret || null };
}
