'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { T, shell, responsiveCSS } from './theme';
import { useVoiceCapture } from '@/lib/useVoiceCapture';

// A door shot plus the main compartment covers most kitchens; beyond that the
// extra cost and wait don't buy much accuracy.
const MAX_PHOTOS = 2;

// Home-screen-only accents — kept local rather than in theme.js so the
// restyle doesn't ripple into cart/orders/welcome, which share that file.
const GRADIENT_SCAN = 'linear-gradient(135deg, #FC8019 0%, #FF5C7A 100%)';
const GRADIENT_VOICE = 'linear-gradient(135deg, #7C5CFC 0%, #FC8019 100%)';

const HOME_KEYFRAMES = `
  @keyframes ins-float { 0%, 100% { transform: translateY(0) } 50% { transform: translateY(-6px) } }
  @keyframes ins-pop-in { from { opacity: 0; transform: scale(0.92) } to { opacity: 1; transform: scale(1) } }
  @keyframes ins-bounce-dot { 0%, 80%, 100% { transform: scale(0.6); opacity: 0.5 } 40% { transform: scale(1); opacity: 1 } }
  @keyframes ins-wave { 0%, 100% { transform: scaleY(0.35) } 50% { transform: scaleY(1) } }

  .ins-home-tile { transition: transform 0.15s ease; }
  .ins-home-tile:active { transform: scale(0.96); }
  .ins-home-btn { transition: transform 0.15s ease; }
  .ins-home-btn:active { transform: scale(0.95); }
  .ins-home-icon-float { animation: ins-float 2.6s ease-in-out infinite; }
  .ins-home-photo { animation: ins-pop-in 0.22s ease; }
  .ins-home-dots { display: inline-flex; gap: 5px; align-items: center; }
  .ins-home-dot {
    width: 7px; height: 7px; border-radius: 50%; background: ${'#FC8019'};
    animation: ins-bounce-dot 1.1s ease-in-out infinite;
  }
  .ins-home-dot:nth-child(2) { animation-delay: 0.15s; background: #E8640C; }
  .ins-home-dot:nth-child(3) { animation-delay: 0.3s; background: #7C5CFC; }
  .ins-home-wave { display: inline-flex; gap: 3px; align-items: center; height: 20px; }
  .ins-home-bar {
    width: 4px; border-radius: 2px; background: #fff;
    animation: ins-wave 0.9s ease-in-out infinite;
  }
`;

