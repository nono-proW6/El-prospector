import { useEffect, useState } from 'react'
import {
  Plus, Trash2, X, Building2, Search, ChevronRight,
  Mail, Phone, Globe, User, Hash, Star, MessageSquare,
  ArrowUpRight, ArrowDownLeft, Clock, ExternalLink,
} from 'lucide-react'
import { supabase } from '../lib/supabase'
import type { Agency, Conversation, Message } from '../lib/types'

const STATUS_CONFIG: Record<string, { label: string; color: string; bg: string }> = {
  pending: { label: 'En attente', color: 'text-gray-400', bg: 'bg-gray-500/20' },
  sent: { label: 'Envoyé', color: 'text-sky-400', bg: 'bg-sky-500/20' },
  prospect_phase: { label: 'Prospect', color: 'text-blue-400', bg: 'bg-blue-500/20' },
  revealed: { label: 'Révélé', color: 'text-purple-400', bg: 'bg-purple-500/20' },
  video_sent: { label: 'Vidéo envoyée', color: 'text-indigo-400', bg: 'bg-indigo-500/20' },
  visio_accepted: { label: 'Visio OK', color: 'text-green-400', bg: 'bg-green-500/20' },
  no_answer: { label: 'Pas de réponse', color: 'text-yellow-400', bg: 'bg-yellow-500/20' },
  callback: { label: 'À rappeler', color: 'text-cyan-400', bg: 'bg-cyan-500/20' },
  closed: { label: 'Fermé', color: 'text-gray-400', bg: 'bg-gray-500/20' },
  lost: { label: 'Perdu', color: 'text-red-400', bg: 'bg-red-500/20' },
  wrong_target: { label: 'Mauvaise cible', color: 'text-rose-400', bg: 'bg-rose-500/20' },
}

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] || { label: status, color: 'text-gray-400', bg: 'bg-gray-500/20' }
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${cfg.color} ${cfg.bg}`}>
      {cfg.label}
    </span>
  )
}

function formatDate(d: string | null) {
  if (!d) return '-'
  return new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function formatDuration(minutes: number | null) {
  if (minutes === null || minutes === undefined) return '-'
  if (minutes < 60) return `${minutes}min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m ? `${h}h${m}min` : `${h}h`
}

