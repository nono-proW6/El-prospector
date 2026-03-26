import { useEffect, useState } from 'react'
import {
  Building2, Mail, Video, Clock, Users, Search, MessageSquare,
  TrendingUp, MapPin, Zap, Phone, ArrowRight, MailQuestion, RefreshCw,
  RotateCw, Target, CalendarClock,
} from 'lucide-react'
import { supabase } from '../lib/supabase'

type AgencyRow = {
  id: string
  email: string | null
  city: string
  is_franchise: boolean
  enrichment_status: string
  website: string | null
  phone: string | null
  owner_name: string | null
  rating: number | null
}

type ConvRow = {
  id: string
  agency_id: string
  status: string
  contact_method: string | null
  visio_accepted: boolean
  first_response_at: string | null
  response_time_minutes: number | null
  nb_exchanges: number
  sent_at: string | null
  no_answer: boolean
  follow_up_count: number
  last_follow_up_at: string | null
}

type MessageRow = {
  id: string
  conversation_id: string
  direction: string
  content: string
  sent_at: string
}

type EventRow = {
  conversation_id: string
  from_status: string | null
  to_status: string
  changed_at: string
}

type FollowUpConfigRow = {
  status: string
  delay_days: number
  max_follow_ups: number
}

type EmailConfigRow = {
  daily_follow_up_limit: number
}

type DashData = {
  agencies: AgencyRow[]
  conversations: ConvRow[]
  messages: MessageRow[]
  events: EventRow[]
  scanZonesTotal: number
  scanZonesDone: number
  unmatchedPending: number
  followUpConfig: FollowUpConfigRow[]
  emailConfig: EmailConfigRow | null
}

const PIPELINE_STATUSES = [
  { key: 'sent', label: 'Envoyees', color: 'bg-sky-500' },
  { key: 'prospect_phase', label: 'Prospect', color: 'bg-blue-500' },
  { key: 'revealed', label: 'Revelees', color: 'bg-purple-500' },
  { key: 'report_sent', label: 'Rapport', color: 'bg-violet-500' },
  { key: 'video_sent', label: 'Video', color: 'bg-indigo-500' },
  { key: 'visio_accepted', label: 'Visio OK', color: 'bg-green-500' },
  { key: 'no_answer', label: 'Pas de reponse', color: 'bg-yellow-500' },
  { key: 'callback', label: 'A rappeler', color: 'bg-cyan-500' },
  { key: 'closed', label: 'Fermees', color: 'bg-gray-500' },
  { key: 'lost', label: 'Perdues', color: 'bg-red-500' },
  { key: 'wrong_target', label: 'Mauvaise cible', color: 'bg-rose-500' },
]

