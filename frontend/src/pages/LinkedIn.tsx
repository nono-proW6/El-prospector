import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import type { Agency } from '../lib/types'
import {
  Linkedin, MapPin, User, Star, Zap,
  Target, Loader2, SkipForward, RotateCcw, ChevronDown, ChevronRight,
  Clock, CheckCircle2, XCircle, Send, MailCheck, CalendarClock, Copy, Check,
  Search, X
} from 'lucide-react'

function firstName(full: string | null): string {
  if (!full) return ''
  // Take the first whitespace-separated token that isn't all-uppercase surname
  const parts = full.trim().split(/\s+/)
  for (const p of parts) {
    if (p.length < 2) continue
    // Heuristic: surnames often written ALL CAPS in our data — prefer mixed-case tokens
    if (p === p.toUpperCase() && parts.length > 1) continue
    return p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()
  }
  return parts[0] || ''
}

function buildConnectMessage(ownerName: string | null, city: string | null): string {
  const first = firstName(ownerName)
  const greeting = first ? `Bonjour ${first},` : 'Bonjour,'
  const place = city || 'votre secteur'
  return `${greeting}\n\nJ'analyse la réactivité des agences immobilières sur ${place} dans le cadre d'un projet IA, j'ai les résultats de votre agence si ça vous intéresse.`
}

type LiStatus = 'sent' | 'accepted' | 'ignored'

const RESULTS: { key: LiStatus; label: string; icon: React.ReactNode; badgeClass: string }[] = [
  { key: 'sent',     label: 'Envoyée',   icon: <Send size={18} />,         badgeClass: 'bg-blue-500/15 text-blue-400' },
  { key: 'accepted', label: 'Acceptée',  icon: <CheckCircle2 size={18} />, badgeClass: 'bg-emerald-500/15 text-emerald-400' },
  { key: 'ignored',  label: 'Ignorée',   icon: <XCircle size={18} />,      badgeClass: 'bg-red-500/15 text-red-400' },
]

const RESULT_MAP = Object.fromEntries(RESULTS.map(r => [r.key, r])) as Record<LiStatus, typeof RESULTS[0]>

const MOTIVATIONS = [
  "Ta présence se construit connexion par connexion",
  "Chaque gérant ajouté = un futur lead possible",
  "Les contactés par mail sont tes cibles chaudes",
  "LinkedIn = playground long terme",
  "Un post + une bonne base = des leads qualifiés",
]

