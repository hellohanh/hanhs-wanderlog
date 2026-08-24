import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import type { Trip } from '../types'
import styles from './Dashboard.module.css'

async function handleSignOut() {
  await supabase.auth.signOut()
}

export default function Dashboard() {
  const [trips, setTrips] = useState<Trip[]>([])
  const [loading, setLoading] = useState(true)
  const [showNewTripForm, setShowNewTripForm] = useState(false)
  const [newTripName, setNewTripName] = useState('')
  const [newTripDestination, setNewTripDestination] = useState('')
  const [newTripStart, setNewTripStart] = useState('')
  const [newTripEnd, setNewTripEnd] = useState('')
  const navigate = useNavigate()

  useEffect(() => {
    loadTrips()
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
