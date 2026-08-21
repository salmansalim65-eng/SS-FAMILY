import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { NotificationBell } from './NotificationBell'
import { Avatar, Button } from './ui'
import type { UserRole } from '../lib/types'

interface NavItem {
  to: string
  label: string
  icon: string
  roles: UserRole[]
}

const NAV: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: '🏠', roles: ['head', 'member'] },
  { to: '/guests', label: 'Guests', icon: '🧳', roles: ['head', 'member'] },
  { to: '/menu', label: 'Menu', icon: '🍽️', roles: ['head', 'member'] },
  { to: '/tasks', label: 'Tasks', icon: '✅', roles: ['head', 'member'] },
  { to: '/shopping', label: 'Shopping', icon: '🛒', roles: ['head', 'member', 'driver'] },
  { to: '/activity', label: 'Activity', icon: '📜', roles: ['head', 'member'] },
]

const ROLE_LABEL: Record<UserRole, string> = {
  head: 'Head of Family',
  member: 'Family Member',
  driver: 'Driver',
}

export function Layout() {
  const { profile, signOut } = useAuth()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)

  const role = profile?.role ?? 'member'
  const items = NAV.filter((item) => item.roles.includes(role))

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${
      isActive ? 'bg-palm-600 text-white shadow-sm' : 'text-slate-600 hover:bg-sand-100'
    }`

  return (
    <div className="min-h-screen lg:flex">
      {/* ------------------------------------------------ desktop sidebar */}
      <aside className="no-print hidden w-64 flex-none border-r border-sand-200 bg-white lg:flex lg:flex-col">
        <div className="flex items-center gap-2.5 px-5 py-5">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-palm-600 text-xl text-white">
            🏡
          </span>
          <div className="leading-tight">
            <p className="font-extrabold text-slate-800">SS Family</p>
            <p className="text-[11px] font-medium text-slate-500">Guest &amp; Event Planner</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-3">
          {items.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === '/'} className={linkClass}>
              <span aria-hidden>{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-sand-200 p-3">
          <button
            onClick={() => navigate('/settings')}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-sand-100"
          >
            <Avatar name={profile?.name ?? '?'} />
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-sm font-semibold text-slate-800">
                {profile?.name}
              </span>
              <span className="block text-[11px] text-slate-500">{ROLE_LABEL[role]}</span>
            </span>
          </button>
          <Button variant="ghost" size="sm" full className="mt-1" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </aside>

      {/* ------------------------------------------------ main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* mobile top bar */}
        <header className="no-print sticky top-0 z-40 flex items-center gap-2 border-b border-sand-200 bg-white/95 px-4 py-3 backdrop-blur lg:hidden">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-palm-600 text-lg text-white">
            🏡
          </span>
          <p className="flex-1 font-extrabold text-slate-800">SS Family</p>
          <NotificationBell />
          <button
            onClick={() => setMenuOpen((v) => !v)}
            className="rounded-xl p-1 transition hover:bg-sand-100"
            aria-label="Account menu"
          >
            <Avatar name={profile?.name ?? '?'} />
          </button>

          {menuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} aria-hidden />
              <div className="absolute right-3 top-full z-50 w-56 overflow-hidden rounded-2xl border border-sand-200 bg-white shadow-xl">
                <div className="border-b border-sand-200 px-4 py-3">
                  <p className="truncate font-semibold text-slate-800">{profile?.name}</p>
                  <p className="text-xs text-slate-500">{ROLE_LABEL[role]}</p>
                </div>
                <button
                  onClick={() => {
                    setMenuOpen(false)
                    navigate('/settings')
                  }}
                  className="w-full px-4 py-3 text-left text-sm font-medium transition hover:bg-sand-50"
                >
                  ⚙️ My profile
                </button>
                <button
                  onClick={() => {
                    setMenuOpen(false)
                    navigate('/notifications')
                  }}
                  className="w-full px-4 py-3 text-left text-sm font-medium transition hover:bg-sand-50"
                >
                  🔔 Notifications
                </button>
                <button
                  onClick={() => void signOut()}
                  className="w-full border-t border-sand-200 px-4 py-3 text-left text-sm font-medium text-red-600 transition hover:bg-red-50"
                >
                  Sign out
                </button>
              </div>
            </>
          )}
        </header>

        {/* desktop top bar */}
        <header className="no-print hidden items-center justify-end gap-2 border-b border-sand-200 bg-white/95 px-6 py-3 backdrop-blur lg:flex">
          <NotificationBell />
        </header>

        <main className="flex-1 px-4 pb-28 pt-4 sm:px-6 lg:pb-10">
          <Outlet />
        </main>

        {/* mobile bottom navigation - large tap targets */}
        <nav className="no-print fixed inset-x-0 bottom-0 z-40 flex border-t border-sand-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
          {items.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[10px] font-semibold transition ${
                  isActive ? 'text-palm-700' : 'text-slate-500'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={`flex h-8 w-full max-w-14 items-center justify-center rounded-lg text-lg ${
                      isActive ? 'bg-palm-100' : ''
                    }`}
                    aria-hidden
                  >
                    {item.icon}
                  </span>
                  {item.label}
                </>
              )}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  )
}
