import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import type { AppUser } from './types'

/** Everyone in the family, for assignment dropdowns. */
export function useUsers() {
  const [users, setUsers] = useState<AppUser[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    supabase
      .from('users')
      .select('*')
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => {
        if (!active) return
        setUsers((data ?? []) as AppUser[])
        setLoading(false)
      })
    return () => {
      active = false
    }
  }, [])

  /** Who can be put down to cook or buy a dish — not the driver. */
  const cooks = users.filter((u) => u.role === 'head' || u.role === 'member')
  return { users, cooks, loading }
}

/** Small helper for the "load, then reload after a mutation" pattern. */
export function useReload(): [number, () => void] {
  const [tick, setTick] = useState(0)
  const reload = useCallback(() => setTick((t) => t + 1), [])
  return [tick, reload]
}
