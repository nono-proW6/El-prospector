import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import type { Agency } from '../lib/types'
import {
  Search, FileText, Copy, Check, User, MapPin, Linkedin,
  Loader2, Sparkles, Globe, X, MailCheck
} from 'lucide-react'

type Candidate = Agency & {
  conversation_id: string | null
  sent_at: string | null
  response_time_minutes: number | null
}

export default function Reports() {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Candidate[]>([])
  const [searching, setSearching] = useState(false)
  const [selected, setSelected] = useState<Candidate | null>(null)

  // Manual fields (universal mode)
  const [manualCity, setManualCity] = useState('')
  const [manualDept, setManualDept] = useState('')
  const [manualRegion, setManualRegion] = useState('')
  const [manualOwner, setManualOwner] = useState('')

  const [output, setOutput] = useState('')
  const [outputMeta, setOutputMeta] = useState<{ scale?: string; zone_label?: string; total_contacted?: number } | null>(null)
  const [generating, setGenerating] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Debounced search
  useEffect(() => {
    if (!query.trim()) { setResults([]); return }
    const t = setTimeout(async () => {
      setSearching(true)
      await runSearch(query.trim())
      setSearching(false)
    }, 250)
    return () => clearTimeout(t)
  }, [query])

  async function runSearch(q: string) {
    // If looks like a LinkedIn URL, search by linkedin column first
    const isUrl = q.startsWith('http') || q.includes('linkedin.com')
    let agenciesQuery = supabase.from('agencies').select('*')

    if (isUrl) {
      const slug = q.replace(/\/$/, '').split('/in/')[1]?.split('?')[0] || q
      agenciesQuery = agenciesQuery.or(`linkedin.ilike.%${slug}%`)
    } else {
      agenciesQuery = agenciesQuery.or(`owner_name.ilike.%${q}%,name.ilike.%${q}%`)
    }
    const { data: ags } = await agenciesQuery.limit(15)
    if (!ags?.length) { setResults([]); return }

    // Enrich with most recent conversation (if any)
    const ids = ags.map(a => a.id)
    const { data: convs } = await supabase.from('conversations').select('id, agency_id, sent_at, response_time_minutes, status')
      .in('agency_id', ids).neq('status', 'pending').order('sent_at', { ascending: false })

    const convByAgency = new Map<string, any>()
    for (const c of convs || []) {
      if (!convByAgency.has(c.agency_id)) convByAgency.set(c.agency_id, c)
    }

    const enriched: Candidate[] = ags.map(a => {
      const c = convByAgency.get(a.id)
      return {
        ...a,
        conversation_id: c?.id || null,
        sent_at: c?.sent_at || null,
        response_time_minutes: c?.response_time_minutes || null,
      }
    })
    // Sort: with conversation + response_time first, then with conv, then rest
    enriched.sort((a, b) => {
      if (a.response_time_minutes !== null && b.response_time_minutes === null) return -1
      if (a.response_time_minutes === null && b.response_time_minutes !== null) return 1
      if (a.conversation_id && !b.conversation_id) return -1
      if (!a.conversation_id && b.conversation_id) return 1
      return 0
    })
    setResults(enriched)
  }

  function selectCandidate(c: Candidate) {
    setSelected(c)
    setResults([])
    setQuery('')
    setOutput('')
    setOutputMeta(null)
    setError(null)
  }

  function clearSelection() {
    setSelected(null)
    setOutput('')
    setOutputMeta(null)
    setError(null)
  }

  async function generatePersonalReport() {
    if (!selected?.conversation_id) return
    setGenerating(true)
    setError(null)
    const { data, error: err } = await supabase.rpc('generate_report_email', { p_conversation_id: selected.conversation_id })
    setGenerating(false)
    if (err) { setError(err.message); return }
    if (data?.error) { setError(String(data.error)); return }
    setOutput(data?.email || '')
    setOutputMeta({ scale: 'perso (avec classement)' })
  }

  async function generateSemiPersonalReport(contactedNoResponse: boolean) {
    if (!selected) return
    setGenerating(true)
    setError(null)
    const { data, error: err } = await supabase.rpc('generate_universal_report_email', {
      p_city: selected.city || null,
      p_department: selected.department || null,
      p_region: selected.region || null,
      p_owner_name: selected.owner_name || null,
      p_contacted_no_response: contactedNoResponse,
    })
    setGenerating(false)
    if (err) { setError(err.message); return }
    setOutput(data?.email || '')
    setOutputMeta({ scale: data?.scale, zone_label: data?.zone_label, total_contacted: data?.total_contacted })
  }

  async function generateUniversalManual() {
    setGenerating(true)
    setError(null)
    const { data, error: err } = await supabase.rpc('generate_universal_report_email', {
      p_city: manualCity.trim() || null,
      p_department: manualDept.trim() || null,
      p_region: manualRegion.trim() || null,
      p_owner_name: manualOwner.trim() || null,
      p_contacted_no_response: false,
    })
    setGenerating(false)
    if (err) { setError(err.message); return }
    setOutput(data?.email || '')
    setOutputMeta({ scale: data?.scale, zone_label: data?.zone_label, total_contacted: data?.total_contacted })
  }

  async function copyToClipboard() {
    await navigator.clipboard.writeText(output)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const hasConv = !!selected?.conversation_id
  const hasResponseTime = selected?.response_time_minutes !== null && selected?.response_time_minutes !== undefined

  return (
    <div className="max-w-3xl mx-auto">
      {/* Title */}
      <div className="mb-8">
        <h1 className="text-xl font-bold">Rapports</h1>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          Génère un rapport perso (si le gérant est dans la base) ou un rapport universel adapté.
        </p>
      </div>

      {/* Search */}
      {!selected && (
        <div className="mb-6">
          <label className="block text-xs uppercase tracking-wider text-[var(--text-muted)] mb-2 font-semibold">
            Chercher un profil LinkedIn (nom du gérant, agence, ou URL)
          </label>
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
            <input
              autoFocus
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Ex: Pierre Dupont, Century 21, linkedin.com/in/..."
              className="w-full pl-10 pr-4 py-3 rounded-xl bg-[var(--surface)] border border-[var(--border)] focus:outline-none focus:border-[var(--accent)] text-sm"
            />
            {searching && <Loader2 size={14} className="animate-spin absolute right-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />}
          </div>

          {results.length > 0 && (
            <div className="mt-3 space-y-1.5 max-h-[400px] overflow-y-auto">
              {results.map(c => (
                <button key={c.id} onClick={() => selectCandidate(c)}
                  className="w-full text-left bg-[var(--surface)] border border-[var(--border)] rounded-xl px-4 py-3 hover:border-[var(--accent)]/40 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{c.owner_name || c.name}</span>
                        {c.response_time_minutes !== null && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400">
                            <MailCheck size={10} className="inline mr-1" />contacté + répondu
                          </span>
                        )}
                        {c.conversation_id && c.response_time_minutes === null && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-400">
                            contacté
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[var(--text-muted)] mt-0.5 flex items-center gap-1.5 truncate">
                        {c.owner_name && <>{c.name}<span className="mx-0.5">·</span></>}
                        <MapPin size={11} />{c.city}
                      </p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {!searching && query.trim() && results.length === 0 && (
            <p className="mt-3 text-xs text-[var(--text-muted)]">
              Aucun profil trouvé — utilise un rapport universel ci-dessous.
            </p>
          )}
        </div>
      )}

      {/* Selected */}
      {selected && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl px-5 py-4 mb-6">
          <div className="flex items-start justify-between mb-3">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-1">
                <User size={14} className="text-[var(--text-muted)]" />
                <span className="font-medium">{selected.owner_name || '—'}</span>
              </div>
              <p className="text-xs text-[var(--text-muted)] flex items-center gap-1.5">
                {selected.name}<span className="mx-0.5">·</span>
                <MapPin size={11} />{selected.city}
                {selected.linkedin && (
                  <>
                    <span className="mx-0.5">·</span>
                    <a href={selected.linkedin} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-[#0A66C2]">
                      <Linkedin size={11} />LinkedIn
                    </a>
                  </>
                )}
              </p>
              <div className="flex gap-2 mt-2">
                {hasResponseTime && (
                  <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-400">
                    a répondu en {selected.response_time_minutes}min
                  </span>
                )}
                {hasConv && !hasResponseTime && (
                  <span className="text-[10px] px-2 py-0.5 rounded bg-blue-500/15 text-blue-400">
                    contacté sans réponse
                  </span>
                )}
                {!hasConv && (
                  <span className="text-[10px] px-2 py-0.5 rounded bg-zinc-500/15 text-zinc-400">
                    pas encore contacté
                  </span>
                )}
              </div>
            </div>
            <button onClick={clearSelection} className="text-[var(--text-muted)] hover:text-[var(--text)]">
              <X size={16} />
            </button>
          </div>

          {/* Generation buttons — one CTA adapted to the 3 cases */}
          <div className="flex flex-wrap gap-2">
            {hasResponseTime && (
              <button onClick={generatePersonalReport} disabled={generating}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-sm font-medium disabled:opacity-50">
                {generating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                Générer le rapport (a répondu · avec classement)
              </button>
            )}
            {hasConv && !hasResponseTime && (
              <button onClick={() => generateSemiPersonalReport(true)} disabled={generating}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-sm font-medium disabled:opacity-50">
                {generating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                Générer le rapport (contacté · pas de réponse)
              </button>
            )}
            {!hasConv && (
              <button onClick={() => generateSemiPersonalReport(false)} disabled={generating}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-sm font-medium disabled:opacity-50">
                {generating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                Générer le rapport (pas encore contacté)
              </button>
            )}
            {/* Fallback: bouton secondaire pour passer à une variante plus neutre */}
            {hasConv && (
              <button onClick={() => generateSemiPersonalReport(false)} disabled={generating}
                title="Version sans mention de l'historique"
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--surface-hover)] border border-[var(--border)] hover:border-[var(--accent)]/40 text-sm font-medium disabled:opacity-50">
                <FileText size={14} />
                Version neutre
              </button>
            )}
          </div>
        </div>
      )}

      {/* Universal manual mode */}
      {!selected && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl px-5 py-4 mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Globe size={14} className="text-[var(--text-muted)]" />
            <h3 className="text-sm font-semibold">Rapport universel (sans profil)</h3>
          </div>
          <p className="text-xs text-[var(--text-muted)] mb-3">
            Les stats s'ajustent automatiquement (ville → dept → région → France) en fonction de la donnée dispo.
          </p>
          <div className="grid grid-cols-4 gap-2 mb-3">
            <input type="text" value={manualCity} onChange={e => setManualCity(e.target.value)} placeholder="Ville"
              className="px-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm focus:outline-none focus:border-[var(--accent)]" />
            <input type="text" value={manualDept} onChange={e => setManualDept(e.target.value)} placeholder="Département (ex: 13)"
              className="px-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm focus:outline-none focus:border-[var(--accent)]" />
            <input type="text" value={manualRegion} onChange={e => setManualRegion(e.target.value)} placeholder="Région"
              className="px-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm focus:outline-none focus:border-[var(--accent)]" />
            <input type="text" value={manualOwner} onChange={e => setManualOwner(e.target.value)} placeholder="Prénom/Nom gérant"
              className="px-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm focus:outline-none focus:border-[var(--accent)]" />
          </div>
          <button onClick={generateUniversalManual} disabled={generating}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[var(--accent)] hover:bg-[var(--accent-hover)] text-white text-sm font-medium disabled:opacity-50">
            {generating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
            Générer
          </button>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 mb-4 text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Output */}
      {output && (
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <FileText size={14} className="text-[var(--accent)]" />
              <h3 className="text-sm font-semibold">Rapport généré</h3>
              {outputMeta?.scale && (
                <span className="text-[10px] px-2 py-0.5 rounded bg-[var(--accent)]/15 text-[var(--accent)]">
                  {outputMeta.scale}{outputMeta.zone_label && ` · ${outputMeta.zone_label}`}
                  {outputMeta.total_contacted ? ` · n=${outputMeta.total_contacted}` : ''}
                </span>
              )}
            </div>
            <button onClick={copyToClipboard}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--surface-hover)] border border-[var(--border)] text-xs hover:border-[var(--accent)]/40 transition-colors">
              {copied ? <><Check size={12} />Copié</> : <><Copy size={12} />Copier</>}
            </button>
          </div>
          <textarea
            value={output}
            onChange={e => setOutput(e.target.value)}
            rows={output.split('\n').length + 2}
            className="w-full bg-[var(--bg)] border border-[var(--border)] rounded-lg px-4 py-3 text-sm font-mono whitespace-pre-wrap focus:outline-none focus:border-[var(--accent)] resize-y"
          />
        </div>
      )}
    </div>
  )
}
