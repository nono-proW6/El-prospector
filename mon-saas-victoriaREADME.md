# Victoria

**Plateforme SaaS de gestion immobiliere intelligente, pilotee par l'IA et le statut des conversations.**

Victoria est un outil tout-en-un pour les agences immobilieres : gestion des prospects, qualification automatique des candidatures, agenda intelligent avec optimisation des trajets, et communication agent via Telegram. Le tout orchestre par des workflows n8n et des agents IA.

---

## Pourquoi Victoria ?

Une agence immobiliere recoit des dizaines de demandes par jour (emails, portails, formulaires). Chaque demande doit etre qualifiee, chaque document verifie, chaque visite planifiee. Victoria automatise ce pipeline de bout en bout :

1. **Un prospect contacte l'agence** (email, portail, creation manuelle)
2. **Axel** (agent IA conversationnel) collecte les informations et documents necessaires
3. **Lyra** (moteur d'analyse IA) evalue la solidite du dossier et attribue un score
4. **Le systeme propose automatiquement un creneau de visite** en tenant compte de l'agenda, des trajets et des contraintes de l'agent
5. **L'agent confirme via Telegram** en un clic
6. **Le prospect recoit la confirmation** et le RDV est inscrit a l'agenda

Tout est pilote par le **statut de la conversation** : chaque changement de statut declenche l'etape suivante du pipeline.

---

## Architecture globale

```
┌─────────────────────────────────────────────────────────────────┐
│                         FRONTEND                                │
│           React + TypeScript + Vite + Tailwind                  │
│                    (deploye sur Vercel)                         │
│                                                                 │
│  Dashboard  │  Agenda  │  Biens  │  Demandes  │  Candidatures   │
└──────────────────────────┬──────────────────────────────────────┘
                           │ Supabase Client (REST + Realtime)
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                        SUPABASE                                 │
│                                                                 │
│  PostgreSQL  │  Auth + RLS  │  Edge Functions  │  Storage       │
│  (40+ tables)  (multi-tenant)  (15+ fonctions)   (documents)    │
└──────────┬───────────────────────────┬──────────────────────────┘
           │ Triggers + Webhooks       │ Webhooks HTTPS
           ▼                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                          N8N                                    │
│              (orchestration des workflows)                      │
│                                                                 │
│  axel-branche  │  axel_manager  │  Lyra  │  Telegram handlers   │
│  (conversation)  (lead ingestion)  (scoring)  (confirmations)   │
│                                                                 │
│  Agents IA : OpenAI (GPT-4.1, GPT-5-mini)                       │
└──────────────────────────┬──────────────────────────────────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
         Telegram       Gmail       OpenAI API
        (agents)        (leads)        (LLM)
```

---

## Fonctionnalites principales

### 1. Gestion des prospects et conversations (Status-Driven)

Le coeur du systeme. Chaque prospect est associe a une **conversation** dont le **statut** pilote tout le pipeline. Chaque changement de statut declenche automatiquement l'etape suivante via des triggers Supabase et des workflows n8n.

#### Statuts de categorisation (routage initial)

Ces statuts determinent dans quelle branche du workflow n8n le prospect est route :

| Statut | Role |
|--------|------|
| `new_lead` | Nouveau prospect (valeur par defaut a la creation) |
| `pending_property_reference` | Prospect arrive mais pas encore associe a un bien precis |
| `property_interest` | Prospect a manifeste un interet pour un bien |
| `in_search` | Prospect en recherche active, pas encore candidat sur un bien |
| `future_project` | Projet futur, pas pret pour le moment |
| `seller` | Contact vendeur (pas un candidat locataire/acquereur) |

#### Statuts du pipeline de qualification (Axel + Lyra)

| Statut | Role | Declenche par |
|--------|------|---------------|
| `waiting_for_form` | Axel collecte les infos et documents (questions Lyra) | n8n (axel-branche) |
| `form_received` | Formulaire externe recu, extraction des donnees en cours | Trigger sur candidature_events |
| `needs_review` | Score Lyra insuffisant, revision manuelle necessaire | Trigger `update_conversation_after_lyra_analysis` |
| `form_qualified` | Lyra a qualifie le dossier (score >= seuil) | Trigger `update_conversation_after_lyra_analysis` |
| `form_rejected` | Dossier rejete apres revision manuelle ou analyse | n8n / action manuelle |

#### Statuts du pipeline RDV

| Statut | Role | Declenche par |
|--------|------|---------------|
| `ready_for_rdv` | Prospect qualifie, pret a recevoir une proposition de creneau | n8n (axel-branche) |
| `waiting_confirmation` | Creneau propose, en attente de confirmation de l'agent via Telegram | Edge Function `waiting-confirmation-trigger` |
| `rdv_confirmed` | Agent a accepte le creneau sur Telegram | Edge Function `rdv-confirmed-trigger` |
| `rdv_refused` | Agent a refuse le creneau sur Telegram | Edge Function `rdv-confirmed-trigger` |
| `repropose_rdv` | Agent a refuse ou creneau invalide → reproposer un autre creneau | n8n (axel-branche) |
| `rdv_scheduled` | Visite inscrite a l'agenda de l'agent | Edge Function `action-book-visit` |
| `prospect_cancel_rdv` | Le prospect a annule le RDV | n8n |
| `rdv_cancelled_by_prospect` | RDV annule par le prospect (apres booking) | n8n |
| `rdv_cancelled_by_agent` | RDV annule par l'agent (apres avoir accepte) | n8n |

#### Statuts post-visite

| Statut | Role | Declenche par |
|--------|------|---------------|
| `collecting_post` | Phase post-visite : collecte de documents/infos supplementaires | Edge Function `lyra-post-visit-cron` |
| `post_analyzed` | Analyse post-visite Lyra terminee | n8n (Lyra) |
| `qualified` | Dossier definitivement retenu par l'agence | Action manuelle |
| `archived` | Conversation terminee / classee | Action manuelle |

#### Statuts obsoletes (encore en DB mais plus utilises)

| Statut | Raison |
|--------|--------|
| `en_attente_formulaire` | Ancien nom francais de `waiting_for_form` |
| `formulaire_recu` | Ancien nom francais de `form_received` |
| `terminee` | Remplace par `archived` |
| `active` | Plus utilise |
| `manual_entry` | Remplace par un boolean `is_manual_entry` |

#### Flow des statuts

```
new_lead / pending_property_reference / property_interest
    │
    ▼
waiting_for_form ◄──────────────────────────────────┐
    │                                                │
    ▼                                                │
form_received (si formulaire externe)                │
    │                                                │
    ▼                                                │
┌─────────────────────────┐                          │
│ LYRA ANALYSE            │                          │
│ score >= seuil?         │                          │
└────┬───────────┬────────┘                          │
     │           │                                   │
     ▼           ▼                                   │
form_qualified  needs_review                         │
     │           │                                   │
     │           ▼                                   │
     │      form_rejected (si rejet manuel)          │
     │                                               │
     ▼                                               │
ready_for_rdv                                        │
     │                                               │
     ▼                                               │
waiting_confirmation ──────► rdv_refused              │
     │                          │                    │
     ▼                          ▼                    │
rdv_confirmed              repropose_rdv ────────────┘
     │
     ▼
rdv_scheduled
     │
     ├──► prospect_cancel_rdv / rdv_cancelled_by_*
     │
     ▼
collecting_post
     │
     ▼
post_analyzed
     │
     ▼
qualified / archived
```

**Frontend** : Vue Kanban et vue liste pour suivre toutes les demandes, filtrees par statut, agent, bien.

### 2. Lyra - Analyse IA des candidatures

Lyra est le moteur d'evaluation des dossiers. Il couvre tout le cycle :

- **Configuration par l'agence** : questions et documents a collecter, poids de chaque critere, seuils de qualification
- **Collecte conversationnelle** : questions posees par Axel au prospect, avec logique conditionnelle (si oui -> sous-question)
- **Generation du bareme** : l'IA repartit 100 points entre les sujets selon l'importance configuree
- **Analyse du dossier** : l'IA evalue chaque sujet sur la base des reponses et documents collectes
- **Score final** : note sur 10 + niveau de risque (faible/moyen/eleve) + recommandation
- **Routage automatique** : si score >= seuil -> qualifie, sinon -> revision manuelle

Fonctionne en deux phases : **avant visite** (qualification) et **apres visite** (analyse approfondie).

### 3. Agenda intelligent et optimisation des trajets

Le systeme d'agenda va bien au-dela d'un simple calendrier :

- **Recherche de creneaux** : trouve les meilleurs creneaux en simulant l'impact sur la journee entiere de l'agent
- **Calcul des trajets** : integre les temps de deplacement reels (API OpenRouteService) entre chaque RDV
- **Smart Destination** : apres chaque RDV, decide intelligemment ou aller (prochain RDV, retour base, rester sur place)
- **Pause dejeuner flexible** : optimise le lieu et l'horaire du dejeuner selon les contraintes de la journee
- **Scenarios strategiques** : propose des creneaux contextualises ("avant votre RDV de 10h30", "entre vos deux visites")
- **Validation de creneaux** : quand le prospect propose un horaire, le systeme valide la faisabilite et propose des alternatives si necessaire
- **Cache de trajets** : 2 niveaux (memoire + DB) pour des performances optimales

### 4. Communication agent via Telegram

Les agents immobiliers interagissent avec le systeme via un bot Telegram :

- **Notifications de visite** : boutons Accepter/Refuser directement dans Telegram
- **Gestion des absences** : declarer des indisponibilites
- **Onboarding** : lier son compte Telegram a l'application

### 5. Webhooks n8n et Edge Functions

Les Edge Functions communiquent avec n8n via 5 webhooks dedies. Le routing est determine par le **type d'action** :

#### N8N_ASK_ACTION_AGENT_TELEGRAM (notifier l'agent, demander une action)

Workflow n8n : `Axel_telegram_ask_action`

| Edge Function | Trigger | Statuts / Condition |
|---|---|---|
| `waiting-confirmation-trigger` | UPDATE conversations | `needs_review`, `waiting_confirmation`, `prospect_cancel_rdv`, `rdv_cancelled` |
| `human-help-trigger` | INSERT human_help_requests | IA detecte besoin d'intervention humaine |

#### N8N_CONVERSATION_EVENTS_WEBHOOK_URL (traitement conversation par axel-branche)

Workflow n8n : `axel-branche`

| Edge Function | Trigger | Statuts / Condition |
|---|---|---|
| `rdv-booking-trigger` | UPDATE conversations | `form_qualified`, `form_rejected` |
| `lyra-post-visit-cron` | CRON (5min) / manuel | Post-visite Lyra |

#### N8N_AGENT_ACTIONS_WEBHOOK_URL (l'agent a repondu)

Workflow n8n : `axel-branche`

| Edge Function | Trigger | Statuts / Condition |
|---|---|---|
| `rdv-confirmed-trigger` | UPDATE conversations | `rdv_confirmed`, `rdv_refused` (sauf via Telegram) |
| `submit-human-help-response` | Appel frontend cockpit | Agent repond aux questions human-help |

#### N8N_SYNTHESE_WEBHOOK_URL / N8N_BAREME_WEBHOOK_URL

| Edge Function | Webhook | Trigger |
|---|---|---|
| `synthese-trigger` | `N8N_SYNTHESE_WEBHOOK_URL` | INSERT messages (sortants uniquement) |
| `generate-lyra-bareme` | `N8N_BAREME_WEBHOOK_URL` | Appel frontend |

#### Configuration des secrets

Les webhooks sont configures via des secrets Supabase (un par environnement) :
- PROD : URLs sans suffixe (`/webhook/<uuid>`)
- DEV : URLs avec suffixe `-dev` (`/webhook/<uuid>-dev`)

Gestion via : `supabase secrets set <NOM>=<URL>`

Les triggers DB sont geres par la fonction SQL `reconfigure_webhooks_for_project()` qui drop/recree tous les triggers en pointant vers le bon projet (DEV ou PROD).

### 6. Gestion des biens immobiliers

- Biens en location et en vente
- Configuration specifique par bien (duree de visite, buffers, lieu de RDV, seuil Lyra)
- Liste des candidatures associees avec scores Lyra
- Base de connaissances agence pour les reponses IA (RAG avec embeddings)

### 7. Organisations multi-tenantes

- Chaque agence = une organisation isolee
- Roles : admin, agent, viewer
- Systeme d'invitations et demandes d'acces
- Configuration Lyra par organisation (location et vente)
- Row Level Security (RLS) sur toutes les tables

---

## Stack technique

### Frontend
| Technologie | Usage |
|-------------|-------|
| React 18 + TypeScript | Framework UI |
| Vite | Build tool |
| TanStack Query | Data fetching + cache |
| React Router v6 | Navigation |
| shadcn/ui + Radix UI | Composants UI |
| Tailwind CSS | Styling |
| Recharts | Graphiques |
| Three.js + Vanta | Effets visuels |

### Backend
| Technologie | Usage |
|-------------|-------|
| Supabase (PostgreSQL) | Base de donnees + Auth + Storage |
| Edge Functions (Deno) | Logique serveur (agenda, Lyra, triggers) |
| Row Level Security | Isolation multi-tenant |
| 40+ fonctions SQL | Business logic (RPC) |

### Automatisation & IA
| Technologie | Usage |
|-------------|-------|
| n8n | Orchestration des workflows |
| OpenAI (GPT-4.1 / GPT-5-mini) | Agents IA (extraction, scoring, conversation) |
| Telegram Bot API | Communication interne agents |
| OpenRouteService API | Calcul d'itineraires |
| API Adresse (BAN) | Geocodage France |

### Deploiement
| Technologie | Usage |
|-------------|-------|
| Vercel | Hebergement frontend |
| Supabase Cloud | Backend managé |
| n8n (self-hosted) | Workflows |

---

## Structure du projet

```
Victoria/
│
├── src/                          # Code source frontend
│   ├── pages/                    # Pages de l'application
│   │   ├── Dashboard.tsx         # Page principale (liste des biens)
│   │   ├── CaseDetail.tsx        # Detail d'un mandat
│   │   ├── agenda/               # Calendrier agent
│   │   ├── demandes/             # Prospects (Kanban + Liste)
│   │   ├── biens/                # Biens (location + vente)
│   │   ├── neo/                  # Detail candidatures
│   │   ├── cockpit/              # Vue cockpit
│   │   └── settings/             # Parametres
│   ├── components/               # Composants reutilisables
│   │   ├── ui/                   # shadcn/ui (50+ composants)
│   │   ├── agenda/               # Calendrier, events, smart slot finder
│   │   ├── lyra/                 # Config Lyra, scores, analyses
│   │   ├── demandes/             # Cartes prospects, dialogs
│   │   └── dashboard/            # Metriques, Neo mini-chat
│   ├── hooks/                    # 30 hooks custom (agenda, prospects, Lyra, trajets...)
│   ├── contexts/                 # SmartSlot, CriticalTravel, Sound, Music
│   ├── integrations/supabase/    # Client + types auto-generes (89KB)
│   ├── lib/                      # Parsers de donnees candidatures
│   └── types/                    # Types TypeScript (candidature, lyra)
│
├── supabase/
│   ├── migrations/               # Schema DB (baseline 342KB + migrations)
│   └── functions/                # Edge Functions
│       ├── get-available-visit-slots/   # Agenda intelligent (28 fichiers, ~5000 lignes)
│       ├── generate-lyra-bareme/        # Generation du bareme de notation
│       ├── lyra-trigger/                # Declencheur analyse Lyra
│       ├── lyra-post-visit-cron/        # Cron analyse post-visite
│       ├── daily-maintenance/           # Maintenance quotidienne (blocs systeme)
│       ├── rdv-booking-trigger/         # Declencheur reservation RDV
│       ├── rdv-confirmed-trigger/       # Declencheur confirmation RDV
│       ├── rdv-email-action/            # Actions email RDV (accepter/refuser)
│       ├── waiting-confirmation-trigger/ # Notification agent (needs_review, waiting_confirmation, etc.)
│       ├── synthese-trigger/            # Declencheur synthese conversation
│       ├── human-help-trigger/          # Notification agent (human_help_needed)
│       ├── submit-human-help-response/  # Reponse aide humaine
│       ├── send-auth-email/             # Emails d'authentification
│       ├── send-invitation/             # Emails d'invitation
│       ├── send-join-request-response/  # Reponse demandes d'acces
│       ├── generate-agency-chunks/      # RAG : chunks agence
│       ├── generate-bien-chunk/         # RAG : chunks biens
│       ├── process-bien-embedding-queue/ # File embeddings
│       └── store-response-knowledge/    # Stockage connaissances
│
├── n8n/                          # Workflows n8n
│   ├── saas-axel/                # Workflows agent Axel
│   │   ├── axel-branche.json     # Flow principal conversation prospect
│   │   ├── axel_manager.json     # Ingestion leads Gmail + classification IA
│   │   ├── Telegram_response.json # Gestion callbacks Telegram
│   │   ├── Axel_telegram_ask_action.json # Envoi notifications RDV
│   │   ├── Telegram_onboarding.json # Onboarding bot Telegram
│   │   └── Create_synthese_conversation.json # Synthese conversations
│   ├── saas-lyra/                # Workflows analyse Lyra
│   │   ├── Lyra_new_version.json # Analyse prospect (GPT-5-mini)
│   │   └── Create_bareme.json    # Generation bareme (GPT-4.1)
│   └── sync.js                   # Script export/sync workflows
│
├── prompts/                      # Prompts systeme des agents IA
│   ├── axel_question_updated.txt # Agent poseur de questions
│   ├── scrappe_response_prospect.txt # Agent extracteur de reponses
│   ├── create_bareme_prompt.txt  # Agent generateur de bareme
│   └── lyra_analyse.txt          # Agent analyste de dossier
│
└── docs/                         # Documentation
    ├── lyra.md                   # Documentation Lyra (a jour)
    └── n8n.md                    # Setup n8n
```

---

## Flow principal : du prospect au RDV

```
        ┌───────────────────────────────────┐
        │         NOUVEAU PROSPECT          │
        │   (email / portail / manuel)      │
        │                                   │
        │   new_lead                        │
        │   pending_property_reference      │
        │   property_interest               │
        └───────────────┬───────────────────┘
                        │
        ┌───────────────▼───────────────────┐
        │         COLLECTE AXEL             │
        │                                   │
        │   waiting_for_form                │
        │   Questions Lyra + Documents      │
        │   Boucle jusqu'a tout collecter   │
        └───────────────┬───────────────────┘
                        │
        ┌───────────────▼───────────────────┐
        │         ANALYSE LYRA              │
        │                                   │
        │   Bareme (100pts) + Score /10     │
        │   Niveau de risque                │
        └───────┬───────────────┬───────────┘
                │               │
    ┌───────────▼────┐  ┌───────▼───────────┐
    │ form_qualified │  │  needs_review     │
    │ (score >= seuil)│  │  (score < seuil)  │
    └───────┬────────┘  │  → revision       │
            │           │    manuelle        │
            │           └───┬───────────────┘
            │               │ (si accepte)
            │    ┌──────────┘
            ▼    ▼
    ┌────────────────────────────────────────┐
    │         PROPOSITION RDV               │
    │                                       │
    │   ready_for_rdv                       │
    │   Creneaux optimises (agenda+trajets) │
    └───────────────┬───────────────────────┘
                    │
    ┌───────────────▼───────────────────────┐
    │     CONFIRMATION AGENT (Telegram)     │
    │                                       │
    │   waiting_confirmation                │
    │   Boutons : Accepter / Refuser        │
    └───────┬───────────────┬───────────────┘
            │               │
    ┌───────▼────┐  ┌───────▼───────────┐
    │ rdv_       │  │ rdv_refused       │
    │ confirmed  │  │ → repropose_rdv   │
    └───────┬────┘  │ → retour collecte │
            │       └───────────────────┘
    ┌───────▼───────────────────────────────┐
    │         RDV PROGRAMME                 │
    │                                       │
    │   rdv_scheduled                       │
    │   Inscrit a l'agenda de l'agent       │
    └───────────────┬───────────────────────┘
                    │
    ┌───────────────▼───────────────────────┐
    │         POST-VISITE                   │
    │                                       │
    │   collecting_post → post_analyzed     │
    │   Lyra phase 2 (analyse approfondie)  │
    └───────────────┬───────────────────────┘
                    │
    ┌───────────────▼───────────────────────┐
    │   qualified / archived                │
    └───────────────────────────────────────┘
```

---

## Modele de donnees (entites principales)

```
organization (agence)
    │
    ├── user (agents) ──────── telegram_chat_id
    │       │
    │       └── agenda_events (RDV, absences, blocs systeme)
    │               │
    │               └── travel_events (trajets calcules)
    │
    ├── biens (proprietes)
    │       │
    │       ├── dossiers_candidature (candidatures)
    │       │       │
    │       │       ├── dossier_personnes (personnes liees)
    │       │       │       │
    │       │       │       └── responses + bareme (donnees Lyra)
    │       │       │
    │       │       └── lyra_analyses (scores + analyses)
    │       │
    │       └── candidature_extractions (OCR documents)
    │
    ├── prospects (contacts)
    │       │
    │       └── conversations (fil de discussion)
    │               │
    │               └── telegram_agent_messages (messages Telegram)
    │
    └── personnes (personnes physiques, deduplication par identity_hash)
```

---

## Developpement

```bash
# Installation
npm install

# Serveur de dev
npm run dev

# Build production
npm run build

# Sync workflows n8n
npm run sync-n8n
```

### Variables d'environnement

```env
VITE_SUPABASE_URL=https://xxx.supabase.co
VITE_SUPABASE_ANON_KEY=xxx
```

Les Edge Functions utilisent des variables supplementaires configurees dans Supabase (webhooks n8n, tokens, cles API).

---

## Securite

- **RLS (Row Level Security)** sur toutes les tables pour l'isolation multi-tenant
- **Auth Supabase** avec JWT + 2FA optionnel (TOTP)
- **SECURITY DEFINER** sur les fonctions SQL appelees par le backend/n8n
- **Webhooks HTTPS** avec token d'authentification entre Supabase et n8n
- **Audit log** (`security_audit_log`) pour tracer les actions sensibles
- **Service Role** reserve aux appels backend (n8n) avec bypass RLS
