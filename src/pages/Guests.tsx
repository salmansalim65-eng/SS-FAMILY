import { useEffect, useMemo, useState } from 'react'
import { supabase, errorMessage } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useReload } from '../lib/hooks'
import { countdown, daysFromToday, fmtDate, todayISO } from '../lib/format'
import {
  DEFAULT_DINNER_TIME,
  downloadIcs,
  googleCalendarUrl,
  removeGuestFromGoogleCalendar,
  syncGuestToGoogleCalendar,
} from '../lib/calendar'
import { downloadCsv } from '../lib/export'
import { guestMessage, shareToWhatsApp } from '../lib/whatsapp'
import {
  Avatar,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Field,
  Input,
  Modal,
  SearchBar,
  Select,
  Spinner,
  Textarea,
} from '../components/ui'
import { GuestHistory } from '../components/GuestHistory'
import type { Guest, GuestType } from '../lib/types'

type When = 'upcoming' | 'current' | 'past' | 'all'
type Kind = 'all' | GuestType
type Mode = 'upcoming' | 'history'

const EMPTY = {
  guest_type: 'staying' as GuestType,
  name: '',
  arrival_date: todayISO(),
  departure_date: '',
  event_time: DEFAULT_DINNER_TIME,
  male_count: '1',
  female_count: '0',
  relationship: '',
  room: '',
  special_needs: '',
  phone: '',
  origin_city: 'Pakistan',
}

