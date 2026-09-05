'use client';

import { useEffect, useRef, useState } from 'react';

// Mobile Chrome in particular ends a "continuous" SpeechRecognition session
// on its own — after a pause, or a platform timeout — well before the user
// is actually done talking. Only these count as truly fatal; everything
// else (no-speech, network blip, aborted) gets a silent restart instead of
// ending the whole flow.
const FATAL_SPEECH_ERRORS = new Set(['not-allowed', 'service-not-allowed', 'audio-capture']);
const MAX_RESTARTS = 6;

/**
 * Records and transcribes speech — primary path is MediaRecorder + Sarvam
 * (server-side), falling back to the browser's own SpeechRecognition
 * whenever Sarvam is unsupported, unavailable, out of credits, or otherwise
 * fails. Shared between the home page (speak a full order) and the cart
 * page (speak one missing item) so the recording/transcription machinery
 * exists in exactly one place.
 *
 * This hook only gets you a transcript — what happens with it (parse, then
 * navigate vs. parse, then add to the existing cart) is entirely the
 * caller's business via `onTranscript`.
 */
export function useVoiceCapture({ onTranscript, router } = {}) {
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [voiceState, setVoiceState] = useState('idle');   // idle | recording | transcribing | listening | error
  const [transcript, setTranscript] = useState('');
  const [listeningNotice, setListeningNotice] = useState(null);
  const [voiceError, setVoiceError] = useState(null);

  const recognitionRef = useRef(null);
  const stoppedByUserRef = useRef(false);   // true once the user taps Done/Cancel
  const mediaRecorderRef = useRef(null);
  const mediaStreamRef = useRef(null);
  const cancelledRef = useRef(false);   // true only for Cancel — skip transcribing the stopped clip

  useEffect(() => {
    const hasSpeechRecognition = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
    const hasMediaRecorder = !!(window.MediaRecorder && navigator.mediaDevices?.getUserMedia);
    setVoiceSupported(hasSpeechRecognition || hasMediaRecorder);
    return () => {
      stoppedByUserRef.current = true;
      recognitionRef.current?.stop();
      mediaRecorderRef.current?.stop();
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const startListening = (notice = null) => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return;

    const recognition = new SR();
    recognition.lang = 'en-IN';
    recognition.continuous = true;
    recognition.interimResults = true;

    let finalTranscript = '';
    let errored = false;
    let restarts = 0;
    stoppedByUserRef.current = false;
    cancelledRef.current = false;

    recognition.onresult = (event) => {
      let interim = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const chunk = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalTranscript += chunk + ' ';
        else interim += chunk;
      }
      setTranscript((finalTranscript + interim).trim());
    };

    recognition.onerror = (event) => {
      if (!FATAL_SPEECH_ERRORS.has(event.error)) return;   // let onend restart it
      errored = true;
      setVoiceState('error');
      setVoiceError(
        event.error === 'not-allowed' || event.error === 'service-not-allowed'
          ? 'Microphone access was blocked — allow it in your browser settings and try again.'
          : "Couldn't access your microphone. Try again."
      );
    };

    recognition.onend = () => {
      if (errored) return;
      // Cancel — resetVoice already put us back to idle; don't overwrite
      // that with an error just because there was no transcript yet.
      if (cancelledRef.current) return;

      if (!stoppedByUserRef.current && restarts < MAX_RESTARTS) {
        restarts += 1;
        try {
          recognition.start();
          return;
        } catch {
          // already stopped for good — fall through and wrap up below
        }
      }

      const heard = finalTranscript.trim();
      if (heard) {
        setVoiceState('idle');
        onTranscript?.(heard);
      } else {
        setVoiceState('error');
        setVoiceError("Didn't catch that — say it again?");
      }
    };

    recognitionRef.current = recognition;
    setTranscript('');
    setVoiceError(null);
    setListeningNotice(notice);
    setVoiceState('listening');
    recognition.start();
  };

  const stopListening = () => {
    stoppedByUserRef.current = true;
    recognitionRef.current?.stop();
  };

  // Sarvam is a batch endpoint (send a clip, get one transcript back) — no
  // live captions while recording, unlike the SpeechRecognition fallback.
  const startRecording = async () => {
    if (!window.MediaRecorder || !navigator.mediaDevices?.getUserMedia) {
      startListening();   // no MediaRecorder support — go straight to the fallback
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      const chunks = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        mediaStreamRef.current = null;
        // Cancel also stops the recorder (to release the mic) but wants the
        // clip discarded, not transcribed — resetVoice sets this flag first.
        if (cancelledRef.current) return;
        transcribeWithSarvam(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }));
      };

      mediaRecorderRef.current = recorder;
      cancelledRef.current = false;
      setVoiceError(null);
      setVoiceState('recording');
      recorder.start();
    } catch {
      // Mic permission denied or unavailable — try the fallback, which will
      // surface its own permission error if that's blocked too.
      startListening();
    }
  };

  const stopRecording = () => mediaRecorderRef.current?.stop();

  const transcribeWithSarvam = async (blob) => {
    setVoiceState('transcribing');
    try {
      const form = new FormData();
      const ext = blob.type.split(';')[0].split('/')[1] || 'webm';
      form.append('audio', blob, `voice-order.${ext}`);
      const res = await fetch('/api/voice-transcribe', { method: 'POST', body: form });
      const data = await res.json();
      if (res.status === 401) { router?.push('/welcome'); return; }

      if (!res.ok || data.fallback || !data.transcript) {
        startListening("Switched to your device's voice recognition — say that again.");
        return;
      }
      setTranscript(data.transcript);
      setVoiceState('idle');
      // translatedTranscript may be null (translate call failed, or wasn't
      // attempted) — the caller's onTranscript handles that as "no
      // translation available" and falls back to translating it itself.
      onTranscript?.(data.transcript, data.translatedTranscript || null);
    } catch {
      startListening("Switched to your device's voice recognition — say that again.");
    }
  };

  const resetVoice = () => {
    stoppedByUserRef.current = true;
    cancelledRef.current = true;
    recognitionRef.current?.stop();
    mediaRecorderRef.current?.stop();
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    setVoiceState('idle');
    setTranscript('');
    setListeningNotice(null);
    setVoiceError(null);
  };

  // Lets the caller drive the hook's own error display for a failure in
  // *its* post-transcript work (e.g. the parse call) — not something this
  // hook could know about on its own.
  const reportError = (message) => {
    setVoiceState('error');
    setVoiceError(message);
  };

  return {
    voiceSupported, voiceState, transcript, listeningNotice, voiceError,
    startRecording, stopRecording, stopListening, resetVoice, reportError,
  };
}
