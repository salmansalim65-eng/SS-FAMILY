import { LoginForm } from "./login-form";

const ERRORS: Record<string, string> = {
  not_allowed: "This email is not allowed to use this dashboard.",
  link_invalid: "That sign-in link is invalid or has expired. Request a new one.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-sm rounded-3xl border border-line bg-surface p-6 shadow-sm sm:p-8">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex size-11 items-center justify-center rounded-2xl bg-accent text-lg font-bold text-white">
            ⌂
          </div>
          <div>
            <h1 className="text-lg font-semibold">My Dashboard</h1>
            <p className="text-sm text-muted">Sign in with your email</p>
          </div>
        </div>
        {error && ERRORS[error] && (
          <p className="mb-4 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">{ERRORS[error]}</p>
        )}
        <LoginForm />
      </div>
    </main>
  );
}
