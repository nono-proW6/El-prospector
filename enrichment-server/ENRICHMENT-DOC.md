# Enrichissement des agences — Documentation technique

## Vue d'ensemble

Le systeme d'enrichissement recherche automatiquement les informations de contact (email, gerant, LinkedIn, SIRET) pour chaque agence trouvee par le scraping Google Maps. Depuis mars 2026, il utilise **Claude Code SDK** sur un VPS au lieu de l'ancien systeme Firecrawl + OpenAI.

---

## Ancien systeme (avant mars 2026)

### Architecture
```
Cron pg_cron (toutes les 5 min, 9h-23h)
  → run_auto_enrich() (fonction SQL)
    → Edge function Supabase "enrich-agencies"
      → Firecrawl /map (listing des URLs du site)
      → OpenAI GPT-4.1 (filtrage des pages pertinentes)
      → Firecrawl /scrape (contenu des pages)
      → OpenAI GPT-4.1 (extraction des donnees)
```

### Problemes
- **Fiabilite** : OpenAI avec les petits modeles ne faisait pas de vraie recherche web, il regardait juste les snippets et hallucinait souvent
- **Cout** : Firecrawl (credits) + OpenAI (tokens API) = double facturation
- **Timeout** : Les edge functions Supabase ont un timeout limite, d'ou le batch de 1 agence par appel toutes les 5 min
- **Donnees limitees** : Pas de LinkedIn, pas de SIRET, pas de detection de faux positifs

### Ce qui a ete desactive
- Cron pg_cron job #6 (`SELECT run_auto_enrich()`) — desactive via `cron.unschedule(6)`
- La fonction SQL `run_auto_enrich()` existe encore en base mais n'est plus appelee
- L'edge function `enrich-agencies` existe encore sur Supabase mais n'est plus appelee

---

## Nouveau systeme (mars 2026)

### Architecture
```
Cron VPS (toutes les 30 min, 9h-23h)
  → node enrich.js cron
    → Verifie enrich_config (paused, daily_target)
    → Verifie le nombre deja enrichi aujourd'hui
    → Claude Code SDK (query)
      → WebSearch (recherche web reelle)
      → WebFetch (ouverture des sites)
    → Update Supabase directement

Frontend (bouton "Enrichir")
  → POST http://148.230.112.157:3456/enrich
    → enrichBatch() sans verification de pause/quota
    → Meme pipeline Claude Code SDK
```

### Stack
- **VPS** : Hostinger (Ubuntu 24.04 LTS, srv915893.hstgr.cloud, IP: 148.230.112.157)
- **Runtime** : Node.js 22.22.1
- **SDK** : @anthropic-ai/claude-agent-sdk (pas @anthropic-ai/claude-code)
- **Process manager** : pm2 (nom: "enrichment", redemarre auto au reboot via systemd)
- **Auth** : Tokens Max Anthropic (OAuth credentials copiees depuis le Mac)
- **Port** : 3456

### Fichiers sur le VPS
```
/opt/enrichment-server/
  ├── package.json
  ├── .env              # SUPABASE_URL, SUPABASE_SERVICE_KEY, PORT
  ├── enrich.js         # Logique principale (enrichissement + cron + CLI)
  ├── server.js         # Serveur Express (endpoint HTTP pour le front)
  └── node_modules/

/root/.claude/
  └── .credentials.json  # Auth Anthropic Max (copie du Mac)

/var/log/enrichment.log  # Logs du cron
```

### Cron
```
*/30 9-23 * * *  cd /opt/enrichment-server && /usr/bin/node enrich.js cron >> /var/log/enrichment.log 2>&1
```

---

## Fonctionnement detaille

### Mode cron (`node enrich.js cron`)
1. Verifie le lock file `/tmp/enrichment.lock` (evite les chevauchements)
2. Lit `enrich_config` via RPC Supabase → verifie `paused` et `daily_target`
3. Compte les agences enrichies aujourd'hui (via colonne `enriched_at`)
4. Si quota pas atteint : enrichit min(remaining, 5) agences
5. Chaque agence : prompt Claude → WebSearch + WebFetch → parse JSON → update Supabase
6. Libere le lock file

### Mode manuel (`POST /enrich {batch_size: N}`)
- Appele par le bouton "Enrichir" du front
- **Bypass** la pause et le daily_target (le user decide)
- Le front envoie des requetes par batch de 5, jusqu'a atteindre le dailyTarget du champ
- Cap serveur : max 10 par requete

### Mode CLI (`node enrich.js [N]`)
- Pour tests manuels en SSH : `node enrich.js 3` enrichit 3 agences
- Bypass la pause et le daily_target

### Detection des faux positifs
Claude valide d'abord si c'est une vraie agence immobiliere. Rejete automatiquement :
- Diagnostiqueurs (DPE, amiante)
- Notaires
- SCI / holdings
- Constructeurs de maisons
- Agences fermees / radiees
- Experts / estimateurs
- Syndics purs
- Photographes / home stagers
- Courtiers en pret

