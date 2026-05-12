import { useEffect, useMemo, useState } from 'react'
import { Plus, Trash2, Flame, Check, CalendarDays, X, Target, RefreshCw } from 'lucide-react'
import { supabase } from '../lib/supabase'

const START_DATE = '2026-05-18'
const TOTAL_DAYS = 60

const COLOR_OPTIONS = [
  { key: 'sky', bg: 'bg-sky-500', text: 'text-sky-400', border: 'border-sky-500/50' },
  { key: 'green', bg: 'bg-green-500', text: 'text-green-400', border: 'border-green-500/50' },
  { key: 'purple', bg: 'bg-purple-500', text: 'text-purple-400', border: 'border-purple-500/50' },
  { key: 'orange', bg: 'bg-orange-500', text: 'text-orange-400', border: 'border-orange-500/50' },
  { key: 'pink', bg: 'bg-pink-500', text: 'text-pink-400', border: 'border-pink-500/50' },
  { key: 'amber', bg: 'bg-amber-500', text: 'text-amber-400', border: 'border-amber-500/50' },
  { key: 'cyan', bg: 'bg-cyan-500', text: 'text-cyan-400', border: 'border-cyan-500/50' },
  { key: 'rose', bg: 'bg-rose-500', text: 'text-rose-400', border: 'border-rose-500/50' },
]

function colorClasses(key: string) {
  return COLOR_OPTIONS.find(c => c.key === key) ?? COLOR_OPTIONS[0]
}

type Habit = {
  id: string
  name: string
  emoji: string | null
  color: string
  sort_order: number
  archived: boolean
}

type Log = {
  id: string
  habit_id: string
  date: string
  value: number
}

