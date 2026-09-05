import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import { transcribeAudio } from '@/lib/sarvam';

// A voice grocery list runs a few seconds to maybe a minute — 15MB covers
// that many times over even at a generous bitrate.
const MAX_AUDIO_BYTES = 15 * 1024 * 1024;

export async function POST(req) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }
  if (!process.env.SARVAM_API_KEY) {
    return NextResponse.json({ error: 'Server missing SARVAM_API_KEY', fallback: true }, { status: 200 });
  }

  const form = await req.formData();
  const audio = form.get('audio');
  if (!audio || typeof audio === 'string') {
    return NextResponse.json({ error: 'No audio provided' }, { status: 400 });
  }
  if (audio.size > MAX_AUDIO_BYTES) {
    return NextResponse.json({ error: 'That recording was too long' }, { status: 400 });
  }

  const buffer = Buffer.from(await audio.arrayBuffer());
  const mimeType = audio.type || 'audio/webm';

  // codemix keeps the native words (what the user actually said — feeds the
  // "echo, don't translate" transcript and spokenAs). translate gives
  // English directly, which lets voice-parse align instead of translating
  // from scratch — moving that reasoning to Sarvam. Run in parallel: a
  // failure in one shouldn't cost the other's result, and this keeps total
  // latency close to a single call rather than doubling it.
  const [codemixResult, translateResult] = await Promise.allSettled([
    transcribeAudio(buffer, { mimeType, mode: 'codemix' }),
    transcribeAudio(buffer, { mimeType, mode: 'translate' }),
  ]);

  if (codemixResult.status === 'rejected') {
    const err = codemixResult.reason;
    console.error('voice-transcribe error (codemix):', err);
    // Every failure path here — quota exhausted, still-overloaded after
    // retries, a genuine service error — means the same thing to the
    // frontend: stop trying Sarvam for this attempt, fall back.
    return NextResponse.json(
      { error: err.quotaExhausted ? "Voice credits are used up for now." : "Couldn't transcribe that.", fallback: true },
      { status: 200 }
    );
  }

  const transcript = (codemixResult.value.transcript || '').trim();
  if (!transcript) {
    // Not an error, just nothing usable — let the caller fall back
    // rather than showing a hard failure for a quiet recording.
    return NextResponse.json({ fallback: true }, { status: 200 });
  }

  // translate failing is not fatal — voice-parse falls back to translating
  // the codemix transcript itself, exactly like before this change existed.
  let translatedTranscript = null;
  if (translateResult.status === 'fulfilled') {
    translatedTranscript = (translateResult.value.transcript || '').trim() || null;
  } else {
    console.warn('voice-transcribe: translate mode failed, falling back to codemix-only:', translateResult.reason?.message);
  }

  return NextResponse.json({ transcript, translatedTranscript });
}
