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

  try {
    const buffer = Buffer.from(await audio.arrayBuffer());
    const data = await transcribeAudio(buffer, { mimeType: audio.type || 'audio/webm' });
    const transcript = (data.transcript || '').trim();

    if (!transcript) {
      // Not an error, just nothing usable — let the caller fall back
      // rather than showing a hard failure for a quiet recording.
      return NextResponse.json({ fallback: true }, { status: 200 });
    }
    return NextResponse.json({ transcript });
  } catch (err) {
    console.error('voice-transcribe error:', err);
    // Every failure path here — quota exhausted, still-overloaded after
    // retries, a genuine service error — means the same thing to the
    // frontend: stop trying Sarvam for this attempt, fall back.
    return NextResponse.json(
      { error: err.quotaExhausted ? "Voice credits are used up for now." : "Couldn't transcribe that.", fallback: true },
      { status: 200 }
    );
  }
}
