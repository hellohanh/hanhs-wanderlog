import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/AuthContext'
import styles from './JoinTrip.module.css'

export default function JoinTrip() {
  const { token } = useParams()
  const { session, loading } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [joining, setJoining] = useState(false)

  useEffect(() => {
    if (!loading && session && token) {
      joinTrip()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, session, token])

  async function sendMagicLink() {
    setError(null)
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.href }
    })
    if (error) {
      setError(error.message)
      return
    }
    setSent(true)
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
        <p className={styles.hint}>sign in to join this trip</p>
        {sent ? (
          <p className={styles.hint}>check your email for a login link</p>
        ) : (
          <>
            <input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
            />
            <button className={styles.sendButton} onClick={sendMagicLink}>
              send magic link
            </button>
            {error && <p className={styles.error}>{error}</p>}
          </>
        )}
      </div>
    </div>
  )
}
