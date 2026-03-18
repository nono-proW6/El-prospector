import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { supabase } from '../lib/supabase'
import type { Conversation, Message } from '../lib/types'
import {
  Search, Play, Square, Zap, Mail, ChevronDown, ChevronUp, Info, RefreshCw,
  X, Phone, Globe, User, Hash, Star, MessageSquare, ArrowUpRight, ArrowDownLeft, Clock, ExternalLink,
} from 'lucide-react'

const COLORS = {
  dense: '#e74c3c',
  intermediate: '#f39c12',
  rural: '#3498db',
  done: '#22c55e',
  processing: '#a855f7',
  saturated: '#ec4899',
}

const AGENCY_COLORS = {
  pending: '#38bdf8',      // Sky blue — trouvée, pas encore enrichie
  autoContact: '#22c55e',  // Green — enrichie + email + listing → contact auto
  manualContact: '#f59e0b', // Orange — enrichie mais sans email → contact manuel
  failed: '#a855f7',       // Purple — enrichissement échoué ou skippée
}

const PIPELINE_COLORS: Record<string, { color: string; label: string }> = {
  not_contacted: { color: '#4b5563', label: 'Non contactée' },
  ready:         { color: '#22c55e', label: 'Prêtes' },        // enrichie + email, pas encore envoyé
  sent:          { color: '#38bdf8', label: 'Envoyées' },
  prospect_phase:{ color: '#f59e0b', label: 'Prospect phase' },
  revealed:      { color: '#a855f7', label: 'Révélées' },
  video_sent:    { color: '#6366f1', label: 'Vidéo envoyée' },
  visio_accepted:{ color: '#34d399', label: 'Visio OK' },
  no_answer:     { color: '#eab308', label: 'Pas de réponse' },
  callback:      { color: '#06b6d4', label: 'À rappeler' },
  closed:        { color: '#ef4444', label: 'Fermées' },
  lost:          { color: '#ef4444', label: 'Perdu' },
  wrong_target:  { color: '#f43f5e', label: 'Mauvaise cible' },
}

type MapViewMode = 'enrichment' | 'pipeline'

function getPipelineKey(a: Agency, convMap: Map<string, string>): string {
  const convStatus = convMap.get(a.id)
  // Has a real conversation status (not just pending)
  if (convStatus && convStatus !== 'pending') return convStatus
  // Enriched + has email → ready to contact
  if (a.enrichment_status === 'done' && a.email?.trim()) return 'ready'
  // Everything else → not contacted (gray)
  return 'not_contacted'
}

const SIZE_OPTIONS = [
  { label: '1 km', latSize: 0.009, lngSize: 0.0133 },
  { label: '3 km', latSize: 0.027, lngSize: 0.04 },
  { label: '5 km', latSize: 0.045, lngSize: 0.0665 },
  { label: '10 km', latSize: 0.09, lngSize: 0.133 },
]

const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZpbWVkZWhxdGNwaWpjZmp1bmxoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI2Njk5NTAsImV4cCI6MjA4ODI0NTk1MH0.SXWsWNHDJj0kT23-W_Msq3y2_M0sI7vvU4AWqfvvPIc'
const SUPABASE_URL = 'https://fimedehqtcpijcfjunlh.supabase.co'

type ScanZone = {
  id: string
  sw_lat: number
  sw_lng: number
  ne_lat: number
  ne_lng: number
  status: string
  density_type: string
  priority: number
  results_count: number
}

type ScrapeLogEntry = {
  url: string
  reason: string
  excerpt: string
}

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
  lat: number | null
  lng: number | null
  enrichment_status: string
  enrichment_note: string | null
  pages_scraped: number | null
  scrape_log: ScrapeLogEntry[] | null
  is_franchise: boolean
  rating: number | null
  source: string | null
}

type Stats = {
  total: number
  pending: number
  done: number
  processing: number
  saturated: number
  byDensity: Record<string, number>
  byPriority: Record<number, number>
}

function getAgencyColor(a: Agency): string {
  if (a.enrichment_status === 'failed') return AGENCY_COLORS.failed
  if (a.enrichment_status === 'done') {
    if (a.email && a.email.trim()) return AGENCY_COLORS.autoContact
    return AGENCY_COLORS.manualContact
  }
  if (a.enrichment_status === 'skipped') return AGENCY_COLORS.failed
  return AGENCY_COLORS.pending
}

function getAgencyColorLabel(a: Agency): string {
  if (a.enrichment_status === 'failed') return 'Echouee'
  if (a.enrichment_status === 'skipped') return 'Skippee'
  if (a.enrichment_status === 'done') {
    if (a.email && a.email.trim()) return 'Contact auto'
    return 'Contact manuel'
  }
  return 'En attente'
}

// Inject marker pulse CSS once
const POPUP_CSS_ID = 'dark-popup-css'
function injectPopupCSS() {
  if (document.getElementById(POPUP_CSS_ID)) return
  const style = document.createElement('style')
  style.id = POPUP_CSS_ID
  style.textContent = `
    @keyframes pulse-ring {
      0% { transform: translate(-50%, -50%) scale(0.5); opacity: 1; }
      100% { transform: translate(-50%, -50%) scale(2.5); opacity: 0; }
    }
    .agency-pulse {
      position: absolute;
      top: 50%;
      left: 50%;
      width: 24px;
      height: 24px;
      border-radius: 50%;
      pointer-events: none;
    }
    .agency-pulse::before, .agency-pulse::after {
      content: '';
      position: absolute;
      top: 50%;
      left: 50%;
      width: 100%;
      height: 100%;
      border-radius: 50%;
      border: 2px solid var(--pulse-color, #22c55e);
      animation: pulse-ring 1.8s ease-out infinite;
    }
    .agency-pulse::after { animation-delay: 0.6s; }
  `
  document.head.appendChild(style)
}

