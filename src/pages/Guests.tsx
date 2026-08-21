import { useEffect, useMemo, useState } from 'react'
import { supabase, errorMessage } from '../lib/supabase'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useReload } from '../lib/hooks'
import { countdown, daysFromToday, fmtDate, todayISO } from '../lib/format'
import { downloadIcs, googleCalendarUrl, syncGuestToGoogleCalendar } from '../lib/calendar'
import { downloadCsv } from '../lib/export'
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
import type { Guest } from '../lib/types'

type Filter = 'upcoming' | 'current' | 'past' | 'all'

const EMPTY = {
  name: '',
  arrival_date: todayISO(),
  departure_date: '',
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
  const [filter, setFilter] = useState<Filter>('upcoming')

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
        setGuests((data ?? []) as Guest[])
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
      const days = daysFromToday(guest.arrival_date) ?? 0
      const departed =
        guest.departure_date !== null && (daysFromToday(guest.departure_date) ?? 0) < 0

      if (filter === 'upcoming' && days < 0) return false
      if (filter === 'current' && !(days <= 0 && !departed)) return false
      if (filter === 'past' && !departed) return false

      if (!term) return true
      return [guest.name, guest.relationship, guest.room, guest.origin_city, guest.special_needs]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(term))
    })
  }, [guests, search, filter])

  const openCreate = () => {
    setEditing(null)
    setForm({ ...EMPTY })
    setFormOpen(true)
  }

  const openEdit = (guest: Guest) => {
    setEditing(guest)
    setForm({
      name: guest.name,
      arrival_date: guest.arrival_date,
      departure_date: guest.departure_date ?? '',
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

    if (male + female < 1) {
      toast.error('There has to be at least one guest.')
      return
    }
    if (form.departure_date && form.departure_date < form.arrival_date) {
      toast.error('Departure cannot be before arrival.')
      return
    }

    setSaving(true)
    const payload = {
      name: form.name.trim(),
      arrival_date: form.arrival_date,
      departure_date: form.departure_date || null,
      male_count: male,
      female_count: female,
      relationship: form.relationship.trim() || null,
      room: form.room.trim() || null,
      special_needs: form.special_needs.trim() || null,
      phone: form.phone.trim() || null,
      origin_city: form.origin_city.trim() || null,
    }

    try {
      if (editing) {
        const { error } = await supabase.from('guests').update(payload).eq('id', editing.id)
        if (error) throw error
        toast.success('Guest updated.')
        setFormOpen(false)
        reload()
        return
      }

      const { data, error } = await supabase
        .from('guests')
        .insert({ ...payload, created_by: profile?.id })
        .select()
        .single()
      if (error) throw error

      const guest = data as Guest
      setFormOpen(false)
      reload()
      toast.success(`${guest.name} added. The family has been notified.`)

      // Calendar sync is best effort and never blocks saving the guest.
      const result = await syncGuestToGoogleCalendar(guest)
      if (result.configured && result.eventId) {
        await supabase
          .from('guests')
          .update({
            google_calendar_event_id: result.eventId,
            google_calendar_html_link: result.htmlLink ?? null,
          })
          .eq('id', guest.id)
        reload()
        toast.success('Added to Google Calendar with a 3-day reminder.')
      } else {
        toast.toast('Google Calendar is not connected — use "Add to Calendar" on the guest card.')
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
    const { error } = await supabase.from('guests').delete().eq('id', deleting.id)
    setBusyDelete(false)
    if (error) {
      toast.error(errorMessage(error))
      return
    }
    setDeleting(null)
    toast.success('Guest removed.')
    reload()
  }

  const exportCsv = () => {
    downloadCsv(
      `guest-list-${todayISO()}.csv`,
      ['Name', 'Relationship', 'From', 'Arrival', 'Departure', 'Male', 'Female', 'Total', 'Room', 'Special needs', 'Phone'],
      visible.map((g) => [
        g.name,
        g.relationship ?? '',
        g.origin_city ?? '',
        g.arrival_date,
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

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-slate-800">Guests</h1>
          <p className="text-sm text-slate-500">
            {visible.length} visit{visible.length === 1 ? '' : 's'} · {totals.people} people (
            {totals.male} male, {totals.female} female)
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={exportCsv} disabled={visible.length === 0}>
            ⬇ Export
          </Button>
          <Button onClick={openCreate}>+ Add guest</Button>
        </div>
      </header>

      <div className="mb-5 flex flex-col gap-3 sm:flex-row">
        <SearchBar value={search} onChange={setSearch} placeholder="Search name, room, relationship…" />
        <div className="flex rounded-xl bg-sand-100 p-1">
          {(['upcoming', 'current', 'past', 'all'] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold capitalize transition sm:flex-none ${
                filter === f ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500'
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
          icon="🧳"
          title="No guests here"
          description={
            search ? 'Nothing matches your search.' : 'Add the first visit to get the family ready.'
          }
          action={<Button onClick={openCreate}>+ Add guest</Button>}
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

      {/* ----------------------------------------------------------- form */}
      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? 'Edit guest' : 'Add guest'}
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
          <Field label="Guest / family name" required>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              placeholder="Ali Ahmed Family"
            />
          </Field>

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
                placeholder="Cousin, Uncle, In-laws…"
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

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Room assignment">
              <Input
                value={form.room}
                onChange={(e) => setForm({ ...form, room: e.target.value })}
                placeholder="Guest Room 1"
              />
            </Field>
            <Field label="Contact phone">
              <Input
                type="tel"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="+92…"
              />
            </Field>
          </div>

          <Field label="Dietary restrictions / special needs">
            <Textarea
              rows={3}
              value={form.special_needs}
              onChange={(e) => setForm({ ...form, special_needs: e.target.value })}
              placeholder="No spicy food, ground floor room, diabetic…"
            />
          </Field>

          {!editing && (
            <p className="rounded-xl bg-palm-50 px-4 py-3 text-xs text-palm-800">
              On save, everyone in the family is notified and a calendar event is created with a
              reminder <strong>3 days before arrival</strong>.
            </p>
          )}
        </form>
      </Modal>

      <ConfirmDialog
        open={deleting !== null}
        title="Remove guest"
        message={`Remove ${deleting?.name}? Their menu items and tasks stay, but lose the link to this visit.`}
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
  const days = daysFromToday(guest.arrival_date)
  const departed = guest.departure_date !== null && (daysFromToday(guest.departure_date) ?? 0) < 0
  const staying = days !== null && days <= 0 && !departed

  const tone = departed ? 'gray' : staying ? 'green' : days !== null && days <= 3 ? 'red' : 'blue'
  const accent =
    tone === 'red'
      ? 'bg-red-500'
      : tone === 'green'
        ? 'bg-emerald-500'
        : tone === 'blue'
          ? 'bg-sky-500'
          : 'bg-slate-300'

  return (
    <Card accent={accent} className="flex flex-col p-5 pl-6">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-lg font-bold text-slate-800">{guest.name}</h3>
          <p className="text-xs text-slate-500">
            {guest.relationship || 'Guest'}
            {guest.origin_city ? ` · ${guest.origin_city}` : ''}
          </p>
        </div>
        <Badge tone={tone}>
          {departed ? 'Departed' : staying ? 'Staying now' : countdown(guest.arrival_date)}
        </Badge>
      </div>

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
          <dt className="w-20 flex-none text-slate-500">Arrives</dt>
          <dd className="font-semibold text-slate-700">{fmtDate(guest.arrival_date)}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-20 flex-none text-slate-500">Departs</dt>
          <dd className="font-semibold text-slate-700">{fmtDate(guest.departure_date)}</dd>
        </div>
        {guest.room && (
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
          title="Download an .ics file with a 3-day reminder"
        >
          ⬇ .ics
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
