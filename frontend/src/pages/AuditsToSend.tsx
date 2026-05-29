import { useEffect, useState } from 'react'
import {
  RefreshCw, FileCheck, MapPin, Mail, Phone, Send,
  CheckCircle2, Copy, ExternalLink, ChevronDown, ChevronUp,
  XCircle, AlertTriangle, CalendarClock, User
} from 'lucide-react'
import { supabase } from '../lib/supabase'

function addBusinessDays(from: Date, days: number): Date {
  const d = new Date(from)
  let added = 0
  while (added < days) {
    d.setDate(d.getDate() + 1)
    const day = d.getDay()
    if (day !== 0 && day !== 6) added++
  }
  return d
}

function defaultCallbackDate(): string {
  const d = addBusinessDays(new Date(), 2)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function formatCallbackDay(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  const day = date.getDay()
  const isWeekend = day === 0 || day === 6
  const formatted = date.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
  return isWeekend ? `${formatted} ⚠️ week-end` : formatted
}

function fullOwnerName(firstName: string | null, lastName: string | null): string | null {
  const parts = [firstName, lastName].filter(Boolean) as string[]
  return parts.length ? parts.join(' ') : null
}

function coverMessage(firstName: string | null): string {
  const greeting = firstName ? `Bonjour ${firstName}` : 'Bonjour'
  return `${greeting},

Je vous envoie un audit de votre agence fait par un agent IA que je suis en train de construire, à partir de tout ce qu'il a vu de vous sur internet, je trouve ça assez fou !

Et encore, l'audit n'est qu'un aperçu. Je bosse en ce moment avec un Arthurimmo pas loin de Toulouse sur quelque chose de bien plus large.

Je vous appelle dans 2-3 jours pour avoir votre avis.

Noam`
}

function coverSubject(firstName: string | null, lastName: string | null): string {
  const full = fullOwnerName(firstName, lastName)
  if (full) return `Pour ${full} — un agent IA est passé dans votre agence`
  return `Un agent IA est passé dans votre agence`
}

function auditPrompt(agencyName: string, firstName: string | null, lastName: string | null, city: string): string {
  const full = fullOwnerName(firstName, lastName)
  const owner = full ? ` qui a normalement ${full} en tant que gérant` : ''
  return `lance un audit pour ${agencyName}${owner} et est situé à ${city}`
}

type Tab = 'audit_requested' | 'audit_sent' | 'audit_refused' | 'other'

const TAB_CONFIG: Record<Tab, {
  label: string
  statuses: string[]
  icon: React.ReactNode
  color: string
  description: string
}> = {
  audit_requested: {
    label: 'À envoyer',
    statuses: ['audit_requested'],
    icon: <FileCheck size={14} />,
    color: 'emerald',
    description: 'Agences qui ont demandé un audit. Génère-le côté Claude Code, envoie le PDF depuis la bonne boîte, puis clique "Envoyé".',
  },
  audit_sent: {
    label: 'Envoyés',
    statuses: ['audit_sent'],
    icon: <Send size={14} />,
    color: 'blue',
    description: 'Audits déjà envoyés. Maintenant à appeler — ces agences remontent en tête du Cold Call.',
  },
  audit_refused: {
    label: 'Refusés',
    statuses: ['audit_refused'],
    icon: <XCircle size={14} />,
    color: 'red',
    description: 'Agences qui ont répondu mais refusé l\'audit. Historique pour analyse.',
  },
  other: {
    label: 'Autres',
    statuses: ['wrong_target', 'closed'],
    icon: <AlertTriangle size={14} />,
    color: 'zinc',
    description: 'Mauvaises cibles (notaires, syndics, particuliers) et conversations fermées.',
  },
}

type Row = {
  conversation_id: string
  status: string
  sender_email: string | null
  created_at: string
  agency_id: string
  agency_name: string
  agency_city: string
  agency_email: string | null
  owner_name: string | null
  owner_first_name: string | null
  owner_last_name: string | null
  manager_phone: string | null
  agency_phone: string | null
  last_inbound: string | null
  last_inbound_at: string | null
}

export default function AuditsToSend() {
  const [tab, setTab] = useState<Tab>('audit_requested')
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [marking, setMarking] = useState<string | null>(null)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)
  const [sendModal, setSendModal] = useState<{ conversation_id: string; agency_id: string; callback_date: string } | null>(null)
  const [counts, setCounts] = useState<Record<Tab, number>>({
    audit_requested: 0, audit_sent: 0, audit_refused: 0, other: 0,
  })

  useEffect(() => {
    load(tab)
    loadCounts()
  }, [tab])

  async function loadCounts() {
    const allStatuses = ['audit_requested', 'audit_sent', 'audit_refused', 'wrong_target', 'closed']
    const { data } = await supabase
      .from('conversations')
      .select('status')
      .in('status', allStatuses)
    const by: Record<string, number> = {}
    for (const c of data || []) by[c.status] = (by[c.status] || 0) + 1
    setCounts({
      audit_requested: by['audit_requested'] || 0,
      audit_sent: by['audit_sent'] || 0,
      audit_refused: by['audit_refused'] || 0,
      other: (by['wrong_target'] || 0) + (by['closed'] || 0),
    })
  }

  async function load(activeTab: Tab) {
    setLoading(true)
    setExpandedId(null)
    const { data: convs } = await supabase
      .from('conversations')
      .select(`
        id, status, sender_email, created_at, agency_id,
        agency:agencies!inner ( id, name, city, email, phone, manager_phone, owner_name, owner_first_name, owner_last_name )
      `)
      .in('status', TAB_CONFIG[activeTab].statuses)
      .order('created_at', { ascending: false })

    if (!convs) {
      setRows([])
      setLoading(false)
      return
    }

    const convIds = convs.map((c: { id: string }) => c.id)
    const { data: msgs } = convIds.length
      ? await supabase
          .from('messages')
          .select('conversation_id, content, sent_at, direction')
          .in('conversation_id', convIds)
          .eq('direction', 'inbound')
          .order('sent_at', { ascending: false })
      : { data: [] }

    const lastInboundByConv = new Map<string, { content: string; sent_at: string }>()
    for (const m of msgs || []) {
      if (!lastInboundByConv.has(m.conversation_id)) {
        lastInboundByConv.set(m.conversation_id, { content: m.content, sent_at: m.sent_at })
      }
    }

    type RawConv = {
      id: string
      status: string
      sender_email: string | null
      created_at: string
      agency_id: string
      agency: { id: string; name: string; city: string; email: string | null; phone: string | null; manager_phone: string | null; owner_name: string | null; owner_first_name: string | null; owner_last_name: string | null } | { id: string; name: string; city: string; email: string | null; phone: string | null; manager_phone: string | null; owner_name: string | null; owner_first_name: string | null; owner_last_name: string | null }[]
    }

    const mapped: Row[] = (convs as unknown as RawConv[]).map(c => {
      const agency = Array.isArray(c.agency) ? c.agency[0] : c.agency
      const last = lastInboundByConv.get(c.id)
      return {
        conversation_id: c.id,
        status: c.status,
        sender_email: c.sender_email,
        created_at: c.created_at,
        agency_id: c.agency_id,
        agency_name: agency?.name || '',
        agency_city: agency?.city || '',
        agency_email: agency?.email || null,
        owner_name: agency?.owner_name || null,
        owner_first_name: agency?.owner_first_name || null,
        owner_last_name: agency?.owner_last_name || null,
        manager_phone: agency?.manager_phone || null,
        agency_phone: agency?.phone || null,
        last_inbound: last?.content || null,
        last_inbound_at: last?.sent_at || null,
      }
    })

    setRows(mapped)
    setLoading(false)
  }

  function copy(text: string, key: string) {
    navigator.clipboard.writeText(text)
    setCopiedKey(key)
    setTimeout(() => setCopiedKey(prev => (prev === key ? null : prev)), 2000)
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

  function openSendModal(conversationId: string, agencyId: string) {
    setSendModal({ conversation_id: conversationId, agency_id: agencyId, callback_date: defaultCallbackDate() })
  }

  async function confirmSent() {
    if (!sendModal) return
    setMarking(sendModal.conversation_id)
    await Promise.all([
      supabase.from('conversations').update({ status: 'audit_sent' }).eq('id', sendModal.conversation_id),
      supabase.from('agencies').update({ audit_callback_date: sendModal.callback_date }).eq('id', sendModal.agency_id),
    ])
    setMarking(null)
    setRows(prev => prev.filter(r => r.conversation_id !== sendModal.conversation_id))
    setSendModal(null)
    loadCounts()
  }

  const conf = TAB_CONFIG[tab]
  const colorClasses = {
    emerald: { text: 'text-emerald-400', bg: 'bg-emerald-500/20', activeBg: 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300' },
    blue:    { text: 'text-blue-400',    bg: 'bg-blue-500/20',    activeBg: 'bg-blue-500/15 border-blue-500/40 text-blue-300' },
    red:     { text: 'text-red-400',     bg: 'bg-red-500/20',     activeBg: 'bg-red-500/15 border-red-500/40 text-red-300' },
    zinc:    { text: 'text-zinc-400',    bg: 'bg-zinc-500/20',    activeBg: 'bg-zinc-500/15 border-zinc-500/40 text-zinc-300' },
  } as const
  const c = colorClasses[conf.color as keyof typeof colorClasses]

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Réponses email</h2>
        <button
          onClick={() => { load(tab); loadCounts() }}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-[var(--surface)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] transition-colors"
        >
          <RefreshCw size={13} /> Actualiser
        </button>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2">
        {(Object.keys(TAB_CONFIG) as Tab[]).map(t => {
          const tc = TAB_CONFIG[t]
          const tcc = colorClasses[tc.color as keyof typeof colorClasses]
          const isActive = tab === t
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                isActive
                  ? tcc.activeBg
                  : 'bg-[var(--surface)] border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-hover)]'
              }`}
            >
              {tc.icon}
              <span className="font-medium">{tc.label}</span>
              <span className={`text-[10px] px-1.5 py-0.5 rounded ${isActive ? 'bg-black/20' : tcc.bg + ' ' + tcc.text}`}>
                {counts[t]}
              </span>
            </button>
          )
        })}
      </div>

      <p className="text-sm text-[var(--text-muted)]">{conf.description}</p>

      {/* List */}
      <div className="flex flex-col gap-3">
        {loading ? (
          <div className="p-8 text-center text-sm text-[var(--text-muted)]">Chargement...</div>
        ) : rows.length === 0 ? (
          <div className="rounded-lg bg-[var(--surface)] border border-[var(--border)] p-8 text-center text-sm text-[var(--text-muted)]">
            {tab === 'audit_requested' && 'Aucun audit en attente. 🎯'}
            {tab === 'audit_sent' && 'Aucun audit envoyé pour l\'instant.'}
            {tab === 'audit_refused' && 'Aucun refus enregistré.'}
            {tab === 'other' && 'Aucune autre conversation classée.'}
          </div>
        ) : (
          rows.map(r => {
            const isExpanded = expandedId === r.conversation_id
            const canOpenGmail = !!r.sender_email
            const showActions = r.status === 'audit_requested'
            return (
              <div
                key={r.conversation_id}
                className="rounded-lg bg-[var(--surface)] border border-[var(--border)] overflow-hidden"
              >
                <div className="px-4 py-3 flex flex-col gap-2.5">
                  {/* Top */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <button
                        onClick={() => copy(r.agency_name, `name-${r.conversation_id}`)}
                        className="group flex items-center gap-2 text-left hover:text-[var(--accent)] transition-colors"
                        title="Cliquer pour copier le nom"
                      >
                        <span className="font-semibold text-base">{r.agency_name}</span>
                        <Copy
                          size={13}
                          className={
                            copiedKey === `name-${r.conversation_id}`
                              ? 'text-emerald-400'
                              : 'opacity-40 group-hover:opacity-100 transition-opacity'
                          }
                        />
                        {copiedKey === `name-${r.conversation_id}` && (
                          <span className="text-[10px] text-emerald-400">copié</span>
                        )}
                      </button>
                      <div className="flex items-center gap-1 text-xs text-[var(--text-muted)] mt-0.5">
                        <MapPin size={11} /> {r.agency_city}
                        {!showActions && (
                          <span className={`ml-2 px-1.5 py-0.5 rounded text-[10px] ${c.bg} ${c.text}`}>
                            {r.status}
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : r.conversation_id)}
                      className="text-[var(--text-muted)] hover:text-[var(--text)] transition-colors p-1"
                      title={isExpanded ? 'Réduire' : 'Voir le dernier message'}
                    >
                      {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                    </button>
                  </div>

                  {/* Meta */}
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
                        {copiedKey === `owner-${r.conversation_id}` && (
                          <span className="text-[10px] text-emerald-400">copié</span>
                        )}
                      </button>
                    )}
                    {r.agency_email && (
                      <button
                        onClick={() => copy(r.agency_email!, `email-${r.conversation_id}`)}
                        className="group flex items-center gap-1.5 text-[var(--text-muted)] hover:text-[var(--text)]"
                        title="Copier l'email"
                      >
                        <Mail size={12} /> {r.agency_email}
                        <Copy
                          size={11}
                          className={copiedKey === `email-${r.conversation_id}` ? 'text-emerald-400' : 'opacity-40 group-hover:opacity-100 transition-opacity'}
                        />
                        {copiedKey === `email-${r.conversation_id}` && (
                          <span className="text-[10px] text-emerald-400">copié</span>
                        )}
                      </button>
                    )}
                    {r.sender_email && (
                      <span className="flex items-center gap-1.5 text-blue-400">
                        <Send size={12} /> {showActions ? 'Envoyer depuis' : 'Boîte'} : <strong>{r.sender_email}</strong>
                      </span>
                    )}
                    {r.manager_phone && (
                      <span className="flex items-center gap-1.5 text-emerald-400">
                        <Phone size={12} /> Gérant : {r.manager_phone}
                      </span>
                    )}
                    {!r.manager_phone && r.agency_phone && (
                      <span className="flex items-center gap-1.5 text-[var(--text-muted)]">
                        <Phone size={12} /> {r.agency_phone}
                      </span>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex flex-wrap gap-2 mt-1">
                    {canOpenGmail && (
                      <button
                        onClick={() => openGmail(r.sender_email, r.agency_email, r.conversation_id)}
                        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-[var(--surface-hover)] hover:bg-[var(--border)] transition-colors"
                        title="Copie 'from:agency@…' dans le clipboard et ouvre Gmail dans la bonne boîte. Colle Cmd+V dans la search."
                      >
                        <ExternalLink size={12} />
                        {copiedKey === `gmail-${r.conversation_id}` ? 'Filtre copié → colle dans Gmail' : 'Ouvrir Gmail (copie le filtre)'}
                      </button>
                    )}
                    {showActions && (
                      <>
                        <button
                          onClick={() => copy(auditPrompt(r.agency_name, r.owner_first_name, r.owner_last_name, r.agency_city), `prompt-${r.conversation_id}`)}
                          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-purple-500/20 text-purple-300 hover:bg-purple-500/30 transition-colors"
                          title="Copier le prompt à coller dans Claude pour générer l'audit"
                        >
                          <Copy size={12} />
                          {copiedKey === `prompt-${r.conversation_id}` ? 'Prompt copié !' : 'Copier prompt audit'}
                        </button>
                        <button
                          onClick={() => copy(coverSubject(r.owner_first_name, r.owner_last_name), `subject-${r.conversation_id}`)}
                          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-[var(--surface-hover)] hover:bg-[var(--border)] transition-colors"
                        >
                          <Copy size={12} />
                          {copiedKey === `subject-${r.conversation_id}` ? 'Objet copié !' : 'Copier l\'objet'}
                        </button>
                        <button
                          onClick={() => copy(coverMessage(r.owner_first_name), `cover-${r.conversation_id}`)}
                          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-[var(--surface-hover)] hover:bg-[var(--border)] transition-colors"
                        >
                          <Copy size={12} />
                          {copiedKey === `cover-${r.conversation_id}` ? 'Copié !' : 'Copier le message'}
                        </button>
                        <button
                          onClick={() => openSendModal(r.conversation_id, r.agency_id)}
                          disabled={marking === r.conversation_id}
                          className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 transition-colors disabled:opacity-40 ml-auto"
                        >
                          <CheckCircle2 size={12} />
                          {marking === r.conversation_id ? '...' : 'Marquer comme envoyé'}
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Dernier message */}
                {isExpanded && r.last_inbound && (
                  <div className="border-t border-[var(--border)] px-4 py-3 text-xs text-[var(--text-muted)] bg-[var(--bg)] max-h-[240px] overflow-y-auto whitespace-pre-wrap leading-relaxed">
                    <div className="font-medium text-[var(--text)] mb-1.5">
                      Dernier message reçu
                      {r.last_inbound_at && (
                        <span className="text-[10px] font-normal text-[var(--text-muted)] ml-2">
                          {new Date(r.last_inbound_at).toLocaleString('fr-FR')}
                        </span>
                      )}
                    </div>
                    {r.last_inbound}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {sendModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setSendModal(null)}>
          <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl p-6 w-80" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-1">
              <CalendarClock size={16} className="text-blue-400" />
              <h3 className="font-bold">Date de rappel</h3>
            </div>
            <p className="text-xs text-[var(--text-muted)] mb-3">Quand rappeler après l'envoi de l'audit ? Par défaut J+2 jours ouvrés — modifiable.</p>
            <input
              type="date"
              value={sendModal.callback_date}
              onChange={e => setSendModal(s => s ? { ...s, callback_date: e.target.value } : s)}
              className="w-full px-4 py-2.5 rounded-xl bg-[var(--bg)] border border-[var(--border)] text-[var(--text)] mb-2 focus:outline-none focus:border-[var(--accent)]"
            />
            {sendModal.callback_date && (
              <p className="text-xs text-blue-400 mb-4">
                Tu rappelleras le <strong>{formatCallbackDay(sendModal.callback_date)}</strong>
              </p>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => setSendModal(null)}
                className="flex-1 py-2.5 rounded-xl border border-[var(--border)] text-sm text-[var(--text-muted)] hover:bg-[var(--surface-hover)]"
              >Annuler</button>
              <button
                onClick={confirmSent}
                disabled={!sendModal.callback_date || marking === sendModal.conversation_id}
                className="flex-1 py-2.5 rounded-xl bg-emerald-500 text-white text-sm font-medium hover:bg-emerald-600 disabled:opacity-40"
              >{marking === sendModal.conversation_id ? '...' : 'Marquer envoyé'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
