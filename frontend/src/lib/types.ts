export interface Agency {
  id: string
  name: string
  email: string | null
  city: string
  source: string | null
  notes: string | null
  phone: string | null
  website: string | null
  owner_name: string | null
  linkedin: string | null
  siret: string | null
  is_franchise: boolean
  enrichment_status: string
  enrichment_note: string | null
  enriched_at: string | null
  score: string | null
  score_reason: string | null
  sales_brief: string | null
  rating: number | null
  created_at: string
}

export interface Conversation {
  id: string
  agency_id: string
  status: string
  contact_method: string | null
  sent_at: string | null
  first_response_at: string | null
  response_time_minutes: number | null
  nb_exchanges: number
  visio_accepted: boolean
  no_answer: boolean
  ref: string | null
  created_at: string
  agency?: Agency
}

export interface Message {
  id: string
  conversation_id: string
  direction: 'outbound' | 'inbound'
  content: string
  sent_at: string
}
