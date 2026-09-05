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
  "items": [{"name": "Item name", "spokenAs": "the word as said", "emoji": "🧅", "quantity": "e.g. 2 kg"}]
}

Rules:
- "spokenAs" is what the speaker actually said for that item, Romanised to plain Latin letters if it was Hindi or Hinglish (e.g. "dahi", "tamatar") — never Devanagari script, never translated. If they said it in English, "spokenAs" and "name" will naturally be close or identical — that's fine, use the words as said either way.
- Every "name" MUST be a specific, searchable product — something you could type into a grocery search bar and get a real result: "Tomatoes", "Onions", "Milk". NEVER a category or umbrella term: "Vegetables", "Groceries", "Snacks", "Dairy", "Essentials", "Spices".
- Write "name" and "quantity" in plain English only, even when the transcript is in Hindi or Hinglish — translate it (e.g. "doodh" → "Milk", "tamatar" → "Tomatoes", "pyaz" → "Onions", "aloo" → "Potatoes", "dahi" → "Curd"). This translation is only for "name" — "spokenAs" stays untranslated.
- Use the term an Indian grocery catalogue actually lists the product under, not just any literal English translation — "dahi" is "Curd", not "Yogurt" (a different, less common catalogue listing there).
- Only include "quantity" if one was actually mentioned — don't invent one.
- Do not invent items that weren't actually said. If the transcript doesn't clearly name any real grocery item, return {"items": []}.

Transcript: "${transcript}"`;

// Used when Sarvam's translate call also succeeded — Claude aligns rather
// than translates, which is a smaller job (and the whole point: push the
// translation reasoning onto Sarvam, not Claude).
const PROMPT_WITH_TRANSLATION = (nativeTranscript, translatedTranscript) => `You are turning a spoken grocery request into a clean order list.

You're given the same spoken request in two forms: the original words as
said (Hindi, Hinglish, a regional Indian language, or English), and an
English translation of that same speech from a speech-to-text model. Both
came straight from speech-to-text and may be casual, rambling, or contain
small recognition errors — that's normal for speech, not a sign either
transcript is unclear.

Match each item across the two versions: the translation tells you what was
meant, the original tells you what to echo back to the user as "spokenAs".

Return ONLY a valid JSON object (no markdown, no explanation, no backticks) in this exact format:
{
  "items": [{"name": "Item name", "spokenAs": "the word as said", "emoji": "🧅", "quantity": "e.g. 2 kg"}]
}

Rules:
- "spokenAs" is the corresponding word or phrase from the ORIGINAL transcript for that item, Romanised to plain Latin letters if it was in Devanagari or another Indian script (e.g. "peela sarson", not "पीला सरसों") — never non-Latin script, never the translation itself. If the original was already in English, spokenAs and name will naturally be close or identical.
- Every "name" MUST be a specific, searchable product — something you could type into a grocery search bar and get a real result: "Tomatoes", "Onions", "Milk". NEVER a category or umbrella term: "Vegetables", "Groceries", "Snacks", "Dairy", "Essentials", "Spices".
- The English translation is a starting point, not gospel — use the term an Indian grocery catalogue actually lists the product under if it differs. E.g. if the translation says "Yogurt", the catalogue term is "Curd".
- Only include "quantity" if one was actually mentioned — don't invent one.
- Do not invent items that weren't actually said. If neither transcript clearly names a real grocery item, return {"items": []}.

Original: "${nativeTranscript}"
English translation: "${translatedTranscript}"`;

export async function POST(req) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const body = await req.json();
  const transcript = typeof body.transcript === 'string' ? body.transcript.trim() : '';
  const translatedTranscript = typeof body.translatedTranscript === 'string' ? body.translatedTranscript.trim() : '';

  if (!transcript) {
    return NextResponse.json({ error: 'No transcript provided' }, { status: 400 });
  }
  if (transcript.length > MAX_TRANSCRIPT_LENGTH || translatedTranscript.length > MAX_TRANSCRIPT_LENGTH) {
    return NextResponse.json({ error: 'That was too long to parse in one go' }, { status: 400 });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'Server missing ANTHROPIC_API_KEY' }, { status: 500 });
  }

  const prompt = translatedTranscript
    ? PROMPT_WITH_TRANSLATION(transcript, translatedTranscript)
    : PROMPT(transcript);

  // This is alignment/extraction (given a transcript, or a transcript +
  // its translation, produce a clean item list), not reasoning-heavy — the
  // catalog-naming judgment it needs (e.g. "dahi" -> "Curd") is well within
  // a small model, tested directly against Hindi and Tamil examples before
  // switching. No adaptive thinking on this model means no risk of thinking
  // alone exhausting max_tokens and coming back empty, which Opus 5 hit
  // here occasionally — cheaper and more reliable for this task, not just
  // cheaper.
  const callOnce = async () => {
    const data = await callClaude({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = data.content?.[0]?.text || '';
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  };

  let parsed;
  try {
    // Even 8192 tokens occasionally comes back empty — confirmed by testing,
    // not a fixed prompt bug, closer to a rare heavy-reasoning outlier than
    // something a bigger ceiling alone rules out. Seen back-to-back once in
    // practice, so one retry isn't quite enough insurance — up to 2 retries
    // on exactly that failure (empty/unparseable text), which only costs
    // anything extra on the rare request that hits this at all.
    let attempt = 0;
    for (;;) {
      try {
        parsed = await callOnce();
        break;
      } catch (err) {
        if (!(err instanceof SyntaxError) || attempt >= 2) throw err;
        attempt += 1;
        console.warn(`voice-parse: empty/unparseable response, retrying (attempt ${attempt + 1})`);
      }
    }
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
