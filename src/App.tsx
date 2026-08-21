import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './context/AuthContext'
import { Layout } from './components/Layout'
import { Spinner } from './components/ui'
import { LoginPage } from './pages/Login'
import { DashboardPage } from './pages/Dashboard'
import { GuestsPage } from './pages/Guests'
import { MenuPage } from './pages/Menu'
import { TasksPage } from './pages/Tasks'
import { ShoppingPage } from './pages/Shopping'
import { NotificationsPage } from './pages/Notifications'
import { ActivityPage } from './pages/Activity'
import { SettingsPage } from './pages/Settings'
import type { ReactNode } from 'react'
import type { UserRole } from './lib/types'

/** Blocks a route when the signed-in role is not allowed to see it. */
function RequireRole({ roles, children }: { roles: UserRole[]; children: ReactNode }) {
  const { profile } = useAuth()
  if (!profile) return null
  if (!roles.includes(profile.role)) {
    // The driver's home is the shopping list; everyone else lands on the dashboard.
    return <Navigate to={profile.role === 'driver' ? '/shopping' : '/'} replace />
  }
  return <>{children}</>
}

export function App() {
  const { session, profile, loading } = useAuth()

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label="Starting up" />
      </div>
    )
  }

  if (!session) return <LoginPage />

  // Signed in, but the profile row has not arrived yet.
  if (!profile) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Spinner label="Loading your profile" />
      </div>
    )
  }

  const family: UserRole[] = ['head', 'member']

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route
          index
          element={
            profile.role === 'driver' ? <Navigate to="/shopping" replace /> : <DashboardPage />
          }
        />
        <Route
          path="guests"
          element={
            <RequireRole roles={family}>
              <GuestsPage />
            </RequireRole>
          }
        />
        <Route
          path="menu"
          element={
            <RequireRole roles={family}>
              <MenuPage />
            </RequireRole>
          }
        />
        <Route
          path="tasks"
          element={
            <RequireRole roles={family}>
              <TasksPage />
            </RequireRole>
          }
        />
        <Route path="shopping" element={<ShoppingPage />} />
        <Route
          path="activity"
          element={
            <RequireRole roles={family}>
              <ActivityPage />
            </RequireRole>
          }
        />
        <Route path="notifications" element={<NotificationsPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
