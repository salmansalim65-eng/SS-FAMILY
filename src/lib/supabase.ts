import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

if (!url || !key) {
  throw new Error(
    'Missing Supabase configuration. Copy .env.example to .env and restart the dev server.',
  )
}

export const supabase = createClient(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
})

export const CURRENCY = import.meta.env.VITE_CURRENCY || 'SAR'

/** Supabase surfaces RLS and trigger failures as objects; make them readable. */
export function errorMessage(error: unknown): string {
  if (!error) return 'Something went wrong.'
  if (typeof error === 'string') return error
  const e = error as { message?: string; details?: string; hint?: string; code?: string }

  if (e.code === '42501' || e.message?.includes('row-level security')) {
    return 'Your role does not allow that action.'
  }
  if (e.code === '23505') return 'That item already exists.'
  if (e.code === '23514') return 'Some values are out of range - please check the form.'

  return e.message || e.details || 'Something went wrong.'
}
