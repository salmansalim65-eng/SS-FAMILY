import { useEffect, useState } from 'react'
import { supabase, errorMessage } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useReload } from '../lib/hooks'
import {
  Avatar,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Field,
  Input,
  Modal,
  SectionHeader,
  Select,
  Spinner,
} from '../components/ui'
import { RELATIONS } from '../lib/types'
import type { AppUser, UserRole } from '../lib/types'

const ROLE_LABEL: Record<UserRole, string> = {
  head: 'Head of Family',
  member: 'Family Member',
  driver: 'Driver',
}

const ROLE_TONE: Record<UserRole, 'purple' | 'blue' | 'gray'> = {
  head: 'purple',
  member: 'blue',
  driver: 'gray',
}

const EMPTY_USER = {
  name: '',
  relation: '',
  username: '',
  password: '',
  role: 'member' as UserRole,
  phone: '',
  whatsapp_number: '',
}

/** All account management runs through the head-only edge function. */
async function adminCall(body: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('admin-users', { body })

  if (error) {
    // The function returns a JSON body with a readable message on 4xx.
    let message = error.message
    const ctx = (error as { context?: Response }).context
    if (ctx && typeof ctx.json === 'function') {
      try {
        const parsed = await ctx.json()
        if (parsed?.error) message = parsed.error
      } catch {
        /* fall back to the generic message */
      }
    }
    throw new Error(message)
  }
  if (data?.error) throw new Error(data.error)
  return data
}

