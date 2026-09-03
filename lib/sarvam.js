const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Speech-to-text via Sarvam's Saaras model — used as the primary transcriber
 * for voice ordering, ahead of the browser's own SpeechRecognition fallback.
 *
 * Retries transient failures (server errors, rate limiting) with backoff,
 * same shape as callClaude in lib/anthropic.js. Never retries
 * insufficient_quota_error — more attempts won't produce credits — and
 * throws with `.quotaExhausted = true` so the caller can fall back
 * immediately instead of burning a retry cycle first.
 */
export async function transcribeAudio(buffer, { mimeType = 'audio/webm', maxAttempts = 3 } = {}) {
  let attempt = 0;

  while (true) {
    const form = new FormData();
    form.append('file', new Blob([buffer], { type: mimeType }), 'voice-order.webm');
    form.append('model', 'saaras:v3');
    // codemix is Sarvam's mode for code-switched speech — exactly the
    // Hindi-English mix a grocery request tends to be.
    form.append('mode', 'codemix');
    form.append('language_code', 'hi-IN');

    const res = await fetch('https://api.sarvam.ai/speech-to-text', {
      method: 'POST',
      headers: { 'api-subscription-key': process.env.SARVAM_API_KEY },
      body: form,
    });

    if (res.ok) return res.json();

    const body = await res.json().catch(() => ({}));
    const code = body.error?.code;

    if (code === 'insufficient_quota_error') {
      const err = new Error(body.error?.message || 'Sarvam credits exhausted');
      err.quotaExhausted = true;
      throw err;
    }

    attempt += 1;
    const retryable = res.status === 500 || res.status === 503 || code === 'rate_limit_exceeded_error';
    if (attempt >= maxAttempts || !retryable) {
      const err = new Error(body.error?.message || 'Sarvam transcription error');
      err.status = res.status;
      throw err;
    }

    const base = 500 * 2 ** (attempt - 1);
    await sleep(base + Math.random() * base * 0.3);
  }
}
