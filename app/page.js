'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { T, shell, responsiveCSS } from './theme';

// A door shot plus the main compartment covers most kitchens; beyond that the
// extra cost and wait don't buy much accuracy.
const MAX_PHOTOS = 2;

const SECTIONS = {
  order_now: { label: 'Order now', bg: T.redSoft, color: T.red, badge: 'Empty' },
  running_low: { label: 'Running low', bg: T.amberSoft, color: T.amber, badge: 'Low' },
  stocked: { label: 'Well stocked', bg: T.greenSoft, color: T.green, badge: 'Good' },
};

function Section({ items, configKey }) {
  if (!items?.length) return null;
  const c = SECTIONS[configKey];
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 0.8, textTransform: 'uppercase', color: c.color }}>
          {c.label}
        </span>
        <span style={{ fontSize: 11, fontWeight: 600, color: c.color, background: c.bg, padding: '2px 8px', borderRadius: 999 }}>
          {items.length}
        </span>
      </div>
      {items.map((item, i) => (
        <div key={i} style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '12px 14px', marginBottom: 8,
          border: `1px solid ${T.hairline}`, borderRadius: 12, background: '#fff',
        }}>
          <span style={{ fontSize: 22, flexShrink: 0 }}>{item.emoji || '•'}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: T.ink }}>
              {item.name}
              {item.quantity && (
                <span style={{ fontWeight: 400, color: T.muted, fontSize: 12 }}> · {item.quantity}</span>
              )}
            </div>
            {item.reason && (
              <div style={{ fontSize: 12, color: T.muted, marginTop: 2 }}>{item.reason}</div>
            )}
          </div>
          <span style={{
            fontSize: 10, fontWeight: 700, color: c.color, background: c.bg,
            padding: '4px 9px', borderRadius: 999, flexShrink: 0,
          }}>
            {c.badge}
          </span>
        </div>
      ))}
    </div>
  );
}

