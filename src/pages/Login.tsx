import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { errorMessage } from '../lib/supabase'
import { Button, Field, Input, Select } from '../components/ui'
import type { UserRole } from '../lib/types'

const DEMO_ACCOUNTS = [
  { email: 'head@ssfamily.app', label: 'Salman Salim', role: 'Head of Family' },
  { email: 'fatima@ssfamily.app', label: 'Fatima', role: 'Family Member' },
  { email: 'driver@ssfamily.app', label: 'Kamal', role: 'Driver' },
]
const DEMO_PASSWORD = 'Family@123'

export function LoginPage() {
  const { signIn, signUp } = useAuth()
  const toast = useToast()

  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [busy, setBusy] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState<UserRole>('member')
  const [phone, setPhone] = useState('')
  const [whatsapp, setWhatsapp] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    try {
      if (mode === 'signin') {
        await signIn(email, password)
      } else {
        const { needsConfirmation } = await signUp({
          email,
          password,
          name,
          role,
          phone,
          whatsapp_number: whatsapp,
        })
        if (needsConfirmation) {
          toast.success('Account created. Check your email to confirm, then sign in.')
          setMode('signin')
        }
      }
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const useDemo = async (demoEmail: string) => {
    setBusy(true)
    try {
      await signIn(demoEmail, DEMO_PASSWORD)
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
              ['🔔', 'In-app and WhatsApp notifications at every step'],
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
          <div className="mb-6 flex rounded-xl bg-sand-100 p-1">
            {(['signin', 'signup'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex-1 rounded-lg py-2.5 text-sm font-bold transition ${
                  mode === m ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'
                }`}
              >
                {m === 'signin' ? 'Sign in' : 'Create account'}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="space-y-4">
            {mode === 'signup' && (
              <>
                <Field label="Full name" required>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    autoComplete="name"
                    placeholder="Fatima Salim"
                  />
                </Field>
                <Field
                  label="Role"
                  hint="The first account ever created automatically becomes the Head of Family."
                >
                  <Select value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
                    <option value="member">Family Member</option>
                    <option value="head">Head of Family</option>
                    <option value="driver">Driver</option>
                  </Select>
                </Field>
              </>
            )}

            <Field label="Email" required>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="you@example.com"
              />
            </Field>

            <Field label="Password" required hint={mode === 'signup' ? 'At least 6 characters.' : undefined}>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                placeholder="••••••••"
              />
            </Field>

            {mode === 'signup' && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Phone">
                  <Input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+9665…"
                  />
                </Field>
                <Field label="WhatsApp" hint="Include the country code.">
                  <Input
                    type="tel"
                    value={whatsapp}
                    onChange={(e) => setWhatsapp(e.target.value)}
                    placeholder="+9665…"
                  />
                </Field>
              </div>
            )}

            <Button type="submit" size="lg" full loading={busy}>
              {mode === 'signin' ? 'Sign in' : 'Create account'}
            </Button>
          </form>

          {mode === 'signin' && (
            <div className="mt-8">
              <div className="flex items-center gap-3">
                <span className="h-px flex-1 bg-sand-200" />
                <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Demo accounts
                </span>
                <span className="h-px flex-1 bg-sand-200" />
              </div>

              <div className="mt-4 space-y-2">
                {DEMO_ACCOUNTS.map((account) => (
                  <button
                    key={account.email}
                    onClick={() => void useDemo(account.email)}
                    disabled={busy}
                    className="flex w-full items-center gap-3 rounded-xl border border-sand-200 bg-white px-4 py-3 text-left transition hover:border-palm-300 hover:bg-palm-50 disabled:opacity-50"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-slate-800">
                        {account.label}
                      </span>
                      <span className="block text-xs text-slate-500">{account.role}</span>
                    </span>
                    <span className="text-xs font-bold text-palm-700">Enter →</span>
                  </button>
                ))}
              </div>
              <p className="mt-3 text-center text-xs text-slate-400">
                All demo accounts use the password <code className="font-semibold">Family@123</code>
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
