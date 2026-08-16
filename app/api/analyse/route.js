import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/auth';
import { createAdminSupabase } from '@/lib/supabase/server';

// Two angles is enough to cover a door plus the main compartment; more only
// adds cost and latency for diminishing returns.
const MAX_IMAGES = 2;

const promptFor = (imageCount) => `You are an expert at analysing Indian household refrigerators and kitchen storage.

${imageCount > 1
  ? `You are given ${imageCount} photos of the SAME kitchen — different angles or compartments (for example the door shelves and the main compartment).

Treat them as one kitchen, not as separate scans. An item visible in ANY photo is present. Never list something as empty or missing just because one photo doesn't show it. If the same item appears in more than one photo, count it once.`
  : 'Analyse this fridge/kitchen photo carefully.'}

Identify all visible food items and assess their stock levels honestly.

Return ONLY a valid JSON object (no markdown, no explanation, no backticks) in this exact format:
{
  "summary": "One warm, conversational line in clear English about the kitchen's state.",
  "order_now": [{"name": "Item name", "emoji": "🧅", "reason": "why urgent, in English", "quantity": "e.g. 1 kg"}],
  "running_low": [{"name": "Item name", "emoji": "🍅", "reason": "what you observe, in English", "quantity": "suggested quantity"}],
  "stocked": [{"name": "Item name", "emoji": "✓", "reason": "looks sufficient, in English"}]
}

Write every field in plain, clear English only — no Hindi or Hinglish words.
Use simple, searchable product names (e.g. "Onions", "Curd", "Butter") since these get matched against a grocery catalogue.
Focus on Indian kitchen staples: vegetables, dairy, atta, dal, rice, spices, oils, condiments, beverages.
Recognise steel dabbas, loose grains, and Indian brands (Amul, Everest, Tata) — but describe everything in English.`;

export async function POST(req) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const supabase = createAdminSupabase();

  const body = await req.json();

  // Accepts either a single image or an array of up to MAX_IMAGES, so both
  // photos are reasoned about together rather than merged after the fact.
  const images = Array.isArray(body.images)
    ? body.images
    : body.imageBase64
      ? [{ data: body.imageBase64, mediaType: body.mediaType }]
      : [];

  if (images.length === 0) {
    return NextResponse.json({ error: 'No image provided' }, { status: 400 });
  }
  if (images.length > MAX_IMAGES) {
    return NextResponse.json(
      { error: `Up to ${MAX_IMAGES} photos per scan` },
      { status: 400 }
    );
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: 'Server missing ANTHROPIC_API_KEY' }, { status: 500 });
  }

  let parsed;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: [
            // Label each photo so the model can refer to them distinctly
            ...images.flatMap((img, i) => [
              ...(images.length > 1
                ? [{ type: 'text', text: `Photo ${i + 1} of ${images.length}:` }]
                : []),
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: img.mediaType || 'image/jpeg',
                  data: img.data,
                },
              },
            ]),
            { type: 'text', text: promptFor(images.length) },
          ],
        }],
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      return NextResponse.json({ error: err.error?.message || 'Vision API error' }, { status: res.status });
    }

    const data = await res.json();
    const text = data.content?.[0]?.text || '';
    parsed = JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch (err) {
    console.error('Analyse error:', err);
    return NextResponse.json({ error: 'Could not analyse that image. Try another photo.' }, { status: 500 });
  }

  const { data: scan, error: dbError } = await supabase
    .from('scans')
    .insert({
      user_id: user.id,
      detected_items: parsed,
      summary: parsed.summary,
      image_count: images.length,
    })
    .select()
    .single();

  if (dbError) {
    console.error('DB insert error (scans):', dbError);
    return NextResponse.json({ ...parsed, scan_id: null, warning: dbError.message });
  }

  return NextResponse.json({ ...parsed, scan_id: scan.id });
}
