import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { errorMessage } from '../lib/supabase'
import { Button, Field, Input } from '../components/ui'

export function LoginPage() {
  const { signIn } = useAuth()
  const toast = useToast()

  const [busy, setBusy] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!username.trim() || !password) return
    setBusy(true)
    try {
      await signIn(username, password)
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex min-h-screen flex-col lg:flex-row">
      {/* --------------------------------------------------------- brand side */}
      <div className="relative flex flex-col justify-center overflow-hidden bg-palm-700 px-6 py-12 text-white lg:w-[45%] lg:px-14">
        <div
          className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-palm-500/40 blur-3xl"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -bottom-32 -left-16 h-80 w-80 rounded-full bg-palm-400/20 blur-3xl"
          aria-hidden
        />
        <div className="relative">
          <span className="mb-6 inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-white/15 text-3xl backdrop-blur">
            🏡
          </span>
          <h1 className="text-3xl font-extrabold leading-tight sm:text-4xl">
            SS Family
            <span className="mt-1 block text-palm-200">Guest &amp; Event Planner</span>
          </h1>
          <p className="mt-4 max-w-md text-palm-100">
            Plan visits from Pakistan to Saudi Arabia in one place — guests, menus, tasks and the
            shopping run, with everyone kept in the loop.
          </p>

          <ul className="mt-8 space-y-3 text-sm text-palm-50">
            {[
              ['🧳', 'Track arrivals with a live countdown and calendar reminders'],
              ['🍽️', 'Suggest dishes, the head approves, tasks assign themselves'],
              ['🛒', 'One consolidated shopping list for the driver'],
              ['🔔', 'Notifications on your phone at every step'],
            ].map(([icon, text]) => (
              <li key={text} className="flex items-start gap-3">
                <span className="mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-white/15">
                  {icon}
                </span>
                {text}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* ---------------------------------------------------------- form side */}
      <div className="flex flex-1 items-center justify-center px-4 py-10 sm:px-8">
        <div className="w-full max-w-md">
          <div className="mb-6">
            <h2 className="text-2xl font-extrabold text-slate-800">Sign in</h2>
            <p className="mt-1 text-sm text-slate-500">
              Use the username and password given to you by the head of family.
            </p>
          </div>

          <form onSubmit={submit} className="space-y-4">
            <Field label="Username" required>
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                autoFocus
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                autoComplete="username"
                placeholder="e.g. fatima"
              />
            </Field>

            <Field label="Password" required>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                placeholder="••••••••"
              />
            </Field>

            <Button type="submit" size="lg" full loading={busy}>
              Sign in
            </Button>
          </form>

          <p className="mt-8 rounded-xl bg-sand-100 px-4 py-3 text-center text-xs leading-relaxed text-slate-600">
            Accounts are created by the head of family. If you need access, or you have forgotten
            your password, ask them to set one for you.
          </p>
        </div>
      </div>
    </div>
  )
}
