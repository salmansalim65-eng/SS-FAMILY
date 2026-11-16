"use client";

import { useEffect } from "react";
import { PENDING_SHARE_KEY } from "@/lib/replies";

// Android's Share menu opens this page (see manifest.ts share_target) with the
// shared text in the address. It only parks the text in this browser and
// opens the dashboard, which shows it in "Replies pending" to be saved — so
// nothing is lost if the dashboard first asks to sign in. No data is read here.
export default function SharePage() {
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const parts = [q.get("title"), q.get("text"), q.get("url")].map((p) => (p ?? "").trim()).filter(Boolean);
    // WhatsApp often repeats the text as the title; keep it once.
    const text = [...new Set(parts)].join("\n").slice(0, 4000);
    try {
      if (text) localStorage.setItem(PENDING_SHARE_KEY, JSON.stringify({ text, at: Date.now() }));
    } catch {}
    window.location.replace("/#replies");
  }, []);
  return <p className="p-6 text-sm text-muted">Opening SS Dashboard…</p>;
}
