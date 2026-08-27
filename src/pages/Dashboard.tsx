import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import type { Trip } from '../types'
import styles from './Dashboard.module.css'

async function handleSignOut() {
  await supabase.auth.signOut()
}

const COPY_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>`
const TRASH_ICON = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>`

// date + days -> "YYYY-MM-DD", used to shift every itinerary day and
// travel-leg date by the same delta when copying a trip.
function addDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00`)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

export default function Dashboard() {
  const [trips, setTrips] = useState<Trip[]>([])
  const [loading, setLoading] = useState(true)
  const [showNewTripForm, setShowNewTripForm] = useState(false)
  const [newTripName, setNewTripName] = useState('')
  const [newTripDestination, setNewTripDestination] = useState('')
  const [newTripStart, setNewTripStart] = useState('')
  const [newTripEnd, setNewTripEnd] = useState('')
  const [copyingTrip, setCopyingTrip] = useState<Trip | null>(null)
  const [copyName, setCopyName] = useState('')
  const [copyStart, setCopyStart] = useState('')
  const [copyEnd, setCopyEnd] = useState('')
  const [copyBusy, setCopyBusy] = useState(false)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [deletingTrip, setDeletingTrip] = useState<Trip | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    loadTrips()
    supabase.auth.getUser().then(({ data }) => setCurrentUserId(data.user?.id ?? null))
  }, [])

  async function loadTrips() {
    setLoading(true)
    const { data, error } = await supabase
      .from('trips')
      .select('*')
      .order('start_date', { ascending: true })

    if (error) {
      console.error('Failed to load trips', error)
    } else {
      setTrips(data ?? [])
    }
    setLoading(false)
  }

  async function createTrip() {
    if (!newTripName.trim() || !newTripDestination.trim()) return

    const { data: userData } = await supabase.auth.getUser()
    const ownerId = userData.user?.id

    const { error } = await supabase.from('trips').insert({
      name: newTripName,
      destination: newTripDestination,
      start_date: newTripStart || null,
      end_date: newTripEnd || null,
      owner_id: ownerId
    })

    if (error) {
      console.error('Failed to create trip', error)
      return
    }

    setNewTripName('')
    setNewTripDestination('')
    setNewTripStart('')
    setNewTripEnd('')
    setShowNewTripForm(false)
    loadTrips()
  }

  function startCopy(trip: Trip, e: React.MouseEvent) {
    e.stopPropagation()
    setCopyingTrip(trip)
    setCopyName(`${trip.name} (Copy)`)
    setCopyStart('')
    setCopyEnd('')
  }

  // Deep-copies a trip: pins, itinerary days, stops, and travel legs —
  // not trip members, per the user's explicit choice (the copy starts
  // with just them; re-inviting people is a separate step). Runs as a
  // sequence of client-side inserts (matching this app's existing
  // pattern — no custom Postgres function elsewhere either), so a
  // failure partway through can leave a partial copy; the new trip is
  // still visible/deletable from the dashboard either way, nothing is
  // silently lost from the ORIGINAL trip regardless of how this goes.
  async function confirmCopy() {
    if (!copyingTrip) return
    setCopyBusy(true)
    try {
      const { data: userData } = await supabase.auth.getUser()
      const ownerId = userData.user?.id

      // Only shift dates if the ORIGINAL trip has a start_date to
      // measure the delta from, AND the user gave the copy a new start
      // date — otherwise dates copy through unchanged (or stay unset).
      const deltaDays =
        copyingTrip.start_date && copyStart
          ? Math.round(
              (new Date(`${copyStart}T00:00:00`).getTime() -
                new Date(`${copyingTrip.start_date}T00:00:00`).getTime()) /
                86400000
            )
          : null
      const shiftDate = (d: string | null): string | null => (d && deltaDays != null ? addDays(d, deltaDays) : d)

      const { data: newTrip, error: tripError } = await supabase
        .from('trips')
        .insert({
          name: copyName.trim() || `${copyingTrip.name} (Copy)`,
          destination: copyingTrip.destination,
          start_date: copyStart || null,
          end_date: copyEnd || null,
          owner_id: ownerId
        })
        .select()
        .single()
      if (tripError || !newTrip) throw tripError ?? new Error('No trip returned')

      const { data: oldPins } = await supabase.from('pins').select('*').eq('trip_id', copyingTrip.id)
      const pinIdMap = new Map<string, string>()
      if (oldPins && oldPins.length > 0) {
        const { data: newPins, error: pinsError } = await supabase
          .from('pins')
          .insert(
            oldPins.map(p => ({
              trip_id: newTrip.id,
              name: p.name,
              category: p.category,
              lat: p.lat,
              lng: p.lng,
              notes: p.notes,
              place_id: p.place_id,
              icon: p.icon,
              added_by: ownerId
            }))
          )
          .select()
        if (pinsError) throw pinsError
        oldPins.forEach((op, i) => pinIdMap.set(op.id, newPins![i].id))
      }

      const { data: oldDays } = await supabase
        .from('itinerary_days')
        .select('*')
        .eq('trip_id', copyingTrip.id)
        .order('day_number')
      if (oldDays && oldDays.length > 0) {
        const { data: newDays, error: daysError } = await supabase
          .from('itinerary_days')
          .insert(oldDays.map(d => ({ trip_id: newTrip.id, day_number: d.day_number, date: shiftDate(d.date) })))
          .select()
        if (daysError) throw daysError
        const dayIdMap = new Map<string, string>()
        oldDays.forEach((od, i) => dayIdMap.set(od.id, newDays![i].id))
        const oldDayIds = oldDays.map(d => d.id)

        const { data: oldStops } = await supabase.from('itinerary_stops').select('*').in('itinerary_day_id', oldDayIds)
        const stopsPayload = (oldStops ?? [])
          .filter(s => dayIdMap.has(s.itinerary_day_id) && pinIdMap.has(s.pin_id))
          .map(s => ({
            itinerary_day_id: dayIdMap.get(s.itinerary_day_id)!,
            pin_id: pinIdMap.get(s.pin_id)!,
            order_index: s.order_index,
            start_time: s.start_time,
            end_time: s.end_time
          }))
        if (stopsPayload.length > 0) {
          const { error: stopsError } = await supabase.from('itinerary_stops').insert(stopsPayload)
          if (stopsError) throw stopsError
        }

        const { data: oldLegs } = await supabase.from('travel_legs').select('*').in('itinerary_day_id', oldDayIds)
        const legsPayload = (oldLegs ?? [])
          .filter(l => dayIdMap.has(l.itinerary_day_id))
          .map(l => ({
            itinerary_day_id: dayIdMap.get(l.itinerary_day_id)!,
            mode: l.mode,
            carrier: l.carrier,
            reference: l.reference,
            title: l.title,
            from_location: l.from_location,
            from_date: shiftDate(l.from_date),
            from_time: l.from_time,
            from_timezone: l.from_timezone,
            to_location: l.to_location,
            to_date: shiftDate(l.to_date),
            to_time: l.to_time,
            to_timezone: l.to_timezone,
            order_index: l.order_index
          }))
        if (legsPayload.length > 0) {
          const { error: legsError } = await supabase.from('travel_legs').insert(legsPayload)
          if (legsError) throw legsError
        }
      }

      setCopyingTrip(null)
      navigate(`/trip/${newTrip.id}`)
    } catch (err) {
      console.error('Failed to copy trip', err)
    } finally {
      setCopyBusy(false)
    }
  }

  function startDeleteTrip(trip: Trip, e: React.MouseEvent) {
    e.stopPropagation()
    setDeletingTrip(trip)
  }

  // Owner-only at the RLS level too (migration 011) — this delete
  // relies entirely on the schema's on-delete-cascade FKs (pins,
  // itinerary_days, and everything under a day all cascade from
  // trips), so one delete here is enough; no manual multi-table
  // cleanup needed the way copyTrip needed manual multi-table inserts.
  async function confirmDeleteTrip() {
    if (!deletingTrip) return
    setDeleteBusy(true)
    const { error } = await supabase.from('trips').delete().eq('id', deletingTrip.id)
    setDeleteBusy(false)
    if (error) {
      console.error('Failed to delete trip', error)
      return
    }
    setDeletingTrip(null)
    loadTrips()
  }

  const today = new Date().toISOString().slice(0, 10)
  const upcoming = trips.filter(t => !t.end_date || t.end_date >= today)
  const past = trips.filter(t => t.end_date && t.end_date < today)

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.brand}>
          <span className={styles.brandIcon}>🧭</span>
          <span className={styles.brandName}>Hanh's Wanderlog</span>
        </div>
        <div className={styles.headerActions}>
          <button className={styles.newTripButton} onClick={() => setShowNewTripForm(true)}>
            + new trip
          </button>
          <button className={styles.signOutButton} onClick={handleSignOut}>
            sign out
          </button>
        </div>
      </header>

      {showNewTripForm && (
        <div className={styles.newTripForm}>
          <input
            placeholder="trip name"
            value={newTripName}
            onChange={e => setNewTripName(e.target.value)}
          />
          <input
            placeholder="destination"
            value={newTripDestination}
            onChange={e => setNewTripDestination(e.target.value)}
          />
          <input
            type="date"
            value={newTripStart}
            onChange={e => setNewTripStart(e.target.value)}
          />
          <input
            type="date"
            value={newTripEnd}
            onChange={e => setNewTripEnd(e.target.value)}
          />
          <div className={styles.formActions}>
            <button onClick={createTrip}>create</button>
            <button onClick={() => setShowNewTripForm(false)}>cancel</button>
          </div>
        </div>
      )}

      {copyingTrip && (
        <div className={styles.newTripForm} onClick={e => e.stopPropagation()}>
          <input placeholder="new trip name" value={copyName} onChange={e => setCopyName(e.target.value)} />
          <input type="date" value={copyStart} onChange={e => setCopyStart(e.target.value)} />
          <input type="date" value={copyEnd} onChange={e => setCopyEnd(e.target.value)} />
          <div className={styles.formActions}>
            <button onClick={confirmCopy} disabled={copyBusy}>
              {copyBusy ? 'copying…' : 'copy'}
            </button>
            <button onClick={() => setCopyingTrip(null)} disabled={copyBusy}>
              cancel
            </button>
          </div>
        </div>
      )}

      {deletingTrip && (
        <div className={styles.newTripForm} onClick={e => e.stopPropagation()}>
          <p className={styles.deleteWarning}>
            Delete "{deletingTrip.name}" and everything in it — pins, itinerary, flights? This can't be undone.
          </p>
          <div className={styles.formActions}>
            <button className={styles.deleteConfirmButton} onClick={confirmDeleteTrip} disabled={deleteBusy}>
              {deleteBusy ? 'deleting…' : 'yes, delete it'}
            </button>
            <button onClick={() => setDeletingTrip(null)} disabled={deleteBusy}>
              cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className={styles.muted}>loading trips…</p>
      ) : (
        <>
          <section>
            <p className={styles.sectionLabel}>upcoming</p>
            <div className={styles.grid}>
              {upcoming.map(trip => (
                <div
                  key={trip.id}
                  className={styles.card}
                  onClick={() => navigate(`/trip/${trip.id}`)}
                >
                  <div className={styles.cardActions}>
                    <button
                      type="button"
                      className={styles.cardIconButton}
                      title="copy trip"
                      aria-label="copy trip"
                      onClick={e => startCopy(trip, e)}
                      dangerouslySetInnerHTML={{ __html: COPY_ICON }}
                    />
                    {trip.owner_id === currentUserId && (
                      <button
                        type="button"
                        className={`${styles.cardIconButton} ${styles.cardIconButtonDanger}`}
                        title="delete trip"
                        aria-label="delete trip"
                        onClick={e => startDeleteTrip(trip, e)}
                        dangerouslySetInnerHTML={{ __html: TRASH_ICON }}
                      />
                    )}
                  </div>
                  <div className={styles.cardThumb}>🗺️</div>
                  <p className={styles.cardTitle}>{trip.destination}</p>
                  <p className={styles.cardDates}>
                    {trip.start_date ?? '?'} – {trip.end_date ?? '?'}
                  </p>
                </div>
              ))}
              {upcoming.length === 0 && (
                <p className={styles.muted}>no upcoming trips yet</p>
              )}
            </div>
          </section>

          {past.length > 0 && (
            <section>
              <p className={styles.sectionLabel}>past</p>
              <div className={styles.grid}>
                {past.map(trip => (
                  <div
                    key={trip.id}
                    className={`${styles.card} ${styles.cardPast}`}
                    onClick={() => navigate(`/trip/${trip.id}`)}
                  >
                    <div className={styles.cardActions}>
                      <button
                        type="button"
                        className={styles.cardIconButton}
                        title="copy trip"
                        aria-label="copy trip"
                        onClick={e => startCopy(trip, e)}
                        dangerouslySetInnerHTML={{ __html: COPY_ICON }}
                      />
                      {trip.owner_id === currentUserId && (
                        <button
                          type="button"
                          className={`${styles.cardIconButton} ${styles.cardIconButtonDanger}`}
                          title="delete trip"
                          aria-label="delete trip"
                          onClick={e => startDeleteTrip(trip, e)}
                          dangerouslySetInnerHTML={{ __html: TRASH_ICON }}
                        />
                      )}
                    </div>
                    <div className={styles.cardThumb}>🗺️</div>
                    <p className={styles.cardTitle}>{trip.destination}</p>
                    <p className={styles.cardDates}>
                      {trip.start_date ?? '?'} – {trip.end_date ?? '?'}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
