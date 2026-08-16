/**
 * Works out who the Swiggy user is from their access token.
 *
 * Swiggy issues a signed JWT. We only read its claims to get a stable
 * identifier — we never trust it for authorisation, since every privileged
 * action goes back to Swiggy's API with the token anyway.
 */

/** Decodes a JWT payload without verifying the signature. */
export function decodeJwtPayload(token) {
  try {
    const part = String(token).split('.')[1];
    if (!part) return null;
    return JSON.parse(Buffer.from(part, 'base64url').toString());
  } catch {
    return null;
  }
}

const ID_CLAIMS = ['sub', 'userId', 'user_id', 'uid', 'customerId', 'swiggyUserId'];
const PHONE_CLAIMS = ['phone', 'mobile', 'phoneNumber', 'mobileNumber', 'msisdn'];
const NAME_CLAIMS = ['name', 'displayName', 'firstName', 'given_name'];

const firstOf = (obj, keys) => {
  for (const k of keys) {
    if (obj?.[k] != null && String(obj[k]).length > 0) return String(obj[k]);
  }
  return null;
};

/**
 * Returns { swiggyUserId, phone, name, claims }.
 *
 * swiggyUserId is null when the token carries no recognisable subject — the
 * caller then falls back to a fresh profile rather than silently merging
 * two different people onto one record.
 */
export function identityFromToken(accessToken) {
  const claims = decodeJwtPayload(accessToken) || {};
  return {
    swiggyUserId: firstOf(claims, ID_CLAIMS),
    phone: firstOf(claims, PHONE_CLAIMS),
    name: firstOf(claims, NAME_CLAIMS),
    claims,
  };
}
