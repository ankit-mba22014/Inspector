import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { generateCodeVerifier, generateCodeChallenge, generateState } from '@/lib/swiggy/pkce';
import { getOrRegisterClientId } from '@/lib/swiggy/dcr';

const BASE = process.env.SWIGGY_BASE_URL || 'https://mcp.swiggy.com';
const AUTHORIZE_URL = `${BASE}/auth/authorize`;

/**
 * Starts the Swiggy OAuth flow. This is the app's only sign-in.
 *
 * A plain GET so it can be a link — there's no prior session to authenticate,
 * which is the whole point.
 */
export async function GET(req) {
  const redirectUri = process.env.SWIGGY_REDIRECT_URI;
  if (!redirectUri) {
    return NextResponse.redirect(new URL('/welcome?error=not_configured', req.url));
  }

  let clientId;
  try {
    ({ clientId } = await getOrRegisterClientId());
  } catch (err) {
    console.error('Dynamic client registration failed:', err);
    return NextResponse.redirect(new URL('/welcome?error=registration_failed', req.url));
  }

  const verifier = generateCodeVerifier();
  const challenge = generateCodeChallenge(verifier);
  const state = generateState();

  const store = await cookies();
  const isLocal = redirectUri.startsWith('http://localhost');
  const opts = {
    httpOnly: true,
    secure: !isLocal,  // browsers drop `secure` cookies on plain http://localhost
    sameSite: 'lax',
    maxAge: 600,
    path: '/',
  };
  store.set('swiggy_pkce_verifier', verifier, opts);
  store.set('swiggy_oauth_state', state, opts);

  const url = new URL(AUTHORIZE_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('state', state);
  url.searchParams.set('scope', 'mcp:tools mcp:resources');

  return NextResponse.redirect(url.toString());
}
