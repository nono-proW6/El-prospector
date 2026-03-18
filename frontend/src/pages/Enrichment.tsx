import { useEffect, useState } from 'react'
import { RefreshCw, Phone, Globe, Building2, User, Star, X, Send, ExternalLink, Zap, Copy, Ban } from 'lucide-react'
import { supabase } from '../lib/supabase'

type Agency = {
  id: string
  name: string
  city: string
  phone: string | null
  website: string | null
  email: string | null
  owner_name: string | null
  linkedin: string | null
  siret: string | null
  score: number | null
  score_reason: string | null
  sales_brief: string | null
  rating: number | null
  enrichment_status: string
  enrichment_note: string | null
  is_franchise: boolean
}

type AgencyWithConv = Agency & {
  conv_status: string | null
}

type Filter = 'all' | 'independant' | 'franchise'
type ChannelTab = 'form' | 'email' | 'phone'

// All conversation statuses — same pipeline for auto and manual
const ALL_STATUSES = [
  { value: 'pending', label: 'En attente', cls: 'bg-gray-500/20 text-[var(--text-muted)]' },
  { value: 'sent', label: 'Email envoye', cls: 'bg-sky-500/20 text-sky-400' },
  { value: 'prospect_phase', label: 'Phase prospect', cls: 'bg-blue-500/20 text-blue-400' },
  { value: 'revealed', label: 'Revele', cls: 'bg-purple-500/20 text-purple-400' },
  { value: 'video_sent', label: 'Video envoyee', cls: 'bg-indigo-500/20 text-indigo-400' },
  { value: 'visio_accepted', label: 'Visio acceptee', cls: 'bg-green-500/20 text-green-400' },
  { value: 'no_answer', label: 'Pas de reponse', cls: 'bg-yellow-500/20 text-yellow-400' },
  { value: 'callback', label: 'A rappeler', cls: 'bg-blue-500/20 text-blue-400' },
  { value: 'closed', label: 'Ferme', cls: 'bg-gray-500/20 text-[var(--text-muted)]' },
  { value: 'lost', label: 'Perdu', cls: 'bg-red-500/20 text-red-400' },
] as const

// Statuses that require an email (prospect is in the email pipeline)
const EMAIL_REQUIRED_STATUSES = ['pending', 'sent', 'prospect_phase', 'revealed', 'video_sent', 'visio_accepted', 'closed']

const STATUS_MAP = Object.fromEntries(ALL_STATUSES.map(s => [s.value, s]))

function generateRef(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789'
  let ref = ''
  for (let i = 0; i < 6; i++) ref += chars[Math.floor(Math.random() * chars.length)]
  return ref
}

function extractDomainEmail(website: string | null): string {
  if (!website) return ''
  try {
    const hostname = new URL(website).hostname.replace(/^www\./, '')
    return `contact@${hostname}`
  } catch {
    return ''
  }
}

function getPriority(a: AgencyWithConv): number {
  if (a.conv_status === 'lost') return -100
  let score = 0
  if (!a.is_franchise) score += 100
  if (a.website) score += 30
  if (a.phone) score += 20
  if (a.rating) score += a.rating * 2
  if (a.owner_name) score += 10
  return score
}

function getRecommendedAction(a: Agency): string {
  if (a.is_franchise) return 'Franchise — basse priorite'
  if (a.website) return 'Formulaire web'
  if (a.phone) return 'Cold call'
  return 'Aucun moyen de contact'
}

