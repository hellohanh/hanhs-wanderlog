import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import type { Trip } from '../types'
import MapView from '../components/MapView'
import ItineraryView from '../components/ItineraryView'
import styles from './TripView.module.css'

type Tab = 'map' | 'itinerary'

const TABS: { key: Tab; label: string }[] = [
  { key: 'map', label: 'map' },
  { key: 'itinerary', label: 'itinerary' }
]

export default function TripView() {
  const { tripId } = useParams()
  const [activeTab, setActiveTab] = useState<Tab>('map')
  const [trip, setTrip] = useState<Trip | null>(null)
  const [showShare, setShowShare] = useState(false)
  const [copied, setCopied] = useState(false)

  const [showEdit, setShowEdit] = useState(false)
  const [editName, setEditName] = useState('')
  const [editDestination, setEditDestination] = useState('')
  const [editStart, setEditStart] = useState('')
  const [editEnd, setEditEnd] = useState('')
  const [savingEdit, setSavingEdit] = useState(false)

  useEffect(() => {
    if (!tripId) return
    loadTrip(tripId)
  }, [tripId])

  async function loadTrip(id: string) {
    const { data, error } = await supabase.from('trips').select('*').eq('id', id).single()
    if (error) {
      console.error('Failed to load trip', error)
      return
    }
    setTrip(data)
  }

  function openEdit() {
    if (!trip) return
    setEditName(trip.name)
    setEditDestination(trip.destination)
    setEditStart(trip.start_date ?? '')
    setEditEnd(trip.end_date ?? '')
    setShowShare(false)
    setShowEdit(true)
  }

  async function saveEdit() {
    if (!tripId || !editName.trim() || !editDestination.trim()) return
    setSavingEdit(true)
    const { error } = await supabase
      .from('trips')
      .update({
        name: editName.trim(),
        destination: editDestination.trim(),
        start_date: editStart || null,
        end_date: editEnd || null
      })
      .eq('id', tripId)

    setSavingEdit(false)
    if (error) {
      console.error('Failed to update trip', error)
      return
    }
    setShowEdit(false)
    loadTrip(tripId)
  }

  function inviteLink() {
    if (!trip) return ''
    return `${window.location.origin}${import.meta.env.BASE_URL}join/${trip.invite_token}`
  }

  async function copyLink() {
    await navigator.clipboard.writeText(inviteLink())
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  if (!tripId) return null

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <Link to="/" className={styles.backLink}>← trips</Link>
        <div className={styles.headerRight}>
          <p className={styles.tripName}>{trip?.destination ?? '…'}</p>
          <button className={styles.shareButton} onClick={openEdit}>
            edit
          </button>
          <button
            className={styles.shareButton}
            onClick={() => {
              setShowEdit(false)
              setShowShare(s => !s)
            }}
          >
            share
          </button>
        </div>
      </header>

      {trip && (
        <p className={styles.tripMeta}>
          {trip.name} · {trip.start_date ?? 'no start date'} – {trip.end_date ?? 'no end date'}
        </p>
      )}

      {showShare && trip && (
        <div className={styles.shareBox}>
          <input readOnly value={inviteLink()} onFocus={e => e.target.select()} />
          <button onClick={copyLink}>{copied ? 'copied' : 'copy'}</button>
        </div>
      )}

      {showEdit && trip && (
        <div className={styles.editBox}>
          <input
            placeholder="trip name"
            value={editName}
            onChange={e => setEditName(e.target.value)}
          />
          <input
            placeholder="destination"
            value={editDestination}
            onChange={e => setEditDestination(e.target.value)}
          />
          <input type="date" value={editStart} onChange={e => setEditStart(e.target.value)} />
          <input type="date" value={editEnd} onChange={e => setEditEnd(e.target.value)} />
          <div className={styles.editActions}>
            <button
              onClick={saveEdit}
              disabled={savingEdit || !editName.trim() || !editDestination.trim()}
            >
              {savingEdit ? 'saving…' : 'save'}
            </button>
            <button onClick={() => setShowEdit(false)}>cancel</button>
          </div>
        </div>
      )}

      <nav className={styles.tabs}>
        {TABS.map(tab => (
          <button
            key={tab.key}
            className={`${styles.tab} ${activeTab === tab.key ? styles.tabActive : ''}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      <div className={styles.content}>
        {activeTab === 'map' && <MapView tripId={tripId} />}
        {activeTab === 'itinerary' && trip && <ItineraryView tripId={tripId} trip={trip} />}
      </div>
    </div>
  )
}
