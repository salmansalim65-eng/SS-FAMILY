import { useEffect, useState } from 'react'
import { supabase, errorMessage } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useReload } from '../lib/hooks'
import { Avatar, Badge, Button, Card, Field, Input, SectionHeader, Select, Spinner } from '../components/ui'
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

export function SettingsPage() {
  const { profile, isHead, signOut, refreshProfile } = useAuth()
  const toast = useToast()
  const [tick, reload] = useReload()

  const [name, setName] = useState(profile?.name ?? '')
  const [phone, setPhone] = useState(profile?.phone ?? '')
  const [whatsapp, setWhatsapp] = useState(profile?.whatsapp_number ?? '')
  const [saving, setSaving] = useState(false)

  const [members, setMembers] = useState<AppUser[]>([])
  const [loadingMembers, setLoadingMembers] = useState(true)

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

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    const { error } = await supabase
      .from('users')
      .update({
        name: name.trim(),
        phone: phone.trim() || null,
        whatsapp_number: whatsapp.trim() || null,
      })
      .eq('id', profile!.id)
    setSaving(false)

    if (error) {
      toast.error(errorMessage(error))
      return
    }
    toast.success('Profile saved.')
    await refreshProfile()
    reload()
  }

  const changeRole = async (member: AppUser, role: UserRole) => {
    const { error } = await supabase.from('users').update({ role }).eq('id', member.id)
    if (error) {
      toast.error(errorMessage(error))
      return
    }
    toast.success(`${member.name} is now ${ROLE_LABEL[role]}.`)
    reload()
  }

  if (!profile) return <Spinner />

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header>
        <h1 className="text-2xl font-extrabold text-slate-800">Settings</h1>
        <p className="text-sm text-slate-500">Your profile and, for the head of family, the team.</p>
      </header>

      {/* ------------------------------------------------------ my profile */}
      <section>
        <SectionHeader icon="👤" title="My profile" />
        <Card className="p-5">
          <div className="mb-5 flex items-center gap-4">
            <Avatar name={profile.name} />
            <div className="min-w-0">
              <p className="truncate font-bold text-slate-800">{profile.name}</p>
              <p className="truncate text-sm text-slate-500">{profile.email}</p>
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
                hint="With country code. Leave blank to receive in-app notifications only."
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
              <Button type="submit" loading={saving}>
                Save profile
              </Button>
              <Button type="button" variant="secondary" onClick={() => void signOut()}>
                Sign out
              </Button>
            </div>
          </form>
        </Card>
      </section>

      {/* ------------------------------------------------------ the family */}
      <section>
        <SectionHeader icon="👨‍👩‍👧‍👦" title="Family & roles" count={members.length} />
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
                  <p className="truncate text-xs text-slate-500">{member.email}</p>
                  <p className="text-[11px] text-slate-400">
                    {member.whatsapp_number ? `WhatsApp ${member.whatsapp_number}` : 'No WhatsApp number'}
                  </p>
                </div>
                {isHead && member.id !== profile.id ? (
                  <Select
                    value={member.role}
                    onChange={(e) => void changeRole(member, e.target.value as UserRole)}
                    className="w-44"
                  >
                    <option value="head">Head of Family</option>
                    <option value="member">Family Member</option>
                    <option value="driver">Driver</option>
                  </Select>
                ) : (
                  <Badge tone={ROLE_TONE[member.role]}>{ROLE_LABEL[member.role]}</Badge>
                )}
              </div>
            ))}
          </Card>
        )}
        {isHead && (
          <p className="mt-2 text-xs text-slate-500">
            New people join by creating their own account on the sign-in screen. You can change
            anyone's role here.
          </p>
        )}
      </section>

      {/* ---------------------------------------------------- integrations */}
      <section>
        <SectionHeader icon="🔌" title="Integrations" />
        <Card className="divide-y divide-sand-100">
          <IntegrationRow
            icon="📅"
            title="Google Calendar"
            body="Guest arrivals are pushed to the family calendar with a reminder 3 days before. Without credentials, every guest card still offers a one-click 'Add to Calendar' link and an .ics download."
            hint="Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN and GOOGLE_CALENDAR_ID as Supabase edge function secrets."
          />
          <IntegrationRow
            icon="💬"
            title="WhatsApp (Twilio)"
            body="Notifications are queued for anyone with a WhatsApp number and delivered by the send-whatsapp edge function. Without credentials they stay in the in-app inbox."
            hint="Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_WHATSAPP_FROM as Supabase edge function secrets."
          />
          <IntegrationRow
            icon="⏰"
            title="Reminders"
            body="A scheduled run notifies assignees 1 day before a task is due, and the family 3 days before a guest arrives."
            hint="Schedule the reminders edge function daily with pg_cron or any external scheduler."
          />
        </Card>
      </section>
    </div>
  )
}

function IntegrationRow({
  icon,
  title,
  body,
  hint,
}: {
  icon: string
  title: string
  body: string
  hint: string
}) {
  return (
    <div className="flex gap-3 px-4 py-4">
      <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-sand-100 text-xl">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="font-bold text-slate-800">{title}</p>
        <p className="mt-0.5 text-sm leading-relaxed text-slate-600">{body}</p>
        <p className="mt-1.5 rounded-lg bg-sand-50 px-3 py-2 font-mono text-[11px] leading-relaxed text-slate-500">
          {hint}
        </p>
      </div>
    </div>
  )
}
