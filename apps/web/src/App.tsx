import { NavLink, Route, Routes } from 'react-router-dom'
import { Dashboard } from './pages/Dashboard.js'
import { Capture } from './pages/Capture.js'
import { Ask } from './pages/Ask.js'
import { Captures } from './pages/Captures.js'
import { Runs } from './pages/Runs.js'

const navItems = [
  { to: '/', label: 'Dashboard' },
  { to: '/ask', label: 'Ask' },
  { to: '/capture', label: 'Capture' },
  { to: '/captures', label: 'Captures' },
  { to: '/runs', label: 'Runs' },
]

export function App() {
  return (
    <div className="min-h-full flex flex-col">
      <header className="border-b border-neutral-800 bg-neutral-900/60 backdrop-blur">
        <div className="max-w-5xl mx-auto px-6 py-3 flex items-center gap-6">
          <div className="text-lg font-semibold tracking-tight">
            <span className="text-emerald-400">hub</span>
            <span className="text-neutral-500 font-normal ml-2 text-sm">v0.3.0</span>
          </div>
          <nav className="flex gap-1 text-sm">
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
        </div>
      </header>
      <main className="flex-1 max-w-5xl w-full mx-auto px-6 py-8">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/ask" element={<Ask />} />
          <Route path="/capture" element={<Capture />} />
          <Route path="/captures" element={<Captures />} />
          <Route path="/runs" element={<Runs />} />
        </Routes>
      </main>
      <footer className="border-t border-neutral-800 text-xs text-neutral-500 py-3 text-center">
        connected to <span className="font-mono">127.0.0.1</span> - all local
      </footer>
    </div>
  )
}
