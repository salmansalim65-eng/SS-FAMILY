"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// The browser's own speech recognition (Chrome, Edge, Safari). Nothing is
// sent to the dashboard's servers; the browser handles the audio.

type Recognition = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};

function recognitionClass(): (new () => Recognition) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** A plain message for the browser's speech errors; null when it is not worth showing. */
function errorText(code: string, lang: string): string | null {
  switch (code) {
    case "no-speech":
    case "aborted":
      return null;
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone blocked: allow it for this site (🔒 in the address bar).";
    case "audio-capture":
      return "No microphone found.";
    case "network":
      // The browser sends the audio to its own speech service (Google for
      // Chrome, Microsoft for Edge); Brave, Opera, VPNs and firewalls block it.
      return "This browser couldn't reach its speech service. Use Chrome, or press Win+H (Windows) / the keyboard mic (phone) to dictate.";
    case "language-not-supported":
      return `This browser can't dictate in ${lang.startsWith("ur") ? "Urdu" : "this language"}; try Chrome or switch to EN.`;
    default:
      return `Dictation failed (${code}).`;
  }
}

export const DICTATION_LANGS = [
  { code: "en-US", label: "EN" },
  { code: "ur-PK", label: "اردو" },
] as const;

/** Start/stop dictation; each finished phrase is handed to `onText`. */
export function useDictation(lang: string, onText: (text: string) => void) {
  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  const callback = useRef(onText);
  callback.current = onText;

  useEffect(() => setSupported(recognitionClass() !== null), []);
  useEffect(() => () => rec.current?.stop(), []);

  const stop = useCallback(() => {
    rec.current?.stop();
    setListening(false);
  }, []);

  const start = useCallback(() => {
    const Ctor = recognitionClass();
    if (!Ctor) return;
    rec.current?.stop();
    const r = new Ctor();
    r.lang = lang;
    r.continuous = true;
    r.interimResults = false;
    r.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const text = res[0].transcript.trim();
        if (res.isFinal && text) callback.current(text);
      }
    };
    r.onerror = (e) => setError(errorText(e.error, lang));
    r.onend = () => setListening(false);
    rec.current = r;
    setError(null);
    r.start();
    setListening(true);
  }, [lang]);

  return { supported, listening, error, start, stop };
}
