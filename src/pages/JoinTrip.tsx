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
  const [email, setEmail] = useState('')
  const [sendingEmail, setSendingEmail] = useState(false)
  const [emailSent, setEmailSent] = useState(false)

  const isAnonymous = session?.user?.is_anonymous ?? false
  // "Linked" means a real, permanent identity — a brand-new anonymous
  // join isn't linked yet; an existing signed-in owner/member (who
  // came from Login.tsx's magic link, never anonymous to begin with)
  // already is.
  const isLinked = !!session && !isAnonymous

  // Only fires join_trip_via_invite once the session is linked (see
  // E63/L32 in SKILL.md) — a fresh anonymous sign-in stops on the
  // "add your email" step below instead of entering the trip
  // immediately. join_trip_via_invite is idempotent (ON CONFLICT DO
  // NOTHING on trip_members), so this is safe to fire again if the
  // component re-renders after the email-confirmation redirect.
  useEffect(() => {
    if (!loading && session && token && isLinked) {
      joinTrip()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, session, token, isLinked])

  // No email step to START the join (E17): the "join trip" button
  // still signs the person in anonymously via Supabase Auth first —
  // a real auth.uid() with no email required up front. RLS policies
  // and GRANTs are unaffected since anonymous sessions still carry
  // the `authenticated` role.
  async function joinAnonymously() {
    setError(null)
    setJoining(true)
    const { error } = await supabase.auth.signInAnonymously()
    setJoining(false)
    if (error) {
      setError(error.message)
      return
    }
    // session becomes truthy but still anonymous → the "add your
    // email" screen below shows next, rather than entering the trip.
  }

  // Required step (Session 22, E63): a joined family member's access
  // lives ONLY in this browser's local storage while they're
  // anonymous — private browsing, storage eviction, or switching
  // between the installed home-screen icon and a regular browser tab
  // can all silently and permanently lock them out, with no way back
  // in (confirmed against Supabase's own anonymous-auth docs). Linking
  // a real email converts the SAME anonymous user into a permanent one
  // (same user id, same trip_members row once joined) without losing
  // anything, and gives them a real way back in if local storage is
  // ever lost. Requires "Allow manual linking" enabled in Supabase's
  // Auth settings (General configuration) — see the Stop Protocol
  // deployment reminder for this session.
  async function sendLinkEmail() {
    setError(null)
    setSendingEmail(true)
    const { error } = await supabase.auth.updateUser(
      { email },
      { emailRedirectTo: window.location.href }
    )
    setSendingEmail(false)
    if (error) {
      setError(error.message)
      return
    }
    setEmailSent(true)
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

  // Not signed in yet.
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

  // Signed in anonymously, email not sent yet — required before they
  // can enter the trip.
  if (isAnonymous && !emailSent) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <p className={styles.brand}>🧭 Hanh's Wanderlog</p>
          <p className={styles.hint}>add your email so you don't lose access to this trip later</p>
          <input
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
          />
          <button
            className={styles.sendButton}
            onClick={sendLinkEmail}
            disabled={sendingEmail || !email}
          >
            {sendingEmail ? '…' : 'continue'}
          </button>
          {error && <p className={styles.error}>{error}</p>}
        </div>
      </div>
    )
  }

  // Email sent — waiting for them to click the confirmation link,
  // which redirects back to this same page and completes the link
  // (session.user.is_anonymous flips to false, and the effect above
  // fires joinTrip()).
  if (isAnonymous && emailSent) {
    return (
      <div className={styles.page}>
        <div className={styles.card}>
          <p className={styles.brand}>🧭 Hanh's Wanderlog</p>
          <p className={styles.hint}>check your email — click the confirmation link to continue into the trip</p>
        </div>
      </div>
    )
  }

  return <p className={styles.hint}>joining trip…</p>
}
