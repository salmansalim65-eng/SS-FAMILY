"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AuthCard, inputCls, primaryBtn } from "@/components/auth-card";
import { supabase } from "@/lib/supabase/client";

type Invite = { email: string; role: string; workspace: string | null; project: string | null; invited_by: string | null; valid: boolean; has_account: boolean };

// Opening an invite link: make an account (or sign in), then join the workspace / project.
export default function JoinPage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [invite, setInvite] = useState<Invite | null | undefined>(undefined);
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase()
      .rpc("get_invitation", { p_token: token })
      .then(({ data }) => setInvite((data as Invite | null) ?? null));
  }, [token]);

  async function accept() {
    const { data, error } = await supabase().rpc("accept_invitation", { p_token: token });
    if (error) throw new Error(error.message);
    router.replace(data ? `/w/${data}` : "/");
    router.refresh();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!invite) return;
    setBusy(true);
    setError(null);
    try {
      const sb = supabase();
      const { data: current } = await sb.auth.getUser();
      if (current.user && current.user.email !== invite.email) await sb.auth.signOut();
      if (!current.user || current.user.email !== invite.email) {
        if (invite.has_account) {
          const { error } = await sb.auth.signInWithPassword({ email: invite.email, password });
          if (error) throw new Error("That password is not correct.");
        } else {
          if (password.length < 8) throw new Error("Use at least 8 characters for the password.");
          const { data, error } = await sb.auth.signUp({ email: invite.email, password, options: { data: { full_name: name.trim() || invite.email.split("@")[0] } } });
          if (error) throw new Error(error.message);
          if (!data.session) throw new Error("Account made, but it needs email confirmation — ask the owner to turn off \"Confirm email\" in Supabase.");
        }
      }
      await accept();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't join.");
    } finally {
      setBusy(false);
    }
  }

  if (invite === undefined) return <AuthCard title="Opening invite…">{null}</AuthCard>;
  if (!invite || !invite.valid)
    return (
      <AuthCard title="Invite not valid" subtitle="This link was used already or has expired.">
        <p className="text-sm text-muted">Ask the person who invited you for a new link.</p>
      </AuthCard>
    );

  const where = invite.project ? `${invite.project}${invite.workspace ? ` · ${invite.workspace}` : ""}` : (invite.workspace ?? "Task Hub");
  return (
    <AuthCard
      title={`Join ${where}`}
      subtitle={
        <>
          {invite.invited_by ? `${invite.invited_by} invited you` : "You're invited"} as <b>{invite.role}</b>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-3">
        <input value={invite.email} readOnly className={`${inputCls} bg-surface-2 text-muted`} aria-label="Email" />
        {!invite.has_account && (
          <input required placeholder="Your name" value={name} onChange={(e) => setName(e.target.value)} className={inputCls} autoComplete="name" />
        )}
        <input
          type="password"
          required
          placeholder={invite.has_account ? "Your password" : "Choose a password (8+ characters)"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputCls}
          autoComplete={invite.has_account ? "current-password" : "new-password"}
        />
        {error && <p className="text-sm text-danger">{error}</p>}
        <button disabled={busy} className={primaryBtn}>
          {busy ? "Joining…" : invite.has_account ? "Sign in and join" : "Create account and join"}
        </button>
      </form>
    </AuthCard>
  );
}
