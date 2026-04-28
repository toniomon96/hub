import { NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { Dashboard } from './pages/Dashboard.js'
import { Capture } from './pages/Capture.js'
import { Ask } from './pages/Ask.js'
import { Govern } from './pages/Govern.js'
import { Captures } from './pages/Captures.js'
import { Runs } from './pages/Runs.js'
import { Brief } from './pages/Brief.js'
import { Context } from './pages/Context.js'
import { Console } from './pages/Console.js'
import { ConsoleRoadmap } from './pages/ConsoleRoadmap.js'
import { Observability } from './pages/Observability.js'
import { Projects } from './pages/Projects.js'
import { Settings } from './pages/Settings.js'
import { Login } from './pages/Login.js'
import { api } from './api.js'

const navItems = [
  { to: '/', label: 'Dashboard' },
  { to: '/console', label: 'Console' },
  { to: '/brief', label: 'Brief' },
  { to: '/context', label: 'Context' },
  { to: '/ask', label: 'Ask' },
  { to: '/govern', label: 'Govern' },
  { to: '/capture', label: 'Capture' },
  { to: '/captures', label: 'Captures' },
  { to: '/runs', label: 'Runs' },
  { to: '/observability', label: 'Observe' },
  { to: '/projects', label: 'Projects' },
  { to: '/settings', label: 'Settings' },
]

export function App() {
  const location = useLocation()
  const isLogin = location.pathname.startsWith('/login')
  const isConsole = location.pathname.startsWith('/console')

  if (isLogin) {
    return (
      <div className="min-h-full flex flex-col">
        <main className="flex-1 max-w-5xl w-full mx-auto px-6 py-8">
          <Routes>
            <Route path="/login" element={<Login />} />
          </Routes>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-full flex flex-col">
      <header className="border-b border-neutral-800 bg-neutral-900/60 backdrop-blur sticky top-0 z-40">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="text-lg font-semibold tracking-tight">
            <span className="text-emerald-400">hub</span>
            <span className="text-neutral-500 font-normal ml-2 text-sm">v0.3.0</span>
          </div>
          <nav className="flex flex-wrap gap-1 text-sm order-last sm:order-none w-full sm:w-auto">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  [
                    'px-3 py-1.5 rounded-md transition-colors',
                    isActive
                      ? 'bg-neutral-800 text-neutral-100'
                      : 'text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50',
                  ].join(' ')
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <button
            type="button"
            onClick={() => api.logout()}
            className="ml-auto text-xs text-neutral-500 hover:text-neutral-300"
          >
            sign out
          </button>
        </div>
      </header>
      <main
        className={[
          'flex-1 w-full mx-auto px-4 sm:px-6 py-6 sm:py-8',
          isConsole ? 'max-w-7xl' : 'max-w-5xl',
        ].join(' ')}
      >
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/console" element={<Console />} />
          <Route path="/console/roadmap" element={<ConsoleRoadmap />} />
          <Route path="/brief" element={<Brief />} />
          <Route path="/context" element={<Context />} />
          <Route path="/ask" element={<Ask />} />
          <Route path="/govern" element={<Govern />} />
          <Route path="/capture" element={<Capture />} />
          <Route path="/captures" element={<Captures />} />
          <Route path="/runs" element={<Runs />} />
          <Route path="/observability" element={<Observability />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
      <footer className="border-t border-neutral-800 text-xs text-neutral-500 py-3 text-center">
        connected to <span className="font-mono">{window.location.host}</span>
      </footer>
    </div>
  )
}
