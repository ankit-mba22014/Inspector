import crypto from 'crypto';

export function generateCodeVerifier() {
  return crypto.randomBytes(32).toString('base64url');
}

export function generateCodeChallenge(verifier) {
  return crypto.createHash('sha256').update(verifier).digest('base64url');
}

export function generateState() {
  return crypto.randomBytes(16).toString('hex');
}
