import { useEffect, useState } from 'react'
import { RefreshCw, Mail, MapPin, Check, ChevronDown, ChevronUp } from 'lucide-react'
import { supabase } from '../lib/supabase'

const N8N_WEBHOOK = 'https://n8n.srv915893.hstgr.cloud/webhook/00332d99-5028-41fb-a3be-bef655e5b912-unmatch-email'

type Candidate = {
  agency_id: string
  agency_name: string
  agency_city: string
  agency_email: string | null
  conversation_id: string
  conversation_status: string
}

type UnmatchedEmail = {
  id: string
  from_email: string
  subject: string | null
  body: string | null
  received_at: string
  sender_domain: string
  candidates: Candidate[] | null
}

export default function UnmatchedEmails() {
  const [emails, setEmails] = useState<UnmatchedEmail[]>([])
  const [loading, setLoading] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [resolving, setResolving] = useState<string | null>(null)

  useEffect(() => {
    loadEmails()
  }, [])

  async function loadEmails() {
    setLoading(true)
    const { data } = await supabase.rpc('get_unmatched_emails')
    setEmails(data || [])
    setLoading(false)
  }

  async function resolve(email: UnmatchedEmail, candidate: Candidate) {
    setResolving(candidate.conversation_id)

    // 1. Call RPC to resolve + update agency email
    const { data } = await supabase.rpc('resolve_unmatched_email', {
      p_unmatched_id: email.id,
      p_conversation_id: candidate.conversation_id,
      p_inbound_content: email.body || '',
    })

    // 2. Call N8N webhook so AI can continue the conversation
    if (data?.success) {
      try {
        await fetch(N8N_WEBHOOK, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            conversation_id: candidate.conversation_id,
            agency_id: candidate.agency_id,
            agency_name: candidate.agency_name,
            agency_email: email.from_email,
            agency_city: candidate.agency_city,
            conversation_status: candidate.conversation_status,
            inbound_content: email.body || '',
            subject: email.subject || '',
          }),
        })
      } catch {
        // Webhook fail is not blocking — conversation is already resolved in DB
      }
    }

    setResolving(null)
    loadEmails()
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Mail size={20} className="text-yellow-400" />
          <h2 className="text-xl font-bold">Reponses non-matchees</h2>
          {emails.length > 0 && (
            <span className="text-sm bg-yellow-500/20 text-yellow-400 px-2 py-0.5 rounded">
              {emails.length}
            </span>
          )}
        </div>
        <button
          onClick={loadEmails}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-[var(--surface)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] transition-colors"
        >
          <RefreshCw size={13} /> Actualiser
        </button>
      </div>

      <p className="text-sm text-[var(--text-muted)]">
        Emails recus dont le domaine correspond a plusieurs agences. Cliquez sur la bonne agence pour associer et reprendre le flow automatique.
      </p>

      {/* List */}
      <div className="flex flex-col gap-3">
        {loading ? (
          <div className="p-8 text-center text-sm text-[var(--text-muted)]">Chargement...</div>
        ) : emails.length === 0 ? (
          <div className="rounded-lg bg-[var(--surface)] border border-[var(--border)] p-8 text-center text-sm text-[var(--text-muted)]">
            Aucune reponse non-matchee.
          </div>
        ) : (
          emails.map(email => {
            const isExpanded = expandedId === email.id
            return (
              <div key={email.id} className="rounded-lg bg-[var(--surface)] border border-[var(--border)] overflow-hidden">
                {/* Email header */}
                <button
                  onClick={() => setExpandedId(isExpanded ? null : email.id)}
                  className="w-full flex items-center justify-between px-4 py-3 hover:bg-[var(--surface-hover)] transition-colors text-left"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{email.from_email}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-400">
                        {email.candidates?.length || 0} agences possibles
                      </span>
                    </div>
                    {email.subject && (
                      <div className="text-xs text-[var(--text-muted)] mt-0.5 truncate">{email.subject}</div>
                    )}
                    <div className="text-[10px] text-[var(--text-muted)] mt-0.5">
                      {new Date(email.received_at).toLocaleString('fr-FR')}
                    </div>
                  </div>
                  {isExpanded ? <ChevronUp size={16} className="text-[var(--text-muted)]" /> : <ChevronDown size={16} className="text-[var(--text-muted)]" />}
                </button>

                {/* Expanded content */}
                {isExpanded && (
                  <div className="border-t border-[var(--border)]">
                    {/* Email body preview */}
                    {email.body && (
                      <div className="px-4 py-3 text-xs text-[var(--text-muted)] bg-[var(--bg)] border-b border-[var(--border)] max-h-[200px] overflow-y-auto whitespace-pre-wrap leading-relaxed">
                        {email.body}
                      </div>
                    )}

                    {/* Candidates */}
                    <div className="px-4 py-3">
                      <div className="text-xs font-medium text-[var(--text-muted)] mb-2">Quelle agence ?</div>
                      <div className="flex flex-col gap-1.5">
                        {email.candidates && email.candidates.length > 0 ? (
                          email.candidates.map(c => (
                            <div
                              key={c.conversation_id}
                              className="flex items-center justify-between px-3 py-2.5 rounded-lg border border-[var(--border)] hover:border-[var(--accent)] transition-colors"
                            >
                              <div>
                                <div className="text-sm font-medium">{c.agency_name}</div>
                                <div className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
                                  <MapPin size={10} /> {c.agency_city}
                                  {c.agency_email && (
                                    <span className="ml-2">{c.agency_email}</span>
                                  )}
                                </div>
                              </div>
                              <button
                                onClick={() => resolve(email, c)}
                                disabled={resolving === c.conversation_id}
                                className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded bg-[var(--accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-40"
                              >
                                <Check size={12} />
                                {resolving === c.conversation_id ? 'Association...' : 'Associer'}
                              </button>
                            </div>
                          ))
                        ) : (
                          <div className="text-xs text-[var(--text-muted)] italic">
                            Aucune conversation active trouvee pour ce domaine.
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
