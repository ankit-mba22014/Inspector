import { createAdminSupabase } from '@/lib/supabase/server';
import { decryptToken } from '@/lib/swiggy/crypto';

/**
 * Swiggy MCP v1.0 issues no refresh tokens — the 5-day access token IS the
 * session. When it expires or is revoked, the user re-runs the OAuth flow.
 *
 * Returns { token, reason } where reason is null on success, or one of:
 *   'not_connected' | 'expired' | 'undecryptable'
 */
export async function getSwiggyToken(userId) {
  const supabase = createAdminSupabase();
  const { data: row } = await supabase
    .from('swiggy_tokens')
    .select('access_token, expires_at')
    .eq('user_id', userId)
    .maybeSingle();

  if (!row) return { token: null, reason: 'not_connected' };

  if (Date.now() > new Date(row.expires_at).getTime() - 60_000) {
    return { token: null, reason: 'expired' };
  }

  try {
    return { token: decryptToken(row.access_token), reason: null };
  } catch (err) {
    // Almost always means TOKEN_ENCRYPTION_KEY changed since the token was
    // stored — the ciphertext can't be authenticated with the new key.
    console.error('Could not decrypt stored Swiggy token:', err.message);
    return { token: null, reason: 'undecryptable' };
  }
}

/** Convenience wrapper for callers that only need the token. */
export async function getValidSwiggyToken(userId) {
  const { token } = await getSwiggyToken(userId);
  return token;
}

/** Removes a user's stored Swiggy credentials. */
export async function clearSwiggyToken(userId) {
  const supabase = createAdminSupabase();
  await supabase.from('swiggy_tokens').delete().eq('user_id', userId);
}
