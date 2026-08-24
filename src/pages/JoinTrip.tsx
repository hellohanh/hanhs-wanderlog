import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/AuthContext'
import styles from './JoinTrip.module.css'

export default function JoinTrip() {
  const { token } = useParams()
  const { session, loading } = useAuth()
  const navigate = useNavigate()
  const [error, setError] = useState<string | null>(null)
  const [joining, setJoining] = useState(false)

  useEffect(() => {
    if (!loading && session && token) {
      joinTrip()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, session, token])

  // No email step (E17 update): joining a shared trip link now signs the
  // person in anonymously via Supabase Auth — a real auth.uid() with no
  // email required. RLS policies and GRANTs are unaffected since
  // anonymous sessions still carry the `authenticated` role.
  async function joinAnonymously() {
    setError(null)
    setJoining(true)
    const { error } = await supabase.auth.signInAnonymously()
    if (error) {
      setError(error.message)
      setJoining(false)
      return
    }
    // session becomes truthy → the effect above fires joinTrip()
  }

  async function joinTrip() {
    setJoining(true)
    const { data, error } = await supabase.rpc('join_trip_via_invite', { _token: token })
    if (error) {
      setError(error.message)
      setJoining(false)
      return
    }
    navigate(`/trip/${data}`)
  }

  if (loading || joining || session) {
    return <p className={styles.hint}>joining trip…</p>
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <p className={styles.brand}>🧭 Hanh's Wanderlog</p>
        <p className={styles.hint}>you've been invited to a trip</p>
        <button className={styles.sendButton} onClick={joinAnonymously}>
          join trip
        </button>
        {error && <p className={styles.error}>{error}</p>}
      </div>
    </div>
  )
}
