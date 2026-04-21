import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import type { Agency } from '../lib/types'
import {
  Phone, MapPin, Globe, User, Star, Zap,
  CalendarClock, Trophy, Flame, Target, Loader2,
  ThumbsDown, PhoneMissed, PhoneOff, SkipForward,
  RotateCcw, ChevronDown, ChevronRight, Clock,
  TrendingUp, CheckCircle2, Send, Linkedin, XCircle
} from 'lucide-react'

function formatDateTime(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
    + ' à '
    + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
}

type CallResult = 'rdv' | 'rappeler' | 'pas_décroché' | 'pas_intéressé' | 'mauvais_numéro'

const RESULTS: { key: CallResult; label: string; icon: React.ReactNode; badgeClass: string }[] = [
  { key: 'rdv',             label: 'RDV obtenu',     icon: <Trophy size={18} />,       badgeClass: 'bg-emerald-500/15 text-emerald-400' },
  { key: 'rappeler',        label: 'Rappeler',       icon: <CalendarClock size={18} />, badgeClass: 'bg-blue-500/15 text-blue-400' },
  { key: 'pas_décroché',    label: 'Pas décroché',   icon: <PhoneMissed size={18} />,   badgeClass: 'bg-zinc-500/15 text-zinc-400' },
  { key: 'pas_intéressé',   label: 'Pas intéressé',  icon: <ThumbsDown size={18} />,    badgeClass: 'bg-red-500/15 text-red-400' },
  { key: 'mauvais_numéro',  label: 'Mauvais n°',     icon: <PhoneOff size={18} />,      badgeClass: 'bg-zinc-500/15 text-zinc-500' },
]

const RESULT_MAP = Object.fromEntries(RESULTS.map(r => [r.key, r])) as Record<CallResult, typeof RESULTS[0]>

const MOTIVATIONS = [
  "Chaque non te rapproche d'un oui",
  "Le prochain pourrait tout changer",
  "Tu construis ton pipeline",
  "La régularité fait la différence",
  "C'est comme ça qu'on signe",
  "Un RDV = un client potentiel",
]

