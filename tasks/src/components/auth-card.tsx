export function AuthCard({ title, subtitle, children }: { title: string; subtitle?: React.ReactNode; children: React.ReactNode }) {
  return (
    <main className="grid min-h-dvh place-items-center p-4">
      <div className="w-full max-w-sm space-y-5 rounded-3xl border border-line bg-surface p-6 shadow-sm">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon.svg" alt="" className="size-10" />
          <div>
            <h1 className="text-lg font-semibold">{title}</h1>
            {subtitle && <p className="text-sm text-muted">{subtitle}</p>}
          </div>
        </div>
        {children}
      </div>
    </main>
  );
}

export const inputCls = "w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm outline-none focus:border-accent";
export const primaryBtn = "w-full rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60";