export default function Dashboard() {
  const [data, setData] = useState<DashData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true)
    const [agRes, convRes, msgRes, evtRes, scanTotalRes, scanDoneRes, unmatchRes, fuConfigRes, emailConfigRes] = await Promise.all([
      supabase.from('agencies').select('id, email, city, is_franchise, enrichment_status, website, phone, owner_name, rating'),
      supabase.from('conversations').select('id, agency_id, status, contact_method, visio_accepted, first_response_at, response_time_minutes, nb_exchanges, sent_at, no_answer, follow_up_count, last_follow_up_at'),
      supabase.from('messages').select('id, conversation_id, direction, content, sent_at').order('sent_at', { ascending: false }).limit(10),
      supabase.from('conversation_events').select('conversation_id, from_status, to_status, changed_at').order('changed_at'),
      supabase.from('scan_zones').select('id', { count: 'exact', head: true }),
      supabase.from('scan_zones').select('id', { count: 'exact', head: true }).eq('status', 'done'),
      supabase.from('unmatched_emails').select('id', { count: 'exact', head: true }).eq('resolved', false),
      supabase.from('follow_up_config').select('status, delay_days, max_follow_ups'),
      supabase.from('email_config').select('daily_follow_up_limit').eq('id', 1).single(),
    ])
    setData({
      agencies: (agRes.data || []) as AgencyRow[],
      conversations: (convRes.data || []) as ConvRow[],
      messages: (msgRes.data || []) as MessageRow[],
      events: (evtRes.data || []) as EventRow[],
      scanZonesTotal: scanTotalRes.count || 0,
      scanZonesDone: scanDoneRes.count || 0,
      unmatchedPending: unmatchRes.count || 0,
      followUpConfig: (fuConfigRes.data || []) as FollowUpConfigRow[],
      emailConfig: emailConfigRes.data as EmailConfigRow | null,
    })
    setLoading(false)
  }

  const [pipelineFilter, setPipelineFilter] = useState<'all' | 'indep' | 'franchise'>('all')

  if (loading || !data) return <p className="text-[var(--text-muted)]">Chargement...</p>

  const { agencies, conversations, messages, events } = data

  // Build agency franchise lookup
  const agencyFranchiseMap = new Map(agencies.map(a => [a.id, a.is_franchise]))

  // Filtered conversations & events for pipeline section
  const filteredConvs = pipelineFilter === 'all' ? conversations
    : conversations.filter(c => {
        const isFranchise = agencyFranchiseMap.get(c.agency_id)
        return pipelineFilter === 'franchise' ? isFranchise : !isFranchise
      })
  const filteredConvIds = new Set(filteredConvs.map(c => c.id))
  const filteredEvents = pipelineFilter === 'all' ? events
    : events.filter(e => filteredConvIds.has(e.conversation_id))

  // === Computed stats ===
  const totalAgencies = agencies.length
  const franchises = agencies.filter(a => a.is_franchise)
  const indeps = agencies.filter(a => !a.is_franchise)
  const pctFranchise = totalAgencies > 0 ? Math.round((franchises.length / totalAgencies) * 100) : 0
  const pctIndep = 100 - pctFranchise

  const withEmail = agencies.filter(a => a.email)
  const enriched = agencies.filter(a => a.enrichment_status === 'done')
  const skipped = agencies.filter(a => a.enrichment_status === 'skipped')
  const pendingEnrich = agencies.filter(a => a.enrichment_status === 'pending')
  const emailFoundByEnrich = enriched.filter(a => a.email)
  const ownerFound = enriched.filter(a => a.owner_name)
  const hasSiteNoEmail = enriched.filter(a => a.website && !a.email)

  const replied = conversations.filter(c => c.first_response_at)
  const visioCount = conversations.filter(c => c.visio_accepted).length
  const lostCount = conversations.filter(c => c.status === 'lost').length
  const noAnswerCount = conversations.filter(c => c.no_answer).length
  const wrongTargetCount = conversations.filter(c => c.status === 'wrong_target').length

  // Pipeline stats — filtered by toggle
  const fReplied = filteredConvs.filter(c => c.first_response_at)
  const fResponseTimes = fReplied.map(c => c.response_time_minutes).filter((t): t is number => t != null)
  const fAvgResponse = fResponseTimes.length > 0 ? Math.round(fResponseTimes.reduce((a, b) => a + b, 0) / fResponseTimes.length) : null
  const fTotalExchanges = filteredConvs.reduce((s, c) => s + c.nb_exchanges, 0)
  const fOutbound = messages.filter(m => m.direction === 'outbound' && filteredConvIds.has(m.conversation_id)).length
  const fInbound = messages.filter(m => m.direction === 'inbound' && filteredConvIds.has(m.conversation_id)).length

  const fAutoConvs = filteredConvs.filter(c => c.contact_method === 'auto')
  const fManualConvs = filteredConvs.filter(c => c.contact_method && c.contact_method !== 'auto')

  // Conv status counts — filtered
  const fStatusCounts: Record<string, number> = {}
  filteredConvs.forEach(c => { fStatusCounts[c.status] = (fStatusCounts[c.status] || 0) + 1 })

  // Franchise vs indep conversations
  const franchiseConvs = conversations.filter(c => agencies.find(a => a.id === c.agency_id)?.is_franchise)
  const indepConvs = conversations.filter(c => !agencies.find(a => a.id === c.agency_id)?.is_franchise)

  // Top cities
  const cityMap = new Map<string, { total: number; email: number; franchise: number }>()
  agencies.forEach(a => {
    const c = cityMap.get(a.city) || { total: 0, email: 0, franchise: 0 }
    c.total++
    if (a.email) c.email++
    if (a.is_franchise) c.franchise++
    cityMap.set(a.city, c)
  })
  const topCities = [...cityMap.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 8)

  // Funnel
  const funnelSteps = [
    { label: 'Trouvees', value: totalAgencies, color: 'bg-sky-500' },
    { label: 'Enrichies', value: enriched.length + skipped.length, color: 'bg-blue-500' },
    { label: 'Avec email', value: withEmail.length, color: 'bg-purple-500' },
    { label: 'Contactees', value: conversations.length, color: 'bg-indigo-500' },
    { label: 'Repondu', value: replied.length, color: 'bg-amber-500' },
    { label: 'Visio', value: visioCount, color: 'bg-green-500' },
  ]


  // Phase performance from events
  // Ordered pipeline phases
  const PHASE_ORDER = ['sent', 'prospect_phase', 'revealed', 'report_sent', 'video_sent', 'visio_accepted']
  const PHASE_LABELS: Record<string, string> = {
    sent: 'Envoyee',
    prospect_phase: 'Prospect',
    revealed: 'Revelee',
    report_sent: 'Rapport envoye',
    video_sent: 'Video envoyee',
    visio_accepted: 'Visio acceptee',
  }
  const DROP_STATUSES = ['lost', 'no_answer', 'closed', 'wrong_target']

  // Group filtered events by conversation
  const eventsByConv = new Map<string, EventRow[]>()
  filteredEvents.forEach(e => {
    const list = eventsByConv.get(e.conversation_id) || []
    list.push(e)
    eventsByConv.set(e.conversation_id, list)
  })

  // For each phase, compute: entered, moved to next (or beyond), avg time, dropped
  const phaseStats = PHASE_ORDER.slice(0, -1).map((phase, i) => {
    const nextPhases = PHASE_ORDER.slice(i + 1)
    const label = `${PHASE_LABELS[phase]} → ${PHASE_LABELS[PHASE_ORDER[i + 1]]}`

    const enteredConvIds = new Set(filteredEvents.filter(e => e.to_status === phase).map(e => e.conversation_id))

    // Of those, which moved to any later phase (even if skipping)
    const convertedConvIds = new Set<string>()
    const times: number[] = []

    enteredConvIds.forEach(convId => {
      const convEvents = eventsByConv.get(convId) || []
      // Find when they entered this phase
      const enterEvt = convEvents.find(e => e.to_status === phase)
      // Find first event where they moved to a later phase
      const advanceEvt = convEvents.find(e =>
        e.from_status && PHASE_ORDER.indexOf(e.from_status) >= i &&
        nextPhases.includes(e.to_status)
      )
      if (advanceEvt && enterEvt) {
        convertedConvIds.add(convId)
        const diff = (new Date(advanceEvt.changed_at).getTime() - new Date(enterEvt.changed_at).getTime()) / 60000
        if (diff > 0) times.push(diff)
      }
    })

    // Dropped: conversations that left this phase to a terminal status
    const droppedConvIds = new Set<string>()
    enteredConvIds.forEach(convId => {
      if (convertedConvIds.has(convId)) return
      const convEvents = eventsByConv.get(convId) || []
      if (convEvents.some(e => e.from_status === phase && DROP_STATUSES.includes(e.to_status))) {
        droppedConvIds.add(convId)
      }
    })

    const entered = enteredConvIds.size
    const converted = convertedConvIds.size
    const dropped = droppedConvIds.size
    const avgTime = times.length > 0 ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null
    const rate = entered > 0 ? Math.round((converted / entered) * 100) : null

    return { label, entered, converted, rate, avgTime, dropped }
  })

  const scanPct = data.scanZonesTotal > 0 ? ((data.scanZonesDone / data.scanZonesTotal) * 100).toFixed(1) : '0'

  // === Follow-up / Relance stats ===
  const fuConfig = data.followUpConfig
  const fuConfigMap = new Map(fuConfig.map(c => [c.status, c]))
  const dailyFuLimit = data.emailConfig?.daily_follow_up_limit ?? 20

  const totalFollowUpsSent = conversations.reduce((s, c) => s + c.follow_up_count, 0)
  const convsWithFollowUp = conversations.filter(c => c.follow_up_count > 0)
  const convsWithFollowUpAndResponse = convsWithFollowUp.filter(c => c.first_response_at)
  const fuResponseRate = convsWithFollowUp.length > 0
    ? Math.round((convsWithFollowUpAndResponse.length / convsWithFollowUp.length) * 100) : null

  // Follow-ups sent today
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
  const followUpsSentToday = conversations.filter(c =>
    c.last_follow_up_at && new Date(c.last_follow_up_at) >= todayStart
  ).length

  // Eligible for follow-up (delay passed + not at max)
  const now = Date.now()
  const ELIGIBLE_STATUSES = ['sent', 'prospect_phase', 'revealed', 'report_sent', 'video_sent']
  const eligibleForFollowUp = conversations.filter(c => {
    if (!ELIGIBLE_STATUSES.includes(c.status)) return false
    const cfg = fuConfigMap.get(c.status)
    if (!cfg) return false
    if (c.follow_up_count >= cfg.max_follow_ups) return false
    // Check delay: use last_follow_up_at if exists, otherwise sent_at
    const lastContact = c.last_follow_up_at || c.sent_at
    if (!lastContact) return false
    const daysSince = (now - new Date(lastContact).getTime()) / (1000 * 60 * 60 * 24)
    return daysSince >= cfg.delay_days
  })

  // Follow-up stats per status
  const fuStatsByStatus = ELIGIBLE_STATUSES.map(status => {
    const cfg = fuConfigMap.get(status)
    const convsInStatus = conversations.filter(c => c.status === status || (c.follow_up_count > 0 && events.some(e => e.conversation_id === c.id && e.from_status === status)))
    const relanced = conversations.filter(c => {
      if (c.follow_up_count === 0) return false
      // Was in this status when follow-up was sent (approximate: check if current or past status)
      const convEvents = events.filter(e => e.conversation_id === c.id)
      return c.status === status || convEvents.some(e => e.from_status === status || e.to_status === status)
    })
    const respondedAfterFu = relanced.filter(c => c.first_response_at)
    return {
      status,
      label: PIPELINE_STATUSES.find(p => p.key === status)?.label || status,
      color: PIPELINE_STATUSES.find(p => p.key === status)?.color || 'bg-gray-500',
      delayDays: cfg?.delay_days ?? '-',
      maxFu: cfg?.max_follow_ups ?? '-',
      total: convsInStatus.length,
      relanced: relanced.length,
      responded: respondedAfterFu.length,
      rate: relanced.length > 0 ? Math.round((respondedAfterFu.length / relanced.length) * 100) : null,
      eligible: eligibleForFollowUp.filter(c => c.status === status).length,
    }
  })

  // Impact: response rate without vs with follow-up
  const convsNoFollowUp = conversations.filter(c => c.follow_up_count === 0 && c.status !== 'pending')
  const convsNoFuWithResponse = convsNoFollowUp.filter(c => c.first_response_at)
  const rateWithoutFu = convsNoFollowUp.length > 0 ? Math.round((convsNoFuWithResponse.length / convsNoFollowUp.length) * 100) : null
  const rateWithFu = fuResponseRate

  // Average follow-ups before response
  const fuBeforeResponse = convsWithFollowUpAndResponse.map(c => c.follow_up_count)
  const avgFuBeforeResponse = fuBeforeResponse.length > 0
    ? (fuBeforeResponse.reduce((a, b) => a + b, 0) / fuBeforeResponse.length).toFixed(1) : null

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold">Dashboard</h2>
        <button
          onClick={load}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm bg-[var(--surface)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] transition-colors"
        >
          <RefreshCw size={13} /> Actualiser
        </button>
      </div>

      {/* ── Section 1 : KPI Cards ── */}
      <div className="grid grid-cols-6 gap-3">
        <KpiCard icon={<Building2 size={18} />} label="Agences" value={totalAgencies} />
        <KpiCard icon={<Users size={18} />} label="Independants" value={indeps.length} sub={`${pctIndep}%`} color="text-green-400" />
        <KpiCard icon={<Building2 size={18} />} label="Franchises" value={franchises.length} sub={`${pctFranchise}%`} color="text-orange-400" />
        <KpiCard icon={<Mail size={18} />} label="Avec email" value={withEmail.length} sub={`${totalAgencies > 0 ? Math.round((withEmail.length / totalAgencies) * 100) : 0}%`} color="text-sky-400" />
        <KpiCard icon={<MessageSquare size={18} />} label="Conversations" value={conversations.length} />
        <KpiCard icon={<Video size={18} />} label="Visios" value={visioCount} color="text-green-400" />
      </div>

      {/* ── Section 2 : Funnel de conversion ── */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
          <TrendingUp size={16} className="text-[var(--accent)]" />
          Funnel de conversion
        </h3>
        <div className="flex items-center gap-2">
          {funnelSteps.map((step, i) => {
            const maxVal = funnelSteps[0].value || 1
            const width = Math.max(((step.value / maxVal) * 100), 8)
            const prevVal = i > 0 ? funnelSteps[i - 1].value : null
            const convRate = prevVal && prevVal > 0 ? Math.round((step.value / prevVal) * 100) : null
            return (
              <div key={step.label} className="flex items-center gap-2 flex-1">
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-[var(--text-muted)]">{step.label}</span>
                    <span className="text-xs font-bold">{step.value}</span>
                  </div>
                  <div className="h-6 bg-[var(--bg)] rounded overflow-hidden">
                    <div className={`h-full ${step.color} rounded transition-all`} style={{ width: `${width}%` }} />
                  </div>
                  {convRate !== null && (
                    <div className="text-[9px] text-[var(--text-muted)] text-center mt-0.5">{convRate}%</div>
                  )}
                </div>
                {i < funnelSteps.length - 1 && (
                  <ArrowRight size={12} className="text-[var(--text-muted)] shrink-0" />
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Section 3 : Enrichissement + Scan ── */}
      <div className="grid grid-cols-2 gap-4">
        {/* Enrichissement */}
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Search size={16} className="text-purple-400" />
            Enrichissement
          </h3>
          <div className="flex flex-col gap-2">
            <StatRow label="Enrichies" value={enriched.length} total={totalAgencies} color="text-green-400" />
            <StatRow label="En attente" value={pendingEnrich.length} total={totalAgencies} color="text-yellow-400" />
            <StatRow label="Ignorees" value={skipped.length} total={totalAgencies} color="text-[var(--text-muted)]" />
            <div className="border-t border-[var(--border)] my-1" />
            <StatRow label="Email trouve (si enrichi)" value={emailFoundByEnrich.length} total={enriched.length} color="text-sky-400" />
            <StatRow label="Gerant trouve (si enrichi)" value={ownerFound.length} total={enriched.length} color="text-indigo-400" />
            <StatRow label="Site web mais pas d'email" value={hasSiteNoEmail.length} color="text-orange-400" />
          </div>
        </div>

        {/* Scan */}
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <MapPin size={16} className="text-sky-400" />
            Scan geographique
          </h3>
          <div className="flex flex-col gap-3">
            <div>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-[var(--text-muted)]">Zones scannees</span>
                <span className="text-xs font-bold">{data.scanZonesDone} / {data.scanZonesTotal} ({scanPct}%)</span>
              </div>
              <div className="h-3 bg-[var(--bg)] rounded-full overflow-hidden">
                <div className="h-full bg-green-500 rounded-full transition-all" style={{ width: `${scanPct}%` }} />
              </div>
            </div>
            <div className="border-t border-[var(--border)] my-1" />
            <StatRow label="Agences / zone (moy.)" value={data.scanZonesDone > 0 ? (totalAgencies / data.scanZonesDone).toFixed(1) : '-'} />
            <StatRow label="Avec telephone" value={agencies.filter(a => a.phone).length} total={totalAgencies} color="text-green-400" />
            <StatRow label="Avec site web" value={agencies.filter(a => a.website).length} total={totalAgencies} color="text-sky-400" />
            <StatRow label="Note moyenne" value={(() => {
              const rated = agencies.filter(a => a.rating)
              return rated.length > 0 ? (rated.reduce((s, a) => s + a.rating!, 0) / rated.length).toFixed(2) : '-'
            })()} color="text-yellow-400" />
          </div>
        </div>
      </div>

      {/* ── Section 4 : Franchise vs Independant ── */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <Building2 size={16} className="text-orange-400" />
          Franchise vs Independant
        </h3>
        <div className="grid grid-cols-2 gap-4">
          <CompareCard
            title="Independants"
            count={indeps.length}
            color="text-green-400"
            barColor="bg-green-500"
            pct={pctIndep}
            stats={[
              { label: 'Avec email', value: indeps.filter(a => a.email).length, total: indeps.length },
              { label: 'Avec site web', value: indeps.filter(a => a.website).length, total: indeps.length },
              { label: 'Avec telephone', value: indeps.filter(a => a.phone).length, total: indeps.length },
              { label: 'Conversations', value: indepConvs.length },
              { label: 'Reponses', value: indepConvs.filter(c => c.first_response_at).length, total: indepConvs.length || undefined },
            ]}
          />
          <CompareCard
            title="Franchises"
            count={franchises.length}
            color="text-orange-400"
            barColor="bg-orange-500"
            pct={pctFranchise}
            stats={[
              { label: 'Avec email', value: franchises.filter(a => a.email).length, total: franchises.length },
              { label: 'Avec site web', value: franchises.filter(a => a.website).length, total: franchises.length },
              { label: 'Avec telephone', value: franchises.filter(a => a.phone).length, total: franchises.length },
              { label: 'Conversations', value: franchiseConvs.length },
              { label: 'Reponses', value: franchiseConvs.filter(c => c.first_response_at).length, total: franchiseConvs.length || undefined },
            ]}
          />
        </div>
      </div>

      {/* ── Toggle Tous / Indep / Franchise ── */}
      <div className="flex gap-1 bg-[var(--surface)] rounded-lg p-1 w-fit border border-[var(--border)]">
        {([
          ['all', 'Tous'],
          ['indep', 'Independants'],
          ['franchise', 'Franchises'],
        ] as ['all' | 'indep' | 'franchise', string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setPipelineFilter(key)}
            className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              pipelineFilter === key
                ? key === 'franchise' ? 'bg-orange-500 text-white'
                  : key === 'indep' ? 'bg-green-500 text-white'
                  : 'bg-[var(--accent)] text-white'
                : 'text-[var(--text-muted)] hover:text-[var(--text)]'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Section 5 : Pipeline detaillee ── */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <Mail size={16} className="text-sky-400" />
          Pipeline
          {pipelineFilter !== 'all' && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${pipelineFilter === 'franchise' ? 'bg-orange-500/20 text-orange-400' : 'bg-green-500/20 text-green-400'}`}>
              {pipelineFilter === 'franchise' ? 'Franchises' : 'Independants'}
            </span>
          )}
        </h3>
        <div className="grid grid-cols-3 gap-4 mb-4">
          <MiniKpi label="Taux de reponse" value={filteredConvs.length > 0 ? `${Math.round((fReplied.length / filteredConvs.length) * 100)}%` : '-'} sub={`${fReplied.length} / ${filteredConvs.length}`} />
          <MiniKpi label="Temps moyen de reponse" value={formatTime(fAvgResponse)} highlight={fAvgResponse != null && fAvgResponse > 480} />
          <MiniKpi label="Echanges totaux" value={fTotalExchanges} sub={`${fOutbound} envoyes / ${fInbound} recus`} />
        </div>

        {/* Status bars */}
        <div className="flex flex-col gap-1.5">
          {PIPELINE_STATUSES.map(s => {
            const count = fStatusCounts[s.key] || 0
            const maxCount = Math.max(...Object.values(fStatusCounts), 1)
            return (
              <div key={s.key} className="flex items-center gap-3">
                <span className="text-xs text-[var(--text-muted)] w-28 text-right shrink-0">{s.label}</span>
                <div className="flex-1 h-5 bg-[var(--bg)] rounded overflow-hidden">
                  <div className={`h-full ${s.color} rounded transition-all`} style={{ width: `${(count / maxCount) * 100}%`, minWidth: count > 0 ? '20px' : '0' }} />
                </div>
                <span className="text-xs font-bold w-6 text-right">{count}</span>
              </div>
            )
          })}
        </div>

        {/* Auto vs Manual */}
        <div className="grid grid-cols-2 gap-3 mt-4 pt-4 border-t border-[var(--border)]">
          <div className="flex items-center gap-2">
            <Zap size={14} className="text-green-400" />
            <span className="text-xs text-[var(--text-muted)]">Auto</span>
            <span className="text-sm font-bold">{fAutoConvs.length}</span>
            {fAutoConvs.length + fManualConvs.length > 0 && (
              <span className="text-[10px] font-medium text-green-400">
                {Math.round((fAutoConvs.length / (fAutoConvs.length + fManualConvs.length)) * 100)}%
              </span>
            )}
            {fAutoConvs.length > 0 && (
              <span className="text-[10px] text-[var(--text-muted)]">
                ({fAutoConvs.filter(c => c.first_response_at).length} reponses)
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Phone size={14} className="text-orange-400" />
            <span className="text-xs text-[var(--text-muted)]">Manuel</span>
            <span className="text-sm font-bold">{fManualConvs.length}</span>
            {fAutoConvs.length + fManualConvs.length > 0 && (
              <span className="text-[10px] font-medium text-orange-400">
                {Math.round((fManualConvs.length / (fAutoConvs.length + fManualConvs.length)) * 100)}%
              </span>
            )}
            {fManualConvs.length > 0 && (
              <span className="text-[10px] text-[var(--text-muted)]">
                ({fManualConvs.filter(c => c.first_response_at).length} reponses)
              </span>
            )}
          </div>
        </div>
      </div>

      {/* ── Section 6 : Relances — KPIs ── */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
          <RotateCw size={16} className="text-amber-400" />
          Relances
          {pipelineFilter !== 'all' && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${pipelineFilter === 'franchise' ? 'bg-orange-500/20 text-orange-400' : 'bg-green-500/20 text-green-400'}`}>
              {pipelineFilter === 'franchise' ? 'Franchises' : 'Independants'}
            </span>
          )}
        </h3>

        {/* KPI row */}
        <div className="grid grid-cols-4 gap-3 mb-5">
          <MiniKpi
            label="Relances envoyees"
            value={totalFollowUpsSent}
            sub={`${convsWithFollowUp.length} conversation${convsWithFollowUp.length > 1 ? 's' : ''}`}
          />
          <MiniKpi
            label="Taux reponse post-relance"
            value={fuResponseRate !== null ? `${fuResponseRate}%` : '-'}
            sub={convsWithFollowUp.length > 0 ? `${convsWithFollowUpAndResponse.length} / ${convsWithFollowUp.length}` : undefined}
          />
          <MiniKpi
            label="En attente de relance"
            value={eligibleForFollowUp.length}
            highlight={eligibleForFollowUp.length > 10}
          />
          <MiniKpi
            label="Relances aujourd'hui"
            value={`${followUpsSentToday} / ${dailyFuLimit}`}
            sub={followUpsSentToday >= dailyFuLimit ? 'Limite atteinte' : `${dailyFuLimit - followUpsSentToday} restantes`}
          />
        </div>

        {/* Efficacite par statut */}
        <h4 className="text-xs font-semibold mb-3 flex items-center gap-2 text-[var(--text-muted)]">
          <Target size={13} />
          Efficacite par statut
        </h4>
        <div className="flex flex-col gap-1.5">
          {/* Header */}
          <div className="flex items-center gap-3">
            <span className="text-[10px] text-[var(--text-muted)] w-24 text-right shrink-0">Statut</span>
            <span className="flex-1 text-[10px] text-[var(--text-muted)]">Relancees / Total</span>
            <span className="text-[10px] text-[var(--text-muted)] w-16 text-center shrink-0">Repondu</span>
            <span className="text-[10px] text-[var(--text-muted)] w-14 text-center shrink-0">Taux</span>
            <span className="text-[10px] text-[var(--text-muted)] w-14 text-center shrink-0">Eligible</span>
            <span className="text-[10px] text-[var(--text-muted)] w-16 text-center shrink-0">Delai (j)</span>
          </div>
          {fuStatsByStatus.map(s => {
            const barMax = Math.max(...fuStatsByStatus.map(x => x.total), 1)
            return (
              <div key={s.status} className="flex items-center gap-3">
                <span className="text-xs text-[var(--text-muted)] w-24 text-right shrink-0">{s.label}</span>
                <div className="flex-1 h-5 bg-[var(--bg)] rounded overflow-hidden flex">
                  {s.total > 0 && (
                    <>
                      <div
                        className={`h-full ${s.color} transition-all`}
                        style={{ width: `${(s.relanced / barMax) * 100}%`, minWidth: s.relanced > 0 ? '4px' : '0' }}
                        title={`${s.relanced} relancees`}
                      />
                      {s.total - s.relanced > 0 && (
                        <div
                          className="h-full bg-[var(--border)] transition-all"
                          style={{ width: `${((s.total - s.relanced) / barMax) * 100}%` }}
                          title={`${s.total - s.relanced} non relancees`}
                        />
                      )}
                    </>
                  )}
                </div>
                <span className="text-[10px] font-medium w-16 text-center shrink-0">
                  {s.responded > 0 ? <span className="text-green-400">{s.responded}</span> : '-'}
                </span>
                <span className={`text-[10px] font-bold w-14 text-center shrink-0 ${s.rate !== null && s.rate >= 30 ? 'text-green-400' : s.rate !== null ? 'text-yellow-400' : 'text-[var(--text-muted)]'}`}>
                  {s.rate !== null ? `${s.rate}%` : '-'}
                </span>
                <span className={`text-[10px] font-medium w-14 text-center shrink-0 ${s.eligible > 0 ? 'text-amber-400' : 'text-[var(--text-muted)]'}`}>
                  {s.eligible > 0 ? s.eligible : '-'}
                </span>
                <span className="text-[10px] text-[var(--text-muted)] w-16 text-center shrink-0">
                  {s.delayDays}j / max {s.maxFu}
                </span>
              </div>
            )
          })}
          {/* Legende */}
          <div className="flex gap-4 mt-2 pt-2 border-t border-[var(--border)]">
            <span className="flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
              <span className="w-2.5 h-2.5 rounded-sm bg-sky-500" /> Relancees
            </span>
            <span className="flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
              <span className="w-2.5 h-2.5 rounded-sm bg-[var(--border)]" /> Non relancees
            </span>
          </div>
        </div>
      </div>

      {/* ── Section 7 : Impact des relances ── */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
          <CalendarClock size={16} className="text-green-400" />
          Impact des relances
        </h3>
        <div className="grid grid-cols-3 gap-4">
          {/* Sans relance vs Avec relance */}
          <div className="bg-[var(--bg)] rounded-lg p-4">
            <div className="text-[10px] text-[var(--text-muted)] mb-2">Taux de reponse</div>
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <div className="text-[10px] text-[var(--text-muted)] mb-1">Sans relance</div>
                <div className="h-8 bg-[var(--surface)] rounded overflow-hidden flex items-center">
                  <div
                    className="h-full bg-sky-500/60 rounded transition-all"
                    style={{ width: `${rateWithoutFu ?? 0}%`, minWidth: rateWithoutFu ? '8px' : '0' }}
                  />
                  <span className="text-xs font-bold ml-2">{rateWithoutFu !== null ? `${rateWithoutFu}%` : '-'}</span>
                </div>
              </div>
              <div className="flex-1">
                <div className="text-[10px] text-[var(--text-muted)] mb-1">Avec relance</div>
                <div className="h-8 bg-[var(--surface)] rounded overflow-hidden flex items-center">
                  <div
                    className="h-full bg-green-500 rounded transition-all"
                    style={{ width: `${rateWithFu ?? 0}%`, minWidth: rateWithFu ? '8px' : '0' }}
                  />
                  <span className="text-xs font-bold ml-2">{rateWithFu !== null ? `${rateWithFu}%` : '-'}</span>
                </div>
              </div>
            </div>
            {rateWithFu !== null && rateWithoutFu !== null && rateWithFu > rateWithoutFu && (
              <div className="text-[10px] text-green-400 mt-2 text-center">
                +{rateWithFu - rateWithoutFu} pts avec relance
              </div>
            )}
            {totalFollowUpsSent === 0 && (
              <div className="text-[10px] text-[var(--text-muted)] mt-2 text-center">
                Pas encore de relances envoyees
              </div>
            )}
          </div>

          {/* Relances moyennes avant reponse */}
          <div className="bg-[var(--bg)] rounded-lg p-4">
            <div className="text-[10px] text-[var(--text-muted)] mb-2">Relances moy. avant reponse</div>
            <div className="text-2xl font-bold">{avgFuBeforeResponse ?? '-'}</div>
            {convsWithFollowUpAndResponse.length > 0 && (
              <div className="text-[10px] text-[var(--text-muted)] mt-1">
                Sur {convsWithFollowUpAndResponse.length} conversation{convsWithFollowUpAndResponse.length > 1 ? 's' : ''}
              </div>
            )}
            {totalFollowUpsSent === 0 && (
              <div className="text-[10px] text-[var(--text-muted)] mt-1">Aucune donnee</div>
            )}
          </div>

          {/* Conversations eligibles par anciennete */}
          <div className="bg-[var(--bg)] rounded-lg p-4">
            <div className="text-[10px] text-[var(--text-muted)] mb-2">Prochaines relances</div>
            {eligibleForFollowUp.length === 0 ? (
              <div className="text-xs text-[var(--text-muted)]">Aucune relance en attente</div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {ELIGIBLE_STATUSES.map(status => {
                  const count = eligibleForFollowUp.filter(c => c.status === status).length
                  if (count === 0) return null
                  const cfg = fuConfigMap.get(status)
                  const label = PIPELINE_STATUSES.find(p => p.key === status)?.label || status
                  return (
                    <div key={status} className="flex items-center justify-between">
                      <span className="text-[10px] text-[var(--text-muted)]">{label}</span>
                      <span className="text-xs font-bold text-amber-400">{count}</span>
                    </div>
                  )
                })}
                <div className="border-t border-[var(--border)] pt-1 mt-1 flex items-center justify-between">
                  <span className="text-[10px] font-medium">Total</span>
                  <span className="text-sm font-bold text-amber-400">{eligibleForFollowUp.length}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Section 8 : Performance par phase ── */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
        <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
          <Clock size={16} className="text-purple-400" />
          Performance par phase
          {pipelineFilter !== 'all' && (
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${pipelineFilter === 'franchise' ? 'bg-orange-500/20 text-orange-400' : 'bg-green-500/20 text-green-400'}`}>
              {pipelineFilter === 'franchise' ? 'Franchises' : 'Independants'}
            </span>
          )}
        </h3>
        {phaseStats.every(p => p.entered === 0) ? (
          <p className="text-xs text-[var(--text-muted)]">Pas encore assez de donnees pour afficher les stats par phase.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {/* Column headers */}
            <div className="flex items-center gap-4">
              <span className="text-[10px] text-[var(--text-muted)] w-36 shrink-0">Phase</span>
              <span className="flex-1 text-[10px] text-[var(--text-muted)]">Progression</span>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-[10px] text-[var(--text-muted)] w-10 text-right">Reponse</span>
                <span className="text-[10px] text-[var(--text-muted)] w-10 text-center">Ratio</span>
                <span className="text-[10px] text-[var(--text-muted)] w-14 text-center">Temps moy.</span>
                <span className="text-[10px] text-[var(--text-muted)] w-16 text-center">Perdus</span>
              </div>
            </div>

            {phaseStats.map(p => (
              <div key={p.label} className="flex items-center gap-4">
                {/* Label */}
                <span className="text-xs font-medium w-36 shrink-0">{p.label}</span>

                {/* Progress bar */}
                <div className="flex-1">
                  <div className="h-5 bg-[var(--bg)] rounded overflow-hidden flex">
                    {p.entered > 0 && (
                      <>
                        <div
                          className="h-full bg-green-500 transition-all"
                          style={{ width: `${(p.converted / p.entered) * 100}%` }}
                          title={`${p.converted} convertis`}
                        />
                        {p.dropped > 0 && (
                          <div
                            className="h-full bg-red-500/60 transition-all"
                            style={{ width: `${(p.dropped / p.entered) * 100}%` }}
                            title={`${p.dropped} perdus`}
                          />
                        )}
                      </>
                    )}
                  </div>
                </div>

                {/* Stats */}
                <div className="flex items-center gap-3 shrink-0">
                  <span className={`text-xs font-bold w-10 text-right ${p.rate !== null && p.rate >= 50 ? 'text-green-400' : p.rate !== null ? 'text-yellow-400' : 'text-[var(--text-muted)]'}`}>
                    {p.rate !== null ? `${p.rate}%` : '-'}
                  </span>
                  <span className="text-[10px] text-[var(--text-muted)] w-10 text-center">
                    {p.converted}/{p.entered}
                  </span>
                  <span className="text-[10px] text-[var(--text-muted)] w-14 text-center">
                    {p.avgTime !== null ? formatTime(p.avgTime) : '-'}
                  </span>
                  <span className="text-[10px] w-16 text-center text-red-400">
                    {p.dropped > 0 ? `${p.dropped} perdu${p.dropped > 1 ? 's' : ''}` : '-'}
                  </span>
                </div>
              </div>
            ))}

            {/* Légende */}
            <div className="flex gap-4 mt-2 pt-2 border-t border-[var(--border)]">
              <span className="flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
                <span className="w-2.5 h-2.5 rounded-sm bg-green-500" /> Convertis
              </span>
              <span className="flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
                <span className="w-2.5 h-2.5 rounded-sm bg-red-500/60" /> Perdus
              </span>
              <span className="flex items-center gap-1.5 text-[10px] text-[var(--text-muted)]">
                <span className="w-2.5 h-2.5 rounded-sm bg-[var(--bg)]" /> En cours
              </span>
            </div>
          </div>
        )}
      </div>

      {/* ── Section 7 : Top villes ── */}
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <MapPin size={16} className="text-blue-400" />
          Top villes
        </h3>
        <div className="grid grid-cols-4 gap-2">
          {topCities.map(([city, s]) => {
            const emailPct = s.total > 0 ? Math.round((s.email / s.total) * 100) : 0
            return (
              <div key={city} className="bg-[var(--bg)] rounded-lg p-3">
                <div className="text-xs font-medium truncate">{city}</div>
                <div className="text-lg font-bold">{s.total}</div>
                <div className="flex items-center gap-2 mt-1">
                  <span className={`text-[10px] ${emailPct >= 70 ? 'text-green-400' : emailPct >= 40 ? 'text-yellow-400' : 'text-red-400'}`}>
                    {emailPct}% email
                  </span>
                  {s.franchise > 0 && (
                    <span className="text-[10px] text-orange-400">{s.franchise} franchise{s.franchise > 1 ? 's' : ''}</span>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── Section 7 : Activite recente + alertes ── */}
      <div className="grid grid-cols-2 gap-4">
        {/* Recent messages */}
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <MessageSquare size={16} className="text-sky-400" />
            Derniers messages
          </h3>
          {messages.length === 0 ? (
            <p className="text-xs text-[var(--text-muted)]">Aucun message.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {messages.slice(0, 6).map(m => (
                <div key={m.id} className="flex items-start gap-2">
                  <span className={`mt-0.5 w-2 h-2 rounded-full shrink-0 ${m.direction === 'inbound' ? 'bg-green-400' : 'bg-sky-400'}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs text-[var(--text-muted)]">
                      {m.direction === 'inbound' ? 'Recu' : 'Envoye'} — {new Date(m.sent_at).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </div>
                    <div className="text-xs truncate">{m.content.slice(0, 120)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Alertes */}
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl p-5">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <MailQuestion size={16} className="text-yellow-400" />
            Alertes
          </h3>
          <div className="flex flex-col gap-2">
            <AlertRow
              label="Emails non-matches en attente"
              value={data.unmatchedPending}
              color={data.unmatchedPending > 0 ? 'text-yellow-400' : 'text-green-400'}
              status={data.unmatchedPending > 0 ? 'A traiter' : 'OK'}
            />
            <AlertRow
              label="Agences a contacter manuellement"
              value={enriched.filter(a => !a.email).length}
              color={enriched.filter(a => !a.email).length > 0 ? 'text-orange-400' : 'text-green-400'}
              status={enriched.filter(a => !a.email).length > 0 ? 'En attente' : 'OK'}
            />
            <AlertRow
              label="Sans reponse (auto 7j)"
              value={noAnswerCount}
              color={noAnswerCount > 0 ? 'text-orange-400' : 'text-green-400'}
              status={noAnswerCount > 0 ? 'A relancer' : 'OK'}
            />
            <AlertRow
              label="Conversations sans reponse (+48h)"
              value={conversations.filter(c => !c.no_answer && c.status === 'sent' && c.sent_at && (Date.now() - new Date(c.sent_at).getTime()) > 48 * 60 * 60 * 1000).length}
              color="text-yellow-400"
              status="A surveiller"
            />
            <AlertRow
              label="Prospects perdus"
              value={lostCount}
              color={lostCount > 0 ? 'text-red-400' : 'text-[var(--text-muted)]'}
              status={lostCount > 0 ? `${lostCount}` : '-'}
            />
            <AlertRow
              label="Mauvaises cibles"
              value={wrongTargetCount}
              color={wrongTargetCount > 0 ? 'text-rose-400' : 'text-[var(--text-muted)]'}
              status={wrongTargetCount > 0 ? `${wrongTargetCount}` : '-'}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Components ──

function KpiCard({ icon, label, value, sub, color }: {
  icon: React.ReactNode; label: string; value: string | number; sub?: string; color?: string
}) {
  return (
    <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl px-4 py-3">
      <div className="flex items-center gap-2 text-[var(--text-muted)] mb-1">
        {icon}
        <span className="text-[10px]">{label}</span>
      </div>
      <div className="flex items-end gap-1.5">
        <span className={`text-xl font-bold ${color || ''}`}>{value}</span>
        {sub && <span className="text-[10px] text-[var(--text-muted)] mb-0.5">{sub}</span>}
      </div>
    </div>
  )
}

function MiniKpi({ label, value, sub, highlight }: {
  label: string; value: string | number; sub?: string; highlight?: boolean
}) {
  return (
    <div className="bg-[var(--bg)] rounded-lg p-3">
      <div className="text-[10px] text-[var(--text-muted)] mb-1">{label}</div>
      <div className={`text-lg font-bold ${highlight ? 'text-red-400' : ''}`}>{value}</div>
      {sub && <div className="text-[10px] text-[var(--text-muted)]">{sub}</div>}
    </div>
  )
}

function StatRow({ label, value, total, color }: {
  label: string; value: string | number; total?: number; color?: string
}) {
  const pct = total && total > 0 && typeof value === 'number' ? Math.round((value / total) * 100) : null
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-[var(--text-muted)]">{label}</span>
      <div className="flex items-center gap-1.5">
        <span className={`text-xs font-bold ${color || ''}`}>{value}</span>
        {pct !== null && <span className="text-[10px] text-[var(--text-muted)]">({pct}%)</span>}
      </div>
    </div>
  )
}

function CompareCard({ title, count, color, barColor, pct, stats }: {
  title: string; count: number; color: string; barColor: string; pct: number
  stats: { label: string; value: number; total?: number }[]
}) {
  return (
    <div className="bg-[var(--bg)] rounded-lg p-4">
      <div className="flex items-center justify-between mb-2">
        <span className={`text-sm font-bold ${color}`}>{title}</span>
        <span className="text-xs text-[var(--text-muted)]">{count} ({pct}%)</span>
      </div>
      <div className="h-2 bg-[var(--surface)] rounded-full overflow-hidden mb-3">
        <div className={`h-full ${barColor} rounded-full`} style={{ width: `${pct}%` }} />
      </div>
      <div className="flex flex-col gap-1.5">
        {stats.map(s => (
          <div key={s.label} className="flex items-center justify-between">
            <span className="text-[10px] text-[var(--text-muted)]">{s.label}</span>
            <span className="text-[10px] font-medium">
              {s.value}{s.total ? ` (${Math.round((s.value / s.total) * 100)}%)` : ''}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function AlertRow({ label, value, color, status }: {
  label: string; value: number; color: string; status: string
}) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-xs text-[var(--text-muted)]">{label}</span>
      <div className="flex items-center gap-2">
        <span className={`text-xs font-bold ${color}`}>{value}</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${color} bg-current/10`}>{status}</span>
      </div>
    </div>
  )
}

function formatTime(minutes: number | null): string {
  if (minutes == null) return '-'
  if (minutes < 60) return `${minutes}min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${h}h${m > 0 ? `${m}m` : ''}`
}