export default function ColdCall() {
  const [inSession, setInSession] = useState(false)
  const [loading, setLoading] = useState(false)

  const [sessionSize, setSessionSize] = useState(() => Number(localStorage.getItem('cc_session_size')) || 10)
  const [dailyGoal, setDailyGoal] = useState(() => Number(localStorage.getItem('cc_daily_goal')) || 15)

  const [currentAgency, setCurrentAgency] = useState<Agency | null>(null)
  const [completed, setCompleted] = useState(0)
  const [streak, setStreak] = useState(0)
  const [showCallbackPicker, setShowCallbackPicker] = useState(false)
  const [callbackDate, setCallbackDate] = useState('')
  const [callNotes, setCallNotes] = useState('')
  const [transitioning, setTransitioning] = useState(false)

  // Tiered pools: accepted LinkedIn (hottest) → sent request → rest → skipped (last chance)
  const acceptedPoolRef = useRef<string[]>([])
  const sentPoolRef = useRef<string[]>([])
  const restPoolRef = useRef<string[]>([])
  const skippedPoolRef = useRef<string[]>([])
  const usedRef = useRef<Set<string>>(new Set())
  const [currentTier, setCurrentTier] = useState<'accepted' | 'sent' | 'rest' | 'skipped' | null>(null)

  const [todayCalls, setTodayCalls] = useState(0)
  const [todayDecroches, setTodayDecroches] = useState(0)
  const [todayRdv, setTodayRdv] = useState(0)

  const [calledAgencies, setCalledAgencies] = useState<Agency[]>([])
  const [showCalled, setShowCalled] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [availableCount, setAvailableCount] = useState(0)
  const [acceptedCount, setAcceptedCount] = useState(0)
  const [sentCount, setSentCount] = useState(0)
  const [skippedCount, setSkippedCount] = useState(0)

  const motRef = useRef(MOTIVATIONS[0])

  // ─── Data loading ─────────────────────────────────────
  useEffect(() => {
    const today = new Date().toISOString().split('T')[0]
    supabase.from('agencies').select('call_result').gte('call_date', today).not('call_result', 'is', null)
      .then(({ data }) => {
        if (!data) return
        setTodayCalls(data.length)
        setTodayDecroches(data.filter(d => d.call_result !== 'pas_décroché' && d.call_result !== 'mauvais_numéro').length)
        setTodayRdv(data.filter(d => d.call_result === 'rdv').length)
      })
    loadAvailable()
    loadCalled()
  }, [])

  async function loadAvailable() {
    const base = () => supabase.from('agencies').select('id', { count: 'exact', head: true })
      .eq('enrichment_status', 'done').eq('is_franchise', false)
      .not('phone', 'is', null).gte('score', 4).is('call_result', null)

    const [total, accepted, sent, skipped] = await Promise.all([
      base(),
      base().eq('linkedin_status', 'accepted').is('call_skipped_at', null),
      base().eq('linkedin_status', 'sent').is('call_skipped_at', null),
      base().not('call_skipped_at', 'is', null),
    ])
    setAvailableCount(total.count || 0)
    setAcceptedCount(accepted.count || 0)
    setSentCount(sent.count || 0)
    setSkippedCount(skipped.count || 0)
  }

  async function loadCalled() {
    const { data } = await supabase.from('agencies').select('*')
      .not('call_result', 'is', null).order('call_date', { ascending: false }).limit(50)
    setCalledAgencies(data || [])
  }

  // ─── Session logic ────────────────────────────────────
  async function drainPool(pool: React.MutableRefObject<string[]>, tier: 'accepted' | 'sent' | 'rest' | 'skipped'): Promise<Agency | null> {
    while (pool.current.length > 0) {
      const id = pool.current.shift()!
      if (usedRef.current.has(id)) continue
      const { data } = await supabase.from('agencies').select('*').eq('id', id).single()
      if (data && !data.call_result) {
        usedRef.current.add(id)
        setCurrentTier(tier)
        return data as Agency
      }
    }
    return null
  }

  async function fetchNext(): Promise<Agency | null> {
    // Priority: accepted → sent → rest → skipped (last resort)
    return (await drainPool(acceptedPoolRef, 'accepted'))
      || (await drainPool(sentPoolRef, 'sent'))
      || (await drainPool(restPoolRef, 'rest'))
      || (await drainPool(skippedPoolRef, 'skipped'))
  }

  async function buildPools() {
    const base = () => supabase.from('agencies').select('id, score')
      .eq('enrichment_status', 'done').eq('is_franchise', false)
      .not('phone', 'is', null).gte('score', 4).is('call_result', null)

    // Unskipped pools — ordered by score DESC
    const unskipped = () => base().is('call_skipped_at', null).order('score', { ascending: false, nullsFirst: false })
    // Skipped pool — oldest skip first (second-chance logic)
    const skipped = () => base().not('call_skipped_at', 'is', null).order('call_skipped_at', { ascending: true })

    const [accepted, sent, rest, skippedData] = await Promise.all([
      unskipped().eq('linkedin_status', 'accepted').limit(100),
      unskipped().eq('linkedin_status', 'sent').limit(100),
      unskipped().is('linkedin_status', null).limit(200),
      skipped().limit(200),
    ])
    acceptedPoolRef.current = (accepted.data || []).map(d => d.id)
    sentPoolRef.current = (sent.data || []).map(d => d.id)
    restPoolRef.current = (rest.data || []).map(d => d.id)
    skippedPoolRef.current = (skippedData.data || []).map(d => d.id)
  }

  async function startSession() {
    setLoading(true)
    acceptedPoolRef.current = []; sentPoolRef.current = []; restPoolRef.current = []; skippedPoolRef.current = []
    usedRef.current = new Set()
    setCompleted(0); setStreak(0)
    await buildPools()
    const a = await fetchNext()
    if (a) { setCurrentAgency(a); setInSession(true) }
    setLoading(false)
    motRef.current = MOTIVATIONS[Math.floor(Math.random() * MOTIVATIONS.length)]
  }

  async function recordCall(result: CallResult) {
    if (!currentAgency) return
    await supabase.from('agencies').update({
      call_result: result, call_date: new Date().toISOString(),
      call_notes: callNotes || null,
      callback_date: result === 'rappeler' && callbackDate ? callbackDate : null,
      call_skipped_at: null,
    }).eq('id', currentAgency.id)
    setTodayCalls(c => c + 1)
    if (result !== 'pas_décroché' && result !== 'mauvais_numéro') setTodayDecroches(d => d + 1)
    if (result === 'rdv') setTodayRdv(r => r + 1)
    if (result === 'rdv' || result === 'rappeler') setStreak(s => s + 1)
    else if (result !== 'pas_décroché') setStreak(0)
    setCompleted(c => c + 1)
    advance()
  }

  async function skip() {
    if (currentAgency) {
      await supabase.from('agencies').update({
        call_skipped_at: new Date().toISOString(),
      }).eq('id', currentAgency.id)
    }
    advance()
  }

  async function advance() {
    setCallNotes(''); setCallbackDate(''); setShowCallbackPicker(false)
    setTransitioning(true)
    motRef.current = MOTIVATIONS[Math.floor(Math.random() * MOTIVATIONS.length)]
    const next = completed + 1
    setTimeout(async () => {
      if (next >= sessionSize) {
        setInSession(false); setCurrentAgency(null); setTransitioning(false)
        loadAvailable(); loadCalled(); return
      }
      const a = await fetchNext()
      if (a) setCurrentAgency(a)
      else { setInSession(false); setCurrentAgency(null) }
      setTransitioning(false)
    }, 350)
  }

  async function release(id: string) {
    await supabase.from('agencies').update({ call_result: null, call_date: null, callback_date: null, call_notes: null }).eq('id', id)
    setCalledAgencies(prev => prev.filter(a => a.id !== id))
    setAvailableCount(c => c + 1)
  }

  async function changeResult(id: string, result: CallResult) {
    await supabase.from('agencies').update({ call_result: result }).eq('id', id)
    setCalledAgencies(prev => prev.map(a => a.id === id ? { ...a, call_result: result } : a))
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
          <button onClick={() => { setInSession(false); loadAvailable(); loadCalled() }}
            className="text-sm text-[var(--text-muted)] hover:text-[var(--text)]">
            Quitter
          </button>
          <div className="flex items-center gap-4">
            {streak >= 2 && (
              <span className="flex items-center gap-1 text-orange-400 text-sm font-bold">
                <Flame size={15} /> {streak}
              </span>
            )}
            <span className="text-sm text-[var(--text-muted)]">
              <b className="text-[var(--text)]">{completed + 1}</b>/{sessionSize}
            </span>
          </div>
        </div>

        {/* Progress */}
        <div className="h-1 bg-[var(--border)] rounded-full mb-6 overflow-hidden">
          <div className="h-full bg-[var(--accent)] rounded-full transition-all duration-500"
            style={{ width: `${(completed / sessionSize) * 100}%` }} />
        </div>

        {/* LinkedIn status block (always shown if linkedin info exists) */}
        {(a.linkedin_status || a.linkedin) && (
          <div className={`flex items-center justify-between gap-3 mb-4 px-3 py-2 rounded-lg border text-xs font-medium ${
            a.linkedin_status === 'accepted' ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400' :
            a.linkedin_status === 'sent'     ? 'bg-blue-500/10 border-blue-500/30 text-blue-400' :
            a.linkedin_status === 'ignored'  ? 'bg-red-500/10 border-red-500/30 text-red-400' :
                                                'bg-[var(--surface)] border-[var(--border)] text-[var(--text-muted)]'
          }`}>
            <div className="flex items-center gap-2">
              {a.linkedin_status === 'accepted' && <><CheckCircle2 size={14} /> Acceptée le {formatDateTime(a.linkedin_connect_date)}</>}
              {a.linkedin_status === 'sent'     && <><Send size={14} /> Demande envoyée le {formatDateTime(a.linkedin_connect_date)}</>}
              {a.linkedin_status === 'ignored'  && <><XCircle size={14} /> Ignorée le {formatDateTime(a.linkedin_connect_date)}</>}
              {!a.linkedin_status && <><Linkedin size={14} /> Profil LinkedIn dispo — aucune demande envoyée</>}
            </div>
            {a.linkedin && (
              <a href={a.linkedin} target="_blank" rel="noreferrer"
                className="flex items-center gap-1 hover:opacity-75">
                <Linkedin size={12} /> Profil
              </a>
            )}
          </div>
        )}

        {currentTier === 'skipped' && a.call_skipped_at && (
          <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-lg bg-zinc-500/10 border border-zinc-500/30 text-zinc-400 text-xs font-medium">
            <SkipForward size={14} />
            Skippé {new Date(a.call_skipped_at).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })} — dernière chance
          </div>
        )}

        {/* Agency name + city */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <h2 className="text-xl font-bold">{a.name}</h2>
            <p className="text-sm text-[var(--text-muted)] flex items-center gap-1.5 mt-1">
              <MapPin size={13} /> {a.city}
              {a.owner_name && <><span className="mx-1">·</span><User size={13} /> {a.owner_name}</>}
            </p>
          </div>
          {a.score && (
            <span className={`text-sm font-bold px-2.5 py-1 rounded-lg ${
              Number(a.score) >= 5 ? 'bg-emerald-500/15 text-emerald-400' : 'bg-amber-500/15 text-amber-400'
            }`}>{a.score}/5</span>
          )}
        </div>

        {/* Phone */}
        <a href={`tel:${a.phone}`}
          className="flex items-center justify-center gap-3 w-full py-4 mb-6 rounded-xl bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-lg font-bold transition-colors">
          <Phone size={20} /> {a.phone}
        </a>

        {/* Info cards */}
        <div className="space-y-3 mb-6">
          {a.sales_brief && (
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl px-4 py-3">
              <p className="text-[10px] uppercase tracking-wider text-[var(--accent)] font-semibold mb-1">Brief commercial</p>
              <p className="text-sm">{a.sales_brief}</p>
            </div>
          )}
          {a.score_reason && (
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl px-4 py-3">
              <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-semibold mb-1">Score</p>
              <p className="text-sm text-[var(--text-muted)]">{a.score_reason}</p>
            </div>
          )}
        </div>

        {/* Links */}
        <div className="flex gap-2 mb-6">
          {a.website && (
            <a href={a.website} target="_blank" rel="noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-[var(--surface)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors">
              <Globe size={13} /> Site web
            </a>
          )}
          {a.rating && (
            <span className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs bg-[var(--surface)] border border-[var(--border)] text-[var(--text-muted)]">
              <Star size={13} /> {a.rating}
            </span>
          )}
        </div>

        {/* Notes */}
        <input type="text" placeholder="Notes (optionnel)..." value={callNotes}
          onChange={e => setCallNotes(e.target.value)}
          className="w-full px-4 py-2.5 mb-6 rounded-xl bg-[var(--surface)] border border-[var(--border)] text-sm placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]" />

        {/* Result buttons */}
        <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
          {RESULTS.map(r => (
            <button key={r.key}
              onClick={() => r.key === 'rappeler' ? setShowCallbackPicker(true) : recordCall(r.key)}
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

        {/* Motivation */}
        <p className="text-center text-xs text-[var(--text-muted)] mt-4">{motRef.current} — encore {remaining}</p>

        {/* Callback modal */}
        {showCallbackPicker && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setShowCallbackPicker(false)}>
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 w-80" onClick={e => e.stopPropagation()}>
              <h3 className="font-bold mb-1">Date de rappel</h3>
              <p className="text-xs text-[var(--text-muted)] mb-4">Quand rappeler ?</p>
              <input type="date" value={callbackDate} onChange={e => setCallbackDate(e.target.value)}
                className="w-full px-4 py-2.5 rounded-xl bg-[var(--bg)] border border-[var(--border)] text-[var(--text)] mb-4 focus:outline-none focus:border-[var(--accent)]" />
              <div className="flex gap-2">
                <button onClick={() => setShowCallbackPicker(false)}
                  className="flex-1 py-2.5 rounded-xl border border-[var(--border)] text-sm text-[var(--text-muted)] hover:bg-[var(--surface-hover)]">Annuler</button>
                <button onClick={() => recordCall('rappeler')}
                  className="flex-1 py-2.5 rounded-xl bg-[var(--accent)] text-white text-sm font-medium hover:bg-[var(--accent-hover)]">Confirmer</button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // HOME VIEW
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  const dailyPct = dailyGoal > 0 ? Math.min(todayCalls / dailyGoal, 1) : 0

  return (
    <div>
      {/* Title */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-xl font-bold">Cold Call</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            {availableCount} disponibles
            {acceptedCount > 0 && (
              <> · <span className="text-emerald-400 font-semibold">{acceptedCount}</span> acceptés LinkedIn</>
            )}
            {sentCount > 0 && (
              <> · <span className="text-blue-400 font-semibold">{sentCount}</span> demandes envoyées</>
            )}
            {skippedCount > 0 && (
              <> · <span className="text-zinc-400 font-semibold">{skippedCount}</span> skippés</>
            )}
          </p>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-8">
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl px-4 py-3">
          <div className="flex items-center gap-2 text-[var(--text-muted)] mb-1">
            <Phone size={14} />
            <span className="text-[10px] uppercase tracking-wider">Appels</span>
          </div>
          <span className="text-xl font-bold">{todayCalls}<span className="text-sm font-normal text-[var(--text-muted)]">/{dailyGoal}</span></span>
          <div className="mt-2 h-1 bg-[var(--border)] rounded-full overflow-hidden">
            <div className="h-full bg-[var(--accent)] rounded-full transition-all" style={{ width: `${dailyPct * 100}%` }} />
          </div>
        </div>
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl px-4 py-3">
          <div className="flex items-center gap-2 text-[var(--text-muted)] mb-1">
            <TrendingUp size={14} />
            <span className="text-[10px] uppercase tracking-wider">Décrochés</span>
          </div>
          <span className="text-xl font-bold text-[var(--green)]">{todayDecroches}</span>
        </div>
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl px-4 py-3">
          <div className="flex items-center gap-2 text-[var(--text-muted)] mb-1">
            <Trophy size={14} />
            <span className="text-[10px] uppercase tracking-wider">RDV</span>
          </div>
          <span className="text-xl font-bold text-emerald-400">{todayRdv}</span>
        </div>
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl px-4 py-3">
          <div className="flex items-center gap-2 text-[var(--text-muted)] mb-1">
            <Target size={14} />
            <span className="text-[10px] uppercase tracking-wider">Session</span>
          </div>
          <input type="number" value={sessionSize}
            onChange={e => { setSessionSize(Number(e.target.value)); localStorage.setItem('cc_session_size', e.target.value) }}
            className="w-full bg-transparent text-xl font-bold focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
        </div>
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl px-4 py-3">
          <div className="flex items-center gap-2 text-[var(--text-muted)] mb-1">
            <CalendarClock size={14} />
            <span className="text-[10px] uppercase tracking-wider">Objectif/j</span>
          </div>
          <input type="number" value={dailyGoal}
            onChange={e => { setDailyGoal(Number(e.target.value)); localStorage.setItem('cc_daily_goal', e.target.value) }}
            className="w-full bg-transparent text-xl font-bold focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
        </div>
      </div>

      {/* Launch button */}
      <div className="flex justify-center mb-10">
        <button onClick={startSession} disabled={loading || availableCount === 0}
          className="flex items-center gap-3 px-8 py-3.5 rounded-xl bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white font-bold transition-colors disabled:opacity-40">
          {loading ? <Loader2 size={18} className="animate-spin" /> : <Zap size={18} />}
          {loading ? 'Chargement...' : `Lancer ${Math.min(sessionSize, availableCount)} appels`}
        </button>
      </div>

      {/* History */}
      {calledAgencies.length > 0 && (
        <div>
          <button onClick={() => setShowCalled(!showCalled)}
            className="flex items-center gap-2 text-sm text-[var(--text-muted)] hover:text-[var(--text)] mb-4">
            {showCalled ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
            <Clock size={14} />
            <span>Historique ({calledAgencies.length})</span>
          </button>

          {showCalled && (
            <div className="space-y-2">
              {calledAgencies.map(a => {
                const cfg = RESULT_MAP[a.call_result as CallResult]
                return (
                  <div key={a.id} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium">{a.name}</span>
                        <span className="text-xs text-[var(--text-muted)] ml-2">{a.city}</span>
                        {a.call_notes && <p className="text-xs text-[var(--text-muted)] mt-0.5 truncate">{a.call_notes}</p>}
                      </div>

                      {a.call_date && (
                        <span className="text-[10px] text-[var(--text-muted)] shrink-0">
                          {new Date(a.call_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                        </span>
                      )}

                      <button onClick={() => setEditingId(editingId === a.id ? null : a.id)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-medium shrink-0 transition-colors ${cfg?.badgeClass || 'bg-zinc-500/15 text-zinc-400'}`}>
                        {cfg?.label || a.call_result}
                        {a.call_result === 'rappeler' && a.callback_date && (
                          <span className="ml-1 opacity-60">{new Date(a.callback_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}</span>
                        )}
                      </button>

                      <button onClick={() => release(a.id)} title="Reset"
                        className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-hover)] transition-colors shrink-0">
                        <RotateCcw size={13} />
                      </button>
                    </div>

                    {editingId === a.id && (
                      <div className="flex flex-wrap gap-1.5 mt-3 pt-3 border-t border-[var(--border)]">
                        {RESULTS.map(r => (
                          <button key={r.key} onClick={() => changeResult(a.id, r.key)}
                            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                              a.call_result === r.key ? 'ring-1 ring-[var(--accent)] ' : ''
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
