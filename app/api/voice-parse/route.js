import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import { dropGenericItems } from '@/lib/genericItemFilter';
import { callClaude } from '@/lib/anthropic';

const MAX_TRANSCRIPT_LENGTH = 2000;

const PROMPT = (transcript) => `You are turning a spoken grocery request into a clean order list.

The transcript below came straight from speech-to-text. It may be in Hindi,
Hinglish (Hindi-English mix), or English, and may be casual, rambling, or
contain small recognition errors — that's normal for speech, not a sign the
request is unclear.

Extract every specific grocery or kitchen item the speaker asked for.

Return ONLY a valid JSON object (no markdown, no explanation, no backticks) in this exact format:
{
  "items": [{"name": "Item name", "emoji": "🧅", "quantity": "e.g. 2 kg"}]
}

Rules:
- Every "name" MUST be a specific, searchable product — something you could type into a grocery search bar and get a real result: "Tomatoes", "Onions", "Milk". NEVER a category or umbrella term: "Vegetables", "Groceries", "Snacks", "Dairy", "Essentials", "Spices".
- Write every "name" and "quantity" in plain English only, even when the transcript is in Hindi or Hinglish — translate it (e.g. "doodh" → "Milk", "tamatar" → "Tomatoes", "pyaz" → "Onions", "aloo" → "Potatoes", "dahi" → "Curd").
- Use the term an Indian grocery catalogue actually lists the product under, not just any literal English translation — "dahi" is "Curd", not "Yogurt" (a different, less common catalogue listing there).
- Only include "quantity" if one was actually mentioned — don't invent one.
- Do not invent items that weren't actually said. If the transcript doesn't clearly name any real grocery item, return {"items": []}.

Transcript: "${transcript}"`;

export async function POST(req) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const body = await req.json();
  const transcript = typeof body.transcript === 'string' ? body.transcript.trim() : '';

  if (!transcript) {
    return NextResponse.json({ error: 'No transcript provided' }, { status: 400 });
  }
  if (transcript.length > MAX_TRANSCRIPT_LENGTH) {
    return NextResponse.json({ error: 'That was too long to parse in one go' }, { status: 400 });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'Server missing ANTHROPIC_API_KEY' }, { status: 500 });
  }

  let parsed;
  try {
    const data = await callClaude({
      model: 'claude-opus-5',
      max_tokens: 1024,
      // Short extraction task on a voice interaction the user is waiting
      // on live — low effort keeps it snappy without hurting accuracy here.
      output_config: { effort: 'low' },
      messages: [{ role: 'user', content: PROMPT(transcript) }],
    });
    const text = data.content?.[0]?.text || '';
    parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch (err) {
    console.error('voice-parse error:', err);
    const busy = err.status === 429 || err.status === 529;
    const status = err.status && err.status >= 400 && err.status < 500 ? err.status : 500;
    const message = busy
      ? "Claude's a bit busy right now — try again in a moment."
      : "Couldn't understand that. Try speaking again.";
    return NextResponse.json({ error: message }, { status });
  }

  const items = dropGenericItems(parsed.items, 'voice-parse');
  return NextResponse.json({ items });
}
