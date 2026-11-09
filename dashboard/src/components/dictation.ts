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
    r.onerror = (e) => {
      setError(e.error === "not-allowed" ? "Allow the microphone for this site to dictate." : e.error === "no-speech" ? null : e.error);
    };
    r.onend = () => setListening(false);
    rec.current = r;
    setError(null);
    r.start();
    setListening(true);
  }, [lang]);

  return { supported, listening, error, start, stop };
}
