import { useEffect } from 'react'
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'
import { TONE_CLASSES } from '../lib/format'
import type { Tone } from '../lib/format'

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------
type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-palm-600 text-white hover:bg-palm-700 focus-visible:ring-palm-500/40',
  secondary: 'bg-white text-slate-700 ring-1 ring-inset ring-sand-200 hover:bg-sand-50 focus-visible:ring-palm-500/40',
  ghost: 'text-slate-600 hover:bg-sand-100 focus-visible:ring-palm-500/40',
  danger: 'bg-red-600 text-white hover:bg-red-700 focus-visible:ring-red-500/40',
  success: 'bg-emerald-600 text-white hover:bg-emerald-700 focus-visible:ring-emerald-500/40',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  full?: boolean
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  full = false,
  className = '',
  children,
  disabled,
  ...rest
}: ButtonProps) {
  const sizes = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2.5 text-sm',
    lg: 'px-5 py-3.5 text-base',
  }
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-xl font-semibold shadow-sm
        transition focus-visible:outline-none focus-visible:ring-4
        disabled:cursor-not-allowed disabled:opacity-50
        ${VARIANTS[variant]} ${sizes[size]} ${full ? 'w-full' : ''} ${className}`}
    >
      {loading && (
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      )}
      {children}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Badge
// ---------------------------------------------------------------------------
export function Badge({
  tone = 'gray',
  children,
  className = '',
}: {
  tone?: Tone
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-xs
        font-semibold ring-1 ring-inset ${TONE_CLASSES[tone]} ${className}`}
    >
      {children}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------
export function Card({
  children,
  className = '',
  accent,
}: {
  children: ReactNode
  className?: string
  accent?: string
}) {
  return (
    <div className={`card relative overflow-hidden ${className}`}>
      {accent && <div className={`absolute inset-y-0 left-0 w-1.5 ${accent}`} />}
      {children}
    </div>
  )
}

export function SectionHeader({
  title,
  count,
  action,
  icon,
}: {
  title: string
  count?: number
  action?: ReactNode
  icon?: string
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-base font-bold text-slate-800">
        {icon && <span aria-hidden>{icon}</span>}
        {title}
        {count !== undefined && (
          <span className="rounded-full bg-sand-200 px-2 py-0.5 text-xs font-bold text-slate-600">
            {count}
          </span>
        )}
      </h2>
      {action}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Form fields
// ---------------------------------------------------------------------------
export function Field({
  label,
  hint,
  required,
  children,
  className = '',
}: {
  label: string
  hint?: ReactNode
  required?: boolean
  children: ReactNode
  className?: string
}) {
  return (
    <div className={className}>
      <label className="label">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  )
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  const { className = '', ...rest } = props
  return <input {...rest} className={`field ${className}`} />
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className = '', ...rest } = props
  return <textarea {...rest} className={`field ${className}`} />
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  const { className = '', children, ...rest } = props
  return (
    <select {...rest} className={`field appearance-none bg-white pr-10 ${className}`}>
      {children}
    </select>
  )
}

// ---------------------------------------------------------------------------
// Modal
// ---------------------------------------------------------------------------
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide = false,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="no-print fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <div
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative flex max-h-[92vh] w-full flex-col rounded-t-3xl bg-white shadow-2xl
          animate-slide-up sm:rounded-2xl ${wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'}`}
      >
        <div className="flex items-center justify-between border-b border-sand-200 px-5 py-4">
          <h3 className="text-lg font-bold text-slate-800">{title}</h3>
          <button
            onClick={onClose}
            className="-mr-2 rounded-lg p-2 text-2xl leading-none text-slate-400 transition hover:bg-sand-100 hover:text-slate-700"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-5">{children}</div>
        {footer && (
          <div className="flex flex-col-reverse gap-2 border-t border-sand-200 px-5 py-4 sm:flex-row sm:justify-end">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------
export function EmptyState({
  icon = '🗂️',
  title,
  description,
  action,
}: {
  icon?: string
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-sand-300 bg-white/60 px-6 py-12 text-center">
      <span className="mb-3 text-4xl" aria-hidden>
        {icon}
      </span>
      <p className="font-semibold text-slate-700">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-slate-500">
      <span className="h-6 w-6 animate-spin rounded-full border-2 border-palm-500 border-t-transparent" />
      <span className="text-sm font-medium">{label}…</span>
    </div>
  )
}

export function Avatar({ name, size = 'md' }: { name: string; size?: 'sm' | 'md' }) {
  const letters = name
    .replace(/\(.*?\)/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')

  // Stable colour per person so faces are recognisable at a glance
  const palette = [
    'bg-palm-100 text-palm-800',
    'bg-sky-100 text-sky-800',
    'bg-violet-100 text-violet-800',
    'bg-amber-100 text-amber-800',
    'bg-rose-100 text-rose-800',
  ]
  let hash = 0
  for (let i = 0; i < name.length; i += 1) hash = (hash * 31 + name.charCodeAt(i)) >>> 0

  return (
    <span
      title={name}
      className={`inline-flex flex-none items-center justify-center rounded-full font-bold
        ${palette[hash % palette.length]}
        ${size === 'sm' ? 'h-6 w-6 text-[10px]' : 'h-9 w-9 text-xs'}`}
    >
      {letters || '?'}
    </span>
  )
}

export function StatCard({
  label,
  value,
  sub,
  icon,
  tone = 'gray',
  onClick,
}: {
  label: string
  value: string | number
  sub?: string
  icon: string
  tone?: Tone
  onClick?: () => void
}) {
  const Wrapper = onClick ? 'button' : 'div'
  return (
    <Wrapper
      onClick={onClick}
      className={`card flex items-center gap-3 p-4 text-left transition ${
        onClick ? 'hover:-translate-y-0.5 hover:shadow-md' : ''
      }`}
    >
      <span
        className={`flex h-11 w-11 flex-none items-center justify-center rounded-xl text-xl ring-1 ring-inset ${TONE_CLASSES[tone]}`}
        aria-hidden
      >
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-2xl font-extrabold leading-tight text-slate-800">{value}</span>
        <span className="block truncate text-xs font-medium text-slate-500">{label}</span>
        {sub && <span className="block truncate text-[11px] text-slate-400">{sub}</span>}
      </span>
    </Wrapper>
  )
}

export function SearchBar({
  value,
  onChange,
  placeholder = 'Search…',
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
}) {
  return (
    <div className="relative flex-1">
      <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden>
        🔍
      </span>
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="field pl-10"
      />
    </div>
  )
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  destructive = false,
  onConfirm,
  onCancel,
  busy = false,
}: {
  open: boolean
  title: string
  message: string
  confirmLabel?: string
  destructive?: boolean
  onConfirm: () => void
  onCancel: () => void
  busy?: boolean
}) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
          <Button variant={destructive ? 'danger' : 'primary'} onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <p className="text-sm leading-relaxed text-slate-600">{message}</p>
    </Modal>
  )
}
