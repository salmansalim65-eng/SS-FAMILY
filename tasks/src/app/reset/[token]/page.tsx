"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthCard, inputCls, primaryBtn } from "@/components/auth-card";
import { supabase } from "@/lib/supabase/client";

type Info = { email: string; name: string | null };

// Opening a password reset link (made by a workspace owner): choose a new password.
export default function ResetPage() {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = useState<Info | null | undefined>(undefined);
  const [password, setPassword] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    supabase()
      .rpc("password_reset_info", { p_token: token })
      .then(({ data }) => setInfo((data as Info | null) ?? null));
  }, [token]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError("Use at least 8 characters.");
    if (password !== again) return setError("The two passwords are not the same.");
    setBusy(true);
    const sb = supabase();
    await sb.auth.signOut().catch(() => {});
    const { data, error } = await sb.rpc("reset_password_with_token", { p_token: token, p_password: password });
    setBusy(false);
    if (error) return setError(error.message);
    setDone((data as string) ?? info?.email ?? "");
  }

  if (info === undefined) return <AuthCard title="Task Hub" subtitle="Checking the link…">{null}</AuthCard>;
  if (done !== null)
    return (
      <AuthCard title="Password changed" subtitle={done}>
        <p className="text-sm">Your new password is set. Sign in with it now.</p>
        <Link href="/login" className={`${primaryBtn} block text-center`}>
          Sign in
        </Link>
      </AuthCard>
    );
  if (!info)
    return (
      <AuthCard title="Link not valid" subtitle="It was used already or is older than 1 hour.">
        <p className="text-sm text-muted">Ask your workspace owner for a new password reset link.</p>
        <Link href="/login" className="text-sm text-accent hover:underline">
          Back to sign in
        </Link>
      </AuthCard>
    );
  return (
    <AuthCard title="Choose a new password" subtitle={info.name ? `${info.name} · ${info.email}` : info.email}>
      <form onSubmit={submit} className="space-y-3">
        <input type="email" value={info.email} readOnly autoComplete="username" className={`${inputCls} text-muted`} />
        <input
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          placeholder="New password (8+ characters)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputCls}
        />
        <input
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          placeholder="New password again"
          value={again}
          onChange={(e) => setAgain(e.target.value)}
          className={inputCls}
        />
        {error && <p className="text-sm text-danger">{error}</p>}
        <button disabled={busy} className={primaryBtn}>
          {busy ? "Saving…" : "Save new password"}
        </button>
      </form>
      <p className="text-xs text-muted">This link works once. You will be signed out on your other devices.</p>
    </AuthCard>
  );
}
