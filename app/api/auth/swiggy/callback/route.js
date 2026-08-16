import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createAdminSupabase } from '@/lib/supabase/server';
import { encryptToken } from '@/lib/swiggy/crypto';
import { identityFromToken } from '@/lib/swiggy/identity';
import { setSessionCookie } from '@/lib/session';

const BASE = process.env.SWIGGY_BASE_URL || 'https://mcp.swiggy.com';
const TOKEN_URL = `${BASE}/auth/token`;

export async function GET(req) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const oauthError = url.searchParams.get('error');

  const fail = (reason) =>
    NextResponse.redirect(new URL(`/welcome?error=${reason}`, req.url));

  if (oauthError) return fail(oauthError);

  const store = await cookies();
  const savedState = store.get('swiggy_oauth_state')?.value;
  const verifier = store.get('swiggy_pkce_verifier')?.value;

  if (!code || !state || state !== savedState || !verifier) {
    console.error('OAuth state check failed', {
      hasCode: !!code, statesMatch: state === savedState, hasVerifier: !!verifier,
    });
    return fail('expired');
  }

  try {
    // /auth/token takes JSON with exactly these four fields — public PKCE
    // client, so no client_id or client_secret.
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        code_verifier: verifier,
        redirect_uri: process.env.SWIGGY_REDIRECT_URI,
      }),
    });

    if (!res.ok) {
      console.error('Token exchange failed:', res.status, await res.text());
      return fail('token_exchange_failed');
    }

    const tokens = await res.json();
    const accessToken = tokens.access_token;
    const identity = identityFromToken(accessToken);

    const supabase = createAdminSupabase();
    let profileId = null;

    // Returning user — match on the Swiggy subject so history carries over.
    if (identity.swiggyUserId) {
      const { data: existing } = await supabase
        .from('profiles')
        .select('id')
        .eq('swiggy_user_id', identity.swiggyUserId)
        .maybeSingle();
      profileId = existing?.id || null;
    } else {
      // No recognisable subject claim. Rather than risk merging two people
      // onto one profile, start a fresh one and log what we did get.
      console.warn(
        'Swiggy token carried no subject claim; creating a new profile. Claims:',
        Object.keys(identity.claims || {})
      );
    }

    if (!profileId) {
      const { data: created, error } = await supabase
        .from('profiles')
        .insert({
          swiggy_user_id: identity.swiggyUserId,
          phone: identity.phone,
          display_name: identity.name,
        })
        .select('id')
        .single();

      if (error) {
        console.error('Could not create profile:', error);
        return fail('profile_failed');
      }
      profileId = created.id;
    }

    const { error: tokenError } = await supabase.from('swiggy_tokens').upsert({
      user_id: profileId,
      access_token: encryptToken(accessToken),
      refresh_token: '',   // Swiggy v1 issues none; the 5-day token is the session
      expires_at: new Date(Date.now() + (tokens.expires_in || 432000) * 1000).toISOString(),
      swiggy_user_id: identity.swiggyUserId,
      updated_at: new Date().toISOString(),
    });

    if (tokenError) {
      console.error('Could not store Swiggy token:', tokenError);
      return fail('token_store_failed');
    }

    const isLocal = (process.env.SWIGGY_REDIRECT_URI || '').startsWith('http://localhost');
    await setSessionCookie(profileId, { secure: !isLocal });

    store.delete('swiggy_pkce_verifier');
    store.delete('swiggy_oauth_state');

    return NextResponse.redirect(new URL('/', req.url));
  } catch (err) {
    console.error('OAuth callback error:', err);
    return fail('unexpected');
  }
}