export default function Home() {
  const [me, setMe] = useState(null);
  const [photos, setPhotos] = useState([]);      // { dataUrl, base64 }
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [isMobile, setIsMobile] = useState(false);
  const fileRef = useRef();
  const router = useRouter();

  // On a phone the file input opens the camera directly, so capture is one tap.
  useEffect(() => {
    setIsMobile(/android|iphone|ipad|ipod/i.test(navigator.userAgent));
  }, []);

  // ---- Speak to order ----
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [voiceState, setVoiceState] = useState('idle');   // idle | listening | parsing | review | error
  const [transcript, setTranscript] = useState('');
  const [voiceItems, setVoiceItems] = useState([]);
  const [voiceError, setVoiceError] = useState(null);
  const recognitionRef = useRef(null);

  useEffect(() => {
    setVoiceSupported(!!(window.SpeechRecognition || window.webkitSpeechRecognition));
    return () => recognitionRef.current?.stop();
  }, []);

  const parseTranscript = async (text) => {
    setVoiceState('parsing');
    try {
      const res = await fetch('/api/voice-parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transcript: text }),
      });
      const data = await res.json();
      if (res.status === 401) { router.push('/welcome'); return; }
      if (!res.ok) throw new Error(data.error || 'Something went wrong');
      if (!data.items?.length) {
        setVoiceError("Didn't catch any items in that — try naming what you need, like \"add milk and onions\".");
        setVoiceState('error');
        return;
      }
      setVoiceItems(data.items);
      setVoiceState('review');
    } catch (err) {
      setVoiceError(err.message);
      setVoiceState('error');
    }
  };

  const startListening = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;

    const recognition = new SR();
    recognition.lang = 'en-IN';
    recognition.continuous = true;
    recognition.interimResults = true;

    let finalTranscript = '';
    let errored = false;

    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const chunk = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalTranscript += chunk + ' ';
        else interim += chunk;
      }
      setTranscript((finalTranscript + interim).trim());
    };

    // Speech recognition errors ('not-allowed', 'no-speech', etc.) fire
    // onerror and are usually followed by onend — the flag stops onend from
    // also trying to parse whatever partial transcript we had.
    recognition.onerror = (event) => {
      errored = true;
      setVoiceState('error');
      setVoiceError(
        event.error === 'not-allowed'
          ? 'Microphone access was blocked — allow it in your browser settings and try again.'
          : "Didn't catch that. Try again."
      );
    };

    recognition.onend = () => {
      if (errored) return;
      const heard = finalTranscript.trim();
      if (heard) {
        parseTranscript(heard);
      } else {
        setVoiceState('error');
        setVoiceError("Didn't catch anything. Try again.");
      }
    };

    recognitionRef.current = recognition;
    setTranscript('');
    setVoiceError(null);
    setVoiceState('listening');
    recognition.start();
  };

  const stopListening = () => recognitionRef.current?.stop();

  const resetVoice = () => {
    recognitionRef.current?.stop();
    setVoiceState('idle');
    setTranscript('');
    setVoiceItems([]);
    setVoiceError(null);
  };

  const confirmVoiceOrder = () => {
    sessionStorage.setItem('inspector_pending_cart', JSON.stringify({ items: voiceItems, scanId: null }));
    router.push('/cart');
  };

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
        setResult(null);
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
    setResult(null);
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
      setResult(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const signOut = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/welcome');
  };

  const orderCount = result
    ? (result.order_now?.length || 0) + (result.running_low?.length || 0)
    : 0;

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
      <div style={shell.card} className="ins-card">

        <header style={shell.header}>
          <div>
            <h1 style={shell.brand}>Inspector</h1>
            <p style={shell.tagline}>Scan your fridge. Order what&apos;s missing.</p>
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

          {voiceState !== 'idle' ? (
            <div style={{ textAlign: 'center', padding: '4px 0' }}>
              {voiceState === 'listening' && (
                <>
                  <div style={{
                    width: 54, height: 54, borderRadius: '50%', background: T.orangeSoft,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    margin: '0 auto 16px', fontSize: 24,
                  }}>
                    <span style={{ animation: 'insPulse 1.2s ease-in-out infinite' }}>🎤</span>
                  </div>
                  <p style={{ fontWeight: 700, fontSize: 16, color: T.ink, margin: '0 0 4px' }}>
                    Listening…
                  </p>
                  <p style={{
                    color: transcript ? T.inkSoft : T.muted, fontSize: 14, lineHeight: 1.5,
                    minHeight: 42, margin: '0 0 20px', padding: '0 8px',
                  }}>
                    {transcript || 'Say what you need — "add milk, onions and two kilos of tomatoes"'}
                  </p>
                  <style>{`@keyframes insPulse { 0%,100% { opacity: 1 } 50% { opacity: 0.35 } }`}</style>
                  <button onClick={stopListening} style={shell.primaryBtn}>Done</button>
                  <button onClick={resetVoice} style={{ ...shell.ghostBtn, width: '100%', marginTop: 8, padding: '11px' }}>
                    Cancel
                  </button>
                </>
              )}

              {voiceState === 'parsing' && (
                <div style={{ padding: '32px 0', color: T.muted, fontSize: 14 }}>
                  Understanding your list…
                </div>
              )}

              {voiceState === 'error' && (
                <>
                  <div style={{ background: T.redSoft, color: T.red, padding: '12px 14px', borderRadius: 10, marginBottom: 16, fontSize: 13, lineHeight: 1.5, textAlign: 'left' }}>
                    {voiceError}
                  </div>
                  <button onClick={startListening} style={shell.primaryBtn}>Try again</button>
                  <button onClick={resetVoice} style={{ ...shell.ghostBtn, width: '100%', marginTop: 8, padding: '11px' }}>
                    Back to scan
                  </button>
                </>
              )}

              {voiceState === 'review' && (
                <div style={{ textAlign: 'left' }}>
                  <p style={{ fontWeight: 700, fontSize: 16, color: T.ink, margin: '0 0 14px', textAlign: 'center' }}>
                    Here's what I heard
                  </p>
                  {voiceItems.map((item, i) => (
                    <div key={i} style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '12px 14px', marginBottom: 8,
                      border: `1px solid ${T.hairline}`, borderRadius: 12, background: '#fff',
                    }}>
                      <span style={{ fontSize: 22, flexShrink: 0 }}>{item.emoji || '•'}</span>
                      <div style={{ fontSize: 14, fontWeight: 600, color: T.ink }}>
                        {item.name}
                        {item.quantity && (
                          <span style={{ fontWeight: 400, color: T.muted, fontSize: 12 }}> · {item.quantity}</span>
                        )}
                      </div>
                    </div>
                  ))}
                  <button onClick={confirmVoiceOrder} style={{ ...shell.successBtn, marginTop: 14 }}>
                    Order {voiceItems.length} {voiceItems.length === 1 ? 'item' : 'items'} on Instamart
                  </button>
                  <button onClick={startListening} style={{ ...shell.ghostBtn, width: '100%', marginTop: 8, padding: '11px' }}>
                    That's not quite right — try again
                  </button>
                  <button onClick={resetVoice} style={{ ...shell.ghostBtn, width: '100%', marginTop: 8, padding: '11px' }}>
                    Back to scan
                  </button>
                </div>
              )}
            </div>
          ) : photos.length === 0 ? (
            <>
              <div
                onClick={openCamera}
                style={{
                  border: `1.5px dashed ${T.hairline}`, borderRadius: 14,
                  padding: '44px 20px', textAlign: 'center', cursor: 'pointer',
                }}
              >
                <div style={{
                  width: 52, height: 52, borderRadius: '50%', background: T.orangeSoft,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  margin: '0 auto 14px', fontSize: 24,
                }}>📷</div>
                <p style={{ fontWeight: 700, fontSize: 16, color: T.ink, margin: '0 0 4px' }}>
                  Scan your fridge
                </p>
                <p style={{ color: T.muted, fontSize: 13, margin: '0 0 18px', lineHeight: 1.5 }}>
                  {isMobile
                    ? 'Take a photo of your fridge or shelves'
                    : 'Photograph your fridge, shelves, or storage'}
                </p>
                <span style={{
                  display: 'inline-block', background: T.orange, color: '#fff',
                  padding: '11px 26px', borderRadius: 10, fontSize: 14, fontWeight: 700,
                }}>
                  {isMobile ? 'Take photo' : 'Choose photo'}
                </span>
              </div>

              {voiceSupported && (
                <>
                  <div style={{ textAlign: 'center', color: T.muted, fontSize: 12, margin: '16px 0' }}>or</div>
                  <button
                    onClick={startListening}
                    style={{
                      width: '100%', background: '#fff', color: T.orange,
                      border: `1.5px solid ${T.orange}`, borderRadius: 10,
                      padding: '13px', fontSize: 14, fontWeight: 700,
                      cursor: 'pointer', fontFamily: 'inherit',
                    }}
                  >
                    🎤 Speak to order
                  </button>
                </>
              )}
            </>
          ) : (
            <>
              <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
                {photos.map((p, i) => (
                  <div key={i} style={{ position: 'relative', flex: 1, minWidth: 0 }}>
                    <img
                      src={p.dataUrl}
                      alt={`Photo ${i + 1} of your kitchen`}
                      style={{
                        width: '100%', aspectRatio: '3 / 4', objectFit: 'cover',
                        borderRadius: 12, border: `1px solid ${T.hairline}`, display: 'block',
                      }}
                    />
                    <button
                      onClick={() => removePhoto(i)}
                      aria-label={`Remove photo ${i + 1}`}
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
                    style={{
                      flex: 1, aspectRatio: '3 / 4', borderRadius: 12,
                      border: `1.5px dashed ${T.hairline}`, background: '#fff',
                      cursor: 'pointer', display: 'flex', flexDirection: 'column',
                      alignItems: 'center', justifyContent: 'center', gap: 6,
                      fontFamily: 'inherit', color: T.orange,
                    }}
                  >
                    <span style={{ fontSize: 22 }}>+</span>
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

              {!result && !loading && (
                <button onClick={analyse} style={shell.primaryBtn}>
                  {photos.length > 1 ? 'Analyse both photos' : 'Analyse my fridge'}
                </button>
              )}

              <button
                onClick={() => { setPhotos([]); setResult(null); setError(null); }}
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
              Scanning your refrigerator…
            </div>
          )}

          {error && (
            <div style={{ background: T.redSoft, color: T.red, padding: '12px 14px', borderRadius: 10, marginTop: 12, fontSize: 13 }}>
              {error}
            </div>
          )}

          {result && (
            <div style={{ marginTop: 22 }}>
              <div style={{
                borderLeft: `3px solid ${T.orange}`, background: T.orangeSoft,
                padding: '12px 14px', borderRadius: '0 10px 10px 0',
                fontSize: 14, color: T.inkSoft, marginBottom: 22, lineHeight: 1.5,
              }}>
                {result.summary}
                {photos.length > 1 && (
                  <span style={{ display: 'block', fontSize: 12, color: T.muted, marginTop: 6 }}>
                    Read across {photos.length} photos
                  </span>
                )}
              </div>

              <Section items={result.order_now} configKey="order_now" />
              <Section items={result.running_low} configKey="running_low" />
              <Section items={result.stocked} configKey="stocked" />

              {orderCount > 0 && (
                <button
                  onClick={() => {
                    const items = [...(result.order_now || []), ...(result.running_low || [])];
                    sessionStorage.setItem('inspector_pending_cart', JSON.stringify({ items, scanId: result.scan_id }));
                    router.push('/cart');
                  }}
                  style={{ ...shell.successBtn, marginTop: 6 }}
                >
                  Order {orderCount} {orderCount === 1 ? 'item' : 'items'} on Instamart
                </button>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
