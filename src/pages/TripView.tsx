import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import type { Trip } from '../types'
import MapView from '../components/MapView'
import styles from './TripView.module.css'

type Tab = 'map' | 'itinerary' | 'budget' | 'packing' | 'notes'

const TABS: { key: Tab; label: string }[] = [
  { key: 'map', label: 'map' },
  { key: 'itinerary', label: 'itinerary' },
  { key: 'budget', label: 'budget' },
  { key: 'packing', label: 'packing' },
  { key: 'notes', label: 'notes' }
]

export default function TripView() {
  const { tripId } = useParams()
  const [activeTab, setActiveTab] = useState<Tab>('map')
  const [trip, setTrip] = useState<Trip | null>(null)
  const [showShare, setShowShare] = useState(false)
  const [copied, setCopied] = useState(false)

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
          <button className={styles.shareButton} onClick={() => setShowShare(s => !s)}>
            share
          </button>
        </div>
      </header>

      {showShare && trip && (
        <div className={styles.shareBox}>
          <input readOnly value={inviteLink()} onFocus={e => e.target.select()} />
          <button onClick={copyLink}>{copied ? 'copied' : 'copy'}</button>
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
        {activeTab === 'itinerary' && (
          <p className={styles.placeholder}>itinerary builder — coming soon</p>
        )}
        {activeTab === 'budget' && (
          <p className={styles.placeholder}>budget tracking — coming soon</p>
        )}
        {activeTab === 'packing' && (
          <p className={styles.placeholder}>packing list — coming soon</p>
        )}
        {activeTab === 'notes' && (
          <p className={styles.placeholder}>notes — coming soon</p>
        )}
      </div>
    </div>
  )
}