export default function Agencies() {
  const [agencies, setAgencies] = useState<Agency[]>([])
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [messages, setMessages] = useState<Record<string, Message[]>>({})
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')

  const fetchData = async () => {
    const [agRes, convRes] = await Promise.all([
      supabase.from('agencies').select('*').order('created_at', { ascending: false }),
      supabase.from('conversations').select('*').order('created_at', { ascending: false }),
    ])
    setAgencies(agRes.data || [])
    setConversations(convRes.data || [])
    setLoading(false)
  }

  useEffect(() => { fetchData() }, [])

  const loadMessages = async (conversationId: string) => {
    if (messages[conversationId]) return
    setLoadingMessages(true)
    const { data } = await supabase
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('sent_at', { ascending: true })
    setMessages(prev => ({ ...prev, [conversationId]: data || [] }))
    setLoadingMessages(false)
  }

  const handleSelect = (agencyId: string) => {
    if (selectedId === agencyId) {
      setSelectedId(null)
      return
    }
    setSelectedId(agencyId)
    const conv = conversations.find(c => c.agency_id === agencyId)
    if (conv) loadMessages(conv.id)
  }

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm('Supprimer cette agence ?')) return
    await supabase.from('agencies').delete().eq('id', id)
    setAgencies(prev => prev.filter(a => a.id !== id))
    if (selectedId === id) setSelectedId(null)
  }

  const handleAdd = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = e.currentTarget
    const formData = new FormData(form)
    const { data: agency, error } = await supabase.from('agencies').insert({
      name: formData.get('name') as string,
      email: formData.get('email') as string,
      city: formData.get('city') as string,
      source: formData.get('source') as string || null,
      notes: formData.get('notes') as string || null,
    }).select().single()
    if (!error && agency) {
      await supabase.from('conversations').insert({ agency_id: agency.id })
      form.reset()
      setShowForm(false)
      fetchData()
    }
  }

  // Filtrage
  const filtered = agencies.filter(a => {
    const matchesSearch = !search ||
      a.name.toLowerCase().includes(search.toLowerCase()) ||
      a.city?.toLowerCase().includes(search.toLowerCase()) ||
      a.email?.toLowerCase().includes(search.toLowerCase()) ||
      a.owner_name?.toLowerCase().includes(search.toLowerCase())
    if (!matchesSearch) return false

    if (statusFilter === 'all') return true
    const conv = conversations.find(c => c.agency_id === a.id)
    if (statusFilter === 'no_conv') return !conv
    return conv?.status === statusFilter
  })

  const selected = selectedId ? agencies.find(a => a.id === selectedId) : null
  const selectedConv = selectedId ? conversations.find(c => c.agency_id === selectedId) : null
  const selectedMessages = selectedConv ? messages[selectedConv.id] || [] : []

  // Stats rapides
  const statusCounts: Record<string, number> = {}
  conversations.forEach(c => {
    statusCounts[c.status] = (statusCounts[c.status] || 0) + 1
  })

  return (
    <div className="flex gap-0 h-[calc(100vh-4rem)] -m-8">
      {/* === COLONNE GAUCHE : Liste === */}
      <div className={`flex flex-col border-r border-[var(--border)] ${selected ? 'w-[420px]' : 'flex-1'} transition-all duration-200`}>
        {/* Header */}
        <div className="p-4 border-b border-[var(--border)] space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Agences ({filtered.length})</h2>
            <button
              onClick={() => setShowForm(!showForm)}
              className="flex items-center gap-1.5 bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white px-3 py-1.5 rounded-lg text-xs transition-colors"
            >
              {showForm ? <X size={14} /> : <Plus size={14} />}
              {showForm ? 'Annuler' : 'Ajouter'}
            </button>
          </div>

          {/* Recherche */}
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Rechercher une agence..."
              className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg pl-9 pr-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)] transition-colors"
            />
          </div>

          {/* Filtres statut */}
          <div className="flex flex-wrap gap-1.5">
            <FilterChip active={statusFilter === 'all'} onClick={() => setStatusFilter('all')} label={`Tout (${agencies.length})`} />
            {Object.entries(STATUS_CONFIG).map(([key, cfg]) => {
              const count = statusCounts[key] || 0
              if (!count) return null
              return <FilterChip key={key} active={statusFilter === key} onClick={() => setStatusFilter(key)} label={`${cfg.label} (${count})`} />
            })}
            <FilterChip active={statusFilter === 'no_conv'} onClick={() => setStatusFilter('no_conv')} label="Sans conv." />
          </div>
        </div>

        {/* Formulaire ajout */}
        {showForm && (
          <form onSubmit={handleAdd} className="p-4 border-b border-[var(--border)] bg-[var(--surface)] space-y-3">
            <p className="text-xs text-[var(--text-muted)] uppercase tracking-wide">Nouvelle agence</p>
            <div className="grid grid-cols-2 gap-3">
              <Input name="name" label="Nom" required />
              <Input name="email" label="Email" type="email" required />
              <Input name="city" label="Ville" required />
              <Input name="source" label="Source" placeholder="leboncoin..." />
            </div>
            <Input name="notes" label="Notes" />
            <button type="submit" className="bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white px-4 py-1.5 rounded-lg text-xs transition-colors">
              Ajouter
            </button>
          </form>
        )}

        {/* Liste agences */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <p className="text-[var(--text-muted)] p-6 text-center">Chargement...</p>
          ) : filtered.length === 0 ? (
            <div className="text-center py-20 text-[var(--text-muted)]">
              <Building2 size={40} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm">Aucune agence trouvée</p>
            </div>
          ) : (
            filtered.map(a => {
              const conv = conversations.find(c => c.agency_id === a.id)
              const isSelected = selectedId === a.id
              return (
                <div
                  key={a.id}
                  onClick={() => handleSelect(a.id)}
                  className={`flex items-center gap-3 px-4 py-3 cursor-pointer border-b border-[var(--border)] transition-colors ${
                    isSelected ? 'bg-[var(--accent)]/10 border-l-2 border-l-[var(--accent)]' : 'hover:bg-[var(--surface-hover)]'
                  }`}
                >
                  {/* Indicateur franchise/indep */}
                  <div className={`w-2 h-2 rounded-full flex-shrink-0 ${a.is_franchise ? 'bg-orange-400' : 'bg-emerald-400'}`} />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">{a.name}</span>
                      {a.rating && <span className="text-xs text-yellow-400 flex items-center gap-0.5"><Star size={10} fill="currentColor" />{a.rating}</span>}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-[var(--text-muted)] mt-0.5">
                      <span>{a.city}</span>
                      {a.email && <span className="truncate">{a.email}</span>}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0">
                    {conv && <StatusBadge status={conv.status} />}
                    {conv && conv.nb_exchanges > 0 && (
                      <span className="text-xs text-[var(--text-muted)] flex items-center gap-0.5">
                        <MessageSquare size={10} />{conv.nb_exchanges}
                      </span>
                    )}
                    <ChevronRight size={14} className={`text-[var(--text-muted)] transition-transform ${isSelected ? 'rotate-180' : ''}`} />
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* === COLONNE DROITE : Détails === */}
      {selected && (
        <div className="flex-1 overflow-y-auto">
          {/* Header agence */}
          <div className="p-6 border-b border-[var(--border)]">
            <div className="flex items-start justify-between mb-4">
              <div>
                <div className="flex items-center gap-3">
                  <h2 className="text-xl font-bold">{selected.name}</h2>
                  <span className={`text-xs px-2 py-0.5 rounded-full ${selected.is_franchise ? 'bg-orange-500/20 text-orange-400' : 'bg-emerald-500/20 text-emerald-400'}`}>
                    {selected.is_franchise ? 'Franchise' : 'Indépendant'}
                  </span>
                </div>
                <p className="text-sm text-[var(--text-muted)] mt-1">{selected.city}</p>
              </div>
              <div className="flex items-center gap-2">
                {selectedConv && <StatusBadge status={selectedConv.status} />}
                <button onClick={(e) => handleDelete(selected.id, e)} className="text-[var(--text-muted)] hover:text-[var(--red)] transition-colors p-1">
                  <Trash2 size={16} />
                </button>
              </div>
            </div>

            {/* Infos de contact */}
            <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
              {selected.email && (
                <InfoRow icon={<Mail size={14} />} label="Email" value={selected.email} />
              )}
              {selected.phone && (
                <InfoRow icon={<Phone size={14} />} label="Téléphone" value={selected.phone} />
              )}
              {selected.website && (
                <InfoRow icon={<Globe size={14} />} label="Site web" value={
                  <a href={selected.website.startsWith('http') ? selected.website : `https://${selected.website}`} target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] hover:underline flex items-center gap-1">
                    {selected.website.replace(/^https?:\/\//, '').replace(/\/$/, '')} <ExternalLink size={10} />
                  </a>
                } />
              )}
              {selected.owner_name && (
                <InfoRow icon={<User size={14} />} label="Dirigeant" value={
                  <span className="flex items-center gap-1.5">
                    {selected.owner_name}
                    {selected.linkedin && (
                      <a href={selected.linkedin} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:text-blue-300">
                        <ExternalLink size={10} />
                      </a>
                    )}
                  </span>
                } />
              )}
              {selected.siret && (
                <InfoRow icon={<Hash size={14} />} label="SIRET" value={selected.siret} />
              )}
              {selected.rating && (
                <InfoRow icon={<Star size={14} />} label="Note Google" value={`${selected.rating}/5`} />
              )}
              {selected.source && (
                <InfoRow icon={<Search size={14} />} label="Source" value={selected.source} />
              )}
            </div>

            {/* Score & Sales brief */}
            {(selected.score || selected.sales_brief) && (
              <div className="mt-4 p-3 bg-[var(--bg)] rounded-lg border border-[var(--border)]">
                {selected.score && (
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs text-[var(--text-muted)]">Score :</span>
                    <span className={`text-sm font-semibold ${
                      Number(selected.score) >= 4 ? 'text-green-400' : Number(selected.score) >= 3 ? 'text-yellow-400' : 'text-red-400'
                    }`}>{selected.score}/5</span>
                    {selected.score_reason && <span className="text-xs text-[var(--text-muted)]">— {selected.score_reason}</span>}
                  </div>
                )}
                {selected.sales_brief && (
                  <p className="text-xs text-[var(--text-muted)] leading-relaxed">{selected.sales_brief}</p>
                )}
              </div>
            )}
          </div>

          {/* Conversation */}
          {selectedConv ? (
            <>
              {/* Stats conversation */}
              <div className="p-6 border-b border-[var(--border)]">
                <h3 className="text-sm font-semibold mb-3 text-[var(--text-muted)] uppercase tracking-wide">Conversation</h3>
                <div className="grid grid-cols-4 gap-4">
                  <StatCard label="Statut" value={<StatusBadge status={selectedConv.status} />} />
                  <StatCard label="Échanges" value={selectedConv.nb_exchanges} />
                  <StatCard label="Temps de réponse" value={formatDuration(selectedConv.response_time_minutes)} />
                  <StatCard label="Méthode" value={
                    <span className="text-xs capitalize">{selectedConv.contact_method || 'auto'}</span>
                  } />
                </div>
                <div className="grid grid-cols-3 gap-4 mt-3 text-xs text-[var(--text-muted)]">
                  <div>
                    <span className="block text-[10px] uppercase tracking-wide mb-0.5">Envoyé le</span>
                    {formatDate(selectedConv.sent_at)}
                  </div>
                  <div>
                    <span className="block text-[10px] uppercase tracking-wide mb-0.5">1ère réponse</span>
                    {formatDate(selectedConv.first_response_at)}
                  </div>
                  <div>
                    <span className="block text-[10px] uppercase tracking-wide mb-0.5">Réf.</span>
                    {selectedConv.ref || '-'}
                  </div>
                </div>
              </div>

              {/* Messages */}
              <div className="p-6">
                <h3 className="text-sm font-semibold mb-4 text-[var(--text-muted)] uppercase tracking-wide flex items-center gap-2">
                  <MessageSquare size={14} />
                  Messages ({selectedMessages.length})
                </h3>

                {loadingMessages ? (
                  <p className="text-sm text-[var(--text-muted)]">Chargement des messages...</p>
                ) : selectedMessages.length === 0 ? (
                  <p className="text-sm text-[var(--text-muted)] text-center py-8">Aucun message dans cette conversation</p>
                ) : (
                  <div className="space-y-3">
                    {selectedMessages.map(msg => (
                      <div
                        key={msg.id}
                        className={`flex gap-3 ${msg.direction === 'outbound' ? '' : 'flex-row-reverse'}`}
                      >
                        <div className={`flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center ${
                          msg.direction === 'outbound' ? 'bg-[var(--accent)]/20 text-[var(--accent)]' : 'bg-emerald-500/20 text-emerald-400'
                        }`}>
                          {msg.direction === 'outbound' ? <ArrowUpRight size={14} /> : <ArrowDownLeft size={14} />}
                        </div>
                        <div className={`flex-1 max-w-[80%] ${msg.direction === 'outbound' ? '' : 'text-right'}`}>
                          <div className={`inline-block text-left p-3 rounded-xl text-sm leading-relaxed ${
                            msg.direction === 'outbound'
                              ? 'bg-[var(--accent)]/10 border border-[var(--accent)]/20'
                              : 'bg-emerald-500/10 border border-emerald-500/20'
                          }`}>
                            <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                          </div>
                          <p className="text-[10px] text-[var(--text-muted)] mt-1 flex items-center gap-1 px-1">
                            <Clock size={9} />
                            {formatDate(msg.sent_at)}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="p-6 text-center text-[var(--text-muted)] py-12">
              <MessageSquare size={32} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm">Aucune conversation pour cette agence</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function FilterChip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`px-2.5 py-1 rounded-full text-[11px] transition-colors ${
        active
          ? 'bg-[var(--accent)] text-white'
          : 'bg-[var(--surface)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] border border-[var(--border)]'
      }`}
    >
      {label}
    </button>
  )
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="text-[var(--text-muted)]">{icon}</span>
      <span className="text-[var(--text-muted)] text-xs w-20">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="bg-[var(--bg)] rounded-lg p-3 border border-[var(--border)]">
      <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide mb-1">{label}</p>
      <div className="text-sm font-medium">{value}</div>
    </div>
  )
}

function Input({ name, label, type = 'text', required = false, placeholder }: {
  name: string; label: string; type?: string; required?: boolean; placeholder?: string
}) {
  return (
    <div>
      <label className="block text-xs text-[var(--text-muted)] mb-1">{label}</label>
      <input
        name={name}
        type={type}
        required={required}
        placeholder={placeholder}
        className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--accent)] transition-colors"
      />
    </div>
  )
}
