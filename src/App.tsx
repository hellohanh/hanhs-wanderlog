import { Routes, Route } from 'react-router-dom'
import { AuthProvider } from './lib/AuthContext'
import RequireAuth from './components/RequireAuth'
import Dashboard from './pages/Dashboard'
import TripView from './pages/TripView'
import Login from './pages/Login'
import JoinTrip from './pages/JoinTrip'

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/join/:token" element={<JoinTrip />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <Dashboard />
            </RequireAuth>
          }
        />
        <Route
          path="/trip/:tripId"
          element={
            <RequireAuth>
              <TripView />
            </RequireAuth>
          }
        />
      </Routes>
    </AuthProvider>
  )
}
