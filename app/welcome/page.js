'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { T, shell, responsiveCSS } from '../theme';

const ERRORS = {
  expired: 'That sign-in took too long and expired. Please try again.',
  token_exchange_failed: "Swiggy couldn't complete the sign-in. Please try again.",
  registration_failed: "Couldn't reach Swiggy just now. Please try again in a moment.",
  profile_failed: 'Something went wrong setting up your account. Please try again.',
  token_store_failed: 'Something went wrong saving your session. Please try again.',
  not_configured: 'This app is not fully configured yet.',
  access_denied: 'Sign-in was cancelled.',
};

function WelcomeInner() {
  const error = useSearchParams().get('error');

  return (
    <div style={{ ...shell.page, alignItems: 'center' }} className="ins-page">
      <style>{responsiveCSS}</style>
      <div style={{ ...shell.card, minHeight: 'auto' }} className="ins-card">
        <div style={{ padding: '48px 30px', textAlign: 'center' }}>
          <div style={{
            width: 58, height: 58, borderRadius: '50%', background: T.orangeSoft,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 18px', fontSize: 26,
          }}>🔍</div>

          <h1 style={{ fontSize: 24, fontWeight: 700, color: T.ink, margin: '0 0 6px', letterSpacing: '-0.3px' }}>
            Inspector
          </h1>
          <p style={{ fontSize: 14, color: T.muted, margin: '0 0 28px', lineHeight: 1.5 }}>
            Photograph your fridge.<br />Order what&apos;s missing on Instamart.
          </p>

          {error && (
            <div style={{
              background: T.redSoft, color: T.red, padding: '12px 14px',
              borderRadius: 10, marginBottom: 18, fontSize: 13, lineHeight: 1.5, textAlign: 'left',
            }}>
              {ERRORS[error] || 'Something went wrong signing in. Please try again.'}
            </div>
          )}

          <a
            href="/api/auth/swiggy/login"
            style={{
              display: 'block', background: T.orange, color: '#fff',
              padding: '15px', borderRadius: 10, fontSize: 15, fontWeight: 700,
              textDecoration: 'none',
            }}
          >
            Continue with Swiggy
          </a>

          <p style={{ color: T.muted, fontSize: 12, marginTop: 18, lineHeight: 1.55 }}>
            You&apos;ll sign in with your phone number and an OTP.
            Inspector reads your cart and addresses, and only places orders you confirm.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function WelcomePage() {
  return (
    <Suspense fallback={null}>
      <WelcomeInner />
    </Suspense>
  );
}
