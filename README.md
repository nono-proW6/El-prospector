# El Prospector

Outil interne pour valider l'angle commercial de Victoria en prouvant aux agences immobilieres leur probleme de reactivite.

## Comment ca marche

1. Je trouve des agences immobilieres et je copie une de leurs annonces
2. Je les rentre dans le frontend (nom, email, annonce ciblee)
3. Le soir a 21h36, n8n envoie un email de faux prospect a chaque agence
4. Quand l'agence repond, une IA analyse la reponse et gere la conversation
5. Au bon moment, l'IA revele la ruse et propose une visio avec moi (Noam) pour presenter Victoria
6. Tout est logge en base : temps de reponse, nb echanges, visio acceptee ou non

## Architecture

```
Frontend (React + Vite + Tailwind)     Supabase (PostgreSQL)
  - Saisie agences + annonces     <-->   - agencies
  - Dashboard resultats                  - conversations
                                         - messages
                                         4 fonctions RPC

                  n8n (toute la logique)
                    |
    +-----------+---+---+-----------+
    |           |       |           |
  Cron 21h36  IMAP    Claude     Gmail
  (envoie)   (recoit) (IA)     (envoie)
```

## Base de donnees (3 tables)

### agencies
Agences immobilieres a tester.
- name, email, city, source, notes
- listing_url, listing_title, listing_price, listing_ref, listing_type (location/vente)

### conversations
Une par agence. Tracking complet.
- agency_id, status (pending → sent → prospect_phase → revealed → video_sent → visio_accepted/closed/lost)
- sent_at, first_response_at, response_time_minutes
- nb_exchanges, visio_accepted

### messages
Chaque email envoye/recu.
- conversation_id, direction (outbound/inbound), content, sent_at

## Fonctions RPC

### get_pending_conversations(batch_size)
Retourne les conversations en `pending` avec toutes les infos agence + annonce.
Utilisee par le cron pour savoir a qui envoyer.

### mark_conversation_sent(p_conversation_id, p_email_content)
Apres envoi du premier email : passe le statut a `sent`, insere le message outbound.

### find_conversation_by_email(p_sender_email)
Quand une agence repond : trouve la conversation par domaine email.
Filtre sur les statuts actifs : `sent`, `prospect_phase`, `revealed`, `video_sent`.
Retourne un JSON avec `found: true/false`, les infos agence, `conversation_status`, et l'historique formate pour l'IA.

Le format de l'historique :
```
[Nous — Mercredi 4 mars 2026 a 22h15]
Bonjour, je suis interesse par votre T3...

[Agence — Jeudi 5 mars 2026 a 08h42 — 10h27 apres]
Bonjour, oui le bien est disponible...
```

### process_agency_response(p_conversation_id, p_inbound_content, p_outbound_content, p_new_status, p_notify_me)
Apres traitement par l'IA : insere les messages (inbound + outbound si reponse), update la conversation (statut, temps de reponse, nb echanges). `visio_accepted` passe a `true` automatiquement quand `p_new_status = 'visio_accepted'`.

## Workflows n8n

### Workflow 1 — Envoi des emails (cron)
```
Schedule (21h36, lun-ven)
  → get_pending_conversations
  → Loop sur chaque agence
    → Wait random (0-15 min)
    → Agent IA genere l'email (subject + body)
    → Gmail envoie
    → mark_conversation_sent
```

### Workflow 2 — Gestion des reponses (status-driven)
```
Gmail trigger (poll chaque minute, unread)
  → find_conversation_by_email
  → IF found
    → Switch sur conversation_status
      ├─ "sent" / "prospect_phase" → AI Agent Revelation
      ├─ "revealed"                → AI Agent Video
      ├─ "video_sent"             → AI Agent Visio
      └─ fallback                 → Mark as read
    → IF need_response
      → Gmail envoie la reponse
      → process_agency_response (avec outbound)
    → ELSE
      → process_agency_response (sans outbound)
    → Mark email as read
  → ELSE
    → Mark email as read
```

## Statuts de conversation

```
pending → sent → prospect_phase → revealed → video_sent → visio_accepted
                                                        → closed
                                                        → lost
```

| Statut | Signification | Qui le met |
|--------|---------------|-----------|
| pending | Agence ajoutee, en attente d'envoi | Frontend |
| sent | Premier email envoye, aucune reponse encore | mark_conversation_sent (cron n8n) |
| prospect_phase | L'agence a repondu, on joue encore le prospect | AI Agent Revelation |
| revealed | Message de revelation envoye, on attend la reaction | AI Agent Revelation |
| video_sent | Lien video envoye, on attend l'avis | AI Agent Video |
| visio_accepted | Visio decrochee avec Noam | AI Agent Visio |
| closed | Refus explicite, conversation terminee | N'importe quel agent |
| lost | Pas de reponse depuis trop longtemps | Regle automatique (a venir) |

## Les 3 agents IA (status-driven)

### AI Agent Revelation
**Entree :** `sent`, `prospect_phase`
**Prompt :** `handle_prospect_phase.md`

Recoit les reponses de l'agence pendant la phase prospect. Decide de continuer a jouer le prospect (1-2 echanges) ou de reveler la ruse. Adapte le message de revelation selon le delai de reponse.

Statuts possibles en sortie : `prospect_phase`, `revealed`, `closed`

### AI Agent Video
**Entree :** `revealed`
**Prompt :** `handle_post_revelation.md`

Recoit les reactions apres la revelation. Soit l'agence est curieuse et il envoie le lien video, soit il vend la valeur pour donner envie. 1 rebond max si refus.

Statuts possibles en sortie : `revealed`, `video_sent`, `closed`

### AI Agent Visio
**Entree :** `video_sent`
**Prompt :** `handle_post_video.md`

Recoit les reactions apres l'envoi de la video. Recolte l'avis, repond aux questions, et decroche un RDV visio avec Noam. 1 rebond max si refus.

Statuts possibles en sortie : `video_sent`, `visio_accepted`, `closed`

## Stack

- **Supabase** : PostgreSQL (stockage uniquement)
- **n8n** : toute la logique (cron, IMAP, SMTP, IA)
- **OpenAI** : GPT-4.1 pour les reponses, GPT-4.1-mini pour la generation d'emails
- **React + TypeScript + Vite + Tailwind** : frontend local
- **Gmail** : envoi/reception des emails

## Frontend

```
cd frontend && npm install && npm run dev
```

Variables d'environnement dans `frontend/.env` :
```
VITE_SUPABASE_URL=https://fimedehqtcpijcfjunlh.supabase.co
VITE_SUPABASE_ANON_KEY=...
```