export default function LinkedInPage() {
  const [inSession, setInSession] = useState(false)
  const [loading, setLoading] = useState(false)

  const [sessionSize, setSessionSize] = useState(() => Number(localStorage.getItem('li_session_size')) || 10)
  const [dailyGoal, setDailyGoal] = useState(() => Number(localStorage.getItem('li_daily_goal')) || 15)

  const [currentAgency, setCurrentAgency] = useState<Agency | null>(null)
  const [currentTier, setCurrentTier] = useState<'priority' | 'rest' | 'skipped' | null>(null)
  const [completed, setCompleted] = useState(0)
  const [transitioning, setTransitioning] = useState(false)

  // Pools: priority (déjà contactés par email) → rest → skipped (last chance)
  const priorityPoolRef = useRef<string[]>([])
  const restPoolRef = useRef<string[]>([])
  const skippedPoolRef = useRef<string[]>([])
  const contactedSetRef = useRef<Set<string>>(new Set())
  const usedRef = useRef<Set<string>>(new Set())

  const [todaySent, setTodaySent] = useState(0)

  const [historyAgencies, setHistoryAgencies] = useState<Agency[]>([])
  const [showHistory, setShowHistory] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  const [priorityCount, setPriorityCount] = useState(0)
  const [restCount, setRestCount] = useState(0)
  const [skippedCount, setSkippedCount] = useState(0)

  const [connectMessage, setConnectMessage] = useState('')
  const [messageCopied, setMessageCopied] = useState(false)

  // Search
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<Agency[]>([])
  const [searching, setSearching] = useState(false)

  const motRef = useRef(MOTIVATIONS[0])

  useEffect(() => {
    const today = new Date().toISOString().split('T')[0]
    supabase.from('agencies').select('linkedin_status').gte('linkedin_connect_date', today).not('linkedin_status', 'is', null)
      .then(({ data }) => setTodaySent(data?.length || 0))
    loadCounts()
    loadHistory()
  }, [])

  async function loadCounts() {
    const { data: convs } = await supabase.from('conversations').select('agency_id').neq('status', 'pending')
    const contactedIds = new Set((convs || []).map(c => c.agency_id))
    contactedSetRef.current = contactedIds

    // Unskipped (linkedin_skipped_at IS NULL) and pending (linkedin_status IS NULL)
    const { data: fresh } = await supabase.from('agencies').select('id')
      .like('linkedin', 'http%')
      .is('linkedin_status', null)
      .is('linkedin_skipped_at', null)
    const freshIds = (fresh || []).map(a => a.id)
    setPriorityCount(freshIds.filter(id => contactedIds.has(id)).length)
    setRestCount(freshIds.filter(id => !contactedIds.has(id)).length)

    const { count: skipCount } = await supabase.from('agencies').select('id', { count: 'exact', head: true })
      .like('linkedin', 'http%')
      .is('linkedin_status', null)
      .not('linkedin_skipped_at', 'is', null)
    setSkippedCount(skipCount || 0)
  }

  async function loadHistory() {
    const { data } = await supabase.from('agencies').select('*')
      .not('linkedin_status', 'is', null)
      .order('linkedin_connect_date', { ascending: false })
      .limit(50)
    setHistoryAgencies(data || [])
  }

  async function drainPool(pool: React.MutableRefObject<string[]>, tier: 'priority' | 'rest' | 'skipped'): Promise<Agency | null> {
    while (pool.current.length > 0) {
      const id = pool.current.shift()!
      if (usedRef.current.has(id)) continue
      const { data } = await supabase.from('agencies').select('*').eq('id', id).single()
      if (data && !data.linkedin_status) {
        usedRef.current.add(id)
        setCurrentTier(tier)
        return data as Agency
      }
    }
    return null
  }

  async function fetchNext(): Promise<Agency | null> {
    return (await drainPool(priorityPoolRef, 'priority'))
      || (await drainPool(restPoolRef, 'rest'))
      || (await drainPool(skippedPoolRef, 'skipped'))
  }

  async function buildPools() {
    const { data: convs } = await supabase.from('conversations').select('agency_id, sent_at').neq('status', 'pending').order('sent_at', { ascending: false })
    const contactedIds = new Set((convs || []).map(c => c.agency_id))
    contactedSetRef.current = contactedIds

    // Fresh (unskipped) candidates — ordered by score DESC
    const { data: fresh } = await supabase.from('agencies').select('id, score')
      .like('linkedin', 'http%')
      .is('linkedin_status', null)
      .is('linkedin_skipped_at', null)
      .order('score', { ascending: false, nullsFirst: false })
      .limit(500)

    const allFresh = (fresh || []).map(d => d.id)
    const contactedOrder = (convs || []).map(c => c.agency_id).filter(id => allFresh.includes(id))
    const restOrder = allFresh.filter(id => !contactedIds.has(id))

    // Skipped pool — oldest skip first (second-chance)
    const { data: skipped } = await supabase.from('agencies').select('id')
      .like('linkedin', 'http%')
      .is('linkedin_status', null)
      .not('linkedin_skipped_at', 'is', null)
      .order('linkedin_skipped_at', { ascending: true })
      .limit(200)

    priorityPoolRef.current = contactedOrder
    restPoolRef.current = restOrder
    skippedPoolRef.current = (skipped || []).map(d => d.id)
  }

  // Debounced search effect
  useEffect(() => {
    if (!searchQuery.trim()) { setSearchResults([]); return }
    const t = setTimeout(async () => {
      setSearching(true)
      const q = searchQuery.trim()
      const isUrl = q.startsWith('http') || q.includes('linkedin.com')
      let qb = supabase.from('agencies').select('*').like('linkedin', 'http%')
      if (isUrl) {
        const slug = q.replace(/\/$/, '').split('/in/')[1]?.split('?')[0] || q
        qb = qb.or(`linkedin.ilike.%${slug}%`)
      } else {
        qb = qb.or(`owner_name.ilike.%${q}%,name.ilike.%${q}%,city.ilike.%${q}%`)
      }
      const { data } = await qb.limit(20)
      setSearchResults((data || []) as Agency[])
      setSearching(false)
    }, 250)
    return () => clearTimeout(t)
  }, [searchQuery])

  async function updateSearchStatus(id: string, status: LiStatus | null) {
    const patch: Record<string, string | null> = status === null
      ? { linkedin_status: null, linkedin_connect_date: null, linkedin_skipped_at: null }
      : { linkedin_status: status, linkedin_connect_date: new Date().toISOString(), linkedin_skipped_at: null }
    await supabase.from('agencies').update(patch).eq('id', id)
    setSearchResults(prev => prev.map(a => a.id === id ? { ...a, ...patch } as Agency : a))
    loadCounts(); loadHistory()
  }

  async function startSession() {
    setLoading(true)
    usedRef.current = new Set()
    priorityPoolRef.current = []; restPoolRef.current = []; skippedPoolRef.current = []
    setCompleted(0)
    await buildPools()
    const next = await fetchNext()
    if (next) {
      setCurrentAgency(next)
      setConnectMessage(buildConnectMessage(next.owner_name, next.city))
      setInSession(true)
    }
    setLoading(false)
    motRef.current = MOTIVATIONS[Math.floor(Math.random() * MOTIVATIONS.length)]
  }

  async function copyConnectMessage() {
    await navigator.clipboard.writeText(connectMessage)
    setMessageCopied(true)
    setTimeout(() => setMessageCopied(false), 1500)
  }

  async function recordAction(status: LiStatus) {
    if (!currentAgency) return
    await supabase.from('agencies').update({
      linkedin_status: status,
      linkedin_connect_date: new Date().toISOString(),
      linkedin_skipped_at: null,
    }).eq('id', currentAgency.id)
    setTodaySent(c => c + 1)
    setCompleted(c => c + 1)
    advance()
  }

  async function skip() {
    if (currentAgency) {
      await supabase.from('agencies').update({
        linkedin_skipped_at: new Date().toISOString(),
      }).eq('id', currentAgency.id)
    }
    advance()
  }

  async function advance() {
    setTransitioning(true)
    motRef.current = MOTIVATIONS[Math.floor(Math.random() * MOTIVATIONS.length)]
    const next = completed + 1
    setTimeout(async () => {
      if (next >= sessionSize) {
        setInSession(false); setCurrentAgency(null); setTransitioning(false)
        loadCounts(); loadHistory(); return
      }
      const n = await fetchNext()
      if (n) {
        setCurrentAgency(n)
        setConnectMessage(buildConnectMessage(n.owner_name, n.city))
      }
      else { setInSession(false); setCurrentAgency(null) }
      setTransitioning(false)
    }, 350)
  }

  async function release(id: string) {
    await supabase.from('agencies').update({ linkedin_status: null, linkedin_connect_date: null }).eq('id', id)
    setHistoryAgencies(prev => prev.filter(a => a.id !== id))
    loadCounts()
  }

  async function changeStatus(id: string, status: LiStatus) {
    await supabase.from('agencies').update({ linkedin_status: status }).eq('id', id)
    setHistoryAgencies(prev => prev.map(a => a.id === id ? { ...a, linkedin_status: status } : a))
    setEditingId(null)
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // SESSION VIEW
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  if (inSession && currentAgency) {
    const a = currentAgency
    const remaining = sessionSize - completed

    return (
      <div className={`max-w-2xl mx-auto transition-all duration-300 ${transitioning ? 'opacity-0 translate-y-1' : 'opacity-100'}`}>

        {/* Top */}
        <div className="flex items-center justify-between mb-4">
          <button onClick={() => { setInSession(false); loadCounts(); loadHistory() }}
            className="text-sm text-[var(--text-muted)] hover:text-[var(--text)]">
            Quitter
          </button>
          <span className="text-sm text-[var(--text-muted)]">
            <b className="text-[var(--text)]">{completed + 1}</b>/{sessionSize}
          </span>
        </div>

        {/* Progress */}
        <div className="h-1 bg-[var(--border)] rounded-full mb-6 overflow-hidden">
          <div className="h-full bg-[var(--accent)] rounded-full transition-all duration-500"
            style={{ width: `${(completed / sessionSize) * 100}%` }} />
        </div>

        {/* Tier badge */}
        {currentTier === 'priority' && (
          <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-medium">
            <MailCheck size={14} />
            Déjà contacté par mail — cible prioritaire
          </div>
        )}
        {currentTier === 'skipped' && a.linkedin_skipped_at && (
          <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-lg bg-zinc-500/10 border border-zinc-500/30 text-zinc-400 text-xs font-medium">
            <SkipForward size={14} />
            Skippé {new Date(a.linkedin_skipped_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} — dernière chance
          </div>
        )}

        {/* Agency + owner */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h2 className="text-xl font-bold">{a.owner_name || a.name}</h2>
            <p className="text-sm text-[var(--text-muted)] flex items-center gap-1.5 mt-1">
              {a.owner_name && <><User size={13} /> {a.name}<span className="mx-1">·</span></>}
              <MapPin size={13} /> {a.city}
            </p>
          </div>
          {a.score && (
            <span className={`text-sm font-bold px-2.5 py-1 rounded-lg ${
              Number(a.score) >= 5 ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/15 text-amber-400'
            }`}>{a.score}/5</span>
          )}
        </div>

        {/* LinkedIn button */}
        <a href={a.linkedin || '#'} target="_blank" rel="noreferrer"
          className="flex items-center justify-center gap-3 w-full py-4 mb-4 rounded-xl bg-[#0A66C2] hover:bg-[#0958A8] text-white text-lg font-bold transition-colors">
          <Linkedin size={20} /> Ouvrir le profil
        </a>

        {/* Connection message */}
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4 mb-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] uppercase tracking-wider text-[var(--accent)] font-semibold">
              Message de demande
            </span>
            <div className="flex items-center gap-3">
              <span className={`text-[10px] ${connectMessage.length > 300 ? 'text-red-400' : 'text-[var(--text-muted)]'}`}>
                {connectMessage.length}/300
              </span>
              <button onClick={copyConnectMessage}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[var(--surface-hover)] border border-[var(--border)] text-xs hover:border-[var(--accent)]/40 transition-colors">
                {messageCopied ? <><Check size={11} />Copié</> : <><Copy size={11} />Copier</>}
              </button>
            </div>
          </div>
          <textarea
            value={connectMessage}
            onChange={e => setConnectMessage(e.target.value)}
            rows={4}
            className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm whitespace-pre-wrap focus:outline-none focus:border-[var(--accent)] resize-y"
          />
        </div>

        {/* Info card */}
        {a.sales_brief && (
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl px-4 py-3 mb-6">
            <p className="text-[10px] uppercase tracking-wider text-[var(--accent)] font-semibold mb-1">Brief commercial</p>
            <p className="text-sm">{a.sales_brief}</p>
          </div>
        )}

        {/* Links */}
        <div className="flex gap-2 mb-6">
          {a.rating && (
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-[var(--surface)] border border-[var(--border)] text-[var(--text-muted)]">
              <Star size={13} /> {a.rating}
            </span>
          )}
        </div>

        {/* Result buttons */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {RESULTS.map(r => (
            <button key={r.key} onClick={() => recordAction(r.key)}
              className={`flex flex-col items-center gap-1.5 py-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] text-xs font-medium transition-all hover:border-[var(--accent)]/40 hover:bg-[var(--surface-hover)] ${r.badgeClass.split(' ')[1]}`}>
              {r.icon}
              {r.label}
            </button>
          ))}
          <button onClick={skip}
            className="flex flex-col items-center gap-1.5 py-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] text-xs font-medium text-[var(--text-muted)] hover:border-[var(--accent)]/40 hover:bg-[var(--surface-hover)] transition-all">
            <SkipForward size={18} />
            Skip
          </button>
        </div>

        <p className="text-center text-xs text-[var(--text-muted)] mt-4">{motRef.current} — encore {remaining}</p>
      </div>
    )
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // HOME VIEW
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const dailyPct = dailyGoal > 0 ? Math.min(todaySent / dailyGoal, 1) : 0
  const totalAvailable = priorityCount + restCount

  return (
    <div>
      {/* Title */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-xl font-bold">LinkedIn</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            <span className="text-emerald-400 font-semibold">{priorityCount}</span> prioritaires
            <span className="mx-1.5">·</span>
            {restCount} autres disponibles
            {skippedCount > 0 && (
              <> · <span className="text-zinc-400 font-semibold">{skippedCount}</span> skippés</>
            )}
          </p>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl px-4 py-3">
          <div className="flex items-center gap-2 text-[var(--text-muted)] mb-1">
            <Send size={14} />
            <span className="text-[10px] uppercase tracking-wider">Demandes</span>
          </div>
          <span className="text-xl font-bold">{todaySent}<span className="text-sm font-normal text-[var(--text-muted)]">/{dailyGoal}</span></span>
          <div className="mt-2 h-1 bg-[var(--border)] rounded-full overflow-hidden">
            <div className="h-full bg-[var(--accent)] rounded-full transition-all" style={{ width: `${dailyPct * 100}%` }} />
          </div>
        </div>
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl px-4 py-3">
          <div className="flex items-center gap-2 text-[var(--text-muted)] mb-1">
            <MailCheck size={14} />
            <span className="text-[10px] uppercase tracking-wider">Prioritaires</span>
          </div>
          <span className="text-xl font-bold text-emerald-400">{priorityCount}</span>
        </div>
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl px-4 py-3">
          <div className="flex items-center gap-2 text-[var(--text-muted)] mb-1">
            <Target size={14} />
            <span className="text-[10px] uppercase tracking-wider">Session</span>
          </div>
          <input type="number" value={sessionSize}
            onChange={e => { setSessionSize(Number(e.target.value)); localStorage.setItem('li_session_size', e.target.value) }}
            className="w-full bg-transparent text-xl font-bold focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
        </div>
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl px-4 py-3">
          <div className="flex items-center gap-2 text-[var(--text-muted)] mb-1">
            <CalendarClock size={14} />
            <span className="text-[10px] uppercase tracking-wider">Objectif/j</span>
          </div>
          <input type="number" value={dailyGoal}
            onChange={e => { setDailyGoal(Number(e.target.value)); localStorage.setItem('li_daily_goal', e.target.value) }}
            className="w-full bg-transparent text-xl font-bold focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
        </div>
      </div>

      {/* Launch button */}
      <div className="flex justify-center mb-8">
        <button onClick={startSession} disabled={loading || totalAvailable === 0}
          className="flex items-center gap-3 px-8 py-3.5 rounded-xl bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white font-bold transition-colors disabled:opacity-40">
          {loading ? <Loader2 size={18} className="animate-spin" /> : <Zap size={18} />}
          {loading ? 'Chargement...' : `Lancer ${Math.min(sessionSize, totalAvailable)} connexions`}
        </button>
      </div>

      {/* Search bar — mettre à jour un statut à la volée */}
      <div className="mb-10">
        <label className="block text-xs uppercase tracking-wider text-[var(--text-muted)] mb-2 font-semibold">
          Rechercher un profil pour mettre à jour son statut
        </label>
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            type="text"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Nom, agence, ville ou URL LinkedIn…"
            className="w-full pl-10 pr-10 py-2.5 rounded-xl bg-[var(--surface)] border border-[var(--border)] focus:outline-none focus:border-[var(--accent)] text-sm"
          />
          {searching && <Loader2 size={14} className="animate-spin absolute right-10 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />}
          {searchQuery && (
            <button onClick={() => { setSearchQuery(''); setSearchResults([]) }}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text)]">
              <X size={14} />
            </button>
          )}
        </div>

        {searchResults.length > 0 && (
          <div className="mt-3 space-y-2 max-h-[500px] overflow-y-auto">
            {searchResults.map(a => {
              const cfg = a.linkedin_status ? RESULT_MAP[a.linkedin_status as LiStatus] : null
              return (
                <div key={a.id} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{a.owner_name || a.name}</span>
                        {a.owner_name && <span className="text-xs text-[var(--text-muted)]">{a.name}</span>}
                      </div>
                      <p className="text-xs text-[var(--text-muted)] flex items-center gap-1.5 mt-0.5">
                        <MapPin size={11} />{a.city}
                        {a.linkedin_connect_date && (
                          <><span className="mx-1">·</span>Dernière MAJ: {new Date(a.linkedin_connect_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</>
                        )}
                        {a.linkedin_skipped_at && (
                          <><span className="mx-1">·</span>Skippé: {new Date(a.linkedin_skipped_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</>
                        )}
                      </p>
                    </div>
                    {a.linkedin && (
                      <a href={a.linkedin} target="_blank" rel="noreferrer"
                        className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[#0A66C2] hover:bg-[var(--surface-hover)] transition-colors shrink-0">
                        <Linkedin size={13} />
                      </a>
                    )}
                    <span className={`px-2.5 py-1 rounded-lg text-xs font-medium shrink-0 ${cfg?.badgeClass || 'bg-zinc-500/15 text-zinc-500'}`}>
                      {cfg?.label || 'Aucun statut'}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-[var(--border)]">
                    {RESULTS.map(r => (
                      <button key={r.key} onClick={() => updateSearchStatus(a.id, r.key)}
                        className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                          a.linkedin_status === r.key ? 'ring-1 ring-[var(--accent)] ' : ''
                        }${r.badgeClass}`}>
                        {r.icon} {r.label}
                      </button>
                    ))}
                    {a.linkedin_status && (
                      <button onClick={() => updateSearchStatus(a.id, null)}
                        title="Reset"
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium text-[var(--text-muted)] hover:bg-[var(--surface-hover)] transition-colors">
                        <RotateCcw size={13} /> Reset
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {!searching && searchQuery.trim() && searchResults.length === 0 && (
          <p className="mt-3 text-xs text-[var(--text-muted)]">Aucun profil trouvé.</p>
        )}
      </div>

      {/* History */}
      {historyAgencies.length > 0 && (
        <div>
          <button onClick={() => setShowHistory(!showHistory)}
            className="flex items-center gap-2 text-sm text-[var(--text-muted)] hover:text-[var(--text)] mb-4">
            {showHistory ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
            <Clock size={14} />
            <span>Historique ({historyAgencies.length})</span>
          </button>

          {showHistory && (
            <div className="space-y-2">
              {historyAgencies.map(a => {
                const cfg = RESULT_MAP[a.linkedin_status as LiStatus]
                return (
                  <div key={a.id} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium">{a.owner_name || a.name}</span>
                        <span className="text-xs text-[var(--text-muted)] ml-2">{a.city}</span>
                      </div>

                      {a.linkedin_connect_date && (
                        <span className="text-[10px] text-[var(--text-muted)] shrink-0">
                          {new Date(a.linkedin_connect_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                        </span>
                      )}

                      {a.linkedin && (
                        <a href={a.linkedin} target="_blank" rel="noreferrer"
                          className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[#0A66C2] hover:bg-[var(--surface-hover)] transition-colors shrink-0">
                          <Linkedin size={13} />
                        </a>
                      )}

                      <button onClick={() => setEditingId(editingId === a.id ? null : a.id)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-medium shrink-0 transition-colors ${cfg?.badgeClass || 'bg-zinc-500/15 text-zinc-400'}`}>
                        {cfg?.label || a.linkedin_status}
                      </button>

                      <button onClick={() => release(a.id)} title="Reset"
                        className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-hover)] transition-colors shrink-0">
                        <RotateCcw size={13} />
                      </button>
                    </div>

                    {editingId === a.id && (
                      <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-[var(--border)]">
                        {RESULTS.map(r => (
                          <button key={r.key} onClick={() => changeStatus(a.id, r.key)}
                            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                              a.linkedin_status === r.key ? 'ring-1 ring-[var(--accent)] ' : ''
                            }${r.badgeClass}`}>
                            {r.icon} {r.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