export default function Enrichment() {
  const [agencies, setAgencies] = useState<AgencyWithConv[]>([])
  const [loading, setLoading] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [saving, setSaving] = useState(false)

  // Contact modal state
  const [modalAgency, setModalAgency] = useState<AgencyWithConv | null>(null)
  const [channelTab, setChannelTab] = useState<ChannelTab>('form')
  const [inputEmail, setInputEmail] = useState('')
  const [inputMessage, setInputMessage] = useState('')
  const [phoneStatus, setPhoneStatus] = useState('sent')
  const [phoneEmail, setPhoneEmail] = useState('')

  // Auto modal state (just set email → pipeline auto)
  const [autoModalAgency, setAutoModalAgency] = useState<AgencyWithConv | null>(null)
  const [autoEmail, setAutoEmail] = useState('')
  const [autoOwner, setAutoOwner] = useState('')

  useEffect(() => {
    loadAgencies()
  }, [])

  async function loadAgencies() {
    setLoading(true)

    const { data: agencyData } = await supabase
      .from('agencies')
      .select('id, name, city, phone, website, email, owner_name, linkedin, siret, score, score_reason, sales_brief, rating, enrichment_status, enrichment_note, is_franchise')
      .eq('enrichment_status', 'done')
      .is('email', null)
      .order('name')
      .limit(200)

    if (!agencyData) {
      setAgencies([])
      setLoading(false)
      return
    }

    const ids = agencyData.map(a => a.id)
    const { data: convData } = ids.length > 0
      ? await supabase
          .from('conversations')
          .select('agency_id, status')
          .in('agency_id', ids)
          .order('created_at', { ascending: false })
      : { data: [] }

    const convMap = new Map<string, string>()
    convData?.forEach(c => {
      if (!convMap.has(c.agency_id)) convMap.set(c.agency_id, c.status)
    })

    setAgencies(agencyData.map(a => ({
      ...a as Agency,
      conv_status: convMap.get(a.id) || null,
    })))
    setLoading(false)
  }

  function openContactModal(agency: AgencyWithConv) {
    setModalAgency(agency)
    if (agency.website) {
      setChannelTab('form')
      setInputEmail(extractDomainEmail(agency.website))
    } else if (agency.phone) {
      setChannelTab('phone')
    } else {
      setChannelTab('email')
      setInputEmail('')
    }
    setInputMessage('')
    setPhoneStatus('sent')
    setPhoneEmail('')
  }

  function openAutoModal(agency: AgencyWithConv) {
    setAutoModalAgency(agency)
    setAutoEmail('')
    setAutoOwner(agency.owner_name || '')
  }

  function onTabChange(tab: ChannelTab) {
    setChannelTab(tab)
    if (tab === 'form' && modalAgency) {
      setInputEmail(extractDomainEmail(modalAgency.website))
    } else if (tab === 'email') {
      setInputEmail('')
    }
  }

  // Form or email direct → create conversation with status "sent"
  async function submitContact() {
    if (!modalAgency || !inputEmail.trim()) return
    setSaving(true)

    await supabase
      .from('agencies')
      .update({ email: inputEmail.trim() })
      .eq('id', modalAgency.id)

    const { data: conv } = await supabase
      .from('conversations')
      .insert({
        agency_id: modalAgency.id,
        status: 'sent',
        sent_at: new Date().toISOString(),
        contact_method: channelTab === 'form' ? 'manual_form' : 'manual_email',
        ref: generateRef(),
      })
      .select('id')
      .single()

    if (conv && inputMessage.trim()) {
      await supabase.from('messages').insert({
        conversation_id: conv.id,
        direction: 'outbound',
        content: inputMessage.trim(),
      })
    }

    setSaving(false)
    setModalAgency(null)
    loadAgencies()
  }

  // Phone → create conversation with selected status
  async function submitPhone() {
    if (!modalAgency) return
    const needsEmail = EMAIL_REQUIRED_STATUSES.includes(phoneStatus)
    if (needsEmail && !phoneEmail.trim()) return
    setSaving(true)

    if (needsEmail) {
      await supabase
        .from('agencies')
        .update({ email: phoneEmail.trim() })
        .eq('id', modalAgency.id)
    }

    await supabase.from('conversations').insert({
      agency_id: modalAgency.id,
      status: phoneStatus,
      sent_at: needsEmail ? new Date().toISOString() : null,
      contact_method: 'manual_call',
      ref: generateRef(),
    })

    setSaving(false)
    setModalAgency(null)
    loadAgencies()
  }

  // Auto → just set email, no conversation (N8N pipeline picks it up)
  async function submitAuto() {
    if (!autoModalAgency || !autoEmail.trim()) return
    setSaving(true)

    const updates: Record<string, string> = { email: autoEmail.trim() }
    if (autoOwner.trim()) updates.owner_name = autoOwner.trim()

    await supabase
      .from('agencies')
      .update(updates)
      .eq('id', autoModalAgency.id)

    setSaving(false)
    setAutoModalAgency(null)
    loadAgencies()
  }

  function copyPrompt(a: AgencyWithConv) {
    const parts = [
      `Trouve-moi l'adresse email professionnelle et le nom du gérant/dirigeant de cette agence immobilière :`,
      ``,
      `- Nom : ${a.name}`,
      `- Ville : ${a.city}`,
    ]
    if (a.website) parts.push(`- Site web : ${a.website}`)
    if (a.phone) parts.push(`- Téléphone : ${a.phone}`)
    if (a.owner_name) parts.push(`- Gérant connu : ${a.owner_name}`)
    parts.push(
      ``,
      `Donne-moi uniquement :`,
      `1. L'email professionnel direct`,
      `2. Le nom complet du gérant/dirigeant`,
      `3. La source où tu as trouvé chaque info (URL, page, annuaire, etc.)`,
      ``,
      `Formate chaque info dans un bloc de code séparé (pour que je puisse copier chacun individuellement) :`,
      '',
      '```',
      `email@exemple.fr`,
      '```',
      '',
      '```',
      `Prénom Nom`,
      '```',
    )
    navigator.clipboard.writeText(parts.join('\n'))
  }

  async function skipAgency(agency: AgencyWithConv) {
    await supabase.from('agencies').update({ enrichment_status: 'skipped' }).eq('id', agency.id)
    setAgencies(prev => prev.filter(a => a.id !== agency.id))
  }

  async function toggleFranchise(agency: AgencyWithConv) {
    const newVal = !agency.is_franchise
    await supabase.from('agencies').update({ is_franchise: newVal }).eq('id', agency.id)
    setAgencies(prev => prev.map(a => a.id === agency.id ? { ...a, is_franchise: newVal } : a))
  }

  const sorted = [...agencies].sort((a, b) => getPriority(b) - getPriority(a))
  const filtered = sorted.filter(a => {
    if (filter === 'independant') return !a.is_franchise
    if (filter === 'franchise') return a.is_franchise
    return true
  })

  const countIndep = agencies.filter(a => !a.is_franchise).length
  const countFranchise = agencies.filter(a => a.is_franchise).length

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Phone size={20} className="text-orange-400" />
          <h2 className="text-xl font-bold">Contacts manuels</h2>
          {agencies.length > 0 && (
            <span className="text-sm bg-orange-500/20 text-orange-400 px-2 py-0.5 rounded">
              {agencies.length}
            </span>
          )}
        </div>
        <button
          onClick={loadAgencies}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-[var(--surface)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] transition-colors"
        >
          <RefreshCw size={13} /> Actualiser
        </button>
      </div>

      {/* Stats bar */}
      <div className="flex gap-3">
        <div className="flex-1 rounded-lg bg-[var(--surface)] border border-[var(--border)] px-4 py-3">
          <div className="text-2xl font-bold text-green-400">{countIndep}</div>
          <div className="text-xs text-[var(--text-muted)]">Independants</div>
        </div>
        <div className="flex-1 rounded-lg bg-[var(--surface)] border border-[var(--border)] px-4 py-3">
          <div className="text-2xl font-bold text-orange-400">{countFranchise}</div>
          <div className="text-xs text-[var(--text-muted)]">Franchises</div>
        </div>
        <div className="flex-1 rounded-lg bg-[var(--surface)] border border-[var(--border)] px-4 py-3">
          <div className="text-2xl font-bold">{agencies.length}</div>
          <div className="text-xs text-[var(--text-muted)]">Total a contacter</div>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 bg-[var(--surface)] rounded-lg p-1 w-fit border border-[var(--border)]">
        {([
          ['all', `Tous (${agencies.length})`],
          ['independant', `Independants (${countIndep})`],
          ['franchise', `Franchises (${countFranchise})`],
        ] as [Filter, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              filter === key
                ? 'bg-[var(--accent)] text-white'
                : 'text-[var(--text-muted)] hover:text-[var(--text)]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="rounded-lg bg-[var(--surface)] border border-[var(--border)] overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-[var(--text-muted)]">Chargement...</div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-[var(--text-muted)]">
            {agencies.length === 0
              ? 'Aucune agence a contacter manuellement.'
              : 'Aucune agence dans cette categorie.'}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-xs text-[var(--text-muted)]">
                <th className="px-4 py-2 text-left font-medium">Agence</th>
                <th className="px-4 py-2 text-left font-medium">Gerant</th>
                <th className="px-4 py-2 text-left font-medium">Contact</th>
                <th className="px-4 py-2 text-left font-medium">Statut</th>
                <th className="px-4 py-2 text-left font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {filtered.map((a) => {
                const statusInfo = a.conv_status ? STATUS_MAP[a.conv_status] : null
                return (
                  <tr
                    key={a.id}
                    className={`hover:bg-[var(--surface-hover)] transition-colors ${
                      a.conv_status === 'lost' ? 'opacity-40' : ''
                    }`}
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="font-medium truncate max-w-[200px]">{a.name}</div>
                        {a.is_franchise ? (
                          <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-400">Franchise</span>
                        ) : (
                          <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-400">Indep.</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-[var(--text-muted)]">{a.city}</span>
                        {a.rating && (
                          <span className="flex items-center gap-0.5 text-xs text-yellow-400">
                            <Star size={10} fill="currentColor" /> {a.rating}
                          </span>
                        )}
                      </div>
                    </td>

                    <td className="px-4 py-3 text-[var(--text-muted)]">
                      {a.owner_name ? (
                        <div className="flex flex-col gap-0.5">
                          <span className="flex items-center gap-1"><User size={12} /> {a.owner_name}</span>
                          {a.linkedin && (
                            <a href={a.linkedin} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-sky-400 hover:underline text-[10px]">
                              <ExternalLink size={9} /> LinkedIn
                            </a>
                          )}
                          {a.siret && (
                            <span className="text-[10px] text-[var(--text-muted)]">SIRET: {a.siret}</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs italic">—</span>
                      )}
                    </td>

                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        {a.phone && (
                          <a href={`tel:${a.phone}`} className="flex items-center gap-1 text-sky-400 hover:underline text-xs">
                            <Phone size={10} /> {a.phone}
                          </a>
                        )}
                        {a.website && (
                          <a href={a.website} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-sky-400 hover:underline text-xs truncate max-w-[180px]">
                            <Globe size={10} /> Site web
                          </a>
                        )}
                        {!a.phone && !a.website && (
                          <span className="text-xs text-[var(--text-muted)] italic">Aucun</span>
                        )}
                      </div>
                    </td>

                    <td className="px-4 py-3">
                      {statusInfo ? (
                        <span className={`text-xs px-2 py-1 rounded ${statusInfo.cls}`}>{statusInfo.label}</span>
                      ) : (
                        <span className={`text-xs px-2 py-1 rounded ${
                          a.is_franchise ? 'bg-gray-500/20 text-[var(--text-muted)]'
                            : a.website ? 'bg-blue-500/20 text-blue-400'
                            : 'bg-yellow-500/20 text-yellow-400'
                        }`}>
                          {getRecommendedAction(a)}
                        </span>
                      )}
                    </td>

                    <td className="px-4 py-3">
                      <div className="flex gap-1.5">
                        <button
                          onClick={() => openContactModal(a)}
                          className="text-xs px-2.5 py-1.5 rounded bg-[var(--accent)] text-white hover:opacity-90 transition-opacity"
                        >
                          Contacter
                        </button>
                        <button
                          onClick={() => openAutoModal(a)}
                          title="Passer en contact auto (ajouter email)"
                          className="flex items-center gap-1 text-xs px-2 py-1.5 rounded bg-green-600 text-white hover:opacity-90 transition-opacity"
                        >
                          <Zap size={11} /> Auto
                        </button>
                        <button
                          onClick={() => copyPrompt(a)}
                          title="Copier prompt ChatGPT"
                          className="flex items-center gap-1 text-xs px-2 py-1.5 rounded bg-purple-600/20 text-purple-400 hover:bg-purple-600/30 transition-colors"
                        >
                          <Copy size={11} /> Prompt
                        </button>
                        <button
                          onClick={() => skipAgency(a)}
                          title="Ignorer cette agence"
                          className="flex items-center gap-1 text-xs px-2 py-1.5 rounded bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors"
                        >
                          <Ban size={11} /> Ignorer
                        </button>
                        <button
                          onClick={() => toggleFranchise(a)}
                          title={a.is_franchise ? 'Marquer comme independant' : 'Marquer comme franchise'}
                          className="flex items-center gap-1 text-xs px-2 py-1.5 rounded bg-[var(--surface-hover)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
                        >
                          <Building2 size={12} />
                          {a.is_franchise ? 'Indep.' : 'Franchise'}
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ===== CONTACT MODAL ===== */}
      {modalAgency && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setModalAgency(null)}>
          <div className="bg-[var(--bg)] border border-[var(--border)] rounded-xl p-6 w-[520px] max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-bold text-lg">{modalAgency.name}</h3>
                <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
                  <span>{modalAgency.city}</span>
                  {modalAgency.owner_name && <><span>·</span><span>{modalAgency.owner_name}</span></>}
                  {modalAgency.is_franchise && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-400">Franchise</span>
                  )}
                </div>
              </div>
              <button onClick={() => setModalAgency(null)} className="text-[var(--text-muted)] hover:text-[var(--text)]">
                <X size={18} />
              </button>
            </div>

            {/* Quick links */}
            <div className="flex flex-wrap gap-2 mb-4">
              {modalAgency.phone && (
                <a href={`tel:${modalAgency.phone}`} className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-green-500/20 text-green-400 hover:bg-green-500/30 transition-colors">
                  <Phone size={12} /> {modalAgency.phone}
                </a>
              )}
              {modalAgency.website && (
                <a href={modalAgency.website} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-sky-500/20 text-sky-400 hover:bg-sky-500/30 transition-colors">
                  <ExternalLink size={12} /> Ouvrir le site
                </a>
              )}
              {modalAgency.linkedin && (
                <a href={modalAgency.linkedin} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-blue-600/20 text-blue-400 hover:bg-blue-600/30 transition-colors">
                  <ExternalLink size={12} /> LinkedIn
                </a>
              )}
            </div>
            {modalAgency.siret && (
              <div className="text-[10px] text-[var(--text-muted)] mb-2">SIRET: {modalAgency.siret}</div>
            )}

            {/* Enrichment note */}
            {modalAgency.enrichment_note && (
              <div className="text-xs text-[var(--text-muted)] bg-[var(--surface)] rounded-lg p-3 mb-4 leading-relaxed">
                {modalAgency.enrichment_note}
              </div>
            )}

            {/* Channel tabs */}
            <div className="flex gap-1 bg-[var(--surface)] rounded-lg p-1 mb-4 border border-[var(--border)]">
              <button
                onClick={() => onTabChange('form')}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium transition-colors ${
                  channelTab === 'form' ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                }`}
              >
                <Globe size={12} /> Formulaire
              </button>
              <button
                onClick={() => onTabChange('email')}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium transition-colors ${
                  channelTab === 'email' ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                }`}
              >
                <Send size={12} /> Email direct
              </button>
              <button
                onClick={() => onTabChange('phone')}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium transition-colors ${
                  channelTab === 'phone' ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                }`}
              >
                <Phone size={12} /> Telephone
              </button>
            </div>

            {/* ── Tab: Formulaire / Email direct ── */}
            {(channelTab === 'form' || channelTab === 'email') && (
              <div className="flex flex-col gap-4">
                <div>
                  <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">
                    {channelTab === 'form' ? 'Email pour le matching' : 'Adresse email trouvee'}
                  </label>
                  <input
                    type="email"
                    value={inputEmail}
                    onChange={e => setInputEmail(e.target.value)}
                    placeholder="contact@agence.fr"
                    className="w-full px-3 py-2 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-sm focus:border-[var(--accent)] focus:outline-none"
                  />
                  {channelTab === 'form' && (
                    <p className="text-[10px] text-[var(--text-muted)] mt-1">
                      Auto-genere depuis le site web. Le matching se fait par domaine.
                    </p>
                  )}
                </div>

                <div>
                  <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">
                    Message envoye (optionnel)
                  </label>
                  <textarea
                    value={inputMessage}
                    onChange={e => setInputMessage(e.target.value)}
                    placeholder={channelTab === 'form' ? 'Collez le message du formulaire...' : "Contenu de l'email envoye..."}
                    rows={4}
                    className="w-full px-3 py-2 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-sm focus:border-[var(--accent)] focus:outline-none resize-none"
                  />
                </div>

                <button
                  onClick={submitContact}
                  disabled={!inputEmail.trim() || saving}
                  className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <Send size={14} />
                  {saving ? 'Creation...' : 'Creer la conversation'}
                </button>
                <p className="text-[10px] text-[var(--text-muted)] text-center -mt-2">
                  Quand l'agence repondra, N8N prendra le relais automatiquement.
                </p>
              </div>
            )}

            {/* ── Tab: Telephone ── */}
            {channelTab === 'phone' && (
              <div className="flex flex-col gap-4">
                <div>
                  <label className="text-xs font-medium text-[var(--text-muted)] mb-2 block">Statut de la conversation</label>
                  <div className="grid grid-cols-2 gap-1.5">
                    {ALL_STATUSES.map(s => (
                      <button
                        key={s.value}
                        onClick={() => setPhoneStatus(s.value)}
                        className={`px-3 py-2 rounded-lg text-xs transition-colors border ${
                          phoneStatus === s.value
                            ? `${s.cls} border-current`
                            : 'border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--text-muted)]'
                        }`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                </div>

                {EMAIL_REQUIRED_STATUSES.includes(phoneStatus) && (
                  <div>
                    <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Email de l'agence</label>
                    <input
                      type="email"
                      value={phoneEmail}
                      onChange={e => setPhoneEmail(e.target.value)}
                      placeholder="contact@agence.fr"
                      className="w-full px-3 py-2 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-sm focus:border-[var(--accent)] focus:outline-none"
                    />
                    <p className="text-[10px] text-[var(--text-muted)] mt-1">
                      Necessaire pour que N8N puisse gerer les echanges.
                    </p>
                  </div>
                )}

                <button
                  onClick={submitPhone}
                  disabled={saving || (EMAIL_REQUIRED_STATUSES.includes(phoneStatus) && !phoneEmail.trim())}
                  className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg bg-[var(--accent)] text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {saving ? 'Enregistrement...' : 'Enregistrer'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ===== AUTO MODAL (passer en contact auto) ===== */}
      {autoModalAgency && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setAutoModalAgency(null)}>
          <div className="bg-[var(--bg)] border border-[var(--border)] rounded-xl p-6 w-[420px]" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-bold">Passer en contact auto</h3>
                <p className="text-sm text-[var(--text-muted)]">{autoModalAgency.name}</p>
              </div>
              <button onClick={() => setAutoModalAgency(null)} className="text-[var(--text-muted)] hover:text-[var(--text)]">
                <X size={18} />
              </button>
            </div>

            <p className="text-xs text-[var(--text-muted)] mb-4">
              Ajoute l'email a l'agence. N8N enverra le premier email automatiquement lors du prochain batch.
            </p>

            <div className="flex flex-col gap-3 mb-4">
              <div>
                <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Adresse email</label>
                <input
                  type="email"
                  value={autoEmail}
                  onChange={e => setAutoEmail(e.target.value)}
                  placeholder="contact@agence.fr"
                  className="w-full px-3 py-2 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-sm focus:border-[var(--accent)] focus:outline-none"
                />
              </div>
              <div>
                <label className="text-xs font-medium text-[var(--text-muted)] mb-1.5 block">Nom du gerant (optionnel)</label>
                <input
                  type="text"
                  value={autoOwner}
                  onChange={e => setAutoOwner(e.target.value)}
                  placeholder="Jean Dupont"
                  className="w-full px-3 py-2 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-sm focus:border-[var(--accent)] focus:outline-none"
                />
              </div>
            </div>

            <button
              onClick={submitAuto}
              disabled={!autoEmail.trim() || saving}
              className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg bg-green-600 text-white text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Zap size={14} />
              {saving ? 'Enregistrement...' : 'Passer en auto'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
