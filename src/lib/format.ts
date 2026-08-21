import { differenceInCalendarDays, format, parseISO } from 'date-fns'
import { CURRENCY } from './supabase'
import type { MenuStatus, Priority, ShopStatus, TaskStatus } from './types'

export function d(value: string | null | undefined): Date | null {
  if (!value) return null
  const parsed = parseISO(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function fmtDate(value: string | null | undefined, pattern = 'dd MMM yyyy'): string {
  const parsed = d(value)
  return parsed ? format(parsed, pattern) : '-'
}

export function fmtDateTime(value: string | null | undefined): string {
  return fmtDate(value, "dd MMM yyyy 'at' HH:mm")
}

export function money(value: number | null | undefined): string {
  const n = Number(value ?? 0)
  return `${CURRENCY} ${n.toLocaleString(undefined, {
    minimumFractionDigits: n % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`
}

export function qty(value: number | string | null | undefined): string {
  const n = Number(value ?? 0)
  return n % 1 === 0 ? String(n) : n.toFixed(2).replace(/0$/, '')
}

/** Whole days from today. Negative means the date has passed. */
export function daysFromToday(value: string | null | undefined): number | null {
  const parsed = d(value)
  if (!parsed) return null
  return differenceInCalendarDays(parsed, new Date())
}

/** "in 3 days" / "today" / "2 days overdue" - used for arrivals and due dates. */
export function countdown(value: string | null | undefined): string {
  const days = daysFromToday(value)
  if (days === null) return 'No date'
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days === -1) return '1 day overdue'
  if (days < 0) return `${Math.abs(days)} days overdue`
  return `in ${days} days`
}

export function relativeTime(value: string | null | undefined): string {
  const parsed = d(value)
  if (!parsed) return ''
  const seconds = Math.floor((Date.now() - parsed.getTime()) / 1000)
  if (seconds < 60) return 'just now'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return fmtDate(value, 'dd MMM')
}

export function todayISO(): string {
  return format(new Date(), 'yyyy-MM-dd')
}

export function initials(name: string | null | undefined): string {
  if (!name) return '?'
  return name
    .replace(/\(.*?\)/g, '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

export function titleCase(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

// ---------------------------------------------------------------------------
// Status colour coding
//   red = urgent/high, yellow = medium, green = done,
//   blue = in progress, gray = draft/pending
// ---------------------------------------------------------------------------
export type Tone = 'red' | 'yellow' | 'green' | 'blue' | 'gray' | 'purple'

export const TONE_CLASSES: Record<Tone, string> = {
  red: 'bg-red-100 text-red-800 ring-red-200',
  yellow: 'bg-amber-100 text-amber-800 ring-amber-200',
  green: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
  blue: 'bg-sky-100 text-sky-800 ring-sky-200',
  gray: 'bg-slate-100 text-slate-700 ring-slate-200',
  purple: 'bg-violet-100 text-violet-800 ring-violet-200',
}

export const TONE_BAR: Record<Tone, string> = {
  red: 'bg-red-500',
  yellow: 'bg-amber-400',
  green: 'bg-emerald-500',
  blue: 'bg-sky-500',
  gray: 'bg-slate-300',
  purple: 'bg-violet-500',
}

export function priorityTone(priority: Priority): Tone {
  return priority === 'high' ? 'red' : priority === 'medium' ? 'yellow' : 'gray'
}

export function taskTone(status: TaskStatus): Tone {
  return status === 'completed' ? 'green' : status === 'in_progress' ? 'blue' : 'gray'
}

export function menuTone(status: MenuStatus): Tone {
  switch (status) {
    case 'approved':
      return 'purple'
    case 'in_progress':
      return 'blue'
    case 'completed':
      return 'green'
    case 'rejected':
      return 'red'
    default:
      return 'gray'
  }
}

export function shopTone(status: ShopStatus): Tone {
  return status === 'verified' ? 'green' : status === 'purchased' ? 'blue' : 'gray'
}

/** A due date's own urgency, independent of the task's priority field. */
export function dueTone(dueDate: string | null | undefined, status: TaskStatus): Tone {
  if (status === 'completed') return 'green'
  const days = daysFromToday(dueDate)
  if (days === null) return 'gray'
  if (days < 0) return 'red'
  if (days <= 1) return 'yellow'
  return 'gray'
}
