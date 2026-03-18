import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import { Building2, BarChart3, Map, PhoneCall, MailQuestion, Activity } from 'lucide-react'
import Agencies from './pages/Agencies'
import Dashboard from './pages/Dashboard'
import ScanMap from './pages/ScanMap'
import Enrichment from './pages/Enrichment'
import UnmatchedEmails from './pages/UnmatchedEmails'
import Monitoring from './pages/Monitoring'

function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen flex">
        <nav className="w-56 border-r border-[var(--border)] p-4 flex flex-col gap-1">
          <h1 className="text-lg font-bold mb-6 px-3">Prospector</h1>
          <NavItem to="/" icon={<BarChart3 size={18} />} label="Dashboard" />
          <NavItem to="/agencies" icon={<Building2 size={18} />} label="Agences" />
          <NavItem to="/scan-map" icon={<Map size={18} />} label="Carte scan" />
          <NavItem to="/enrichment" icon={<PhoneCall size={18} />} label="Contacts manuels" />
          <NavItem to="/unmatched" icon={<MailQuestion size={18} />} label="Non-matches" />
          <NavItem to="/monitoring" icon={<Activity size={18} />} label="Monitoring" />
        </nav>
        <main className="flex-1 p-8 overflow-auto">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/agencies" element={<Agencies />} />
            <Route path="/scan-map" element={<ScanMap />} />
            <Route path="/enrichment" element={<Enrichment />} />
            <Route path="/unmatched" element={<UnmatchedEmails />} />
            <Route path="/monitoring" element={<Monitoring />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}

function NavItem({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <NavLink
      to={to}
      end
      className={({ isActive }) =>
        `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
          isActive
            ? 'bg-[var(--accent)] text-white'
            : 'text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-hover)]'
        }`
      }
    >
      {icon}
      {label}
    </NavLink>
  )
}

export default App
