"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { AuthCard, inputCls, primaryBtn } from "@/components/auth-card";
import { supabase } from "@/lib/supabase/client";

function LoginForm() {
  const router = useRouter();
  const next = useSearchParams().get("next") || "/";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase().auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
    setBusy(false);
    if (error) return setError("Email or password is not correct.");
    router.replace(next.startsWith("/") ? next : "/");
    router.refresh();
  }

  return (
    <AuthCard title="SS Tasks" subtitle="Sign in to your tasks">
      <form onSubmit={submit} className="space-y-3">
        <input type="email" required autoComplete="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls} />
        <input
          type="password"
          required
          autoComplete="current-password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputCls}
        />
        {error && <p className="text-sm text-danger">{error}</p>}
        <button disabled={busy} className={primaryBtn}>
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <p className="text-xs text-muted">New here? Open the invite link you were sent.</p>
    </AuthCard>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