export function GuestsPage() {
  const { profile, isHead } = useAuth()
  const toast = useToast()
  const [tick, reload] = useReload()

  const [guests, setGuests] = useState<Guest[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [when, setWhen] = useState<When>('upcoming')
  const [kind, setKind] = useState<Kind>('all')
  const [mode, setMode] = useState<Mode>('upcoming')

  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState<Guest | null>(null)
  const [form, setForm] = useState({ ...EMPTY })
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState<Guest | null>(null)
  const [busyDelete, setBusyDelete] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    supabase
      .from('guests')
      .select('*, creator:users!guests_created_by_fkey(id, name)')
      .order('arrival_date')
      .then(({ data, error }) => {
        if (!active) return
        if (error) toast.error(errorMessage(error))
        setGuests((data ?? []) as unknown as Guest[])
        setLoading(false)
      })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick])

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    return guests.filter((guest) => {
      if (kind !== 'all' && guest.guest_type !== kind) return false

      const days = daysFromToday(guest.arrival_date) ?? 0
      // A dinner is over the day it happens; a stay runs until departure.
      const finished =
        guest.guest_type === 'dinner'
          ? days < 0
          : guest.departure_date !== null && (daysFromToday(guest.departure_date) ?? 0) < 0

      if (when === 'upcoming' && days < 0) return false
      if (when === 'current' && !(days <= 0 && !finished)) return false
      if (when === 'past' && !finished) return false

      if (!term) return true
      return [guest.name, guest.relationship, guest.room, guest.origin_city, guest.special_needs]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term))
    })
  }, [guests, search, when, kind])

  const counts = useMemo(
    () => ({
      all: guests.length,
      staying: guests.filter((g) => g.guest_type === 'staying').length,
      dinner: guests.filter((g) => g.guest_type === 'dinner').length,
    }),
    [guests],
  )

  const openCreate = (type: GuestType) => {
    setEditing(null)
    setForm({ ...EMPTY, guest_type: type })
    setFormOpen(true)
  }

  const openEdit = (guest: Guest) => {
    setEditing(guest)
    setForm({
      guest_type: guest.guest_type,
      name: guest.name,
      arrival_date: guest.arrival_date,
      departure_date: guest.departure_date ?? '',
      event_time: (guest.event_time ?? DEFAULT_DINNER_TIME).slice(0, 5),
      male_count: String(guest.male_count),
      female_count: String(guest.female_count),
      relationship: guest.relationship ?? '',
      room: guest.room ?? '',
      special_needs: guest.special_needs ?? '',
      phone: guest.phone ?? '',
      origin_city: guest.origin_city ?? '',
    })
    setFormOpen(true)
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    const male = Number(form.male_count) || 0
    const female = Number(form.female_count) || 0
    const isDinner = form.guest_type === 'dinner'

    if (male + female < 1) {
      toast.error('There has to be at least one guest.')
      return
    }
    if (!isDinner && form.departure_date && form.departure_date < form.arrival_date) {
      toast.error('Departure cannot be before arrival.')
      return
    }

    setSaving(true)
    const payload = {
      guest_type: form.guest_type,
      name: form.name.trim(),
      arrival_date: form.arrival_date,
      // A dinner has no departure and no room; a stay has no time.
      departure_date: isDinner ? null : form.departure_date || null,
      event_time: isDinner ? form.event_time || null : null,
      room: isDinner ? null : form.room.trim() || null,
      male_count: male,
      female_count: female,
      relationship: form.relationship.trim() || null,
      special_needs: form.special_needs.trim() || null,
      phone: form.phone.trim() || null,
      origin_city: isDinner ? null : form.origin_city.trim() || null,
    }

    try {
      let guest: Guest

      if (editing) {
        const { data, error } = await supabase
          .from('guests')
          .update(payload)
          .eq('id', editing.id)
          .select()
          .single()
        if (error) throw error
        guest = data as unknown as Guest
        toast.success('Guest updated.')
      } else {
        const { data, error } = await supabase
          .from('guests')
          .insert({ ...payload, created_by: profile?.id })
          .select()
          .single()
        if (error) throw error
        guest = data as unknown as Guest
        toast.success(
          isDinner
            ? `${guest.name} added as a dinner guest. The family has been notified.`
            : `${guest.name} added. The family has been notified.`,
        )
      }

      setFormOpen(false)
      reload()

      // Calendar sync runs after the save and never blocks it.
      const result = await syncGuestToGoogleCalendar(guest)
      if (result.configured) {
        toast.success(result.message)
        reload()
      } else if (!editing) {
        toast.toast('Google Calendar is not connected — use "Add to Calendar" on the card.')
      }
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleting) return
    setBusyDelete(true)
    const eventId = deleting.google_calendar_event_id
    const { error } = await supabase.from('guests').delete().eq('id', deleting.id)
    setBusyDelete(false)
    if (error) {
      toast.error(errorMessage(error))
      return
    }
    void removeGuestFromGoogleCalendar(eventId)
    setDeleting(null)
    toast.success('Guest removed.')
    reload()
  }

  const exportCsv = () => {
    downloadCsv(
      `guest-list-${todayISO()}.csv`,
      ['Type', 'Name', 'Relationship', 'From', 'Date', 'Time', 'Departure', 'Male', 'Female', 'Total', 'Room', 'Special needs', 'Phone'],
      visible.map((g) => [
        g.guest_type === 'dinner' ? 'Dinner only' : 'Staying',
        g.name,
        g.relationship ?? '',
        g.origin_city ?? '',
        g.arrival_date,
        g.event_time ?? '',
        g.departure_date ?? '',
        g.male_count,
        g.female_count,
        g.total_guests,
        g.room ?? '',
        g.special_needs ?? '',
        g.phone ?? '',
      ]),
    )
    toast.success('Guest list exported.')
  }

  const totals = useMemo(
    () => ({
      people: visible.reduce((sum, g) => sum + g.total_guests, 0),
      male: visible.reduce((sum, g) => sum + g.male_count, 0),
      female: visible.reduce((sum, g) => sum + g.female_count, 0),
    }),
    [visible],
  )

  const isDinnerForm = form.guest_type === 'dinner'

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800">Guests</h1>
          <p className="text-sm text-slate-500">
            {visible.length} entr{visible.length === 1 ? 'y' : 'ies'} · {totals.people} people (
            {totals.male} male, {totals.female} female)
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={exportCsv} disabled={visible.length === 0}>
            ⬇ Export
          </Button>
          <Button variant="secondary" onClick={() => openCreate('dinner')}>
            🍽️ Dinner guest
          </Button>
          <Button onClick={() => openCreate('staying')}>+ Staying guest</Button>
        </div>
      </header>

      {/* --------------------------------------------------------- mode tabs */}
      <div className="mb-4 flex rounded-xl bg-sand-100 p-1">
        {([['upcoming', '🧳 Visits'], ['history', '📖 History']] as [Mode, string][]).map(
          ([key, label]) => (
            <button
              key={key}
              onClick={() => setMode(key)}
              className={`flex-1 rounded-lg py-2.5 text-sm font-bold transition ${
                mode === key ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'
              }`}
            >
              {label}
            </button>
          ),
        )}
      </div>

      {mode === 'history' ? (
        <GuestHistory />
      ) : (
        <>
      {/* ------------------------------------------------------- category tabs */}
      <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
        {(
          [
            ['all', 'All', '👥'],
            ['staying', 'Staying with us', '🏠'],
            ['dinner', 'Dinner only', '🍽️'],
          ] as [Kind, string, string][]
        ).map(([key, label, icon]) => (
          <button
            key={key}
            onClick={() => setKind(key)}
            className={`flex flex-none items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition ${
              kind === key
                ? 'bg-palm-600 text-white shadow-sm'
                : 'bg-white text-slate-600 ring-1 ring-inset ring-sand-200 hover:bg-sand-50'
            }`}
          >
            <span aria-hidden>{icon}</span>
            {label}
            <span
              className={`rounded-full px-1.5 text-xs font-bold ${
                kind === key ? 'bg-white/20' : 'bg-sand-200 text-slate-600'
              }`}
            >
              {counts[key]}
            </span>
          </button>
        ))}
      </div>

      <div className="mb-5 flex flex-col gap-3 sm:flex-row">
        <SearchBar value={search} onChange={setSearch} placeholder="Search name, room, relationship…" />
        <div className="flex rounded-xl bg-sand-100 p-1">
          {(['upcoming', 'current', 'past', 'all'] as When[]).map((f) => (
            <button
              key={f}
              onClick={() => setWhen(f)}
              className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold capitalize transition sm:flex-none ${
                when === f ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <Spinner label="Loading guests" />
      ) : visible.length === 0 ? (
        <EmptyState
          icon={kind === 'dinner' ? '🍽️' : '🧳'}
          title="No guests here"
          description={
            search ? 'Nothing matches your search.' : 'Add a visit to get the family ready.'
          }
          action={
            <div className="flex gap-2">
              <Button variant="secondary" onClick={() => openCreate('dinner')}>
                🍽️ Dinner guest
              </Button>
              <Button onClick={() => openCreate('staying')}>+ Staying guest</Button>
            </div>
          }
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((guest) => (
            <GuestCard
              key={guest.id}
              guest={guest}
              canDelete={isHead}
              onEdit={() => openEdit(guest)}
              onDelete={() => setDeleting(guest)}
            />
          ))}
        </div>
      )}

        </>
      )}

      {/* ----------------------------------------------------------- form */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? 'Edit guest' : isDinnerForm ? 'Add dinner guest' : 'Add staying guest'}
        wide
        footer={
          <>
            <Button variant="secondary" onClick={() => setFormOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" form="guest-form" loading={saving}>
              {editing ? 'Save changes' : 'Add guest'}
            </Button>
          </>
        }
      >
        <form id="guest-form" onSubmit={save} className="space-y-4">
          <Field label="Type of guest" required>
            <div className="grid grid-cols-2 gap-3">
              {(
                [
                  ['staying', '🏠 Staying with us', 'Sleeps at home'],
                  ['dinner', '🍽️ Dinner only', 'Invited for a meal'],
                ] as [GuestType, string, string][]
              ).map(([value, label, hint]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setForm({ ...form, guest_type: value })}
                  className={`rounded-xl border-2 px-3 py-3 text-left transition ${
                    form.guest_type === value
                      ? 'border-palm-500 bg-palm-50'
                      : 'border-sand-200 bg-white hover:border-sand-300'
                  }`}
                >
                  <span
                    className={`block text-sm font-bold ${
                      form.guest_type === value ? 'text-palm-800' : 'text-slate-700'
                    }`}
                  >
                    {label}
                  </span>
                  <span className="block text-[11px] text-slate-500">{hint}</span>
                </button>
              ))}
            </div>
          </Field>

          <Field label="Guest / family name" required>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              placeholder={isDinnerForm ? 'Khan Family' : 'Ali Ahmed Family'}
            />
          </Field>

          {isDinnerForm ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Dinner date" required>
                <Input
                  type="date"
                  value={form.arrival_date}
                  onChange={(e) => setForm({ ...form, arrival_date: e.target.value })}
                  required
                />
              </Field>
              <Field label="Time" hint="Used for the calendar event.">
                <Input
                  type="time"
                  value={form.event_time}
                  onChange={(e) => setForm({ ...form, event_time: e.target.value })}
                />
              </Field>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Arrival date" required>
                <Input
                  type="date"
                  value={form.arrival_date}
                  onChange={(e) => setForm({ ...form, arrival_date: e.target.value })}
                  required
                />
              </Field>
              <Field label="Departure date">
                <Input
                  type="date"
                  value={form.departure_date}
                  min={form.arrival_date}
                  onChange={(e) => setForm({ ...form, departure_date: e.target.value })}
                />
              </Field>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <Field label="Male guests" required>
              <Select
                value={form.male_count}
                onChange={(e) => setForm({ ...form, male_count: e.target.value })}
              >
                {Array.from({ length: 31 }, (_, i) => (
                  <option key={i} value={i}>
                    {i}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Female guests" required>
              <Select
                value={form.female_count}
                onChange={(e) => setForm({ ...form, female_count: e.target.value })}
              >
                {Array.from({ length: 31 }, (_, i) => (
                  <option key={i} value={i}>
                    {i}
                  </option>
                ))}
              </Select>
            </Field>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Relationship">
              <Input
                value={form.relationship}
                onChange={(e) => setForm({ ...form, relationship: e.target.value })}
                placeholder="Cousin, Uncle, Neighbour…"
              />
            </Field>
            <Field label="Contact phone">
              <Input
                type="tel"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="+966…"
              />
            </Field>
          </div>

          {!isDinnerForm && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Room assignment">
                <Input
                  value={form.room}
                  onChange={(e) => setForm({ ...form, room: e.target.value })}
                  placeholder="Guest Room 1"
                />
              </Field>
              <Field label="Coming from">
                <Input
                  value={form.origin_city}
                  onChange={(e) => setForm({ ...form, origin_city: e.target.value })}
                  placeholder="Lahore, Pakistan"
                />
              </Field>
            </div>
          )}

          <Field label="Dietary restrictions / special needs">
            <Textarea
              rows={3}
              value={form.special_needs}
              onChange={(e) => setForm({ ...form, special_needs: e.target.value })}
              placeholder="No spicy food, diabetic, allergies…"
            />
          </Field>

          <p className="rounded-xl bg-palm-50 px-4 py-3 text-xs leading-relaxed text-palm-800">
            On save this is added to the shared Google Calendar automatically —{' '}
            {isDinnerForm ? (
              <>
                a <strong>timed evening event</strong> with a reminder <strong>1 day before</strong>.
              </>
            ) : (
              <>
                an <strong>all-day event</strong> across the stay with a reminder{' '}
                <strong>3 days before arrival</strong>.
              </>
            )}
          </p>
        </form>
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        title="Remove guest"
        message={`Remove ${deleting?.name}? Their calendar event is deleted too. Menu items and tasks stay, but lose the link to this visit.`}
        confirmLabel="Remove"
        destructive
        busy={busyDelete}
        onCancel={() => setDeleting(null)}
        onConfirm={confirmDelete}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------

function GuestCard({
  guest,
  canDelete,
  onEdit,
  onDelete,
}: {
  guest: Guest
  canDelete: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  const isDinner = guest.guest_type === 'dinner'
  const days = daysFromToday(guest.arrival_date)
  const finished = isDinner
    ? (days ?? 0) < 0
    : guest.departure_date !== null && (daysFromToday(guest.departure_date) ?? 0) < 0
  const here = days !== null && days <= 0 && !finished

  const tone = finished ? 'gray' : here ? 'green' : days !== null && days <= 3 ? 'red' : 'blue'
  const accent = {
    red: 'bg-red-500',
    green: 'bg-emerald-500',
    blue: 'bg-sky-500',
    gray: 'bg-slate-300',
  }[tone]

  return (
    <Card accent={accent} className="flex flex-col p-5 pl-6">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-lg font-bold text-slate-800">{guest.name}</h3>
          <p className="text-xs text-slate-500">
            {guest.relationship || 'Guest'}
            {!isDinner && guest.origin_city ? ` · ${guest.origin_city}` : ''}
          </p>
        </div>
        <Badge tone={tone}>
          {finished
            ? isDinner
              ? 'Done'
              : 'Departed'
            : here
              ? isDinner
                ? 'Today'
                : 'Staying now'
              : countdown(guest.arrival_date)}
        </Badge>
      </div>

      <Badge tone={isDinner ? 'purple' : 'blue'} className="mb-3 self-start">
        {isDinner ? '🍽️ Dinner only' : '🏠 Staying with us'}
      </Badge>

      <div className="mb-3 grid grid-cols-3 gap-2 rounded-xl bg-sand-50 p-3 text-center">
        <div>
          <p className="text-lg font-extrabold text-slate-800">{guest.total_guests}</p>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Total</p>
        </div>
        <div>
          <p className="text-lg font-extrabold text-sky-700">{guest.male_count}</p>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Male</p>
        </div>
        <div>
          <p className="text-lg font-extrabold text-rose-700">{guest.female_count}</p>
          <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Female</p>
        </div>
      </div>

      <dl className="mb-3 space-y-1.5 text-sm">
        <div className="flex gap-2">
          <dt className="w-20 flex-none text-slate-500">{isDinner ? 'Dinner' : 'Arrives'}</dt>
          <dd className="font-semibold text-slate-700">
            {fmtDate(guest.arrival_date)}
            {isDinner && guest.event_time ? ` · ${guest.event_time.slice(0, 5)}` : ''}
          </dd>
        </div>
        {!isDinner && (
          <div className="flex gap-2">
            <dt className="w-20 flex-none text-slate-500">Departs</dt>
            <dd className="font-semibold text-slate-700">{fmtDate(guest.departure_date)}</dd>
          </div>
        )}
        {!isDinner && guest.room && (
          <div className="flex gap-2">
            <dt className="w-20 flex-none text-slate-500">Room</dt>
            <dd className="font-semibold text-slate-700">{guest.room}</dd>
          </div>
        )}
        {guest.phone && (
          <div className="flex gap-2">
            <dt className="w-20 flex-none text-slate-500">Phone</dt>
            <dd>
              <a href={`tel:${guest.phone}`} className="font-semibold text-palm-700 hover:underline">
                {guest.phone}
              </a>
            </dd>
          </div>
        )}
      </dl>

      {guest.special_needs && (
        <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
          <span className="font-bold">⚠ Special needs: </span>
          {guest.special_needs}
        </p>
      )}

      <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-sand-100 pt-3">
        {guest.google_calendar_html_link ? (
          <a
            href={guest.google_calendar_html_link}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 transition hover:bg-emerald-100"
          >
            ✓ In Google Calendar
          </a>
        ) : (
          <a
            href={googleCalendarUrl(guest)}
            target="_blank"
            rel="noreferrer"
            className="rounded-lg bg-sand-100 px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-sand-200"
          >
            📅 Add to Calendar
          </a>
        )}
        <button
          onClick={() => downloadIcs(guest)}
          className="rounded-lg bg-sand-100 px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-sand-200"
          title="Download an .ics file with the reminder"
        >
          ⬇ .ics
        </button>
        <button
          onClick={(event) => {
            event.stopPropagation()
            shareToWhatsApp(guestMessage(guest))
          }}
          className="rounded-lg bg-sand-100 px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-sand-200"
          title="Open WhatsApp with these details ready to send"
        >
          💬 Share
        </button>
        <button
          onClick={onEdit}
          className="rounded-lg bg-sand-100 px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-sand-200"
        >
          ✏ Edit
        </button>
        {canDelete && (
          <button
            onClick={onDelete}
            className="rounded-lg px-3 py-1.5 text-xs font-bold text-red-600 transition hover:bg-red-50"
          >
            Remove
          </button>
        )}
        {guest.creator?.name && (
          <span className="ml-auto flex items-center gap-1.5 text-[10px] text-slate-400">
            <Avatar name={guest.creator.name} size="sm" />
            added
          </span>
        )}
      </div>
    </Card>
  )
}
