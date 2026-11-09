"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { signOut } from "@/app/login/actions";
import { LOCK_CLASS, LOCK_KEY } from "@/lib/app-lock";

// App lock: on this device, the dashboard asks for the phone's fingerprint
// (or face / screen lock) each time it is opened, and again after being in
// the background for a while. It uses the device's own WebAuthn
// authenticator with user verification, so the fingerprint never leaves
// the phone. The setting lives in this browser only.

const HIDDEN_AT_KEY = "dashboard.appLockHiddenAt";

type LockSetting = { credId: string; minutes: number };

function readSetting(): LockSetting | null {
  try {
    const s = JSON.parse(localStorage.getItem(LOCK_KEY) ?? "null");
    return s && typeof s.credId === "string" ? { credId: s.credId, minutes: Number(s.minutes) || 0 } : null;
  } catch {
    return null;
  }
}

const b64url = (bytes: ArrayBuffer) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const randomBytes = (n: number) => crypto.getRandomValues(new Uint8Array(n));

async function platformAvailable() {
  try {
    return typeof PublicKeyCredential !== "undefined" && (await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
  } catch {
    return false;
  }
}

/** Asks for the fingerprint against the credential made on this device. */
async function verify(credId: string) {
  const res = await navigator.credentials.get({
    publicKey: {
      challenge: randomBytes(32),
      allowCredentials: [{ type: "public-key", id: fromB64url(credId) }],
      userVerification: "required",
      timeout: 60_000,
      rpId: location.hostname,
    },
  });
  if (!res) throw new Error("Not verified");
}

/** The lock screen; renders nothing when no lock is set or once unlocked. */
export function AppLock() {
  const path = usePathname();
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const setting = useRef<LockSetting | null>(null);

  // auto: asked as the lock appears; some phones only show the prompt after a tap, so no error then.
  const unlock = useCallback(async (auto = false) => {
    if (!setting.current) return;
    setBusy(true);
    setError(null);
    try {
      await verify(setting.current.credId);
      setLocked(false);
      document.documentElement.classList.remove(LOCK_CLASS);
    } catch {
      if (!auto) setError("Fingerprint not confirmed. Try again.");
    } finally {
      setBusy(false);
    }
  }, []);

  const lock = useCallback(() => {
    setLocked(true);
    document.documentElement.classList.add(LOCK_CLASS);
  }, []);

  useEffect(() => {
    if (path.startsWith("/login")) {
      document.documentElement.classList.remove(LOCK_CLASS);
      return;
    }
    setting.current = readSetting();
    if (!setting.current) {
      document.documentElement.classList.remove(LOCK_CLASS);
      return;
    }
    lock();
    unlock(true);

    const onVisibility = () => {
      const s = readSetting();
      if (!s) return;
      try {
        if (document.visibilityState === "hidden") {
          sessionStorage.setItem(HIDDEN_AT_KEY, String(Date.now()));
        } else {
          const at = Number(sessionStorage.getItem(HIDDEN_AT_KEY) ?? 0);
          if (at && Date.now() - at >= s.minutes * 60_000) {
            setting.current = s;
            lock();
            unlock(true);
          }
        }
      } catch {}
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
    // Runs once per page: the lock is decided when the dashboard opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);

  if (!locked) return null;
  return (
    <div id="app-lock" className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-5 bg-bg p-6 text-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/logos/ss-dashboard.svg" alt="" className="size-16 rounded-2xl shadow" />
      <div>
        <h1 className="text-xl font-semibold">SS Dashboard is locked</h1>
        <p className="mt-1 text-sm text-muted">Use your fingerprint to open it.</p>
      </div>
      <button
        type="button"
        onClick={() => unlock()}
        disabled={busy}
        className="flex items-center gap-2 rounded-2xl bg-accent px-6 py-3 text-base font-medium text-white shadow hover:opacity-90 disabled:opacity-60"
      >
        <span aria-hidden className="text-2xl">
          🔒
        </span>
        {busy ? "Waiting for fingerprint…" : "Unlock with fingerprint"}
      </button>
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      <form
        action={signOut}
        onSubmit={() => {
          // Signing in again with the password turns the lock off on this device.
          try {
            localStorage.removeItem(LOCK_KEY);
          } catch {}
        }}
      >
        <button className="text-xs text-muted underline hover:text-fg">Fingerprint not working? Sign out and use the password</button>
      </form>
    </div>
  );
}

const DELAYS = [
  { value: 0, label: "Every time it opens" },
  { value: 1, label: "After 1 minute away" },
  { value: 5, label: "After 5 minutes away" },
  { value: 15, label: "After 15 minutes away" },
  { value: 60, label: "After 1 hour away" },
];

/** Settings: turn the fingerprint lock on or off for this device. */
export function AppLockSettings({ email }: { email: string }) {
  const [setting, setSetting] = useState<LockSetting | null>(null);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setSetting(readSetting());
    platformAvailable().then(setSupported);
  }, []);

  function save(s: LockSetting | null) {
    setSetting(s);
    try {
      if (s) localStorage.setItem(LOCK_KEY, JSON.stringify(s));
      else localStorage.removeItem(LOCK_KEY);
    } catch {}
  }

  async function turnOn() {
    setBusy(true);
    setError(null);
    try {
      const cred = (await navigator.credentials.create({
        publicKey: {
          challenge: randomBytes(32),
          rp: { name: "SS Dashboard", id: location.hostname },
          user: { id: randomBytes(16), name: email, displayName: "SS Dashboard lock" },
          pubKeyCredParams: [
            { type: "public-key", alg: -7 },
            { type: "public-key", alg: -257 },
          ],
          authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "discouraged" },
          timeout: 60_000,
          attestation: "none",
        },
      })) as PublicKeyCredential | null;
      if (!cred) throw new Error("No credential");
      save({ credId: b64url(cred.rawId), minutes: 5 });
    } catch (e) {
      setError(e instanceof Error && e.name === "NotAllowedError" ? "Cancelled — fingerprint not confirmed." : "Couldn't set up the fingerprint lock on this device.");
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    if (!setting) return;
    setBusy(true);
    setError(null);
    try {
      await verify(setting.credId);
      save(null);
    } catch {
      setError("Confirm with your fingerprint to turn the lock off.");
    } finally {
      setBusy(false);
    }
  }

  if (supported === false) {
    return <p className="text-sm text-muted">This device or browser has no fingerprint / screen lock that the dashboard can use.</p>;
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        On this device, the dashboard asks for your fingerprint (or face / screen lock) when it opens. Set it on each phone or computer
        you use.
      </p>
      {setting ? (
        <div className="flex flex-wrap items-center gap-3">
          <span className="rounded-full bg-emerald-100 px-3 py-1 text-sm font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200">
            🔒 On for this device
          </span>
          <label className="flex items-center gap-2 text-sm text-muted">
            Lock
            <select
              value={setting.minutes}
              onChange={(e) => save({ ...setting, minutes: Number(e.target.value) })}
              className="rounded-lg border border-line bg-surface px-2 py-1 text-sm text-fg"
            >
              {DELAYS.map((d) => (
                <option key={d.value} value={d.value}>
                  {d.label}
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={turnOff} disabled={busy} className="rounded-xl border border-line px-3 py-1.5 text-sm hover:bg-surface-2 disabled:opacity-60">
            Turn off
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={turnOn}
          disabled={busy || supported === null}
          className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60"
        >
          {busy ? "Waiting for fingerprint…" : "🔒 Turn on fingerprint lock"}
        </button>
      )}
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
