import { useEffect, useState } from 'react'
import {
  RefreshCw, PhoneCall, MapPin, Mail, Phone, FileCheck, CalendarClock,
  Trophy, ThumbsDown, PhoneMissed, ChevronDown, ChevronUp, Copy, ExternalLink,
  StickyNote, Pencil, Check, X, User
} from 'lucide-react'
import { supabase } from '../lib/supabase'

type Row = {
  conversation_id: string
  agency_id: string
  agency_name: string
  agency_city: string
  owner_name: string | null
  agency_email: string | null
  manager_phone: string | null
  agency_phone: string | null
  audit_callback_date: string | null
  sender_email: string | null
  last_message: string | null
  last_message_at: string | null
  call_notes: string | null
}

type Filter = 'due' | 'upcoming' | 'all'

function daysFromToday(dateStr: string | null): number | null {
  if (!dateStr) return null
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const d = new Date(dateStr); d.setHours(0, 0, 0, 0)
  return Math.round((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
}

function badge(days: number | null): { label: string; cls: string } {
  if (days === null) return { label: 'Sans date', cls: 'bg-zinc-500/15 text-zinc-400' }
  if (days < 0) return { label: `En retard de ${-days}j`, cls: 'bg-red-500/15 text-red-400' }
  if (days === 0) return { label: "Aujourd'hui", cls: 'bg-emerald-500/15 text-emerald-400' }
  if (days === 1) return { label: 'Demain', cls: 'bg-blue-500/15 text-blue-400' }
  return { label: `Dans ${days}j`, cls: 'bg-zinc-500/15 text-zinc-400' }
}

export default function AuditsToCallback() {
  const [filter, setFilter] = useState<Filter>('due')
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [acting, setActing] = useState<string | null>(null)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [recallModal, setRecallModal] = useState<{ agency_id: string; date: string } | null>(null)
  const [rdvModal, setRdvModal] = useState<{ row: Row; rdv_at: string } | null>(null)
  const [counts, setCounts] = useState<{ due: number; upcoming: number; all: number }>({ due: 0, upcoming: 0, all: 0 })
  const [editingNotesId, setEditingNotesId] = useState<string | null>(null)
  const [editingNotesValue, setEditingNotesValue] = useState('')
  const [savingNotes, setSavingNotes] = useState(false)

  useEffect(() => { load() }, [filter])

  async function load() {
    setLoading(true)
    setExpandedId(null)

    const { data: convs } = await supabase
      .from('conversations')
      .select(`
        id, sender_email, agency_id,
        agency:agencies!inner ( id, name, city, email, phone, manager_phone, owner_name, audit_callback_date, call_notes )
      `)
      .eq('status', 'audit_sent')

    if (!convs) { setRows([]); setLoading(false); return }

    const today = new Date(); today.setHours(0, 0, 0, 0)
    type RawConv = {
      id: string
      sender_email: string | null
      agency_id: string
      agency: { id: string; name: string; city: string; email: string | null; phone: string | null; manager_phone: string | null; owner_name: string | null; audit_callback_date: string | null; call_notes: string | null }
        | { id: string; name: string; city: string; email: string | null; phone: string | null; manager_phone: string | null; owner_name: string | null; audit_callback_date: string | null; call_notes: string | null }[]
    }

    let mapped: Row[] = (convs as unknown as RawConv[]).map(c => {
      const agency = Array.isArray(c.agency) ? c.agency[0] : c.agency
      return {
        conversation_id: c.id,
        agency_id: c.agency_id,
        agency_name: agency?.name || '',
        agency_city: agency?.city || '',
        owner_name: agency?.owner_name || null,
        agency_email: agency?.email || null,
        manager_phone: agency?.manager_phone || null,
        agency_phone: agency?.phone || null,
        audit_callback_date: agency?.audit_callback_date || null,
        sender_email: c.sender_email,
        last_message: null,
        last_message_at: null,
        call_notes: agency?.call_notes || null,
      }
    })

    const due = mapped.filter(r => {
      const d = daysFromToday(r.audit_callback_date)
      return d !== null && d <= 0
    }).length
    const upcoming = mapped.length - due
    setCounts({ due, upcoming, all: mapped.length })

    if (filter === 'due') {
      mapped = mapped.filter(r => {
        const d = daysFromToday(r.audit_callback_date)
        return d !== null && d <= 0
      })
    } else if (filter === 'upcoming') {
      mapped = mapped.filter(r => {
        const d = daysFromToday(r.audit_callback_date)
        return d !== null && d > 0
      })
    }

    mapped.sort((a, b) => {
      const da = a.audit_callback_date ? new Date(a.audit_callback_date).getTime() : Infinity
      const db = b.audit_callback_date ? new Date(b.audit_callback_date).getTime() : Infinity
      return da - db
    })

    const convIds = mapped.map(r => r.conversation_id)
    if (convIds.length) {
      const { data: msgs } = await supabase
        .from('messages')
        .select('conversation_id, content, sent_at, direction')
        .in('conversation_id', convIds)
        .eq('direction', 'inbound')
        .order('sent_at', { ascending: false })
      const last = new Map<string, { content: string; sent_at: string }>()
      for (const m of msgs || []) {
        if (!last.has(m.conversation_id)) last.set(m.conversation_id, { content: m.content, sent_at: m.sent_at })
      }
      mapped = mapped.map(r => {
        const l = last.get(r.conversation_id)
        return l ? { ...r, last_message: l.content, last_message_at: l.sent_at } : r
      })
    }

    setRows(mapped)
    setLoading(false)
  }

  function copy(text: string, key: string) {
    navigator.clipboard.writeText(text)
    setCopiedKey(key)
    setTimeout(() => setCopiedKey(prev => (prev === key ? null : prev)), 2000)
  }

  async function setOutcome(row: Row, outcome: 'rdv' | 'pas_intéressé' | 'pas_décroché' | 'audit_refused', rdvAt?: string) {
    setActing(row.conversation_id)
    if (outcome === 'audit_refused') {
      await supabase.from('conversations').update({ status: 'audit_refused' }).eq('id', row.conversation_id)
    } else {
      const agencyUpdate: Record<string, unknown> = {
        call_result: outcome,
        call_date: new Date().toISOString(),
        audit_callback_date: null,
      }
      if (outcome === 'rdv' && rdvAt) agencyUpdate.rdv_at = new Date(rdvAt).toISOString()
      await Promise.all([
        supabase.from('agencies').update(agencyUpdate).eq('id', row.agency_id),
        outcome === 'rdv'
          ? supabase.from('conversations').update({ status: 'closed' }).eq('id', row.conversation_id)
          : Promise.resolve(),
      ])
    }
    setActing(null)
    setRows(prev => prev.filter(r => r.conversation_id !== row.conversation_id))
    setCounts(c => ({ ...c, [filter]: Math.max(0, c[filter] - 1), all: Math.max(0, c.all - 1) }))
  }

  function openRdv(row: Row) {
    const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(11, 0, 0, 0)
    const off = d.getTimezoneOffset()
    const local = new Date(d.getTime() - off * 60000)
    setRdvModal({ row, rdv_at: local.toISOString().slice(0, 16) })
  }

  async function confirmRdv() {
    if (!rdvModal || !rdvModal.rdv_at) return
    const { row, rdv_at } = rdvModal
    setRdvModal(null)
    await setOutcome(row, 'rdv', rdv_at)
  }

  function startEditNotes(row: Row) {
    setEditingNotesId(row.conversation_id)
    setEditingNotesValue(row.call_notes || '')
  }

  async function saveNotes(row: Row) {
    setSavingNotes(true)
    const newNotes = editingNotesValue.trim() || null
    await supabase.from('agencies').update({ call_notes: newNotes }).eq('id', row.agency_id)
    setRows(prev => prev.map(r => r.conversation_id === row.conversation_id ? { ...r, call_notes: newNotes } : r))
    setSavingNotes(false)
    setEditingNotesId(null)
  }

  function openRecall(agencyId: string, currentDate: string | null) {
    const d = new Date()
    d.setDate(d.getDate() + 2)
    setRecallModal({ agency_id: agencyId, date: currentDate || d.toISOString().split('T')[0] })
  }

  async function confirmRecall() {
    if (!recallModal) return
    setActing(recallModal.agency_id)
    await supabase.from('agencies').update({ audit_callback_date: recallModal.date }).eq('id', recallModal.agency_id)
    setActing(null)
    setRecallModal(null)
    load()
  }

  function gmailInboxUrl(senderEmail: string | null): string | null {
    if (!senderEmail) return null
    return `https://mail.google.com/mail/?authuser=${senderEmail}`
  }

  function openGmail(senderEmail: string | null, agencyEmail: string | null, key: string) {
    if (!senderEmail) return
    if (agencyEmail) {
      navigator.clipboard.writeText(`from:${agencyEmail}`)
      setCopiedKey(`gmail-${key}`)
      setTimeout(() => setCopiedKey(prev => (prev === `gmail-${key}` ? null : prev)), 2500)
    }
    const url = gmailInboxUrl(senderEmail)
    if (url) window.open(url, '_blank', 'noopener,noreferrer')
  }

  const tabs: { key: Filter; label: string; count: number; cls: string }[] = [
    { key: 'due', label: 'À rappeler maintenant', count: counts.due, cls: 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300' },
    { key: 'upcoming', label: 'À venir', count: counts.upcoming, cls: 'bg-blue-500/15 border-blue-500/40 text-blue-300' },
    { key: 'all', label: 'Tous', count: counts.all, cls: 'bg-zinc-500/15 border-zinc-500/40 text-zinc-300' },
  ]

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2">
            <FileCheck size={18} className="text-purple-400" />
            Rappels après audit
          </h2>
          <p className="text-xs text-[var(--text-muted)] mt-1">Agences à qui on a envoyé l'audit — à rappeler à la date prévue.</p>
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
            Aucun rappel d'audit en attente.
          </div>
        ) : (
          rows.map(r => {
            const days = daysFromToday(r.audit_callback_date)
            const b = badge(days)
            const isExpanded = expandedId === r.conversation_id
            const phone = r.manager_phone || r.agency_phone
            return (
              <div key={r.conversation_id} className="rounded-lg bg-[var(--surface)] border border-[var(--border)] overflow-hidden">
                <div className="px-4 py-3 flex flex-col gap-2.5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <button
                        onClick={() => copy(r.agency_name, `name-${r.conversation_id}`)}
                        className="group flex items-center gap-2 text-left hover:text-[var(--accent)] transition-colors"
                        title="Copier le nom"
                      >
                        <span className="font-semibold text-base">{r.agency_name}</span>
                        <Copy size={13} className={copiedKey === `name-${r.conversation_id}` ? 'text-emerald-400' : 'opacity-40 group-hover:opacity-100 transition-opacity'} />
                      </button>
                      <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] mt-0.5">
                        <MapPin size={11} /> {r.agency_city}
                        <span className={`ml-1 px-1.5 py-0.5 rounded text-[10px] ${b.cls}`}>{b.label}</span>
                        {r.audit_callback_date && (
                          <span className="flex items-center gap-1 text-[10px]">
                            <CalendarClock size={11} />
                            {new Date(r.audit_callback_date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : r.conversation_id)}
                      className="text-[var(--text-muted)] hover:text-[var(--text)] transition-colors p-1"
                    >
                      {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
                    {r.owner_name && (
                      <button
                        onClick={() => copy(r.owner_name!, `owner-${r.conversation_id}`)}
                        className="group flex items-center gap-1.5 text-amber-400 hover:text-amber-300"
                        title="Copier le nom du gérant"
                      >
                        <User size={12} /> Gérant : <strong>{r.owner_name}</strong>
                        <Copy
                          size={11}
                          className={copiedKey === `owner-${r.conversation_id}` ? 'text-emerald-400' : 'opacity-40 group-hover:opacity-100 transition-opacity'}
                        />
                      </button>
                    )}
                    {r.agency_email && (
                      <span className="flex items-center gap-1.5 text-[var(--text-muted)]">
                        <Mail size={12} /> {r.agency_email}
                      </span>
                    )}
                    {phone && (
                      <a href={`tel:${phone}`} className="flex items-center gap-1.5 text-emerald-400 hover:underline">
                        <Phone size={12} /> {phone}
                        {r.manager_phone === phone && <span className="opacity-70">(gérant)</span>}
                      </a>
                    )}
                  </div>

                  {editingNotesId === r.conversation_id ? (
                    <div className="flex flex-col gap-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg p-2">
                      <textarea
                        autoFocus
                        value={editingNotesValue}
                        onChange={e => setEditingNotesValue(e.target.value)}
                        rows={3}
                        placeholder="Numéro perso, nom de contact, contexte du rappel..."
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

                  <div className="flex flex-wrap gap-2 mt-1">
                    <button
                      onClick={() => openRdv(r)}
                      disabled={acting === r.conversation_id}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition-colors disabled:opacity-40"
                    >
                      <Trophy size={12} /> RDV obtenu
                    </button>
                    <button
                      onClick={() => openRecall(r.agency_id, r.audit_callback_date)}
                      disabled={acting === r.conversation_id}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-blue-500/20 text-blue-400 hover:bg-blue-500/30 transition-colors disabled:opacity-40"
                    >
                      <CalendarClock size={12} /> Re-rappeler
                    </button>
                    <button
                      onClick={() => setOutcome(r, 'pas_décroché')}
                      disabled={acting === r.conversation_id}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-zinc-500/20 text-zinc-400 hover:bg-zinc-500/30 transition-colors disabled:opacity-40"
                    >
                      <PhoneMissed size={12} /> Pas décroché
                    </button>
                    <button
                      onClick={() => setOutcome(r, 'pas_intéressé')}
                      disabled={acting === r.conversation_id}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors disabled:opacity-40"
                    >
                      <ThumbsDown size={12} /> Pas intéressé
                    </button>
                    <button
                      onClick={() => setOutcome(r, 'audit_refused')}
                      disabled={acting === r.conversation_id}
                      className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-red-500/10 text-red-400 hover:bg-red-500/20 transition-colors disabled:opacity-40 ml-auto"
                      title="L'agence a explicitement refusé / dit non à l'audit"
                    >
                      Refusé
                    </button>
                  </div>

                  {r.sender_email && (
                    <button
                      onClick={() => openGmail(r.sender_email, r.agency_email, r.conversation_id)}
                      className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] hover:text-[var(--text)] self-start"
                    >
                      <ExternalLink size={11} />
                      {copiedKey === `gmail-${r.conversation_id}` ? 'Filtre copié → colle dans Gmail' : 'Voir la conversation Gmail'}
                    </button>
                  )}
                </div>

                {isExpanded && r.last_message && (
                  <div className="border-t border-[var(--border)] px-4 py-3 text-xs text-[var(--text-muted)] bg-[var(--bg)] max-h-[240px] overflow-y-auto whitespace-pre-wrap leading-relaxed">
                    <div className="font-medium text-[var(--text)] mb-1.5">
                      Dernier message reçu
                      {r.last_message_at && (
                        <span className="text-[10px] font-normal text-[var(--text-muted)] ml-2">
                          {new Date(r.last_message_at).toLocaleString('fr-FR')}
                        </span>
                      )}
                    </div>
                    {r.last_message}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {rdvModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setRdvModal(null)}>
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 w-80" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-1">
              <Trophy size={16} className="text-emerald-400" />
              <h3 className="font-bold">RDV pris</h3>
            </div>
            <p className="text-xs text-[var(--text-muted)] mb-4">Quand a lieu le RDV avec {rdvModal.row.agency_name} ?</p>
            <input
              type="datetime-local"
              value={rdvModal.rdv_at}
              onChange={e => setRdvModal(s => s ? { ...s, rdv_at: e.target.value } : s)}
              className="w-full px-4 py-2.5 rounded-xl bg-[var(--bg)] border border-[var(--border)] text-[var(--text)] mb-4 focus:outline-none focus:border-[var(--accent)]"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setRdvModal(null)}
                className="flex-1 py-2.5 rounded-xl border border-[var(--border)] text-sm text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
              >Annuler</button>
              <button
                onClick={confirmRdv}
                disabled={!rdvModal.rdv_at}
                className="flex-1 py-2.5 rounded-xl bg-emerald-500 text-white text-sm font-medium hover:bg-emerald-600 disabled:opacity-40"
              >Confirmer</button>
            </div>
          </div>
        </div>
      )}

      {recallModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setRecallModal(null)}>
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 w-80" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-1">
              <PhoneCall size={16} className="text-blue-400" />
              <h3 className="font-bold">Nouvelle date de rappel</h3>
            </div>
            <p className="text-xs text-[var(--text-muted)] mb-4">Quand rappeler à nouveau ?</p>
            <input
              type="date"
              value={recallModal.date}
              onChange={e => setRecallModal(s => s ? { ...s, date: e.target.value } : s)}
              className="w-full px-4 py-2.5 rounded-xl bg-[var(--bg)] border border-[var(--border)] text-[var(--text)] mb-4 focus:outline-none focus:border-[var(--accent)]"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setRecallModal(null)}
                className="flex-1 py-2.5 rounded-xl border border-[var(--border)] text-sm text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
              >Annuler</button>
              <button
                onClick={confirmRecall}
                disabled={!recallModal.date || acting === recallModal.agency_id}
                className="flex-1 py-2.5 rounded-xl bg-[var(--accent)] text-white text-sm font-medium hover:bg-[var(--accent-hover)] disabled:opacity-40"
              >Confirmer</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
