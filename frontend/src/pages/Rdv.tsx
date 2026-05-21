import { useEffect, useState } from 'react'
import {
  RefreshCw, MapPin, Mail, Phone, CalendarClock,
  StickyNote, Pencil, Check, X, User, Copy, Trophy, Trash2
} from 'lucide-react'
import { supabase } from '../lib/supabase'

type Row = {
  agency_id: string
  agency_name: string
  agency_city: string
  owner_name: string | null
  agency_email: string | null
  manager_phone: string | null
  agency_phone: string | null
  rdv_at: string
  call_notes: string | null
}

type Filter = 'upcoming' | 'past' | 'all'

function relativeLabel(iso: string): { label: string; cls: string } {
  const now = new Date()
  const d = new Date(iso)
  const diffMs = d.getTime() - now.getTime()
  const diffMin = Math.round(diffMs / 60000)
  const diffH = Math.round(diffMs / 3600000)
  const day = new Date(d); day.setHours(0, 0, 0, 0)
  const today = new Date(now); today.setHours(0, 0, 0, 0)
  const diffDays = Math.round((day.getTime() - today.getTime()) / 86400000)

  if (diffMs < 0) return { label: 'Passé', cls: 'bg-zinc-500/15 text-zinc-400' }
  if (diffMin < 60) return { label: `Dans ${diffMin}min`, cls: 'bg-red-500/20 text-red-300' }
  if (diffH < 6) return { label: `Dans ${diffH}h`, cls: 'bg-orange-500/20 text-orange-300' }
  if (diffDays === 0) return { label: "Aujourd'hui", cls: 'bg-emerald-500/15 text-emerald-400' }
  if (diffDays === 1) return { label: 'Demain', cls: 'bg-blue-500/15 text-blue-400' }
  if (diffDays <= 7) return { label: `Dans ${diffDays}j`, cls: 'bg-blue-500/10 text-blue-400' }
  return { label: `Dans ${diffDays}j`, cls: 'bg-zinc-500/15 text-zinc-400' }
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long',
    hour: '2-digit', minute: '2-digit'
  })
}

