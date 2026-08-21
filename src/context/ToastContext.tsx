import { createContext, useCallback, useContext, useMemo, useState } from 'react'
import type { ReactNode } from 'react'

type ToastKind = 'success' | 'error' | 'info'

interface Toast {
  id: number
  kind: ToastKind
  message: string
}

interface ToastValue {
  toast: (message: string, kind?: ToastKind) => void
  success: (message: string) => void
  error: (message: string) => void
}

const ToastContext = createContext<ToastValue | null>(null)

const STYLES: Record<ToastKind, string> = {
  success: 'bg-emerald-600',
  error: 'bg-red-600',
  info: 'bg-slate-800',
}

const ICONS: Record<ToastKind, string> = {
  success: '✓',
  error: '!',
  info: 'i',
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const toast = useCallback((message: string, kind: ToastKind = 'info') => {
    const id = Date.now() + Math.random()
    setToasts((current) => [...current, { id, kind, message }])
    window.setTimeout(() => {
      setToasts((current) => current.filter((t) => t.id !== id))
    }, 4500)
  }, [])

  const value = useMemo<ToastValue>(
    () => ({
      toast,
      success: (message: string) => toast(message, 'success'),
      error: (message: string) => toast(message, 'error'),
    }),
    [toast],
  )

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="no-print pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4 sm:bottom-6"
        role="status"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex w-full max-w-md animate-slide-up items-start gap-3 rounded-xl px-4 py-3 text-white shadow-lg ${STYLES[t.kind]}`}
          >
            <span className="mt-0.5 flex h-5 w-5 flex-none items-center justify-center rounded-full bg-white/25 text-xs font-bold">
              {ICONS[t.kind]}
            </span>
            <p className="text-sm leading-snug">{t.message}</p>
            <button
              onClick={() => setToasts((c) => c.filter((x) => x.id !== t.id))}
              className="ml-auto flex-none text-white/70 transition hover:text-white"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>')
  return ctx
}
