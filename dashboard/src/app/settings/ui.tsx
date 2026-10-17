"use client";

import { useState, useTransition } from "react";
import type { ActionResult } from "./actions";

export const inputCls =
  "w-full rounded-xl border border-line bg-bg px-3 py-2 text-base outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 sm:text-sm";
export const btnCls = "rounded-xl px-4 py-2 text-sm font-medium transition disabled:opacity-60";
export const primaryBtn = `${btnCls} bg-accent text-white hover:opacity-90`;
export const ghostBtn = `${btnCls} border border-line bg-surface hover:bg-surface-2`;
export const dangerBtn = `${btnCls} text-danger hover:bg-danger-soft`;

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="block text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted">{hint}</span>}
    </label>
  );
}

/** Runs a server action, tracking pending state and the error message. */
export function useAction() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  function exec(action: () => Promise<ActionResult>, onOk?: () => void) {
    setError(null);
    setSaved(false);
    start(async () => {
      const res = await action();
      if (res.ok) {
        setSaved(true);
        onOk?.();
      } else setError(res.error);
    });
  }
  /**
   * onSubmit handler for a form. Used instead of <form action>, which resets
   * the fields after every submit — including one that failed validation.
   */
  function submit(action: (form: FormData) => Promise<ActionResult>, onOk?: () => void) {
    return (e: React.FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      const form = new FormData(e.currentTarget);
      exec(() => action(form), onOk);
    };
  }
  return { pending, error, saved, exec, submit };
}

export function Status({ error, saved }: { error: string | null; saved?: boolean }) {
  if (error) return <p className="text-sm text-danger" role="alert">{error}</p>;
  if (saved) return <p className="text-sm text-up">Saved</p>;
  return null;
}