export function SettingsPage() {
  const { profile, isHead, signOut, refreshProfile, changePassword } = useAuth()
  const toast = useToast()
  const [tick, reload] = useReload()

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [whatsapp, setWhatsapp] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)

  const [pw1, setPw1] = useState('')
  const [pw2, setPw2] = useState('')
  const [savingPw, setSavingPw] = useState(false)

  const [members, setMembers] = useState<AppUser[]>([])
  const [loadingMembers, setLoadingMembers] = useState(true)

  const [addOpen, setAddOpen] = useState(false)
  const [form, setForm] = useState({ ...EMPTY_USER })
  const [savingUser, setSavingUser] = useState(false)

  const [resetting, setResetting] = useState<AppUser | null>(null)
  const [resetPw, setResetPw] = useState('')
  const [deleting, setDeleting] = useState<AppUser | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setName(profile?.name ?? '')
    setPhone(profile?.phone ?? '')
    setWhatsapp(profile?.whatsapp_number ?? '')
  }, [profile])

  useEffect(() => {
    let active = true
    supabase
      .from('users')
      .select('*')
      .order('role')
      .order('name')
      .then(({ data }) => {
        if (!active) return
        setMembers((data ?? []) as AppUser[])
        setLoadingMembers(false)
      })
    return () => {
      active = false
    }
  }, [tick])

  // ------------------------------------------------------------ my profile
  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    setSavingProfile(true)
    const { error } = await supabase
      .from('users')
      .update({
        name: name.trim(),
        phone: phone.trim() || null,
        whatsapp_number: whatsapp.trim() || null,
      })
      .eq('id', profile!.id)
    setSavingProfile(false)

    if (error) {
      toast.error(errorMessage(error))
      return
    }
    toast.success('Profile saved.')
    await refreshProfile()
    reload()
  }

  const savePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    if (pw1.length < 6) {
      toast.error('Password must be at least 6 characters.')
      return
    }
    if (pw1 !== pw2) {
      toast.error('The two passwords do not match.')
      return
    }
    setSavingPw(true)
    try {
      await changePassword(pw1)
      toast.success('Password changed. Use it next time you sign in.')
      setPw1('')
      setPw2('')
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setSavingPw(false)
    }
  }

  // --------------------------------------------------------- user management
  const addUser = async (e: React.FormEvent) => {
    e.preventDefault()
    setSavingUser(true)
    try {
      await adminCall({
        action: 'create',
        name: form.name,
        username: form.username,
        password: form.password,
        relation: form.relation,
        role: form.role,
        phone: form.phone,
        whatsapp_number: form.whatsapp_number,
      })
      toast.success(`${form.name.trim()} can now sign in as "${form.username.trim().toLowerCase()}".`)
      setForm({ ...EMPTY_USER })
      setAddOpen(false)
      reload()
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setSavingUser(false)
    }
  }

  const changeRole = async (member: AppUser, role: UserRole) => {
    try {
      await adminCall({ action: 'update', id: member.id, role })
      toast.success(`${member.name} is now ${ROLE_LABEL[role]}.`)
      reload()
    } catch (error) {
      toast.error(errorMessage(error))
    }
  }

  const doReset = async () => {
    if (!resetting) return
    if (resetPw.length < 6) {
      toast.error('Password must be at least 6 characters.')
      return
    }
    setBusy(true)
    try {
      await adminCall({ action: 'set_password', id: resetting.id, password: resetPw })
      toast.success(`New password set for ${resetting.name}.`)
      setResetting(null)
      setResetPw('')
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  const doDelete = async () => {
    if (!deleting) return
    setBusy(true)
    try {
      await adminCall({ action: 'delete', id: deleting.id })
      toast.success(`${deleting.name}'s account was removed.`)
      setDeleting(null)
      reload()
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  if (!profile) return <Spinner />

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header>
        <h1 className="text-2xl font-extrabold text-slate-800">Settings</h1>
        <p className="text-sm text-slate-500">Your profile, your password, and the family.</p>
      </header>

      {/* ------------------------------------------------------ my profile */}
      <section>
        <SectionHeader icon="👤" title="My profile" />
        <Card className="p-5">
          <div className="mb-5 flex items-center gap-4">
            <Avatar name={profile.name} />
            <div className="min-w-0">
              <p className="truncate font-bold text-slate-800">{profile.name}</p>
              <p className="truncate text-sm text-slate-500">
                @{profile.username}
                {profile.relation ? ` · ${profile.relation}` : ''}
              </p>
            </div>
            <Badge tone={ROLE_TONE[profile.role]} className="ml-auto">
              {ROLE_LABEL[profile.role]}
            </Badge>
          </div>

          <form onSubmit={saveProfile} className="space-y-4">
            <Field label="Full name" required>
              <Input value={name} onChange={(e) => setName(e.target.value)} required />
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Phone">
                <Input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+9665…"
                />
              </Field>
              <Field
                label="WhatsApp number"
                hint="With country code. Blank means in-app notifications only."
              >
                <Input
                  type="tel"
                  value={whatsapp}
                  onChange={(e) => setWhatsapp(e.target.value)}
                  placeholder="+9665…"
                />
              </Field>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" loading={savingProfile}>
                Save profile
              </Button>
              <Button type="button" variant="secondary" onClick={() => void signOut()}>
                Sign out
              </Button>
            </div>
          </form>
        </Card>
      </section>

      {/* --------------------------------------------------- change password */}
      <section>
        <SectionHeader icon="🔑" title="Change my password" />
        <Card className="p-5">
          <form onSubmit={savePassword} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="New password" required hint="At least 6 characters.">
                <Input
                  type="password"
                  value={pw1}
                  onChange={(e) => setPw1(e.target.value)}
                  required
                  minLength={6}
                  autoComplete="new-password"
                  placeholder="••••••••"
                />
              </Field>
              <Field label="Repeat new password" required>
                <Input
                  type="password"
                  value={pw2}
                  onChange={(e) => setPw2(e.target.value)}
                  required
                  minLength={6}
                  autoComplete="new-password"
                  placeholder="••••••••"
                />
              </Field>
            </div>
            <Button type="submit" loading={savingPw}>
              Change password
            </Button>
          </form>
        </Card>
      </section>

      {/* ------------------------------------------------------ the family */}
      <section>
        <SectionHeader
          icon="👨‍👩‍👧‍👦"
          title={isHead ? 'User management' : 'Family'}
          count={members.length}
          action={
            isHead ? (
              <Button
                size="sm"
                onClick={() => {
                  setForm({ ...EMPTY_USER })
                  setAddOpen(true)
                }}
              >
                + Add user
              </Button>
            ) : undefined
          }
        />

        {loadingMembers ? (
          <Spinner label="Loading" />
        ) : (
          <Card className="divide-y divide-sand-100">
            {members.map((member) => (
              <div key={member.id} className="flex flex-wrap items-center gap-3 px-4 py-3.5">
                <Avatar name={member.name} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold text-slate-800">
                    {member.name}
                    {member.id === profile.id && (
                      <span className="ml-1.5 text-xs font-bold text-palm-700">(you)</span>
                    )}
                  </p>
                  <p className="truncate text-xs text-slate-500">
                    @{member.username}
                    {member.relation ? ` · ${member.relation}` : ''}
                  </p>
                  {isHead && (
                    <p className="text-[11px] text-slate-400">
                      {member.whatsapp_number
                        ? `WhatsApp ${member.whatsapp_number}`
                        : 'No WhatsApp number'}
                    </p>
                  )}
                </div>

                {isHead && member.id !== profile.id ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <Select
                      value={member.role}
                      onChange={(e) => void changeRole(member, e.target.value as UserRole)}
                      className="w-40"
                    >
                      <option value="head">Head of Family</option>
                      <option value="member">Family Member</option>
                      <option value="driver">Driver</option>
                    </Select>
                    <button
                      onClick={() => {
                        setResetting(member)
                        setResetPw('')
                      }}
                      className="rounded-lg bg-sand-100 px-3 py-2 text-xs font-bold text-slate-700 transition hover:bg-sand-200"
                    >
                      Reset password
                    </button>
                    <button
                      onClick={() => setDeleting(member)}
                      className="rounded-lg px-3 py-2 text-xs font-bold text-red-600 transition hover:bg-red-50"
                    >
                      Delete
                    </button>
                  </div>
                ) : (
                  <Badge tone={ROLE_TONE[member.role]}>{ROLE_LABEL[member.role]}</Badge>
                )}
              </div>
            ))}
          </Card>
        )}

        {isHead && (
          <p className="mt-2 text-xs text-slate-500">
            There is no public sign-up: every account is created here by you.
          </p>
        )}
      </section>

      {/* --------------------------------------------------------- add user */}
      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add user"
        wide
        footer={
          <>
            <Button variant="secondary" onClick={() => setAddOpen(false)} disabled={savingUser}>
              Cancel
            </Button>
            <Button type="submit" form="add-user-form" loading={savingUser}>
              Create account
            </Button>
          </>
        }
      >
        <form id="add-user-form" onSubmit={addUser} className="space-y-4">
          <Field label="Full name" required>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              autoFocus
              placeholder="Fatima Salim"
            />
          </Field>

          <Field label="Relation" hint="How they relate to the family.">
            <Input
              value={form.relation}
              onChange={(e) => setForm({ ...form, relation: e.target.value })}
              list="relation-options"
              placeholder="Daughter, Uncle, Driver…"
            />
            <datalist id="relation-options">
              {RELATIONS.map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field
              label="Username"
              required
              hint="Lowercase letters, numbers, dot, dash or underscore."
            >
              <Input
                value={form.username}
                onChange={(e) =>
                  setForm({ ...form, username: e.target.value.toLowerCase().replace(/\s+/g, '') })
                }
                required
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                placeholder="fatima"
              />
            </Field>
            <Field label="Password" required hint="At least 6 characters. Share it with them.">
              <Input
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required
                minLength={6}
                placeholder="••••••••"
              />
            </Field>
          </div>

          <Field label="Role" required>
            <Select
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as UserRole })}
            >
              <option value="member">Family Member — suggest menu, add shopping, own tasks</option>
              <option value="driver">Driver — sees the shopping list only</option>
              <option value="head">Head of Family — full control</option>
            </Select>
          </Field>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Phone">
              <Input
                type="tel"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="+9665…"
              />
            </Field>
            <Field label="WhatsApp number">
              <Input
                type="tel"
                value={form.whatsapp_number}
                onChange={(e) => setForm({ ...form, whatsapp_number: e.target.value })}
                placeholder="+9665…"
              />
            </Field>
          </div>

          <p className="rounded-xl bg-palm-50 px-4 py-3 text-xs leading-relaxed text-palm-800">
            They sign in with this <strong>username and password</strong> — no email needed. They
            can change the password themselves from Settings afterwards.
          </p>
        </form>
      </Modal>

      {/* --------------------------------------------------- reset password */}
      <Modal
        open={resetting !== null}
        onClose={() => setResetting(null)}
        title={`Reset password for ${resetting?.name ?? ''}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setResetting(null)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={() => void doReset()} loading={busy}>
              Set password
            </Button>
          </>
        }
      >
        <Field label="New password" required hint="At least 6 characters. Tell them the new one.">
          <Input
            value={resetPw}
            onChange={(e) => setResetPw(e.target.value)}
            minLength={6}
            placeholder="••••••••"
          />
        </Field>
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        title="Delete account"
        message={`Remove ${deleting?.name}'s account (@${deleting?.username})? They will no longer be able to sign in. Anything they created stays, but is no longer credited to them.`}
        confirmLabel="Delete account"
        destructive
        busy={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={doDelete}
      />
    </div>
  )
}
