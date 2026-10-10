import { HashRouter, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { BookOpen, Calculator, FlaskConical, Home, MessageCircle, Wheat } from 'lucide-react'
import { lazy, Suspense } from 'react'
import { AppProvider } from './context/AppContext'
import { Dashboard } from './pages/Dashboard'
import { FlourLibrary } from './pages/FlourLibrary'
import { RecipeBook } from './pages/RecipeBook'
import { DoughBuilder } from './pages/DoughBuilder'
import { Feedback } from './pages/Feedback'
import './App.css'

const LieviaLab = lazy(() => import('./pages/LieviaLab').then((module) => ({ default: module.LieviaLab })))
const AskLievia = lazy(() => import('./pages/AskLievia').then((module) => ({ default: module.AskLievia })))

const navigation = [
  { to: '/', label: 'Panoramica', icon: Home, end: true },
  { to: '/impasto', label: 'Crea impasto', icon: Calculator, end: false },
  { to: '/farine', label: 'Le mie farine', icon: Wheat, end: false },
  { to: '/lab', label: 'Lievia Lab', icon: FlaskConical, end: false },
  { to: '/ricette', label: 'Le mie ricette', icon: BookOpen, end: false },
  { to: '/chiedi', label: 'Chiedi a Lievia', icon: MessageCircle, end: false },
]

function AppShell() {
  const location = useLocation()
  const titles: Record<string, string> = {
    '/': 'Il tuo laboratorio',
    '/impasto': 'Calcolatore impasti',
    '/farine': 'La dispensa',
    '/lab': 'Lievia Lab',
    '/ricette': 'Il tuo ricettario',
    '/chiedi': 'Chiedi a Lievia',
    '/esiti': 'Esiti e dati',
  }
  return (
    <div className="app-frame">
      <aside className="sidebar">
        <NavLink to="/" className="brand-lockup">
          <span className="brand-mark"><Wheat size={21} strokeWidth={1.8} /></span>
          <span><strong>Lievia</strong><small>The Science of Dough</small></span>
        </NavLink>
        <p className="nav-caption">IL TUO SPAZIO</p>
        <nav className="side-nav" aria-label="Navigazione principale">
          {navigation.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
              <Icon size={18} strokeWidth={1.8} /><span>{label}</span>
              {to === '/impasto' && <span className="nav-plus">+</span>}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-note"><span className="status-dot" /><span>Il tuo ricettario, sempre con te</span></div>
      </aside>
      <div className="main-column">
        <header className="topbar"><p>{titles[location.pathname] ?? 'Lievia'}</p><div className="topbar-user"><span className="user-avatar">L</span><span>Il mio spazio</span></div></header>
        <main className="main-content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/impasto" element={<DoughBuilder key={location.search} />} />
            <Route path="/farine" element={<FlourLibrary />} />
            <Route path="/lab" element={<Suspense fallback={<p className="lab-loading">Apro Lievia Lab…</p>}><LieviaLab /></Suspense>} />
            <Route path="/ricette" element={<RecipeBook />} />
            <Route path="/chiedi" element={<Suspense fallback={<p className="lab-loading">Apro l’assistente…</p>}><AskLievia /></Suspense>} />
            <Route path="/esiti" element={<Feedback />} />
          </Routes>
        </main>
      </div>
      <nav className="mobile-nav" aria-label="Navigazione principale">
        {navigation.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => `mobile-nav-link${isActive ? ' active' : ''}`}>
            <Icon size={19} strokeWidth={1.8} /><span>{label === 'Panoramica' ? 'Home' : label === 'Crea impasto' ? 'Impasto' : label === 'Le mie farine' ? 'Farine' : label === 'Lievia Lab' ? 'Lab' : label === 'Le mie ricette' ? 'Ricette' : 'Chiedi'}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}

export default function App() {
  return <HashRouter><AppProvider><AppShell /></AppProvider></HashRouter>
}
