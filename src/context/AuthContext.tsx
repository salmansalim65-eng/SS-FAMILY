import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import type { AppUser } from '../lib/types'

/**
 * People sign in with a username. Supabase Auth needs an email, so each
 * account carries a synthetic one derived from the username — it is never
 * shown or typed. Keep this in step with login_email() in the database and
 * EMAIL_DOMAIN in the admin-users edge function.
 */
export const LOGIN_EMAIL_DOMAIN = 'ssfamily.local'

export function loginEmail(username: string): string {
  const clean = username.trim().toLowerCase()
  // Tolerate someone typing the full address out of habit.
  return clean.includes('@') ? clean : `${clean}@${LOGIN_EMAIL_DOMAIN}`
}

interface AuthValue {
  session: Session | null
  profile: AppUser | null
  loading: boolean
  isHead: boolean
  isFamily: boolean
  isDriver: boolean
  /** May approve menu items — the head, plus anyone they have trusted with it. */
  canApproveMenu: boolean
  signIn: (username: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  changePassword: (newPassword: string) => Promise<void>
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<AppUser | null>(null)
  const [loading, setLoading] = useState(true)

  const loadProfile = useCallback(async (userId: string) => {
    const { data, error } = await supabase.from('users').select('*').eq('id', userId).maybeSingle()

    if (error) {
      console.error('Could not load profile', error)
      setProfile(null)
      return
    }
    setProfile(data as AppUser | null)
  }, [])

  useEffect(() => {
    let active = true

    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return
      setSession(data.session)
      if (data.session?.user) await loadProfile(data.session.user.id)
      if (active) setLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      if (nextSession?.user) {
        // Deferred: calling back into supabase-js from inside its own auth
        // callback can deadlock the client's internal lock.
        setTimeout(() => {
          void loadProfile(nextSession.user.id)
        }, 0)
      } else {
        setProfile(null)
      }
    })

    return () => {
      active = false
      listener.subscription.unsubscribe()
    }
  }, [loadProfile])

  const signIn = useCallback(async (username: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email: loginEmail(username),
      password,
    })
    if (error) {
      // Don't leak whether the username exists.
      throw new Error('Wrong username or password.')
    }
  }, [])

  const signOut = useCallback(async () => {
    await supabase.auth.signOut()
    setProfile(null)
    setSession(null)
  }, [])

  const changePassword = useCallback(async (newPassword: string) => {
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    if (error) throw error
  }, [])

  const refreshProfile = useCallback(async () => {
    if (session?.user) await loadProfile(session.user.id)
  }, [session, loadProfile])

  const value = useMemo<AuthValue>(
    () => ({
      session,
      profile,
      loading,
      isHead: profile?.role === 'head',
      isFamily: profile?.role === 'head' || profile?.role === 'member',
      isDriver: profile?.role === 'driver',
      canApproveMenu: profile?.role === 'head' || Boolean(profile?.can_approve_menu),
      signIn,
      signOut,
      changePassword,
      refreshProfile,
    }),
    [session, profile, loading, signIn, signOut, changePassword, refreshProfile],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>')
  return ctx
}
