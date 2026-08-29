import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/AuthContext'
import styles from './JoinTrip.module.css'

// Session 22 tried making email-linking REQUIRED before a joined member
// could enter the trip, to protect against anonymous sessions being
// lost (E63). Real-world testing the same night (Session 23) showed
// that trade was wrong in practice: Supabase's default built-in email
// service caps at 2 emails/hour, shared across every auth email in the
// whole project — meaning a single family member joining could exhaust
// it and leave later joins/logins broken with no clear symptom (looked
// like a code bug, wasn't). Reverted back to the simple, original
// design (E17): clicking the invite link signs someone in anonymously
// and joins the trip immediately, with no email dependency in the
// critical path at all. See E64/L33 in SKILL.md for the full story.
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

  async function joinAnonymously() {
    setError(null)
    setJoining(true)
    const { error } = await supabase.auth.signInAnonymously()
    if (error) {
      setError(error.message)
      setJoining(false)
    }
    // session becomes truthy on success → the effect above fires
    // joinTrip() automatically.
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

  if (loading || joining) {
    return <p className={styles.hint}>joining trip…</p>
  }

  if (!session) {
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

  return <p className={styles.hint}>joining trip…</p>
}
