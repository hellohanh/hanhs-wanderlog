import type { JSX } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../lib/AuthContext'

export default function RequireAuth({ children }: { children: JSX.Element }) {
  const { session, loading } = useAuth()

  if (loading) return <p style={{ padding: 16, fontSize: 14 }}>loading…</p>

  if (!session) {
    return <Navigate to="/login" replace />
  }

  return children
}