export default function Home() {
  const [me, setMe] = useState(null);
  const [photos, setPhotos] = useState([]);      // { dataUrl, base64 }
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [isMobile, setIsMobile] = useState(false);
  const fileRef = useRef();
  const router = useRouter();

  // On a phone the file input opens the camera directly, so capture is one tap.
  useEffect(() => {
    setIsMobile(/android|iphone|ipad|ipod/i.test(navigator.userAgent));
  }, []);

  const goToCart = (items, scanId, sourceTranscript) => {
    sessionStorage.setItem('inspector_pending_cart', JSON.stringify({
      items, scanId: scanId ?? null, transcript: sourceTranscript ?? null,
    }));
    router.push('/cart');
  };

  // ---- Speak to order ----
  // Capture -> cart -> confirmation is the whole flow. Every stage in
  // between (recording, transcribing, matching) is machine state, not a
  // decision — there's no review screen here. Once we have a parsed item
  // list, we hand off to the cart page immediately and it does the rest.
  const [parsing, setParsing] = useState(false);

  const parseTranscript = async (text, translatedText) => {
    setParsing(true);
    try {
      const res = await fetch('/api/voice-parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript: text, translatedTranscript: translatedText || undefined }),
      });
      const data = await res.json();
      if (res.status === 401) { router.push('/welcome'); return; }
      if (!res.ok) throw new Error(data.error || 'Something went wrong');

      if (!data.items?.length) {
        voice.reportError("Didn't catch that — say it again?");
        setParsing(false);
        return;
      }

      goToCart(
        data.items.map((i) => ({ ...i, inferred: false })),
        null,
        text
      );
    } catch (err) {
      voice.reportError(err.message);
      setParsing(false);
    }
  };

  const voice = useVoiceCapture({ router, onTranscript: parseTranscript });
  const {
    voiceSupported, voiceState, transcript, listeningNotice, voiceError,
    startRecording, stopRecording, stopListening, resetVoice,
  } = voice;

  const handleReset = () => {
    resetVoice();
    setParsing(false);
  };

  // The cart's transcript line links back here to auto-start a re-record.
  // A sessionStorage flag, not a ?rerecord=1 URL param — the URL+
  // history.replaceState version left a stale history entry that the
  // browser's own back button could restore, re-triggering recording
  // instead of just leaving the page. Removing the flag the instant it's
  // read means no navigation can ever replay it.
  useEffect(() => {
    if (sessionStorage.getItem('inspector_auto_rerecord') === '1') {
      sessionStorage.removeItem('inspector_auto_rerecord');
      startRecording();
    }
  }, []);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((data) => {
        if (!data.signedIn) {
          router.push('/welcome');
          return;
        }
        setMe(data);
      })
      .catch(() => router.push('/welcome'));
  }, []);

  const handleFile = useCallback((file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new window.Image();
      img.onload = () => {
        // Normalise everything (including iPhone HEIC) to JPEG via canvas
        const canvas = document.createElement('canvas');
        const MAX = 1568;
        let { width, height } = img;
        if (width > MAX || height > MAX) {
          const s = MAX / Math.max(width, height);
          width = Math.round(width * s);
          height = Math.round(height * s);
        }
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        const jpeg = canvas.toDataURL('image/jpeg', 0.85);

        setPhotos((prev) =>
          prev.length >= MAX_PHOTOS
            ? prev
            : [...prev, { dataUrl: jpeg, base64: jpeg.split(',')[1] }]
        );
        setError(null);
      };
      img.onerror = () => setError("That image couldn't be read. Try another photo.");
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }, []);

  const openCamera = () => {
    if (photos.length >= MAX_PHOTOS) return;
    fileRef.current.value = '';   // lets the same file be picked twice
    fileRef.current.click();
  };

  const removePhoto = (i) => {
    setPhotos((prev) => prev.filter((_, idx) => idx !== i));
  };

  const analyse = async () => {
    if (photos.length === 0) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/analyse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          images: photos.map((p) => ({ data: p.base64, mediaType: 'image/jpeg' })),
        }),
      });
      const data = await res.json();
      if (res.status === 401) { router.push('/welcome'); return; }
      if (!res.ok) throw new Error(data.error || 'Something went wrong');

      const items = [...(data.order_now || []), ...(data.running_low || [])]
        .map((i) => ({ ...i, inferred: true }));

      if (items.length === 0) {
        setError("Didn't spot anything that needs restocking in that photo.");
        setLoading(false);
        return;
      }

      goToCart(items, data.scan_id, null);
    } catch (err) {
      setError(err.message);
      setLoading(false);
    }
  };

  const signOut = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/welcome');
  };

  if (!me) {
    return (
      <div style={shell.page} className="ins-page">
        <style>{responsiveCSS}</style>
        <div style={shell.card} className="ins-card">
          <div style={{ ...shell.body, textAlign: 'center', color: T.muted, paddingTop: 60 }}>Loading…</div>
        </div>
      </div>
    );
  }

  return (
    <div style={shell.page} className="ins-page">
      <style>{responsiveCSS}</style>
      <style>{HOME_KEYFRAMES}</style>
      <div style={shell.card} className="ins-card">

        <header style={shell.header}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{
              width: 34, height: 34, borderRadius: 10, background: GRADIENT_SCAN,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 16, flexShrink: 0,
            }}>📷</div>
            <div>
              <h1 style={{ ...shell.brand, fontWeight: 800, letterSpacing: '-0.5px' }}>Inspector</h1>
              <p style={shell.tagline}>Scan your fridge. Order what&apos;s missing.</p>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button onClick={() => router.push('/orders')} style={shell.ghostBtn}>Orders</button>
            <button onClick={signOut} style={shell.ghostBtn}>Sign out</button>
          </div>
        </header>

        <main style={shell.body}>
          {!me.swiggyConnected && (
            <div style={{ background: T.amberSoft, borderRadius: 12, padding: 16, marginBottom: 18 }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: T.ink, margin: '0 0 4px' }}>
                Your Swiggy session has ended
              </p>
              <p style={{ fontSize: 13, color: T.inkSoft, margin: '0 0 14px', lineHeight: 1.5 }}>
                Sessions last five days, and signing in elsewhere can end them early.
              </p>
              <a href="/api/auth/swiggy/login" style={{
                display: 'block', textAlign: 'center', background: T.orange, color: '#fff',
                padding: '11px', borderRadius: 10, fontSize: 14, fontWeight: 700, textDecoration: 'none',
              }}>
                Sign in again
              </a>
            </div>
          )}

          {(voiceState !== 'idle' || parsing) ? (
            <div style={{ textAlign: 'center', padding: '4px 0' }}>
              {voiceState === 'recording' && (
                <>
                  <div style={{
                    width: 64, height: 64, borderRadius: '50%', background: GRADIENT_VOICE,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    margin: '0 auto 16px', boxShadow: '0 8px 20px rgba(124,92,252,0.35)',
                  }}>
                    <span className="ins-home-wave">
                      {[0, 1, 2, 3].map((i) => (
                        <span key={i} className="ins-home-bar" style={{ height: 10 + (i % 2) * 8, animationDelay: `${i * 0.12}s` }} />
                      ))}
                    </span>
                  </div>
                  <p style={{ fontWeight: 700, fontSize: 16, color: T.ink, margin: '0 0 4px' }}>
                    Listening…
                  </p>
                  <p style={{ color: T.muted, fontSize: 14, lineHeight: 1.5, margin: '0 0 20px', padding: '0 8px' }}>
                    Say what you need — "add milk, onions and two kilos of tomatoes"
                  </p>
                  <button onClick={stopRecording} className="ins-home-btn" style={{ ...shell.primaryBtn, background: GRADIENT_VOICE }}>Done</button>
                  <button onClick={handleReset} className="ins-home-btn" style={{ ...shell.ghostBtn, width: '100%', marginTop: 8, padding: '11px' }}>
                    Cancel
                  </button>
                </>
              )}

              {voiceState === 'transcribing' && (
                <div style={{ padding: '48px 0' }}>
                  <span className="ins-home-dots">
                    <span className="ins-home-dot" />
                    <span className="ins-home-dot" />
                    <span className="ins-home-dot" />
                  </span>
                </div>
              )}

              {voiceState === 'listening' && (
                <>
                  <div style={{
                    width: 64, height: 64, borderRadius: '50%', background: GRADIENT_VOICE,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    margin: '0 auto 16px', boxShadow: '0 8px 20px rgba(124,92,252,0.35)',
                  }}>
                    <span className="ins-home-wave">
                      {[0, 1, 2, 3].map((i) => (
                        <span key={i} className="ins-home-bar" style={{ height: 10 + (i % 2) * 8, animationDelay: `${i * 0.12}s` }} />
                      ))}
                    </span>
                  </div>
                  <p style={{ fontWeight: 700, fontSize: 16, color: T.ink, margin: '0 0 4px' }}>
                    Listening…
                  </p>
                  {listeningNotice && (
                    <p style={{ color: T.orangeDeep, fontSize: 12, fontWeight: 600, margin: '0 0 8px' }}>
                      {listeningNotice}
                    </p>
                  )}
                  <p style={{
                    color: transcript ? T.inkSoft : T.muted, fontSize: 14, lineHeight: 1.5,
                    minHeight: 42, margin: '0 0 20px', padding: '0 8px',
                  }}>
                    {transcript || 'Say what you need — "add milk, onions and two kilos of tomatoes"'}
                  </p>
                  <button onClick={stopListening} className="ins-home-btn" style={{ ...shell.primaryBtn, background: GRADIENT_VOICE }}>Done</button>
                  <button onClick={handleReset} className="ins-home-btn" style={{ ...shell.ghostBtn, width: '100%', marginTop: 8, padding: '11px' }}>
                    Cancel
                  </button>
                </>
              )}

              {parsing && (
                <div style={{ padding: '20px 8px' }}>
                  <p style={{ color: T.inkSoft, fontSize: 15, lineHeight: 1.6, fontStyle: 'italic', margin: '0 0 16px' }}>
                    "{transcript}"
                  </p>
                  <span className="ins-home-dots">
                    <span className="ins-home-dot" />
                    <span className="ins-home-dot" />
                    <span className="ins-home-dot" />
                  </span>
                </div>
              )}

              {voiceState === 'error' && (
                <>
                  <div style={{ background: T.redSoft, color: T.red, padding: '12px 14px', borderRadius: 10, marginBottom: 16, fontSize: 13, lineHeight: 1.5, textAlign: 'left' }}>
                    {voiceError}
                  </div>
                  <button onClick={startRecording} className="ins-home-btn" style={shell.primaryBtn}>Try again</button>
                  <button onClick={handleReset} className="ins-home-btn" style={{ ...shell.ghostBtn, width: '100%', marginTop: 8, padding: '11px' }}>
                    Back to scan
                  </button>
                </>
              )}
            </div>
          ) : photos.length === 0 ? (
            <div style={{
              display: 'grid',
              gridTemplateColumns: voiceSupported ? '1fr 1fr' : '1fr',
              gap: 12,
            }}>
              <div
                onClick={openCamera}
                className="ins-home-tile"
                style={{
                  background: GRADIENT_SCAN, borderRadius: 20, padding: '28px 14px',
                  textAlign: 'center', cursor: 'pointer', color: '#fff',
                  boxShadow: '0 10px 24px rgba(252,128,25,0.28)',
                  display: 'flex', flexDirection: 'column', justifyContent: 'center',
                  minHeight: 190,
                }}
              >
                <div className="ins-home-icon-float" style={{
                  width: 50, height: 50, borderRadius: '50%', background: 'rgba(255,255,255,0.22)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  margin: '0 auto 14px', fontSize: 22,
                }}>📷</div>
                <p style={{ fontWeight: 800, fontSize: 15, margin: '0 0 4px' }}>
                  Scan your fridge
                </p>
                <p style={{ color: 'rgba(255,255,255,0.88)', fontSize: 12, margin: '0 0 16px', lineHeight: 1.4 }}>
                  {isMobile
                    ? 'Take a photo of your fridge or shelves'
                    : 'Photograph your fridge, shelves, or storage'}
                </p>
                <span className="ins-home-btn" style={{
                  display: 'inline-block', background: 'rgba(255,255,255,0.95)', color: T.orangeDeep,
                  padding: '10px 18px', borderRadius: 10, fontSize: 13, fontWeight: 700,
                }}>
                  {isMobile ? 'Take photo' : 'Choose photo'}
                </span>
              </div>

              {voiceSupported && (
                <button
                  onClick={startRecording}
                  className="ins-home-tile ins-home-btn"
                  style={{
                    background: GRADIENT_VOICE, borderRadius: 20, padding: '28px 14px',
                    textAlign: 'center', cursor: 'pointer', color: '#fff', border: 'none',
                    fontFamily: 'inherit', boxShadow: '0 10px 24px rgba(124,92,252,0.28)',
                    display: 'flex', flexDirection: 'column', justifyContent: 'center',
                    minHeight: 190,
                  }}
                >
                  <div style={{
                    width: 50, height: 50, borderRadius: '50%', background: 'rgba(255,255,255,0.22)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    margin: '0 auto 14px', fontSize: 22,
                  }}>🎤</div>
                  <p style={{ fontWeight: 800, fontSize: 15, margin: 0 }}>Speak to order</p>
                </button>
              )}
            </div>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
                {photos.map((p, i) => (
                  <div key={i} className="ins-home-photo" style={{ position: 'relative', flex: 1, minWidth: 0 }}>
                    <img
                      src={p.dataUrl}
                      alt={`Photo ${i + 1} of your kitchen`}
                      style={{
                        width: '100%', aspectRatio: '3 / 4', objectFit: 'cover',
                        borderRadius: 16, border: `1px solid ${T.hairline}`, display: 'block',
                        boxShadow: '0 6px 16px rgba(0,0,0,0.10)',
                      }}
                    />
                    <button
                      onClick={() => removePhoto(i)}
                      aria-label={`Remove photo ${i + 1}`}
                      className="ins-home-btn"
                      style={{
                        position: 'absolute', top: 6, right: 6,
                        width: 26, height: 26, borderRadius: '50%',
                        background: 'rgba(0,0,0,0.55)', color: '#fff',
                        border: 'none', cursor: 'pointer', fontSize: 15, lineHeight: 1,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontFamily: 'inherit',
                      }}
                    >
                      ×
                    </button>
                    <span style={{
                      position: 'absolute', bottom: 6, left: 6,
                      background: 'rgba(0,0,0,0.55)', color: '#fff',
                      borderRadius: 6, padding: '2px 7px', fontSize: 11, fontWeight: 600,
                    }}>
                      {i + 1}
                    </span>
                  </div>
                ))}

                {/* Second slot invites another angle rather than sitting empty */}
                {photos.length < MAX_PHOTOS && (
                  <button
                    onClick={openCamera}
                    className="ins-home-tile"
                    style={{
                      flex: 1, aspectRatio: '3 / 4', borderRadius: 16,
                      border: `1.5px dashed ${T.orange}`, background: T.orangeSoft,
                      cursor: 'pointer', display: 'flex', flexDirection: 'column',
                      alignItems: 'center', justifyContent: 'center', gap: 6,
                      fontFamily: 'inherit', color: T.orangeDeep,
                    }}
                  >
                    <span className="ins-home-icon-float" style={{ fontSize: 22 }}>+</span>
                    <span style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.3, padding: '0 8px' }}>
                      Add another angle
                    </span>
                  </button>
                )}
              </div>

              <p style={{ fontSize: 12, color: T.muted, textAlign: 'center', marginBottom: 14, lineHeight: 1.5 }}>
                {photos.length < MAX_PHOTOS
                  ? 'Add the other compartment so nothing gets missed — optional.'
                  : `Both photos will be read together (${MAX_PHOTOS} of ${MAX_PHOTOS}).`}
              </p>

              {!loading && (
                <button onClick={analyse} className="ins-home-btn" style={{ ...shell.primaryBtn, background: GRADIENT_SCAN, boxShadow: '0 10px 24px rgba(252,128,25,0.3)' }}>
                  {photos.length > 1 ? 'Analyse both photos' : 'Analyse my fridge'}
                </button>
              )}

              <button
                onClick={() => { setPhotos([]); setError(null); }}
                className="ins-home-btn"
                style={{ ...shell.ghostBtn, width: '100%', marginTop: 8, padding: '11px' }}
              >
                Start over
              </button>
            </>
          )}

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            style={{ display: 'none' }}
            onChange={(e) => handleFile(e.target.files[0])}
          />

          {loading && (
            <div style={{ textAlign: 'center', padding: '32px 0', color: T.muted, fontSize: 14 }}>
              <div className="ins-home-dots" style={{ justifyContent: 'center', marginBottom: 14, width: '100%' }}>
                <span className="ins-home-dot" />
                <span className="ins-home-dot" />
                <span className="ins-home-dot" />
              </div>
              Looking at your shelves…
            </div>
          )}

          {error && (
            <div style={{ background: T.redSoft, color: T.red, padding: '12px 14px', borderRadius: 10, marginTop: 12, fontSize: 13 }}>
              {error}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
