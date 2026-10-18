"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isAllowedEmail } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

export type LoginState = { step: "email" | "code"; email: string; message?: string; error?: string };

async function siteUrl() {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  const proto = h.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}

export async function sendLink(_: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!/^\S+@\S+\.\S+$/.test(email)) return { step: "email", email, error: "Enter a valid email." };

  const sent: LoginState = {
    step: "code",
    email,
    message: "If this email is allowed, a sign-in link is on its way. Open it, or type the code from the email.",
  };

  // Same answer either way, so the page doesn't reveal which email is allowed.
  if (!isAllowedEmail(email)) return sent;

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: `${await siteUrl()}/auth/callback` },
  });
  if (error) return { step: "email", email, error: error.message };
  return sent;
}

export async function verifyCode(_: LoginState, form: FormData): Promise<LoginState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const token = String(form.get("code") ?? "").replace(/\s/g, "");
  if (!isAllowedEmail(email)) return { step: "code", email, error: "That code is not valid." };

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
  if (error) return { step: "code", email, error: "That code is not valid or has expired." };
  redirect("/");
}

export type PasswordState = { email: string; error?: string };

export async function signInWithPassword(_: PasswordState, form: FormData): Promise<PasswordState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const failed = { email, error: "Email or password is not correct." };
  // Same answer for a non-whitelisted email as for a wrong password.
  if (!isAllowedEmail(email) || !password) return failed;

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return failed;
  redirect("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}
