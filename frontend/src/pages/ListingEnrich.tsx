import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Copy, Check, Globe, ExternalLink, ChevronRight, ChevronLeft, SkipForward, ClipboardPaste } from 'lucide-react'

type AgencyPreview = {
  id: string
  name: string
  city: string
  email: string
  website: string | null
  listing_title: string | null
  listing_price: string | null
  listing_url: string | null
  listing_ref: string | null
  listing_type: string | null
}

const PROMPT_TEMPLATE = `Je suis sur le site de l'agence immobilière "{name}" à {city}.
Trouve-moi UN bien immobilier en vente sur cette page. N'importe lequel, du moment qu'il est réel et visible sur le site.

Renvoie-moi UNIQUEMENT un bloc de code JSON comme ceci, rien d'autre :

\`\`\`json
{
  "listing_title": "le titre exact de l'annonce",
  "listing_price": "le prix affiché (ex: 245 000 €)",
  "listing_url": "l'URL exacte de la page de l'annonce",
  "listing_type": "vente"
}
\`\`\``

export default function ListingEnrich() {
  const [agencies, setAgencies] = useState<AgencyPreview[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [pasteValue, setPasteValue] = useState('')
  const [parsed, setParsed] = useState<Record<string, string> | null>(null)
  const [parseError, setParseError] = useState('')
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)
  const [savedCount, setSavedCount] = useState(0)
  const [skippedCount, setSkippedCount] = useState(0)

  useEffect(() => {
    loadAgencies()
  }, [])

  async function loadAgencies() {
    setLoading(true)
    const { data, error } = await supabase.rpc('preview_next_contacts', { p_limit: 200 })
    if (!error && data) {
      setAgencies(data)
      // Sauter les agences déjà enrichies, aller à la première sans listing
      const firstEmpty = data.findIndex((a: AgencyPreview) => !a.listing_title)
      if (firstEmpty >= 0) setCurrentIndex(firstEmpty)
    }
    setLoading(false)
  }

  const current = agencies[currentIndex] || null
  const enrichedCount = agencies.filter(a => a.listing_title).length
  const remaining = agencies.filter(a => !a.listing_title).length

  function copyPrompt() {
    if (!current) return
    const prompt = PROMPT_TEMPLATE
      .replace('{name}', current.name)
      .replace('{city}', current.city)
    navigator.clipboard.writeText(prompt)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function openWebsite() {
    if (!current?.website) return
    const url = current.website.startsWith('http') ? current.website : `https://${current.website}`
    window.open(url, '_blank')
  }

  function handlePaste(value: string) {
    setPasteValue(value)
    setParseError('')
    setParsed(null)

    if (!value.trim()) return

    try {
      // Extraire le JSON d'un bloc code ou du texte brut
      let jsonStr = value
      const codeBlockMatch = value.match(/```(?:json)?\s*([\s\S]*?)```/)
      if (codeBlockMatch) jsonStr = codeBlockMatch[1]

      const data = JSON.parse(jsonStr.trim())

      // Parser les clés de manière flexible
      const result: Record<string, string> = {}
      for (const [key, val] of Object.entries(data)) {
        const k = key.toLowerCase().replace(/[-\s]/g, '_')
        if (k.includes('title') || k.includes('titre')) result.listing_title = String(val)
        else if (k.includes('price') || k.includes('prix')) result.listing_price = String(val)
        else if (k.includes('url') || k.includes('lien') || k.includes('link')) result.listing_url = String(val)
        else if (k.includes('ref')) result.listing_ref = String(val)
        else if (k.includes('type')) result.listing_type = String(val)
      }

      if (!result.listing_title && !result.listing_url) {
        setParseError('JSON valide mais aucun champ reconnu (title, price, url...)')
        return
      }

      setParsed(result)
    } catch {
      setParseError('JSON invalide — copie le bloc code en entier')
    }
  }

  async function handleSave() {
    if (!current || !parsed) return
    setSaving(true)

    const updates: Record<string, string | null> = {
      listing_title: parsed.listing_title || null,
      listing_price: parsed.listing_price || null,
      listing_url: parsed.listing_url || null,
      listing_ref: parsed.listing_ref === 'null' ? null : (parsed.listing_ref || null),
      listing_type: parsed.listing_type || 'vente',
    }

    await supabase.from('agencies').update(updates).eq('id', current.id)

    // Mettre à jour localement
    setAgencies(prev => prev.map(a => a.id === current.id ? { ...a, ...updates } : a))
    setSavedCount(prev => prev + 1)
    goNext()
    setSaving(false)
  }

  async function handleSkip() {
    if (!current) return
    // Marquer en base pour ne plus reproposer
    await supabase.from('agencies').update({ listing_title: 'SKIP' }).eq('id', current.id)
    setAgencies(prev => prev.map(a => a.id === current.id ? { ...a, listing_title: 'SKIP' } : a))
    setSkippedCount(prev => prev + 1)
    goNext()
  }

  function goNext() {
    setPasteValue('')
    setParsed(null)
    setParseError('')
    // Sauter à la prochaine agence sans listing
    setCurrentIndex(prev => {
      for (let i = prev + 1; i < agencies.length; i++) {
        if (!agencies[i].listing_title) return i
      }
      return prev // plus rien à enrichir
    })
  }

  function goPrev() {
    setPasteValue('')
    setParsed(null)
    setParseError('')
    // Reculer à la précédente sans listing
    setCurrentIndex(prev => {
      for (let i = prev - 1; i >= 0; i--) {
        if (!agencies[i].listing_title) return i
      }
      return prev
    })
  }

  if (loading) {
    return <div className="flex items-center justify-center h-[60vh] text-[var(--text-muted)]">Chargement...</div>
  }

  if (agencies.length === 0) {
    return (
      <div className="flex items-center justify-center h-[60vh] text-[var(--text-muted)]">
        <p>Aucune agence en attente de contact.</p>
      </div>
    )
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Enrichir les annonces</h2>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            {remaining} restantes · {enrichedCount} enrichies · {savedCount} cette session
          </p>
        </div>
        <div className="flex items-center gap-3 text-sm text-[var(--text-muted)]">
          <span>{enrichedCount + 1} / {agencies.length}</span>
          <button onClick={goPrev} disabled={currentIndex === 0}
            className="p-1.5 rounded-lg hover:bg-[var(--surface-hover)] disabled:opacity-30 transition-colors">
            <ChevronLeft size={18} />
          </button>
          <button onClick={goNext} disabled={currentIndex >= agencies.length - 1}
            className="p-1.5 rounded-lg hover:bg-[var(--surface-hover)] disabled:opacity-30 transition-colors">
            <ChevronRight size={18} />
          </button>
        </div>
      </div>

      {current && (
        <div className="grid grid-cols-2 gap-6">
          {/* Colonne gauche — Agence + Actions */}
          <div className="space-y-4">
            {/* Carte agence */}
            <div className="p-5 rounded-xl bg-[var(--surface)] border border-[var(--border)]">
              <h3 className="text-lg font-semibold">{current.name}</h3>
              <p className="text-sm text-[var(--text-muted)] mt-0.5">{current.city}</p>
              <p className="text-xs text-[var(--text-muted)] mt-1">{current.email}</p>

              {current.listing_title && current.listing_title !== 'SKIP' && (
                <div className="mt-3 p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                  <p className="text-xs text-emerald-400 font-medium">Annonce deja renseignee</p>
                  <p className="text-sm mt-1">{current.listing_title}</p>
                  <p className="text-xs text-emerald-400 mt-0.5">{current.listing_price}</p>
                </div>
              )}
            </div>

            {/* Boutons d'action */}
            <div className="flex gap-2">
              <button onClick={openWebsite} disabled={!current.website}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-medium bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/20 border border-[var(--accent)]/20 transition-colors disabled:opacity-30">
                <Globe size={16} />
                Ouvrir le site
              </button>

              <button onClick={copyPrompt}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-xl text-sm font-medium bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 border border-amber-500/20 transition-colors">
                {copied ? <Check size={16} /> : <Copy size={16} />}
                {copied ? 'Copie !' : 'Copier prompt'}
              </button>
            </div>

            <button onClick={handleSkip}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm text-[var(--text-muted)] hover:bg-[var(--surface-hover)] border border-[var(--border)] transition-colors">
              <SkipForward size={14} />
              Passer (pas de bien trouvé)
            </button>
          </div>

          {/* Colonne droite — Coller résultat */}
          <div className="space-y-4">
            <div className="p-5 rounded-xl bg-[var(--surface)] border border-[var(--border)] space-y-3">
              <div className="flex items-center gap-2">
                <ClipboardPaste size={16} className="text-[var(--text-muted)]" />
                <p className="text-sm font-medium">Coller le résultat ChatGPT</p>
              </div>

              <textarea
                value={pasteValue}
                onChange={e => handlePaste(e.target.value)}
                placeholder='Colle ici le bloc JSON de ChatGPT...'
                rows={8}
                className="w-full px-3 py-2.5 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm text-[var(--text)] font-mono outline-none focus:border-[var(--accent)] transition-colors resize-none"
              />

              {parseError && (
                <p className="text-xs text-red-400">{parseError}</p>
              )}
            </div>

            {/* Preview parsed */}
            {parsed && (
              <div className="p-4 rounded-xl bg-[var(--bg)] border border-emerald-500/30 space-y-2">
                <p className="text-xs text-emerald-400 font-medium uppercase tracking-wide">Apercu</p>
                <div className="space-y-1.5 text-sm">
                  <div className="flex gap-2">
                    <span className="text-[var(--text-muted)] w-12 shrink-0 text-xs">Titre</span>
                    <span className="font-medium">{parsed.listing_title || '-'}</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-[var(--text-muted)] w-12 shrink-0 text-xs">Prix</span>
                    <span className="text-emerald-400 font-semibold">{parsed.listing_price || '-'}</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-[var(--text-muted)] w-12 shrink-0 text-xs">URL</span>
                    {parsed.listing_url ? (
                      <a href={parsed.listing_url} target="_blank" rel="noopener noreferrer" className="text-[var(--accent)] hover:underline flex items-center gap-1 truncate">
                        {parsed.listing_url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 50)} <ExternalLink size={10} />
                      </a>
                    ) : <span>-</span>}
                  </div>
                  <div className="flex gap-2">
                    <span className="text-[var(--text-muted)] w-12 shrink-0 text-xs">Ref</span>
                    <span>{parsed.listing_ref || '-'}</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-[var(--text-muted)] w-12 shrink-0 text-xs">Type</span>
                    <span className="capitalize">{parsed.listing_type || 'vente'}</span>
                  </div>
                </div>

                <button onClick={handleSave} disabled={saving}
                  className="w-full mt-3 py-2.5 rounded-lg text-sm font-semibold bg-emerald-500 text-white hover:bg-emerald-600 transition-colors disabled:opacity-50">
                  {saving ? 'Enregistrement...' : 'Valider et suivant'}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