export default function ScanMap() {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstance = useRef<L.Map | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)
  const previewRef = useRef<L.Rectangle | null>(null)
  const agencyLayerRef = useRef<L.LayerGroup | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [addMode, setAddMode] = useState(false)
  const [selectedSize, setSelectedSize] = useState(3)
  const [showAgencies, setShowAgencies] = useState(true)
  const [agencyCount, setAgencyCount] = useState(0)
  const [agencyStats, setAgencyStats] = useState({ pending: 0, autoContact: 0, manualContact: 0, failed: 0 })
  const [searchQuery, setSearchQuery] = useState('')
  const [scanRunning, setScanRunning] = useState(false)
  const [scanPaused, setScanPaused] = useState(false)
  const [targetAgencies, setTargetAgencies] = useState(50)
  const [maxRequests, setMaxRequests] = useState(166)
  const [scanResult, setScanResult] = useState<{ new_agencies: number; api_requests: number; stopped_reason: string } | null>(null)
  // Enrichment state
  const [enrichPaused, setEnrichPaused] = useState(false)
  const [dailyTarget, setDailyTarget] = useState(30)
  const [enrichRunning, setEnrichRunning] = useState(false)
  const [enrichResult, setEnrichResult] = useState<{ processed: number; results: any[] } | null>(null)
  // Email state
  const [emailPaused, setEmailPaused] = useState(false)
  const [emailDailyTarget, setEmailDailyTarget] = useState(10)
  const [emailRunning, setEmailRunning] = useState(false)
  const [emailResult, setEmailResult] = useState<{ sent: number; detail: any } | null>(null)
  const [readyCount, setReadyCount] = useState(0)
  const [convStats, setConvStats] = useState<Record<string, number>>({})
  const [showEmailStats, setShowEmailStats] = useState(false)
  // Follow-up (relance) state
  const [followUpLimit, setFollowUpLimit] = useState(20)
  const [showFollowUpDoc, setShowFollowUpDoc] = useState(false)
  const [followUpConfig, setFollowUpConfig] = useState<{ status: string; delay_days: number; max_follow_ups: number }[]>([])
  const highlightedIdsRef = useRef<Set<string>>(new Set())
  const [mapView, setMapView] = useState<MapViewMode>('enrichment')
  const [pipelineStats, setPipelineStats] = useState<Record<string, number>>({})
  const agencyConvMapRef = useRef<Map<string, string>>(new Map()) // agency_id → conv status

  // Max requests per day = 5000 / days in current month
  const daysInMonth = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0).getDate()
  const safeMaxPerDay = Math.floor(5000 / daysInMonth)
  const [searchResults, setSearchResults] = useState<{ type: 'city' | 'agency'; label: string; lat: number; lng: number }[]>([])
  const [showResults, setShowResults] = useState(false)
  // Side panel state
  const [selectedAgency, setSelectedAgency] = useState<Agency | null>(null)
  const [selectedConv, setSelectedConv] = useState<Conversation | null>(null)
  const [selectedMessages, setSelectedMessages] = useState<Message[]>([])
  const [loadingPanel, setLoadingPanel] = useState(false)
  const [panelEdits, setPanelEdits] = useState<Record<string, string>>({})
  const [panelDirty, setPanelDirty] = useState(false)
  const [panelSaving, setPanelSaving] = useState(false)
  const allAgenciesRef = useRef<Agency[]>([])
  const addModeRef = useRef(false)
  const selectedSizeRef = useRef(3)
  const mapViewRef = useRef<MapViewMode>('enrichment')

  useEffect(() => { addModeRef.current = addMode }, [addMode])
  useEffect(() => { selectedSizeRef.current = selectedSize }, [selectedSize])
  useEffect(() => {
    mapViewRef.current = mapView
    // Re-render markers with new colors
    if (allAgenciesRef.current.length > 0) loadAgencies()
  }, [mapView])

  // Load scan config + enrich config
  useEffect(() => {
    supabase.rpc('get_scan_config').then(({ data }) => {
      if (data) {
        setScanPaused(data.paused)
        setTargetAgencies(data.target_agencies_per_day)
        setMaxRequests(data.max_requests_per_day)
      }
    })
    supabase.rpc('get_enrich_config').then(({ data }) => {
      if (data) {
        setEnrichPaused(data.paused)
        setDailyTarget(data.daily_target ?? 30)
      }
    })
    supabase.rpc('get_email_config').then(({ data }) => {
      if (data) {
        setEmailPaused(data.paused)
        setEmailDailyTarget(data.daily_target ?? 10)
        setFollowUpLimit(data.daily_follow_up_limit ?? 20)
      }
    })
    supabase.from('follow_up_config').select('*').order('delay_days').then(({ data }) => {
      if (data) setFollowUpConfig(data)
    })
    // Count ready-to-contact agencies (done + email + no conversation yet)
    loadEmailCounts()
  }, [])


  // Search handler with debounce
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([])
      setShowResults(false)
      return
    }

    const timeout = setTimeout(async () => {
      const q = searchQuery.toLowerCase()
      const results: typeof searchResults = []

      // Search agencies locally
      for (const a of allAgenciesRef.current) {
        if (!a.lat || !a.lng) continue
        if (a.name.toLowerCase().includes(q) || a.city.toLowerCase().includes(q)) {
          results.push({ type: 'agency', label: `${a.name} — ${a.city}`, lat: a.lat, lng: a.lng })
        }
        if (results.length >= 5) break
      }

      // Search communes via geo.api.gouv.fr
      try {
        const res = await fetch(`https://geo.api.gouv.fr/communes?nom=${encodeURIComponent(searchQuery)}&fields=nom,centre&limit=5`)
        if (res.ok) {
          const communes = await res.json()
          for (const c of communes) {
            if (c.centre?.coordinates) {
              results.unshift({
                type: 'city',
                label: c.nom,
                lat: c.centre.coordinates[1],
                lng: c.centre.coordinates[0],
              })
            }
          }
        }
      } catch { /* ignore */ }

      setSearchResults(results.slice(0, 10))
      setShowResults(results.length > 0)
    }, 300)

    return () => clearTimeout(timeout)
  }, [searchQuery])

  function goTo(lat: number, lng: number, zoom = 13) {
    mapInstance.current?.setView([lat, lng], zoom)
    setShowResults(false)
    setSearchQuery('')
  }

  async function handleMarkerClick(agency: Agency) {
    setSelectedAgency(agency)
    setPanelEdits({
      email: agency.email || '',
      phone: agency.phone || '',
      owner_name: agency.owner_name || '',
      website: agency.website || '',
      linkedin: agency.linkedin || '',
    })
    setPanelDirty(false)
    setPanelSaving(false)
    setLoadingPanel(true)
    setSelectedMessages([])
    setSelectedConv(null)

    // Load conversation for this agency
    const { data: convData } = await supabase
      .from('conversations')
      .select('*')
      .eq('agency_id', agency.id)
      .order('created_at', { ascending: false })
      .limit(1)

    const conv = convData?.[0] || null
    setSelectedConv(conv)

    if (conv) {
      const { data: msgData } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conv.id)
        .order('sent_at', { ascending: true })
      setSelectedMessages(msgData || [])
    }
    setLoadingPanel(false)
  }

  function handleEditField(field: string, value: string) {
    setPanelEdits(prev => ({ ...prev, [field]: value }))
    setPanelDirty(true)
  }

  async function handleSavePanel() {
    if (!selectedAgency || !panelDirty) return
    setPanelSaving(true)
    const updates: Record<string, string | null> = {}
    for (const [k, v] of Object.entries(panelEdits)) {
      updates[k] = v.trim() || null
    }
    const { error } = await supabase.from('agencies').update(updates).eq('id', selectedAgency.id)
    if (!error) {
      // Update local ref + selected
      const local = allAgenciesRef.current.find(a => a.id === selectedAgency.id)
      if (local) {
        local.email = updates.email ?? null
        local.phone = updates.phone ?? null
        local.owner_name = updates.owner_name ?? null
        local.website = updates.website ?? null
        local.linkedin = updates.linkedin ?? null
      }
      setSelectedAgency(prev => prev ? { ...prev, ...updates } : prev)
      setPanelDirty(false)
      // Recalc stats
      const counts = { pending: 0, autoContact: 0, manualContact: 0, failed: 0 }
      for (const a of allAgenciesRef.current) {
        const lbl = getAgencyColorLabel(a)
        if (lbl === 'Contact auto') counts.autoContact++
        else if (lbl === 'Contact manuel') counts.manualContact++
        else if (lbl === 'Echouee' || lbl === 'Skippee') counts.failed++
        else counts.pending++
      }
      setAgencyStats(counts)
    }
    setPanelSaving(false)
  }

  function closeSidePanel() {
    setSelectedAgency(null)
    setSelectedConv(null)
    setSelectedMessages([])
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

  // Map init
  useEffect(() => {
    if (!mapRef.current || mapInstance.current) return

    injectPopupCSS()
    mapInstance.current = L.map(mapRef.current).setView([46.5, 2.5], 6)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; OpenStreetMap &copy; CARTO',
      maxZoom: 19,
    }).addTo(mapInstance.current)

    layerRef.current = L.layerGroup().addTo(mapInstance.current)
    agencyLayerRef.current = L.layerGroup().addTo(mapInstance.current)

    // Click handler for add mode
    mapInstance.current.on('click', async (e: L.LeafletMouseEvent) => {
      if (!addModeRef.current) return
      const { lat, lng } = e.latlng
      const size = SIZE_OPTIONS[selectedSizeRef.current]
      const sw_lat = Math.round((lat - size.latSize / 2) * 1e6) / 1e6
      const sw_lng = Math.round((lng - size.lngSize / 2) * 1e6) / 1e6
      const ne_lat = Math.round((lat + size.latSize / 2) * 1e6) / 1e6
      const ne_lng = Math.round((lng + size.lngSize / 2) * 1e6) / 1e6

      const { error } = await supabase.from('scan_zones').insert({
        sw_lat, sw_lng, ne_lat, ne_lng,
        density_type: 'rural', priority: 3, status: 'pending',
      })
      if (error) { console.error('Insert error:', error); return }

      if (layerRef.current) {
        const rect = L.rectangle([[sw_lat, sw_lng], [ne_lat, ne_lng]],
          { color: '#22d3ee', weight: 1.5, fillOpacity: 0.25, fillColor: '#22d3ee' })
        rect.bindPopup(`<b>Manuel</b><br>Taille: ${size.label}<br>Status: pending`)
        layerRef.current.addLayer(rect)
      }
    })

    // Mousemove for preview
    mapInstance.current.on('mousemove', (e: L.LeafletMouseEvent) => {
      if (!addModeRef.current) {
        if (previewRef.current) { previewRef.current.remove(); previewRef.current = null }
        return
      }
      const { lat, lng } = e.latlng
      const size = SIZE_OPTIONS[selectedSizeRef.current]
      const bounds: L.LatLngBoundsExpression = [
        [lat - size.latSize / 2, lng - size.lngSize / 2],
        [lat + size.latSize / 2, lng + size.lngSize / 2],
      ]
      if (previewRef.current) { previewRef.current.setBounds(bounds) }
      else {
        previewRef.current = L.rectangle(bounds, {
          color: '#22d3ee', weight: 1.5, fillOpacity: 0.1, fillColor: '#22d3ee',
          dashArray: '5 5', interactive: false,
        }).addTo(mapInstance.current!)
      }
    })

    loadZones()
    return () => { mapInstance.current?.remove(); mapInstance.current = null }
  }, [])

  useEffect(() => {
    if (mapInstance.current) {
      if (addMode) {
        mapInstance.current.getContainer().style.cursor = 'crosshair'
      } else {
        mapInstance.current.getContainer().style.cursor = ''
        if (previewRef.current) { previewRef.current.remove(); previewRef.current = null }
      }
    }
  }, [addMode])

  async function loadZones() {
    setLoading(true)
    const PAGE_SIZE = 1000
    let allData: ScanZone[] = []
    let from = 0
    let hasMore = true

    while (hasMore) {
      const { data, error } = await supabase
        .from('scan_zones')
        .select('id, sw_lat, sw_lng, ne_lat, ne_lng, status, density_type, priority, results_count')
        .range(from, from + PAGE_SIZE - 1)
      if (error || !data) { console.error(error); setLoading(false); return }
      allData = allData.concat(data as ScanZone[])
      hasMore = data.length === PAGE_SIZE
      from += PAGE_SIZE
    }

    const data = allData
    const s: Stats = {
      total: data.length, pending: 0, done: 0, processing: 0, saturated: 0,
      byDensity: {}, byPriority: {},
    }
    for (const z of data) {
      if (z.status === 'pending') s.pending++
      else if (z.status === 'done') s.done++
      else if (z.status === 'processing') s.processing++
      else if (z.status === 'saturated') s.saturated++
      s.byDensity[z.density_type] = (s.byDensity[z.density_type] || 0) + 1
      s.byPriority[z.priority] = (s.byPriority[z.priority] || 0) + 1
    }
    setStats(s)

    if (layerRef.current) {
      layerRef.current.clearLayers()
      for (const z of data) {
        const color = z.status === 'done' ? COLORS.done
          : z.status === 'processing' ? COLORS.processing
          : z.status === 'saturated' ? COLORS.saturated
          : COLORS[z.density_type as keyof typeof COLORS] || '#999'

        const rect = L.rectangle([[z.sw_lat, z.sw_lng], [z.ne_lat, z.ne_lng]], {
          color, weight: 0.5,
          fillOpacity: z.status === 'done' ? 0.4 : 0.15,
          fillColor: color,
        })
        rect.bindPopup(
          `<b>${z.density_type}</b><br>Priorite: ${z.priority}<br>Status: ${z.status}<br>Resultats: ${z.results_count}`
        )
        layerRef.current.addLayer(rect)
      }
    }

    await loadAgencies()
    setLoading(false)
  }

  async function loadAgencies() {
    if (!agencyLayerRef.current) return
    agencyLayerRef.current.clearLayers()

    const PAGE_SIZE = 1000
    let allAgencies: Agency[] = []
    let from = 0
    let hasMore = true

    while (hasMore) {
      const { data, error } = await supabase
        .from('agencies')
        .select('id, name, city, phone, website, email, owner_name, linkedin, siret, score, score_reason, sales_brief, lat, lng, enrichment_status, enrichment_note, pages_scraped, scrape_log, is_franchise, rating, source')
        .range(from, from + PAGE_SIZE - 1)
      if (error || !data) break
      allAgencies = allAgencies.concat(data as Agency[])
      hasMore = data.length === PAGE_SIZE
      from += PAGE_SIZE
    }

    allAgenciesRef.current = allAgencies
    setAgencyCount(allAgencies.length)

    // Load conversations for pipeline view
    const convMap = new Map<string, string>()
    let convFrom = 0
    let convHasMore = true
    while (convHasMore) {
      const { data: convData } = await supabase
        .from('conversations')
        .select('agency_id, status')
        .range(convFrom, convFrom + PAGE_SIZE - 1)
      if (!convData || convData.length === 0) break
      for (const c of convData) convMap.set(c.agency_id, c.status)
      convHasMore = convData.length === PAGE_SIZE
      convFrom += PAGE_SIZE
    }
    agencyConvMapRef.current = convMap

    // Compute per-status counts (enrichment view)
    const counts = { pending: 0, autoContact: 0, manualContact: 0, failed: 0 }
    for (const a of allAgencies) {
      const label = getAgencyColorLabel(a)
      if (label === 'Contact auto') counts.autoContact++
      else if (label === 'Contact manuel') counts.manualContact++
      else if (label === 'Echouee' || label === 'Skippee') counts.failed++
      else counts.pending++
    }
    setAgencyStats(counts)

    // Compute pipeline stats
    const pCounts: Record<string, number> = {}
    for (const a of allAgencies) {
      if (!a.lat || !a.lng) continue
      const pKey = getPipelineKey(a, convMap)
      pCounts[pKey] = (pCounts[pKey] || 0) + 1
    }
    setPipelineStats(pCounts)

    const currentView = mapViewRef.current

    for (const a of allAgencies) {
      if (!a.lat || !a.lng) continue

      let color: string
      if (currentView === 'pipeline') {
        const pKey = getPipelineKey(a, convMap)
        color = PIPELINE_COLORS[pKey]?.color || '#4b5563'
      } else {
        color = getAgencyColor(a)
      }
      const isHighlighted = highlightedIdsRef.current.has(a.id)
      const pulseHtml = isHighlighted
        ? `<div class="agency-pulse" style="--pulse-color:${color}"></div>`
        : ''

      const svgIcon = L.divIcon({
        className: '',
        html: `${pulseHtml}<svg width="24" height="32" viewBox="0 0 24 32" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 20 12 20s12-11 12-20C24 5.4 18.6 0 12 0z" fill="${color}"/>
          <circle cx="12" cy="11" r="5" fill="white" opacity="0.9"/>
          <path d="M9.5 13V9.5L12 8L14.5 9.5V13H13V11H11V13H9.5Z" fill="${color}"/>
        </svg>`,
        iconSize: [24, 32],
        iconAnchor: [12, 32],
        popupAnchor: [0, -32],
      })

      const marker = L.marker([a.lat, a.lng], { icon: svgIcon })
      marker.on('click', () => handleMarkerClick(a))
      agencyLayerRef.current.addLayer(marker)
    }

    if (mapInstance.current) {
      const updateVisibility = () => {
        if (!mapInstance.current || !agencyLayerRef.current) return
        const zoom = mapInstance.current.getZoom()
        if (zoom >= 10 && !mapInstance.current.hasLayer(agencyLayerRef.current)) {
          mapInstance.current.addLayer(agencyLayerRef.current)
        } else if (zoom < 10 && mapInstance.current.hasLayer(agencyLayerRef.current)) {
          mapInstance.current.removeLayer(agencyLayerRef.current)
        }
      }
      mapInstance.current.on('zoomend', updateVisibility)
      updateVisibility()
    }
  }

  async function toggleScanPause() {
    const newPaused = !scanPaused
    setScanPaused(newPaused)
    await supabase.rpc('update_scan_config', { p_paused: newPaused })
  }

  async function toggleEnrichPause() {
    const newPaused = !enrichPaused
    setEnrichPaused(newPaused)
    await supabase.rpc('update_enrich_config', { p_paused: newPaused })
  }

  async function saveScanConfig() {
    await supabase.rpc('update_scan_config', {
      p_target_agencies_per_day: targetAgencies,
      p_max_requests_per_day: maxRequests,
    })
  }

  async function saveEnrichConfig() {
    await supabase.rpc('update_enrich_config', { p_daily_target: dailyTarget })
  }

  async function loadEmailCounts() {
    // Ready to contact (done + email + no conversation yet)
    const { data: readyData } = await supabase.rpc('count_ready_agencies')
    setReadyCount(readyData ?? 0)

    // Conversation breakdown by status
    const { data: convData } = await supabase
      .from('conversations')
      .select('status')
    if (convData) {
      const counts: Record<string, number> = {}
      for (const c of convData) {
        counts[c.status] = (counts[c.status] || 0) + 1
      }
      setConvStats(counts)
    }
  }

  async function toggleEmailPause() {
    const newPaused = !emailPaused
    setEmailPaused(newPaused)
    await supabase.rpc('update_email_config', { p_paused: newPaused })
  }

  async function saveEmailConfig() {
    await supabase.rpc('update_email_config', { p_daily_target: emailDailyTarget })
  }

  async function saveFollowUpLimit() {
    await supabase.rpc('update_email_config', { p_daily_follow_up_limit: followUpLimit })
  }

  async function runSendEmails() {
    setEmailRunning(true)
    setEmailResult(null)
    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/send-emails`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const result = await res.json()
      setEmailResult({ sent: result.sent ?? 0, detail: result })
      await loadEmailCounts()
    } catch (err) {
      console.error('Email send error:', err)
    } finally {
      setEmailRunning(false)
    }
  }

  async function runScan() {
    setScanRunning(true)
    setScanResult(null)

    try {
      const res = await fetch(`${SUPABASE_URL}/functions/v1/scan-zones`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${ANON_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_agencies: targetAgencies, max_requests: maxRequests }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const result = await res.json()
      setScanResult(result)
      await loadZones()
    } catch (err) {
      console.error('Scan error:', err)
    } finally {
      setScanRunning(false)
    }
  }

  async function runEnrichment() {
    setEnrichRunning(true)
    setEnrichResult(null)

    const allResults: any[] = []
    const allEnrichedIds = new Set<string>()

    try {
      // Call enrichment server in batches of 5, up to dailyTarget total
      const ENRICH_URL = import.meta.env.VITE_ENRICHMENT_URL || 'http://localhost:3456'
      const BATCH_SIZE = 5
      let remaining = dailyTarget
      while (remaining > 0) {
        const thisBatch = Math.min(remaining, BATCH_SIZE)
        remaining -= thisBatch
        const res = await fetch(`${ENRICH_URL}/enrich`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ batch_size: thisBatch }),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const result = await res.json()

        if (!result.results || result.results.length === 0) break // no more agencies

        allResults.push(...result.results)

        // Update progress in real-time
        for (const r of result.results) {
          if (r.status === 'done' || r.status === 'skipped' || r.status === 'failed') {
            allEnrichedIds.add(r.id)
          }
        }
        setEnrichResult({ processed: allResults.length, results: allResults })

        // Refresh markers after each agency
        highlightedIdsRef.current = allEnrichedIds
        await loadAgencies()
      }

      // Zoom to enriched agencies
      if (allEnrichedIds.size > 0 && mapInstance.current) {
        const enrichedAgencies = allAgenciesRef.current.filter(a => allEnrichedIds.has(a.id) && a.lat && a.lng)
        if (enrichedAgencies.length > 0) {
          const bounds = L.latLngBounds(enrichedAgencies.map(a => [a.lat!, a.lng!] as [number, number]))
          mapInstance.current.fitBounds(bounds, { padding: [60, 60], maxZoom: 13 })
        }
      }

      // Clear highlights after 30s
      setTimeout(() => {
        highlightedIdsRef.current = new Set()
        loadAgencies()
      }, 30000)
    } catch (err) {
      console.error('Enrichment error:', err)
    } finally {
      setEnrichRunning(false)
    }
  }

  const progress = stats ? ((stats.done / stats.total) * 100).toFixed(1) : '0'

  return (
    <div className="h-screen -m-8 p-8 flex flex-col gap-2 overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center gap-3">
        <h2 className="text-xl font-bold shrink-0">Carte du scan</h2>

        {/* Search bar */}
        <div className="relative flex-1 max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => searchResults.length > 0 && setShowResults(true)}
            onBlur={() => setTimeout(() => setShowResults(false), 200)}
            placeholder="Rechercher une ville ou une agence..."
            className="w-full pl-9 pr-3 py-1.5 rounded-lg text-sm bg-[var(--surface)] border border-[var(--border)] text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
          />
          {showResults && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-[var(--surface)] border border-[var(--border)] rounded-lg shadow-lg z-[1000] max-h-64 overflow-y-auto">
              {searchResults.map((r, i) => (
                <button
                  key={i}
                  onMouseDown={() => goTo(r.lat, r.lng, r.type === 'city' ? 12 : 16)}
                  className="w-full px-3 py-2 text-left text-sm hover:bg-[var(--surface-hover)] flex items-center gap-2"
                >
                  <span className={`text-xs px-1.5 py-0.5 rounded ${
                    r.type === 'city' ? 'bg-blue-500/20 text-blue-400' : 'bg-amber-500/20 text-amber-400'
                  }`}>
                    {r.type === 'city' ? 'Ville' : 'Agence'}
                  </span>
                  <span className="truncate">{r.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Buttons */}
        <div className="flex gap-2 items-center shrink-0">
          <button
            onClick={() => setAddMode(!addMode)}
            className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
              addMode ? 'bg-cyan-500 text-white' : 'bg-[var(--surface)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)]'
            }`}
          >
            {addMode ? '+ Ajout ON' : '+ Zone'}
          </button>

          {addMode && (
            <div className="flex gap-1">
              {SIZE_OPTIONS.map((opt, i) => (
                <button key={opt.label} onClick={() => setSelectedSize(i)}
                  className={`px-2 py-1 rounded text-xs transition-colors ${
                    selectedSize === i ? 'bg-cyan-500 text-white' : 'bg-[var(--surface)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)]'
                  }`}
                >{opt.label}</button>
              ))}
            </div>
          )}

          <button
            onClick={() => {
              setShowAgencies(!showAgencies)
              if (agencyLayerRef.current && mapInstance.current) {
                if (showAgencies) mapInstance.current.removeLayer(agencyLayerRef.current)
                else mapInstance.current.addLayer(agencyLayerRef.current)
              }
            }}
            className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${
              showAgencies ? 'bg-sky-500 text-white' : 'bg-[var(--surface)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)]'
            }`}
          >
            Agences ({agencyCount})
          </button>

          {/* View mode toggle */}
          <div className="flex rounded-lg border border-[var(--border)] overflow-hidden">
            <button
              onClick={() => setMapView('enrichment')}
              className={`px-2.5 py-1.5 text-xs transition-colors ${
                mapView === 'enrichment' ? 'bg-[var(--accent)] text-white' : 'bg-[var(--surface)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)]'
              }`}
            >
              Enrichissement
            </button>
            <button
              onClick={() => setMapView('pipeline')}
              className={`px-2.5 py-1.5 text-xs transition-colors ${
                mapView === 'pipeline' ? 'bg-[var(--accent)] text-white' : 'bg-[var(--surface)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)]'
              }`}
            >
              Pipeline
            </button>
          </div>

          <button
            onClick={() => mapInstance.current?.setView([46.5, 2.5], 6)}
            className="px-3 py-1.5 rounded-lg text-sm bg-[var(--surface)] text-[var(--text-muted)] hover:bg-[var(--surface-hover)] transition-colors"
          >
            France
          </button>
        </div>
      </div>

      {/* Stats + Legend */}
      <div className="flex items-center justify-between text-xs">
        {/* Zone legend */}
        <div className="flex gap-3 items-center flex-wrap">
          <span className="text-[var(--text-muted)] font-medium">Zones:</span>
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-sm" style={{ background: COLORS.done }} />
            <span>Scannees ({stats?.done || 0})</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-sm" style={{ background: COLORS.dense }} />
            <span>Dense</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-sm" style={{ background: COLORS.intermediate }} />
            <span>Interm.</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-sm" style={{ background: COLORS.rural }} />
            <span>Rural</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-sm" style={{ background: COLORS.saturated }} />
            <span>Saturee</span>
          </div>

          <span className="text-[var(--border)]">|</span>

          {/* Agency legend — dynamic based on view */}
          <span className="text-[var(--text-muted)] font-medium">Agences:</span>
          {mapView === 'enrichment' ? (
            <>
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full" style={{ background: AGENCY_COLORS.pending }} />
                <span>En attente ({agencyStats.pending})</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full" style={{ background: AGENCY_COLORS.autoContact }} />
                <span>Contact auto ({agencyStats.autoContact}){agencyStats.autoContact + agencyStats.manualContact > 0 && ` · ${Math.round((agencyStats.autoContact / (agencyStats.autoContact + agencyStats.manualContact)) * 100)}%`}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full" style={{ background: AGENCY_COLORS.manualContact }} />
                <span>Contact manuel ({agencyStats.manualContact}){agencyStats.autoContact + agencyStats.manualContact > 0 && ` · ${Math.round((agencyStats.manualContact / (agencyStats.autoContact + agencyStats.manualContact)) * 100)}%`}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full" style={{ background: AGENCY_COLORS.failed }} />
                <span>Echouee / Skippee ({agencyStats.failed})</span>
              </div>
            </>
          ) : (
            <>
              {Object.entries(PIPELINE_COLORS).map(([key, { color, label }]) => {
                const count = pipelineStats[key] || 0
                if (!count) return null
                return (
                  <div key={key} className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
                    <span>{label} ({count})</span>
                  </div>
                )
              })}
            </>
          )}
        </div>

        {/* Progress */}
        <div className="flex items-center gap-3 shrink-0">
          <span className="font-medium">{progress}% scanne</span>
          <span className="text-[var(--text-muted)]">{stats?.total || 0} zones</span>
        </div>
      </div>

      {/* Progress bar */}
      {stats && (
        <div className="w-full h-1.5 bg-[var(--surface)] rounded-full overflow-hidden">
          <div className="h-full rounded-full transition-all duration-500"
            style={{ width: `${progress}%`, background: COLORS.done }} />
        </div>
      )}

      {/* Control panels — Scan + Enrichment stacked */}
      <div className="flex flex-col gap-2">
        {/* Scan control panel */}
        <div className="flex items-center gap-3 p-3 rounded-lg bg-[var(--surface)] border border-[var(--border)]">
          <Zap size={16} className="text-sky-400 shrink-0" />
          <span className="text-xs font-medium text-[var(--text-muted)] shrink-0 w-12">Scan</span>

          <button
            onClick={toggleScanPause}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              scanPaused
                ? 'bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30'
                : 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
            }`}
          >
            {scanPaused ? <><Play size={13} /> Reprendre</> : <><Square size={13} /> Pause</>}
          </button>

          <div className="w-px h-5 bg-[var(--border)]" />

          <div className="flex items-center gap-1.5">
            <label className="text-xs text-[var(--text-muted)] shrink-0">Agences/jour</label>
            <input
              type="number" min={1} max={1000} value={targetAgencies}
              onChange={(e) => setTargetAgencies(Number(e.target.value))}
              onBlur={saveScanConfig}
              disabled={scanRunning}
              className="w-20 px-2 py-1 text-sm rounded bg-[var(--bg)] border border-[var(--border)] text-[var(--text)] text-center"
            />
          </div>

          <div className="flex items-center gap-1.5">
            <label className="text-xs text-[var(--text-muted)] shrink-0">Req/jour</label>
            <input
              type="number" min={1} max={safeMaxPerDay} value={maxRequests}
              onChange={(e) => setMaxRequests(Number(e.target.value))}
              onBlur={saveScanConfig}
              disabled={scanRunning}
              className={`w-20 px-2 py-1 text-sm rounded bg-[var(--bg)] border text-[var(--text)] text-center ${
                maxRequests > safeMaxPerDay ? 'border-red-500' : 'border-[var(--border)]'
              }`}
            />
            <span className="text-xs text-[var(--text-muted)]">max {safeMaxPerDay}/j</span>
          </div>

          <div className="w-px h-5 bg-[var(--border)]" />

          <button
            onClick={runScan}
            disabled={scanRunning}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium bg-sky-500/20 text-sky-400 hover:bg-sky-500/30 transition-colors disabled:opacity-50"
          >
            <Play size={13} /> Scan manuel
          </button>

          {scanRunning && (
            <span className="text-xs text-[var(--text-muted)] animate-pulse">En cours...</span>
          )}

          {scanResult && !scanRunning && (
            <span className="text-xs text-[var(--text-muted)]">
              {scanResult.new_agencies} agences · {scanResult.api_requests} req ·{' '}
              <span className={
                scanResult.stopped_reason === 'target_reached' ? 'text-green-400' :
                scanResult.stopped_reason === 'max_requests_reached' ? 'text-yellow-400' : ''
              }>
                {scanResult.stopped_reason === 'target_reached' ? 'Objectif atteint' :
                 scanResult.stopped_reason === 'max_requests_reached' ? 'Limite atteinte' : 'Termine'}
              </span>
            </span>
          )}
        </div>

        {/* Enrichment control panel */}
        <div className="flex items-center gap-3 p-3 rounded-lg bg-[var(--surface)] border border-[var(--border)]">
          <Zap size={16} className="text-amber-400 shrink-0" />
          <span className="text-xs font-medium text-[var(--text-muted)] shrink-0 w-12">Enrich</span>

          <button
            onClick={toggleEnrichPause}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              enrichPaused
                ? 'bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30'
                : 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
            }`}
          >
            {enrichPaused ? <><Play size={13} /> Reprendre</> : <><Square size={13} /> Pause</>}
          </button>

          <div className="w-px h-5 bg-[var(--border)]" />

          <div className="flex items-center gap-1.5">
            <label className="text-xs text-[var(--text-muted)] shrink-0">Agences/jour</label>
            <input
              type="number" min={1} max={168} value={dailyTarget}
              onChange={(e) => setDailyTarget(Number(e.target.value))}
              onBlur={saveEnrichConfig}
              disabled={enrichRunning}
              className="w-20 px-2 py-1 text-sm rounded bg-[var(--bg)] border border-[var(--border)] text-[var(--text)] text-center"
            />
          </div>

          <div className="w-px h-5 bg-[var(--border)]" />

          <button
            onClick={runEnrichment}
            disabled={enrichRunning}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 transition-colors disabled:opacity-50"
          >
            <Play size={13} /> Enrichir
          </button>

          {enrichRunning && !enrichResult && (
            <span className="text-xs text-[var(--text-muted)] animate-pulse">En cours...</span>
          )}

          {enrichResult && (
            <span className={`text-xs text-[var(--text-muted)] ${enrichRunning ? 'animate-pulse' : ''}`}>
              {enrichRunning ? `${enrichResult.processed}/${dailyTarget}` : enrichResult.processed} traitees —{' '}
              {enrichResult.results?.filter((r: any) => r.status === 'done').length} enrichies,{' '}
              {enrichResult.results?.filter((r: any) => r.status === 'skipped').length} skippees,{' '}
              {enrichResult.results?.filter((r: any) => r.status === 'failed').length} echouees
              {enrichRunning && ' ...'}
            </span>
          )}
        </div>

        {/* Email control panel */}
        <div className="rounded-lg bg-[var(--surface)] border border-[var(--border)]">
          <div className="flex items-center gap-3 p-3">
            <Mail size={16} className="text-rose-400 shrink-0" />
            <span className="text-xs font-medium text-[var(--text-muted)] shrink-0 w-12">Email</span>

            <button
              onClick={toggleEmailPause}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                emailPaused
                  ? 'bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30'
                  : 'bg-green-500/20 text-green-400 hover:bg-green-500/30'
              }`}
            >
              {emailPaused ? <><Play size={13} /> Reprendre</> : <><Square size={13} /> Pause</>}
            </button>

            <div className="w-px h-5 bg-[var(--border)]" />

            <div className="flex items-center gap-1.5">
              <label className="text-xs text-[var(--text-muted)] shrink-0">Emails/jour</label>
              <input
                type="number" min={1} max={100} value={emailDailyTarget}
                onChange={(e) => setEmailDailyTarget(Number(e.target.value))}
                onBlur={saveEmailConfig}
                disabled={emailRunning}
                className="w-20 px-2 py-1 text-sm rounded bg-[var(--bg)] border border-[var(--border)] text-[var(--text)] text-center"
              />
            </div>

            <div className="w-px h-5 bg-[var(--border)]" />

            <div className="flex items-center gap-1.5">
              <label className="text-xs text-[var(--text-muted)] shrink-0">Relances/jour</label>
              <input
                type="number" min={1} max={100} value={followUpLimit}
                onChange={(e) => setFollowUpLimit(Number(e.target.value))}
                onBlur={saveFollowUpLimit}
                className="w-20 px-2 py-1 text-sm rounded bg-[var(--bg)] border border-[var(--border)] text-[var(--text)] text-center"
              />
            </div>

            <div className="w-px h-5 bg-[var(--border)]" />

            <button
              onClick={runSendEmails}
              disabled={emailRunning}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium bg-rose-500/20 text-rose-400 hover:bg-rose-500/30 transition-colors disabled:opacity-50"
            >
              <Mail size={13} /> Envoyer
            </button>

            <button
              onClick={() => setShowEmailStats(!showEmailStats)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                showEmailStats
                  ? 'bg-rose-500/20 text-rose-400'
                  : 'text-[var(--text-muted)] hover:bg-[var(--surface-hover)]'
              }`}
            >
              Pipeline
              {showEmailStats ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>

            <button
              onClick={() => setShowFollowUpDoc(!showFollowUpDoc)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                showFollowUpDoc
                  ? 'bg-orange-500/20 text-orange-400'
                  : 'text-[var(--text-muted)] hover:bg-[var(--surface-hover)]'
              }`}
            >
              <RefreshCw size={12} /> Relances
              {showFollowUpDoc ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
            </button>

            {emailRunning && (
              <span className="text-xs text-[var(--text-muted)] animate-pulse">En cours...</span>
            )}

            {emailResult && !emailRunning && (
              <span className="text-xs text-[var(--text-muted)]">
                {emailResult.sent} email{emailResult.sent > 1 ? 's' : ''} envoye{emailResult.sent > 1 ? 's' : ''}
              </span>
            )}
          </div>

          {showEmailStats && (
            <div className="flex items-center gap-4 px-3 pb-3 text-xs border-t border-[var(--border)] pt-2">
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-green-400" />
                <span>Prêtes ({readyCount})</span>
              </div>
              <span className="text-[var(--border)]">→</span>
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-sky-400" />
                <span>Envoyées ({convStats.sent ?? 0})</span>
              </div>
              <span className="text-[var(--border)]">→</span>
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-amber-400" />
                <span>Prospect phase ({convStats.prospect_phase ?? 0})</span>
              </div>
              <span className="text-[var(--border)]">→</span>
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-purple-400" />
                <span>Révélées ({convStats.revealed ?? 0})</span>
              </div>
              <span className="text-[var(--border)]">→</span>
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-indigo-400" />
                <span>Vidéo envoyée ({convStats.video_sent ?? 0})</span>
              </div>
              <span className="text-[var(--border)]">→</span>
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-emerald-400" />
                <span>Visio OK ({convStats.visio_accepted ?? 0})</span>
              </div>
              <span className="text-[var(--border)]">|</span>
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-red-400" />
                <span>Fermées ({convStats.closed ?? 0})</span>
              </div>
            </div>
          )}

          {showFollowUpDoc && (
            <div className="px-3 pb-3 text-xs border-t border-[var(--border)] pt-2 space-y-2">
              <div className="flex items-center gap-1.5 text-orange-400 font-medium">
                <Info size={12} />
                <span>Systeme de relance automatique</span>
              </div>
              <p className="text-[var(--text-muted)] leading-relaxed">
                Chaque jour a 8h, les conversations sans reponse sont marquees (delai variable selon le statut, voir ci-dessous). A 9h, les relances sont envoyees automatiquement (limite configurable ci-dessus) via un agent IA adapte au statut.
              </p>
              <div className="grid grid-cols-4 gap-2 mt-2">
                {[
                  { status: 'sent', label: 'Email envoye', color: 'bg-sky-400', desc: 'Relance du 1er email froid' },
                  { status: 'prospect_phase', label: 'Prospect phase', color: 'bg-amber-400', desc: 'Relance contextuelle sur la discussion' },
                  { status: 'revealed', label: 'Revelee', color: 'bg-purple-400', desc: 'Relance post-revelation, ton humble' },
                  { status: 'video_sent', label: 'Video envoyee', color: 'bg-indigo-400', desc: 'Relance pour proposer une visio' },
                ].map((item) => {
                  const cfg = followUpConfig.find((c) => c.status === item.status)
                  return (
                    <div key={item.status} className="rounded-lg bg-[var(--bg)] border border-[var(--border)] p-2">
                      <div className="flex items-center gap-1.5 mb-1">
                        <div className={`w-2 h-2 rounded-full ${item.color}`} />
                        <span className="font-medium text-[var(--text)]">{item.label}</span>
                      </div>
                      <div className="text-[var(--text-muted)] space-y-0.5">
                        <div>Delai : <span className="text-[var(--text)]">{cfg?.delay_days ?? '?'}j</span></div>
                        <div>Max relances : <span className="text-[var(--text)]">{cfg?.max_follow_ups ?? '?'}</span></div>
                        <div className="mt-1 text-[10px] leading-tight">{item.desc}</div>
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="flex items-center gap-3 mt-2 text-[var(--text-muted)]">
                <span>Statuts exclus de la relance :</span>
                {['pending', 'visio_accepted', 'callback', 'closed', 'lost', 'no_answer', 'wrong_target'].map((s) => (
                  <span key={s} className="px-1.5 py-0.5 rounded bg-[var(--bg)] border border-[var(--border)] text-[10px]">{s}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Map + Side Panel */}
      <div className="flex-1 flex gap-0 min-h-0 overflow-hidden">
        {/* Map */}
        <div ref={mapRef}
          className="flex-1 rounded-lg overflow-hidden border border-[var(--border)]"
          style={{ minHeight: '300px' }}
        />

        {/* Agency Side Panel */}
        {selectedAgency && (
          <div className="w-[420px] h-full shrink-0 border-l border-[var(--border)] bg-[var(--bg)] overflow-y-auto">
            {/* Panel Header */}
            <div className="p-5 border-b border-[var(--border)]">
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-bold truncate">{selectedAgency.name}</h3>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full shrink-0 ${selectedAgency.is_franchise ? 'bg-orange-500/20 text-orange-400' : 'bg-emerald-500/20 text-emerald-400'}`}>
                      {selectedAgency.is_franchise ? 'Franchise' : 'Indépendant'}
                    </span>
                  </div>
                  <p className="text-xs text-[var(--text-muted)] mt-0.5">{selectedAgency.city}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium`}
                    style={{ background: getAgencyColor(selectedAgency) + '33', color: getAgencyColor(selectedAgency) }}>
                    {getAgencyColorLabel(selectedAgency)}
                  </span>
                  <button onClick={closeSidePanel} className="text-[var(--text-muted)] hover:text-[var(--text)] transition-colors p-1 rounded-lg hover:bg-[var(--surface)]">
                    <X size={16} />
                  </button>
                </div>
              </div>

              {/* Editable contact fields */}
              <div className="flex flex-col gap-2">
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-[var(--text-muted)] font-medium">Email</label>
                  <input value={panelEdits.email || ''} onChange={e => handleEditField('email', e.target.value)} placeholder="—"
                    className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-sm text-[var(--text)] outline-none focus:border-[var(--accent)] transition-colors" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-[var(--text-muted)] font-medium">Téléphone</label>
                  <input value={panelEdits.phone || ''} onChange={e => handleEditField('phone', e.target.value)} placeholder="—"
                    className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-sm text-[var(--text)] outline-none focus:border-[var(--accent)] transition-colors" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-[var(--text-muted)] font-medium">Responsable</label>
                  <input value={panelEdits.owner_name || ''} onChange={e => handleEditField('owner_name', e.target.value)} placeholder="—"
                    className="w-full px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-sm text-[var(--text)] outline-none focus:border-[var(--accent)] transition-colors" />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-[var(--text-muted)] font-medium">Site web</label>
                  <div className="flex gap-1.5">
                    <input value={panelEdits.website || ''} onChange={e => handleEditField('website', e.target.value)} placeholder="—"
                      className="flex-1 px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-sm text-[var(--text)] outline-none focus:border-[var(--accent)] transition-colors" />
                    {panelEdits.website && (
                      <a href={panelEdits.website.startsWith('http') ? panelEdits.website : `https://${panelEdits.website}`} target="_blank" rel="noopener noreferrer"
                        className="flex items-center justify-center w-8 h-8 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--accent)] hover:bg-[var(--surface-hover)] transition-colors shrink-0">
                        <ExternalLink size={13} />
                      </a>
                    )}
                  </div>
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[10px] text-[var(--text-muted)] font-medium">LinkedIn</label>
                  <div className="flex gap-1.5">
                    <input value={panelEdits.linkedin || ''} onChange={e => handleEditField('linkedin', e.target.value)} placeholder="—"
                      className="flex-1 px-2.5 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-sm text-[var(--text)] outline-none focus:border-[var(--accent)] transition-colors" />
                    {panelEdits.linkedin && (
                      <a href={panelEdits.linkedin} target="_blank" rel="noopener noreferrer"
                        className="flex items-center justify-center w-8 h-8 rounded-lg border border-[var(--border)] bg-[var(--surface)] text-blue-400 hover:bg-[var(--surface-hover)] transition-colors shrink-0">
                        <ExternalLink size={13} />
                      </a>
                    )}
                  </div>
                </div>

                {/* Read-only fields */}
                {selectedAgency.siret && (
                  <div className="flex items-center gap-2 py-0.5 mt-1">
                    <Hash size={13} className="text-[var(--text-muted)] shrink-0" />
                    <span className="text-xs text-[var(--text-muted)] w-16 shrink-0">SIRET</span>
                    <span className="text-sm">{selectedAgency.siret}</span>
                  </div>
                )}
                {selectedAgency.rating && (
                  <div className="flex items-center gap-2 py-0.5">
                    <Star size={13} className="text-[var(--text-muted)] shrink-0" />
                    <span className="text-xs text-[var(--text-muted)] w-16 shrink-0">Google</span>
                    <span className="text-sm text-yellow-400 flex items-center gap-0.5"><Star size={10} fill="currentColor" />{selectedAgency.rating}/5</span>
                  </div>
                )}
                {selectedAgency.source && (
                  <div className="flex items-center gap-2 py-0.5">
                    <Search size={13} className="text-[var(--text-muted)] shrink-0" />
                    <span className="text-xs text-[var(--text-muted)] w-16 shrink-0">Source</span>
                    <span className="text-sm">{selectedAgency.source}</span>
                  </div>
                )}

                {/* Save button */}
                {panelDirty && (
                  <button onClick={handleSavePanel} disabled={panelSaving}
                    className="w-full mt-1 py-2 rounded-lg text-xs font-semibold bg-green-500 text-white hover:bg-green-600 transition-colors disabled:opacity-50">
                    {panelSaving ? '...' : 'Sauvegarder'}
                  </button>
                )}
              </div>

              {/* Score & Sales brief */}
              {(selectedAgency.score || selectedAgency.sales_brief) && (
                <div className="mt-3 p-3 bg-[var(--surface)] rounded-lg border border-[var(--border)]">
                  {selectedAgency.score && (
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs text-[var(--text-muted)]">Score :</span>
                      <span className={`text-sm font-semibold ${
                        Number(selectedAgency.score) >= 4 ? 'text-green-400' : Number(selectedAgency.score) >= 3 ? 'text-yellow-400' : 'text-red-400'
                      }`}>{selectedAgency.score}/5</span>
                      {selectedAgency.score_reason && <span className="text-xs text-[var(--text-muted)]">— {selectedAgency.score_reason}</span>}
                    </div>
                  )}
                  {selectedAgency.sales_brief && (
                    <p className="text-xs text-[var(--text-muted)] leading-relaxed">{selectedAgency.sales_brief}</p>
                  )}
                </div>
              )}

              {/* Enrichment note */}
              {selectedAgency.enrichment_note && (
                <div className="mt-3 text-xs text-[var(--text-muted)] p-2.5 bg-[var(--surface)] rounded-lg border-l-3 leading-relaxed"
                  style={{ borderLeftColor: getAgencyColor(selectedAgency), borderLeftWidth: '3px' }}>
                  {selectedAgency.enrichment_note}
                </div>
              )}

              {/* Web search stats */}
              {(selectedAgency.enrichment_status === 'done' || selectedAgency.enrichment_status === 'failed') && (
                <div className="mt-3 text-xs text-[var(--text-muted)]">
                  <p className="font-medium mb-1">
                    {selectedAgency.pages_scraped || 0} recherche{(selectedAgency.pages_scraped || 0) > 1 ? 's' : ''} web
                    {selectedAgency.scrape_log && ` · ${selectedAgency.scrape_log.filter(u => u.url).length} source${selectedAgency.scrape_log.filter(u => u.url).length > 1 ? 's' : ''}`}
                  </p>
                  {selectedAgency.scrape_log?.filter(u => u.url).map((entry, i) => (
                    <div key={i} className="text-[10px] px-2 py-1 bg-[var(--surface)] rounded mb-0.5">
                      <span className="text-[var(--accent)]">{entry.url.replace(/^https?:\/\/(www\.)?/, '').slice(0, 60)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Conversation section */}
            {loadingPanel ? (
              <div className="p-6 text-center text-[var(--text-muted)]">
                <p className="text-sm animate-pulse">Chargement...</p>
              </div>
            ) : selectedConv ? (
              <>
                {/* Conv stats */}
                <div className="p-5 border-b border-[var(--border)]">
                  <h4 className="text-xs font-semibold mb-3 text-[var(--text-muted)] uppercase tracking-wide">Conversation</h4>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-[var(--surface)] rounded-lg p-2.5 border border-[var(--border)]">
                      <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide mb-0.5">Statut</p>
                      <span className="text-xs font-medium capitalize">{selectedConv.status}</span>
                    </div>
                    <div className="bg-[var(--surface)] rounded-lg p-2.5 border border-[var(--border)]">
                      <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide mb-0.5">Échanges</p>
                      <span className="text-xs font-medium">{selectedConv.nb_exchanges}</span>
                    </div>
                    <div className="bg-[var(--surface)] rounded-lg p-2.5 border border-[var(--border)]">
                      <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide mb-0.5">Temps de réponse</p>
                      <span className="text-xs font-medium">{formatDuration(selectedConv.response_time_minutes)}</span>
                    </div>
                    <div className="bg-[var(--surface)] rounded-lg p-2.5 border border-[var(--border)]">
                      <p className="text-[10px] text-[var(--text-muted)] uppercase tracking-wide mb-0.5">Méthode</p>
                      <span className="text-xs font-medium capitalize">{selectedConv.contact_method || 'auto'}</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-2 text-xs text-[var(--text-muted)]">
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
                <div className="p-5">
                  <h4 className="text-xs font-semibold mb-3 text-[var(--text-muted)] uppercase tracking-wide flex items-center gap-2">
                    <MessageSquare size={13} />
                    Messages ({selectedMessages.length})
                  </h4>

                  {selectedMessages.length === 0 ? (
                    <p className="text-xs text-[var(--text-muted)] text-center py-6">Aucun message</p>
                  ) : (
                    <div className="space-y-2.5">
                      {selectedMessages.map(msg => (
                        <div key={msg.id} className={`flex gap-2 ${msg.direction === 'outbound' ? '' : 'flex-row-reverse'}`}>
                          <div className={`flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center ${
                            msg.direction === 'outbound' ? 'bg-[var(--accent)]/20 text-[var(--accent)]' : 'bg-emerald-500/20 text-emerald-400'
                          }`}>
                            {msg.direction === 'outbound' ? <ArrowUpRight size={12} /> : <ArrowDownLeft size={12} />}
                          </div>
                          <div className={`flex-1 max-w-[85%] ${msg.direction === 'outbound' ? '' : 'text-right'}`}>
                            <div className={`inline-block text-left p-2.5 rounded-xl text-xs leading-relaxed ${
                              msg.direction === 'outbound'
                                ? 'bg-[var(--accent)]/10 border border-[var(--accent)]/20'
                                : 'bg-emerald-500/10 border border-emerald-500/20'
                            }`}>
                              <p className="whitespace-pre-wrap break-words">{msg.content}</p>
                            </div>
                            <p className="text-[9px] text-[var(--text-muted)] mt-0.5 flex items-center gap-1 px-1">
                              <Clock size={8} />
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
              <div className="p-6 text-center text-[var(--text-muted)] py-10">
                <MessageSquare size={28} className="mx-auto mb-2 opacity-30" />
                <p className="text-xs">Aucune conversation</p>
              </div>
            )}
          </div>
        )}
      </div>

      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/20 z-50 pointer-events-none">
          <span className="text-sm text-[var(--text-muted)]">Chargement des zones...</span>
        </div>
      )}
    </div>
  )
}