export default function Rdv() {
  const [filter, setFilter] = useState<Filter>('upcoming')
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(false)
  const [acting, setActing] = useState<string | null>(null)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [counts, setCounts] = useState<{ upcoming: number; past: number; all: number }>({ upcoming: 0, past: 0, all: 0 })
  const [editingNotesId, setEditingNotesId] = useState<string | null>(null)
  const [editingNotesValue, setEditingNotesValue] = useState('')
  const [savingNotes, setSavingNotes] = useState(false)
  const [editingDateId, setEditingDateId] = useState<string | null>(null)
  const [editingDateValue, setEditingDateValue] = useState('')

  useEffect(() => { load() }, [filter])

  async function load() {
    setLoading(true)
    const { data } = await supabase
      .from('agencies')
      .select('id, name, city, email, phone, manager_phone, owner_name, rdv_at, call_notes')
      .not('rdv_at', 'is', null)
      .order('rdv_at', { ascending: true })

    if (!data) { setRows([]); setLoading(false); return }

    const now = new Date()
    const mapped: Row[] = data.map(a => ({
      agency_id: a.id,
      agency_name: a.name,
      agency_city: a.city || '',
      owner_name: a.owner_name,
      agency_email: a.email,
      manager_phone: a.manager_phone,
      agency_phone: a.phone,
      rdv_at: a.rdv_at,
      call_notes: a.call_notes,
    }))

    const upcoming = mapped.filter(r => new Date(r.rdv_at) >= now).length
    const past = mapped.length - upcoming
    setCounts({ upcoming, past, all: mapped.length })

    let filtered = mapped
    if (filter === 'upcoming') filtered = mapped.filter(r => new Date(r.rdv_at) >= now)
    else if (filter === 'past') filtered = mapped.filter(r => new Date(r.rdv_at) < now)

    setRows(filtered)
    setLoading(false)
  }

  function copy(text: string, key: string) {
    navigator.clipboard.writeText(text)
    setCopiedKey(key)
    setTimeout(() => setCopiedKey(prev => (prev === key ? null : prev)), 2000)
  }

  function startEditNotes(row: Row) {
    setEditingNotesId(row.agency_id)
    setEditingNotesValue(row.call_notes || '')
  }

  async function saveNotes(row: Row) {
    setSavingNotes(true)
    const newNotes = editingNotesValue.trim() || null
    await supabase.from('agencies').update({ call_notes: newNotes }).eq('id', row.agency_id)
    setRows(prev => prev.map(r => r.agency_id === row.agency_id ? { ...r, call_notes: newNotes } : r))
    setSavingNotes(false)
    setEditingNotesId(null)
  }

  function toLocalInput(iso: string): string {
    const d = new Date(iso)
    const off = d.getTimezoneOffset()
    const local = new Date(d.getTime() - off * 60000)
    return local.toISOString().slice(0, 16)
  }

  function startEditDate(row: Row) {
    setEditingDateId(row.agency_id)
    setEditingDateValue(toLocalInput(row.rdv_at))
  }

  async function saveDate(row: Row) {
    if (!editingDateValue) return
    setActing(row.agency_id)
    const iso = new Date(editingDateValue).toISOString()
    await supabase.from('agencies').update({ rdv_at: iso }).eq('id', row.agency_id)
    setEditingDateId(null)
    setActing(null)
    load()
  }

  async function markDone(row: Row) {
    if (!confirm(`Marquer le RDV avec "${row.agency_name}" comme terminé ?`)) return
    setActing(row.agency_id)
    await supabase.from('agencies').update({ rdv_at: null }).eq('id', row.agency_id)
    setActing(null)
    setRows(prev => prev.filter(r => r.agency_id !== row.agency_id))
    setCounts(c => ({ ...c, [filter]: Math.max(0, c[filter] - 1), all: Math.max(0, c.all - 1) }))
  }

  const tabs: { key: Filter; label: string; count: number; cls: string }[] = [
    { key: 'upcoming', label: 'À venir', count: counts.upcoming, cls: 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300' },
    { key: 'past', label: 'Passés', count: counts.past, cls: 'bg-zinc-500/15 border-zinc-500/40 text-zinc-300' },
    { key: 'all', label: 'Tous', count: counts.all, cls: 'bg-blue-500/15 border-blue-500/40 text-blue-300' },
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <Trophy size={18} className="text-emerald-400" />
            RDV pris
          </h2>
          <p className="text-xs text-[var(--text-muted)] mt-1">Visios et meetings confirmés — triés par date.</p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-[var(--surface)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] transition-colors"
        >
          <RefreshCw size={13} /> Actualiser
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {tabs.map(t => {
          const isActive = filter === t.key
          return (
            <button
              key={t.key}
              onClick={() => setFilter(t.key)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                isActive ? t.cls : 'bg-[var(--surface)] border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-hover)]'
              }`}
            >
              <span className="font-medium">{t.label}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${isActive ? 'bg-black/20' : 'bg-zinc-500/20 text-zinc-400'}`}>{t.count}</span>
            </button>
          )
        })}
      </div>

      <div className="flex flex-col gap-3">
        {loading ? (
          <div className="p-8 text-center text-sm text-[var(--text-muted)]">Chargement...</div>
        ) : rows.length === 0 ? (
          <div className="rounded-lg bg-[var(--surface)] border border-[var(--border)] p-8 text-center text-sm text-[var(--text-muted)]">
            Aucun RDV {filter === 'upcoming' ? 'à venir' : filter === 'past' ? 'passé' : ''}.
          </div>
        ) : (
          rows.map(r => {
            const b = relativeLabel(r.rdv_at)
            const phone = r.manager_phone || r.agency_phone
            return (
              <div key={r.agency_id} className="rounded-lg bg-[var(--surface)] border border-[var(--border)] overflow-hidden">
                <div className="px-4 py-3 flex flex-col gap-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <button
                        onClick={() => copy(r.agency_name, `name-${r.agency_id}`)}
                        className="group flex items-center gap-2 text-left hover:text-[var(--accent)] transition-colors"
                        title="Copier le nom"
                      >
                        <span className="font-semibold text-base">{r.agency_name}</span>
                        <Copy size={13} className={copiedKey === `name-${r.agency_id}` ? 'text-emerald-400' : 'opacity-40 group-hover:opacity-100 transition-opacity'} />
                      </button>
                      <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] mt-0.5 flex-wrap">
                        <MapPin size={11} /> {r.agency_city}
                        <span className={`ml-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${b.cls}`}>{b.label}</span>
                      </div>
                    </div>
                    <button
                      onClick={() => markDone(r)}
                      disabled={acting === r.agency_id}
                      className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-zinc-500/15 text-zinc-400 hover:bg-zinc-500/25 disabled:opacity-40"
                      title="Marquer le RDV comme terminé (efface rdv_at)"
                    >
                      <Trash2 size={11} /> Terminé
                    </button>
                  </div>

                  {editingDateId === r.agency_id ? (
                    <div className="flex items-center gap-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg p-2">
                      <CalendarClock size={13} className="text-blue-400" />
                      <input
                        type="datetime-local"
                        value={editingDateValue}
                        onChange={e => setEditingDateValue(e.target.value)}
                        className="flex-1 bg-transparent text-xs text-[var(--text)] focus:outline-none"
                      />
                      <button
                        onClick={() => setEditingDateId(null)}
                        className="text-[var(--text-muted)] hover:text-[var(--text)] p-1"
                      ><X size={12} /></button>
                      <button
                        onClick={() => saveDate(r)}
                        disabled={acting === r.agency_id}
                        className="text-emerald-400 hover:text-emerald-300 p-1 disabled:opacity-40"
                      ><Check size={12} /></button>
                    </div>
                  ) : (
                    <button
                      onClick={() => startEditDate(r)}
                      className="flex items-center gap-1.5 text-sm text-blue-300 hover:text-blue-200 self-start group"
                      title="Modifier la date/heure"
                    >
                      <CalendarClock size={13} />
                      <span className="font-medium capitalize">{formatDateTime(r.rdv_at)}</span>
                      <Pencil size={10} className="opacity-0 group-hover:opacity-60 transition-opacity" />
                    </button>
                  )}

                  <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
                    {r.owner_name && (
                      <button
                        onClick={() => copy(r.owner_name!, `owner-${r.agency_id}`)}
                        className="group flex items-center gap-1.5 text-amber-400 hover:text-amber-300"
                        title="Copier le nom du gérant"
                      >
                        <User size={12} /> Gérant : <strong>{r.owner_name}</strong>
                        <Copy
                          size={11}
                          className={copiedKey === `owner-${r.agency_id}` ? 'text-emerald-400' : 'opacity-40 group-hover:opacity-100 transition-opacity'}
                        />
                      </button>
                    )}
                    {r.agency_email && (
                      <a
                        href={`mailto:${r.agency_email}`}
                        className="flex items-center gap-1.5 text-[var(--text-muted)] hover:text-[var(--text)]"
                      >
                        <Mail size={12} /> {r.agency_email}
                      </a>
                    )}
                    {phone && (
                      <a href={`tel:${phone}`} className="flex items-center gap-1.5 text-emerald-400 hover:underline">
                        <Phone size={12} /> {phone}
                        {r.manager_phone === phone && <span className="opacity-70">(gérant)</span>}
                      </a>
                    )}
                  </div>

                  {editingNotesId === r.agency_id ? (
                    <div className="flex flex-col gap-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg p-2">
                      <textarea
                        autoFocus
                        value={editingNotesValue}
                        onChange={e => setEditingNotesValue(e.target.value)}
                        rows={4}
                        placeholder="Détails du RDV, TODO, lien Meet, contact perso..."
                        className="w-full bg-transparent text-xs text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none resize-none"
                      />
                      <div className="flex gap-2 justify-end">
                        <button
                          onClick={() => setEditingNotesId(null)}
                          disabled={savingNotes}
                          className="flex items-center gap-1 text-xs px-2 py-1 rounded text-[var(--text-muted)] hover:bg-[var(--surface-hover)] disabled:opacity-40"
                        >
                          <X size={12} /> Annuler
                        </button>
                        <button
                          onClick={() => saveNotes(r)}
                          disabled={savingNotes}
                          className="flex items-center gap-1 text-xs px-2 py-1 rounded bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 disabled:opacity-40"
                        >
                          <Check size={12} /> Enregistrer
                        </button>
                      </div>
                    </div>
                  ) : r.call_notes ? (
                    <div className="flex items-start gap-2 bg-amber-500/5 border border-amber-500/20 rounded-lg px-2.5 py-2 group">
                      <StickyNote size={12} className="text-amber-400 mt-0.5 shrink-0" />
                      <p className="flex-1 text-xs text-amber-100/90 whitespace-pre-wrap break-words leading-relaxed">{r.call_notes}</p>
                      <button
                        onClick={() => startEditNotes(r)}
                        className="text-amber-400/60 hover:text-amber-400 transition-colors shrink-0 opacity-0 group-hover:opacity-100"
                        title="Éditer la note"
                      >
                        <Pencil size={12} />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => startEditNotes(r)}
                      className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-amber-400 transition-colors self-start"
                    >
                      <StickyNote size={11} /> Ajouter une note
                    </button>
                  )}
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
