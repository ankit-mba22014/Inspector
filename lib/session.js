import crypto from 'crypto';
import { cookies } from 'next/headers';

const COOKIE = 'inspector_session';
const MAX_AGE_SEC = 60 * 60 * 24 * 30; // 30 days

function secret() {
  const s = process.env.SESSION_SECRET || process.env.TOKEN_ENCRYPTION_KEY;
  if (!s) {
    throw new Error('SESSION_SECRET not set — generate with: openssl rand -base64 32');
  }
  return s;
}

function sign(payloadB64) {
  return crypto.createHmac('sha256', secret()).update(payloadB64).digest('base64url');
}

/**
 * Our own session token: base64url(payload).hmac
 *
 * Deliberately minimal — it carries a profile id and an expiry, nothing more.
 * The Swiggy access token never leaves the server; it lives encrypted in the
 * database and is fetched per request.
 */
export function createSessionToken(profileId) {
  const payload = { uid: profileId, exp: Date.now() + MAX_AGE_SEC * 1000 };
  const b64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${b64}.${sign(b64)}`;
}

export function verifySessionToken(token) {
  if (!token || !token.includes('.')) return null;
  const [b64, mac] = token.split('.');

  // Constant-time compare so a wrong signature can't be probed by timing
  const expected = sign(b64);
  if (
    mac.length !== expected.length ||
    !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(b64, 'base64url').toString());
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function setSessionCookie(profileId, { secure }) {
  const store = await cookies();
  store.set(COOKIE, createSessionToken(profileId), {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    maxAge: MAX_AGE_SEC,
    path: '/',
  });
}

export async function clearSessionCookie() {
  const store = await cookies();
  store.delete(COOKIE);
}

export async function readSession() {
  const store = await cookies();
  return verifySessionToken(store.get(COOKIE)?.value);
}

export const SESSION_COOKIE = COOKIE;