Garde : agences classiques, franchises, mandataires (IAD, Capifrance...), auto-entrepreneurs en transaction.

Les rejetes → `enrichment_status = 'skipped'` + raison dans `enrichment_note`

### Donnees stockees par agence
| Colonne | Source | Exemple |
|---------|--------|---------|
| email | Site, pages jaunes, societe.com | contact@agence.fr |
| owner_name | societe.com, pappers.fr | Jean DUPONT |
| linkedin | Recherche web LinkedIn | https://linkedin.com/in/... |
| siret | societe.com, pappers.fr | 88267519200026 |
| is_franchise | Analyse du nom + reseau | true/false |
| enrichment_status | Resultat global | done/failed/skipped |
| enrichment_note | Resume des infos | Confiance: high \| notes... |
| enriched_at | Timestamp | 2026-03-15T14:30:00Z |

---

## Config Supabase

### Table `enrich_config`
```sql
id: 1
paused: boolean      -- Pause/reprendre depuis le front
daily_target: int    -- Nombre d'agences a enrichir par jour
batch_size: int      -- (legacy, plus utilise)
```

### RPCs utilisees
- `get_enrich_config()` → lit la config
- `update_enrich_config(p_paused, p_daily_target)` → modifie depuis le front

---

## Frontend

### ScanMap.tsx
- Bouton "Enrichir" → `POST /enrich` par batch de 5
- Champ "Agences/jour" → daily_target (sauve en base via RPC)
- Bouton "Pause" → toggle `paused` en base
- Popup agence → affiche email, phone, owner_name, website, **linkedin**, **siret** (editables)
- Variable env : `VITE_ENRICHMENT_URL=http://148.230.112.157:3456`

### Enrichment.tsx (page Contacts manuels)
- Affiche les agences `enrichment_status = 'done'` ET `email IS NULL`
- Tableau avec nom du gerant, LinkedIn cliquable, SIRET
- Modal de contact : bouton LinkedIn a cote du telephone et site web

---

## Commandes utiles (SSH sur le VPS)

```bash
# Voir les logs du cron
tail -f /var/log/enrichment.log

# Enrichir manuellement 3 agences
cd /opt/enrichment-server && node enrich.js 3

# Lancer le cron manuellement
cd /opt/enrichment-server && node enrich.js cron

# Voir le statut pm2
pm2 status
pm2 logs enrichment

# Redemarrer le serveur
pm2 restart enrichment

# Voir le cron
crontab -l
```

---

## Erreurs rencontrees et solutions

### 1. `import { claude } from "@anthropic-ai/claude-code"` → SyntaxError
**Probleme** : Le package `@anthropic-ai/claude-code` n'exporte pas `claude`.
**Solution** : Utiliser `@anthropic-ai/claude-agent-sdk` avec `import { query } from "@anthropic-ai/claude-agent-sdk"`. La fonction `query()` retourne un async generator.

### 2. OAuth login echoue sur le VPS ("Scope inconnu : org:create_api_key")
**Probleme** : `claude login` sur un serveur headless ne peut pas ouvrir de navigateur, et le scope OAuth est incompatible.
**Solution** : Extraire les credentials depuis le Keychain macOS du Mac local :
```bash
# Sur le Mac
security find-generic-password -s "Claude Code-credentials" -a "noamthomas" -w
```
Puis les copier dans `/root/.claude/.credentials.json` sur le VPS.

### 3. CORS bloque les requetes du front
**Probleme** : Le navigateur (localhost:5173) appelle le VPS (148.230.112.157:3456), bloque par la politique CORS.
**Solution** : Ajouter les headers CORS dans server.js :
```js
app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
```

### 4. Le front appelait localhost au lieu du VPS
**Probleme** : Le code avait un fallback `localhost:3456` mais le serveur tourne sur le VPS.
**Solution** : Ajouter `VITE_ENRICHMENT_URL=http://148.230.112.157:3456` dans `frontend/.env`.

---

## Cout et performance

- **Tokens par agence** : ~18-20k tokens (input + output + web search)
- **Temps par agence** : ~1-2 minutes
- **Abonnement** : Max 5x (quota hebdomadaire genereux)
- **Estimation** : 50 agences/jour = ~1M tokens/jour, largement dans le quota
- **Capacity max** : 145 agences/jour (29 runs cron × 5 par run)

---

## Migration depuis l'ancien systeme

### Colonnes ajoutees
```sql
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS enriched_at timestamptz DEFAULT NULL;
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS linkedin text DEFAULT NULL;
ALTER TABLE agencies ADD COLUMN IF NOT EXISTS siret text DEFAULT NULL;
```

### Cron desactive
```sql
SELECT cron.unschedule(6);  -- ancien cron run_auto_enrich
```

### Ce qui n'a PAS change
- Schema de base (agencies, conversations, messages, scan_zones, etc.)
- Workflows n8n (emails, reponses, relances)
- Pipeline de conversation (prospect → revelation → video → visio)
- Page Dashboard, Agencies, UnmatchedEmails
- Google Maps scanning
