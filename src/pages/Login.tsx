import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { supabase } from '../lib/supabaseClient'
import { useAuth } from '../lib/AuthContext'
import styles from './Login.module.css'

export default function Login() {
  const { session } = useAuth()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (session) {
    return <Navigate to="/" replace />
  }

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

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <p className={styles.brand}>🧭 Hanh's Wanderlog</p>
        {sent ? (
          <p className={styles.hint}>check your email for a login link</p>
        ) : (
          <>
            <p className={styles.hint}>enter your email to sign in</p>
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
