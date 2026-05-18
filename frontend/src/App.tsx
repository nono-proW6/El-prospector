import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import { Building2, BarChart3, Map, PhoneCall, MailQuestion, Activity, ClipboardList, Headset, Linkedin, FileText, Target, FileCheck, CalendarClock } from 'lucide-react'
import Agencies from './pages/Agencies'
import Dashboard from './pages/Dashboard'
import ScanMap from './pages/ScanMap'
import Enrichment from './pages/Enrichment'
import UnmatchedEmails from './pages/UnmatchedEmails'
import Monitoring from './pages/Monitoring'
import ListingEnrich from './pages/ListingEnrich'
import ColdCall from './pages/ColdCall'
import LinkedInPage from './pages/LinkedIn'
import Reports from './pages/Reports'
import Habits from './pages/Habits'
import AuditsToSend from './pages/AuditsToSend'
import AuditsToCallback from './pages/AuditsToCallback'

function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen md:flex">
        {/* Sidebar — desktop only */}
        <nav className="hidden md:flex w-56 border-r border-[var(--border)] p-4 flex-col gap-1">
          <h1 className="text-lg font-bold mb-6 px-3">Prospector</h1>
          <NavItem to="/" icon={<BarChart3 size={18} />} label="Dashboard" />
          <NavItem to="/agencies" icon={<Building2 size={18} />} label="Agences" />
          <NavItem to="/scan-map" icon={<Map size={18} />} label="Carte scan" />
          <NavItem to="/cold-call" icon={<Headset size={18} />} label="Cold Call" />
          <NavItem to="/audits-to-send" icon={<FileCheck size={18} />} label="Réponses email" />
          <NavItem to="/audits-to-callback" icon={<CalendarClock size={18} />} label="Rappels audit" />
          <NavItem to="/linkedin" icon={<Linkedin size={18} />} label="LinkedIn" />
          <NavItem to="/reports" icon={<FileText size={18} />} label="Rapports" />
          <NavItem to="/habits" icon={<Target size={18} />} label="Habitudes" />
          <NavItem to="/enrichment" icon={<PhoneCall size={18} />} label="Contacts manuels" />
          <NavItem to="/listing-enrich" icon={<ClipboardList size={18} />} label="Annonces" />
          <NavItem to="/unmatched" icon={<MailQuestion size={18} />} label="Non-matches" />
          <NavItem to="/monitoring" icon={<Activity size={18} />} label="Monitoring" />
        </nav>

        <main className="flex-1 p-4 md:p-8 pb-24 md:pb-8 overflow-auto">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/agencies" element={<Agencies />} />
            <Route path="/scan-map" element={<ScanMap />} />
            <Route path="/cold-call" element={<ColdCall />} />
            <Route path="/audits-to-send" element={<AuditsToSend />} />
            <Route path="/audits-to-callback" element={<AuditsToCallback />} />
            <Route path="/linkedin" element={<LinkedInPage />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/habits" element={<Habits />} />
            <Route path="/enrichment" element={<Enrichment />} />
            <Route path="/listing-enrich" element={<ListingEnrich />} />
            <Route path="/unmatched" element={<UnmatchedEmails />} />
            <Route path="/monitoring" element={<Monitoring />} />
          </Routes>
        </main>

        {/* Bottom nav — mobile only */}
        <nav
          className="md:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-[var(--border)] bg-[var(--bg)]/95 backdrop-blur-md"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          <div className="grid grid-cols-4">
            <BottomNavItem to="/cold-call" icon={<Headset size={22} />} label="Cold Call" />
            <BottomNavItem to="/audits-to-callback" icon={<CalendarClock size={22} />} label="Rappels" />
            <BottomNavItem to="/linkedin" icon={<Linkedin size={22} />} label="LinkedIn" />
            <BottomNavItem to="/habits" icon={<Target size={22} />} label="Habits" />
          </div>
        </nav>
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

function BottomNavItem({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) {
  return (
    <NavLink
      to={to}
      end
      className={({ isActive }) =>
        `flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors ${
          isActive ? 'text-[var(--accent)]' : 'text-[var(--text-muted)] active:text-[var(--text)]'
        }`
      }
    >
      {icon}
      {label}
    </NavLink>
  )
}

export default App
