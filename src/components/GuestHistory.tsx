import { useEffect, useMemo, useState } from 'react'
import { supabase, errorMessage } from '../lib/supabase'
import { useToast } from '../context/ToastContext'
import { useReload } from '../lib/hooks'
import { fmtDate } from '../lib/format'
import { Badge, Button, Card, EmptyState, Field, Modal, SearchBar, Spinner, Textarea } from './ui'
import type { GuestProfile, GuestVisit } from '../lib/types'

/**
 * Who has visited, how often, and what we have learned about them.
 *
 * Profiles are derived from the visits themselves — the only field a person
 * curates is `notes`, which is why the sync never touches it.
 */
export function GuestHistory() {
  const toast = useToast()
  const [tick, reload] = useReload()

  const [profiles, setProfiles] = useState<GuestProfile[]>([])
  const [visits, setVisits] = useState<GuestVisit[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const [editing, setEditing] = useState<GuestProfile | null>(null)
  const [noteDraft, setNoteDraft] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let active = true
    setLoading(true)
    Promise.all([
      supabase.from('guest_profiles').select('*').order('last_visit', { ascending: false }),
      supabase.from('guest_visits').select('*').order('arrival_date', { ascending: false }),
    ]).then(([p, v]) => {
      if (!active) return
      if (p.error) toast.error(errorMessage(p.error))
      setProfiles((p.data ?? []) as unknown as GuestProfile[])
      setVisits((v.data ?? []) as unknown as GuestVisit[])
      setLoading(false)
    })
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick])

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return profiles
    return profiles.filter((p) =>
      [p.display_name, p.relationship, p.notes, p.origin_city]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(term)),
    )
  }, [profiles, search])

  const visitsFor = (norm: string) => visits.filter((v) => v.normalized_name === norm)

  const saveNotes = async () => {
    if (!editing) return
    setSaving(true)
    const { error } = await supabase
      .from('guest_profiles')
      .update({ notes: noteDraft.trim() || null })
      .eq('id', editing.id)
    setSaving(false)
    if (error) {
      toast.error(errorMessage(error))
      return
    }
    setEditing(null)
    toast.success('Saved. This will be remembered for their next visit.')
    reload()
  }

  if (loading) return <Spinner label="Loading history" />

  return (
    <div>
      <div className="mb-4">
        <SearchBar value={search} onChange={setSearch} placeholder="Search past guests…" />
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon="📖"
          title={search ? 'No match' : 'No guest history yet'}
          description={
            search
              ? 'Nobody matches that search.'
              : 'Once you record a visit, the guest appears here with their history and preferences.'
          }
        />
      ) : (
        <div className="space-y-3">
          {visible.map((profile) => {
            const own = visitsFor(profile.normalized_name)
            const open = expanded === profile.id
            const repeat = profile.visit_count > 1

            return (
              <Card key={profile.id} accent={repeat ? 'bg-violet-500' : 'bg-sky-500'} className="p-4 pl-5">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-bold text-slate-800">{profile.display_name}</h3>
                      {repeat && <Badge tone="purple">Repeat guest · {profile.visit_count}×</Badge>}
                    </div>
                    <p className="text-xs text-slate-500">
                      {profile.relationship || 'Guest'}
                      {profile.origin_city ? ` · ${profile.origin_city}` : ''}
                    </p>

                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
                      <span>
                        <strong>{profile.staying_count}</strong> stay
                        {profile.staying_count === 1 ? '' : 's'}
                      </span>
                      <span>
                        <strong>{profile.dinner_count}</strong> dinner
                        {profile.dinner_count === 1 ? '' : 's'}
                      </span>
                      {profile.total_nights > 0 && (
                        <span>
                          <strong>{profile.total_nights}</strong> night
                          {profile.total_nights === 1 ? '' : 's'} total
                        </span>
                      )}
                      <span>
                        Last: <strong>{fmtDate(profile.last_visit, 'dd MMM yyyy')}</strong>
                      </span>
                    </div>

                    {(profile.notes || profile.last_special_needs) && (
                      <div className="mt-2 space-y-1.5">
                        {profile.notes && (
                          <p className="rounded-xl bg-palm-50 px-3 py-2 text-xs leading-relaxed text-palm-900">
                            <span className="font-bold">📌 Remembered: </span>
                            {profile.notes}
                          </p>
                        )}
                        {profile.last_special_needs && (
                          <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
                            <span className="font-bold">⚠ Last visit: </span>
                            {profile.last_special_needs}
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => {
                        setEditing(profile)
                        setNoteDraft(profile.notes ?? '')
                      }}
                      className="rounded-lg bg-sand-100 px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-sand-200"
                    >
                      📌 Preferences
                    </button>
                    <button
                      onClick={() => setExpanded(open ? null : profile.id)}
                      className="rounded-lg bg-sand-100 px-3 py-1.5 text-xs font-bold text-slate-700 transition hover:bg-sand-200"
                    >
                      {open ? 'Hide visits' : `${own.length} visit${own.length === 1 ? '' : 's'}`}
                    </button>
                  </div>
                </div>

                {open && (
                  <ul className="mt-3 divide-y divide-sand-100 border-t border-sand-100 pt-1">
                    {own.map((visit) => (
                      <li key={visit.id} className="flex flex-wrap items-center gap-2 py-2 text-xs">
                        <Badge tone={visit.guest_type === 'dinner' ? 'purple' : 'blue'}>
                          {visit.guest_type === 'dinner' ? '🍽️ Dinner' : '🏠 Stay'}
                        </Badge>
                        <span className="font-semibold text-slate-700">
                          {fmtDate(visit.arrival_date, 'dd MMM yyyy')}
                          {visit.departure_date
                            ? ` → ${fmtDate(visit.departure_date, 'dd MMM')}`
                            : ''}
                          {visit.event_time ? ` · ${visit.event_time.slice(0, 5)}` : ''}
                        </span>
                        <span className="text-slate-500">
                          {visit.total_guests} guest{visit.total_guests === 1 ? '' : 's'} (
                          {visit.male_count}M / {visit.female_count}F)
                        </span>
                        {visit.nights !== null && (
                          <span className="text-slate-400">{visit.nights} nights</span>
                        )}
                        {visit.room && <span className="text-slate-400">· {visit.room}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            )
          })}
        </div>
      )}

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={`Preferences for ${editing?.display_name ?? ''}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setEditing(null)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void saveNotes()} loading={saving}>
              Save
            </Button>
          </>
        }
      >
        <Field
          label="What should we remember?"
          hint="Shown every time they visit. Kept even when old visits are deleted."
        >
          <Textarea
            rows={4}
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            placeholder="Prefers the ground floor room. No chilli. Always brings the children."
          />
        </Field>

        {editing?.last_special_needs && (
          <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-900">
            <span className="font-bold">From their last visit: </span>
            {editing.last_special_needs}
          </p>
        )}
      </Modal>
    </div>
  )
}
