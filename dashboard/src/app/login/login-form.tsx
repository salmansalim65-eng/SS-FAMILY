"use client";

import { useActionState } from "react";
import { sendLink, verifyCode, type LoginState } from "./actions";

const input =
  "w-full rounded-xl border border-line bg-bg px-3 py-2.5 text-base outline-none focus:border-accent focus:ring-2 focus:ring-accent/30";
const button =
  "w-full rounded-xl bg-accent px-4 py-2.5 font-medium text-white transition hover:opacity-90 disabled:opacity-60";

export function LoginForm() {
  const [sendState, send, sending] = useActionState(sendLink, { step: "email", email: "" } as LoginState);
  const [codeState, verify, verifying] = useActionState(verifyCode, { step: "code", email: "" } as LoginState);

  if (sendState.step === "email") {
    return (
      <form action={send} className="space-y-3">
        <input name="email" type="email" required autoComplete="email" placeholder="you@example.com" defaultValue={sendState.email} className={input} />
        {sendState.error && <p className="text-sm text-danger">{sendState.error}</p>}
        <button className={button} disabled={sending}>{sending ? "Sending…" : "Send sign-in link"}</button>
      </form>
    );
  }

  return (
    <form action={verify} className="space-y-3">
      <p className="text-sm text-muted">{sendState.message}</p>
      <input type="hidden" name="email" value={sendState.email} />
      <input name="code" inputMode="numeric" autoComplete="one-time-code" placeholder="Code from the email" required className={`${input} tracking-widest`} />
      {codeState.error && <p className="text-sm text-danger">{codeState.error}</p>}
      <button className={button} disabled={verifying}>{verifying ? "Checking…" : "Sign in"}</button>
      <button type="button" onClick={() => location.reload()} className="w-full text-sm text-muted hover:text-fg">
        Use a different email
      </button>
    </form>
  );
}
