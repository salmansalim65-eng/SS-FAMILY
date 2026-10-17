"use client";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="text-sm text-muted">
        {error.message || "The dashboard could not load."} If this is a fresh setup, check that the SQL migrations
        have been run and your email is in <code>dashboard_owners</code>.
      </p>
      <button onClick={reset} className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white">Try again</button>
    </main>
  );
}