function addDays(iso: string, days: number) {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

function todayISO() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function diffDays(a: string, b: string) {
  const ad = new Date(a + 'T00:00:00Z').getTime()
  const bd = new Date(b + 'T00:00:00Z').getTime()
  return Math.round((ad - bd) / 86_400_000)
}

function formatDate(iso: string) {
  const d = new Date(iso + 'T00:00:00Z')
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

export default function Habits() {
  const [habits, setHabits] = useState<Habit[]>([])
  const [logs, setLogs] = useState<Log[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState('')
  const [newEmoji, setNewEmoji] = useState('')
  const [newColor, setNewColor] = useState('sky')

  const today = todayISO()
  const days = useMemo(() => Array.from({ length: TOTAL_DAYS }, (_, i) => addDays(START_DATE, i)), [])
  const endDate = days[TOTAL_DAYS - 1]
  const dayIndex = diffDays(today, START_DATE)
  const isStarted = dayIndex >= 0
  const isEnded = dayIndex >= TOTAL_DAYS
  const elapsedDays = Math.max(0, Math.min(TOTAL_DAYS, dayIndex + 1))

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [hRes, lRes] = await Promise.all([
      supabase.from('habits').select('*').eq('archived', false).order('sort_order'),
      supabase.from('habit_logs').select('*').gte('date', START_DATE).lte('date', endDate),
    ])
    setHabits((hRes.data || []) as Habit[])
    setLogs((lRes.data || []).map((l: { id: string; habit_id: string; date: string; value: number | string }) => ({
      ...l,
      value: Number(l.value),
    })) as Log[])
    setLoading(false)
  }

  // Cycle entre 3 etats : vide -> 1.0 (fait) -> 0.5 (a moitie) -> vide
  async function cycleLog(habit_id: string, date: string, currentValue: number | null) {
    const existing = logs.find(l => l.habit_id === habit_id && l.date === date)
    const nextValue: number | null =
      currentValue == null ? 1.0
      : currentValue >= 1.0 ? 0.5
      : null

    if (nextValue === null) {
      if (!existing) return
      setLogs(prev => prev.filter(l => l.id !== existing.id))
      const { error } = await supabase.from('habit_logs').delete().eq('id', existing.id)
      if (error) {
        console.error('[habits] delete failed:', error)
        alert(`Erreur suppression : ${error.message}`)
        load()
      }
      return
    }

    if (existing) {
      setLogs(prev => prev.map(l => l.id === existing.id ? { ...l, value: nextValue } : l))
      const { error } = await supabase.from('habit_logs').update({ value: nextValue }).eq('id', existing.id)
      if (error) {
        console.error('[habits] update failed:', error)
        alert(`Erreur update : ${error.message}`)
        load()
      }
      return
    }

    const tmpId = `tmp-${Date.now()}-${Math.random()}`
    setLogs(prev => [...prev, { id: tmpId, habit_id, date, value: nextValue }])
    const { data, error } = await supabase
      .from('habit_logs')
      .insert({ habit_id, date, value: nextValue })
      .select()
      .single()
    if (error || !data) {
      console.error('[habits] insert failed:', error, { habit_id, date, value: nextValue })
      alert(`Erreur insert : ${error?.message ?? 'aucune donnee'}`)
      setLogs(prev => prev.filter(l => l.id !== tmpId))
      return
    }
    const inserted = { ...(data as Log), value: Number((data as Log).value) }
    setLogs(prev => prev.map(l => l.id === tmpId ? inserted : l))
  }

  async function addHabit() {
    if (!newName.trim()) return
    const maxOrder = habits.length > 0 ? Math.max(...habits.map(h => h.sort_order)) : -1
    const { data, error } = await supabase
      .from('habits')
      .insert({ name: newName.trim(), emoji: newEmoji.trim() || null, color: newColor, sort_order: maxOrder + 1 })
      .select()
      .single()
    if (error || !data) return
    setHabits(prev => [...prev, data as Habit])
    setNewName('')
    setNewEmoji('')
    setNewColor('sky')
    setShowAdd(false)
  }

  async function deleteHabit(id: string) {
    if (!confirm('Supprimer cette habitude ? Tous les logs seront effaces.')) return
    setHabits(prev => prev.filter(h => h.id !== id))
    setLogs(prev => prev.filter(l => l.habit_id !== id))
    await supabase.from('habits').delete().eq('id', id)
  }

  if (loading) return <p className="text-[var(--text-muted)]">Chargement...</p>

  // habit_id -> (date -> value)
  const logsByHabit = new Map<string, Map<string, number>>()
  habits.forEach(h => logsByHabit.set(h.id, new Map()))
  logs.forEach(l => logsByHabit.get(l.habit_id)?.set(l.date, l.value))

  function getValue(habitId: string, date: string): number | null {
    const v = logsByHabit.get(habitId)?.get(date)
    return v == null ? null : v
  }

  // Streak: jours consecutifs avec une valeur > 0 (1.0 ou 0.5)
  function currentStreak(habitId: string) {
    const m = logsByHabit.get(habitId)
    if (!isStarted || !m) return 0
    const refDay = Math.min(dayIndex, TOTAL_DAYS - 1)
    let streak = 0
    for (let i = refDay; i >= 0; i--) {
      if ((m.get(days[i]) ?? 0) > 0) streak++
      else break
    }
    return streak
  }

  function bestStreak(habitId: string) {
    const m = logsByHabit.get(habitId)
    if (!m) return 0
    let best = 0
    let curr = 0
    for (let i = 0; i < TOTAL_DAYS; i++) {
      if ((m.get(days[i]) ?? 0) > 0) {
        curr++
        if (curr > best) best = curr
      } else {
        curr = 0
      }
    }
    return best
  }

  // Completion ponderee :
  // - Pendant la periode : somme des valeurs / jours ecoules
  // - Avant la periode (pre-coches) : moyenne des valeurs cochees / nb jours coches
  function completionPct(habitId: string) {
    const m = logsByHabit.get(habitId)
    if (!m || m.size === 0) return 0
    if (elapsedDays > 0) {
      let sum = 0
      for (let i = 0; i < elapsedDays; i++) sum += m.get(days[i]) ?? 0
      return Math.round((sum / elapsedDays) * 100)
    }
    let sum = 0
    for (const v of m.values()) sum += v
    return Math.round((sum / m.size) * 100)
  }

  // Score pondere du jour cible (today si demarrage, sinon day 1)
  const scoreDate = isStarted ? today : days[0]
  const todayScore = !isEnded && habits.length > 0
    ? Math.round((habits.reduce((s, h) => s + (logsByHabit.get(h.id)?.get(scoreDate) ?? 0), 0) / habits.length) * 100)
    : 0

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Target size={22} className="text-[var(--accent)]" />
            Habitudes
          </h2>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            Du {formatDate(START_DATE)} au {formatDate(endDate)} - {TOTAL_DAYS} jours
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm bg-[var(--surface)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-hover)]"
            title="Recharger depuis la base"
          >
            <RefreshCw size={14} /> Actualiser
          </button>
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm bg-[var(--accent)] text-white hover:opacity-90"
          >
            <Plus size={16} /> Ajouter
          </button>
        </div>
      </div>

      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
        {!isStarted ? (
          <div className="text-center py-2">
            <CalendarDays size={28} className="mx-auto text-[var(--text-muted)] mb-2" />
            <div className="text-sm font-medium">Demarrage dans {Math.abs(dayIndex)} jour{Math.abs(dayIndex) > 1 ? 's' : ''}</div>
            <div className="text-xs text-[var(--text-muted)] mt-1">Le {formatDate(START_DATE)}</div>
          </div>
        ) : isEnded ? (
          <div className="text-center py-2">
            <div className="text-sm font-medium">Periode terminee</div>
            <div className="text-xs text-[var(--text-muted)] mt-1">Du {formatDate(START_DATE)} au {formatDate(endDate)}</div>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <div className="text-xs text-[var(--text-muted)]">Jour</div>
              <div className="text-2xl font-bold">{dayIndex + 1}<span className="text-sm text-[var(--text-muted)]"> / {TOTAL_DAYS}</span></div>
            </div>
            <div className="flex-1 min-w-[180px]">
              <div className="h-2 bg-[var(--bg)] rounded-full overflow-hidden">
                <div className="h-full bg-[var(--accent)]" style={{ width: `${((dayIndex + 1) / TOTAL_DAYS) * 100}%` }} />
              </div>
              <div className="text-[10px] text-[var(--text-muted)] mt-1">
                {Math.round(((dayIndex + 1) / TOTAL_DAYS) * 100)}% de la periode
              </div>
            </div>
            {habits.length > 0 && (
              <div className="text-right">
                <div className="text-xs text-[var(--text-muted)]">Score aujourd'hui</div>
                <div className={`text-2xl font-bold ${todayScore >= 80 ? 'text-green-400' : todayScore >= 40 ? 'text-yellow-400' : 'text-[var(--text-muted)]'}`}>{todayScore}<span className="text-sm text-[var(--text-muted)]">%</span></div>
              </div>
            )}
          </div>
        )}
      </div>

      {habits.length === 0 ? (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-8 text-center">
          <Target size={32} className="mx-auto text-[var(--text-muted)] mb-3" />
          <p className="text-sm text-[var(--text-muted)] mb-4">Aucune habitude pour l'instant.</p>
          <button
            onClick={() => setShowAdd(true)}
            className="px-4 py-2 rounded-lg text-sm bg-[var(--accent)] text-white inline-flex items-center gap-1.5 hover:opacity-90"
          >
            <Plus size={16} /> Creer ma premiere habitude
          </button>
        </div>
      ) : (
        <>
          {!isEnded && (() => {
            const targetDate = isStarted ? today : days[0]
            const targetDayNum = isStarted ? dayIndex + 1 : 1
            const title = isStarted
              ? `Aujourd'hui - ${formatDate(today)}`
              : `Jour 1 - ${formatDate(days[0])} (demarrage dans ${Math.abs(dayIndex)}j)`
            return (
            <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
              <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                <h3 className="text-sm font-semibold">{title}</h3>
                <span className="text-[10px] text-[var(--text-muted)]">Jour {targetDayNum} / {TOTAL_DAYS}</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {habits.map(h => {
                  const value = getValue(h.id, targetDate)
                  const cc = colorClasses(h.color)
                  const isFull = value != null && value >= 1
                  const isHalf = value != null && value < 1
                  const label = isFull ? 'Fait' : isHalf ? 'A moitie' : 'A faire'
                  return (
                    <button
                      key={h.id}
                      onClick={() => cycleLog(h.id, targetDate, value)}
                      className={`flex items-center gap-3 p-3 rounded-lg border transition-colors text-left ${
                        value != null
                          ? `${cc.border} bg-[var(--bg)]`
                          : 'border-[var(--border)] bg-[var(--bg)] hover:bg-[var(--surface-hover)]'
                      }`}
                    >
                      <div className={`w-9 h-9 rounded-md flex items-center justify-center shrink-0 border ${
                        value != null
                          ? `${cc.bg} border-transparent ${isHalf ? 'opacity-50' : ''}`
                          : 'bg-[var(--surface)] border-[var(--border)]'
                      }`}>
                        {isFull ? <Check size={18} className="text-white" />
                          : isHalf ? <span className="text-white text-xs font-bold">½</span>
                          : (h.emoji ? <span className="text-lg">{h.emoji}</span> : null)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium truncate">{h.name}</div>
                        <div className={`text-[10px] ${value != null ? cc.text : 'text-[var(--text-muted)]'}`}>
                          {label}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
              <div className="text-[10px] text-[var(--text-muted)] mt-3">
                Clic 1 : fait (100%) · Clic 2 : a moitie (50%) · Clic 3 : efface (0%)
              </div>
            </div>
            )
          })()}

          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
            <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
              <CalendarDays size={16} className="text-[var(--accent)]" />
              Vue 60 jours
            </h3>
            <div className="overflow-x-auto">
              <table className="text-xs">
                <thead>
                  <tr>
                    <th className="text-left pr-3 sticky left-0 bg-[var(--surface)] z-10 min-w-[110px]">Habitude</th>
                    {days.map((d, i) => {
                      const dt = new Date(d + 'T00:00:00Z')
                      const dayNum = dt.getUTCDate()
                      const isFirstOfMonth = dayNum === 1 || i === 0
                      return (
                        <th key={d} className="px-0.5 font-normal text-[var(--text-muted)] text-[9px]">
                          <div className="w-5 text-center">
                            {isFirstOfMonth ? `${dayNum}/${dt.getUTCMonth() + 1}` : dayNum}
                          </div>
                        </th>
                      )
                    })}
                    <th className="pl-3 text-right">Streak</th>
                    <th className="pl-3 text-right">Taux</th>
                    <th className="pl-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {habits.map(h => {
                    const cc = colorClasses(h.color)
                    const cs = currentStreak(h.id)
                    const completion = completionPct(h.id)
                    return (
                      <tr key={h.id} className="hover:bg-[var(--bg)]">
                        <td className="pr-3 py-1 sticky left-0 bg-[var(--surface)] z-10 max-w-[140px]">
                          <div className="flex items-center gap-1.5 truncate">
                            {h.emoji && <span>{h.emoji}</span>}
                            <span className="truncate">{h.name}</span>
                          </div>
                        </td>
                        {days.map(d => {
                          const value = getValue(h.id, d)
                          const isFull = value != null && value >= 1
                          const isHalf = value != null && value < 1
                          const isFuture = isStarted && diffDays(d, today) > 0
                          const isToday = d === today
                          return (
                            <td key={d} className="px-0.5 py-1">
                              <button
                                onClick={() => cycleLog(h.id, d, value)}
                                className={`w-5 h-5 rounded-sm transition-colors ${
                                  isFull ? cc.bg
                                  : isHalf ? `${cc.bg} opacity-50`
                                  : isFuture
                                    ? 'bg-[var(--bg)] hover:bg-[var(--surface-hover)] border border-[var(--border)] opacity-50'
                                    : 'bg-[var(--bg)] hover:bg-[var(--surface-hover)] border border-[var(--border)]'
                                } ${isToday ? 'ring-1 ring-[var(--accent)]' : ''}`}
                                title={`${formatDate(d)}${value != null ? ` - ${value >= 1 ? '100%' : '50%'}` : ''}`}
                              />
                            </td>
                          )
                        })}
                        <td className="pl-3 text-right whitespace-nowrap">
                          <span className="inline-flex items-center gap-1 font-medium">
                            <Flame size={11} className={cs > 0 ? 'text-amber-400' : 'text-[var(--text-muted)]'} />
                            {cs}
                          </span>
                        </td>
                        <td className="pl-3 text-right">
                          <span className={`font-bold ${completion >= 80 ? 'text-green-400' : completion >= 50 ? 'text-yellow-400' : 'text-[var(--text-muted)]'}`}>
                            {completion}%
                          </span>
                        </td>
                        <td className="pl-2">
                          <button
                            onClick={() => deleteHabit(h.id)}
                            className="text-[var(--text-muted)] hover:text-red-400"
                            title="Supprimer"
                          >
                            <Trash2 size={13} />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="text-[10px] text-[var(--text-muted)] mt-3 flex flex-wrap items-center gap-3">
              <span>Cycle :</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-[var(--accent)]" /> 100%</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-[var(--accent)] opacity-50" /> 50%</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-[var(--bg)] border border-[var(--border)]" /> 0%</span>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {habits.map(h => {
              const cc = colorClasses(h.color)
              const cs = currentStreak(h.id)
              const bs = bestStreak(h.id)
              const m = logsByHabit.get(h.id) || new Map()
              const totalChecked = m.size
              const completion = completionPct(h.id)
              return (
                <div key={h.id} className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <div className={`w-8 h-8 rounded-md ${cc.bg} flex items-center justify-center`}>
                      {h.emoji ? <span className="text-lg">{h.emoji}</span> : <Check size={16} className="text-white" />}
                    </div>
                    <div className="flex-1 truncate">
                      <div className="text-sm font-medium truncate">{h.name}</div>
                    </div>
                    <button
                      onClick={() => deleteHabit(h.id)}
                      className="p-1.5 rounded-md text-[var(--text-muted)] hover:text-red-400 hover:bg-red-500/10 transition-colors shrink-0"
                      title="Supprimer cette habitude"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <div className="text-[10px] text-[var(--text-muted)]">Streak</div>
                      <div className="text-lg font-bold flex items-center gap-1">
                        <Flame size={13} className="text-amber-400" /> {cs}
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] text-[var(--text-muted)]">Record</div>
                      <div className="text-lg font-bold">{bs}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-[var(--text-muted)]">Total</div>
                      <div className="text-lg font-bold">{totalChecked}</div>
                    </div>
                  </div>
                  <div className="mt-3">
                    <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)] mb-1">
                      <span>Completion</span><span>{completion}%</span>
                    </div>
                    <div className="h-1.5 bg-[var(--bg)] rounded-full overflow-hidden">
                      <div className={`h-full ${cc.bg}`} style={{ width: `${completion}%` }} />
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {showAdd && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4"
          onClick={() => setShowAdd(false)}
        >
          <div
            className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5 w-full max-w-sm"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold">Nouvelle habitude</h3>
              <button onClick={() => setShowAdd(false)} className="text-[var(--text-muted)]">
                <X size={18} />
              </button>
            </div>
            <div className="flex flex-col gap-3">
              <div>
                <label className="text-[10px] text-[var(--text-muted)]">Nom</label>
                <input
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="ex: Mediter 10 min"
                  className="w-full mt-1 px-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-[10px] text-[var(--text-muted)]">Emoji (optionnel)</label>
                <input
                  value={newEmoji}
                  onChange={e => setNewEmoji(e.target.value.slice(0, 4))}
                  placeholder=""
                  className="w-full mt-1 px-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm"
                />
              </div>
              <div>
                <label className="text-[10px] text-[var(--text-muted)]">Couleur</label>
                <div className="flex gap-2 mt-2 flex-wrap">
                  {COLOR_OPTIONS.map(c => (
                    <button
                      key={c.key}
                      onClick={() => setNewColor(c.key)}
                      className={`w-7 h-7 rounded-md ${c.bg} ${newColor === c.key ? 'ring-2 ring-white ring-offset-2 ring-offset-[var(--surface)]' : ''}`}
                    />
                  ))}
                </div>
              </div>
              <button
                onClick={addHabit}
                disabled={!newName.trim()}
                className="mt-2 px-3 py-2.5 rounded-lg bg-[var(--accent)] text-white text-sm font-medium disabled:opacity-50"
              >
                Creer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
