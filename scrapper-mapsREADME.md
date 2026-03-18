# Scraper Google Maps — Agences Immobilières France

## Spec technique finale — Victoria

---

## 1. UX — Dashboard admin

L'idée c'est que tu n'as rien à faire manuellement. Tu as un dashboard simple dans Victoria (ou juste une page admin) qui affiche :

- **Progression globale** : nombre de zones total, pending, done, saturated + barre de progression ("France scannée à 47%")
- **Agences trouvées** : total en base, nouvelles aujourd'hui
- **Coût estimé** : nombre de requêtes API consommées, coût en dollars
- **Contrôles** : bouton start/pause du scan, input pour régler le quota quotidien (nombre max de requêtes par jour)

**Bonus (pas essentiel au lancement)** : une vue carte qui affiche les zones scannées en vert et les zones pending en gris, pour visualiser la progression géographiquement.

---

## 2. Architecture Supabase

### Table `scan_zones` — La file d'attente

Chaque ligne = une zone rectangulaire à scanner.

| Champ | Type | Description |
|-------|------|-------------|
| `id` | uuid | Clé primaire |
| `sw_lat` | float | Latitude coin sud-ouest |
| `sw_lng` | float | Longitude coin sud-ouest |
| `ne_lat` | float | Latitude coin nord-est |
| `ne_lng` | float | Longitude coin nord-est |
| `status` | text | `pending`, `processing`, `done`, `saturated` |
| `density_type` | text | `dense`, `intermediate`, `rural` |
| `priority` | int | Plus c'est bas, plus c'est prioritaire (1 = Bordeaux, 4 = rural) |
| `parent_id` | uuid | Référence à la zone parente si c'est une subdivision (nullable) |
| `results_count` | int | Nombre de résultats trouvés dans cette zone |
| `created_at` | timestamp | Date de création |
| `scanned_at` | timestamp | Date du scan (nullable) |

Index : `(status, priority, id)` pour que le cron récupère efficacement les prochaines zones.

### Table `agencies` — La base d'agences

| Champ | Type | Description |
|-------|------|-------------|
| `id` | uuid | Clé primaire |
| `place_id` | text | **UNIQUE** — ID Google Places, anti-doublon |
| `name` | text | Nom de l'agence |
| `address` | text | Adresse complète |
| `phone` | text | Téléphone (nullable) |
| `website` | text | Site web (nullable) |
| `email` | text | Email si disponible (nullable) |
| `lat` | float | Latitude |
| `lng` | float | Longitude |
| `rating` | float | Note Google (nullable) |
| `user_ratings_total` | int | Nombre d'avis (nullable) |
| `created_at` | timestamp | Date d'insertion |

Contrainte : `UNIQUE(place_id)` → insertion avec `ON CONFLICT (place_id) DO NOTHING`.

### Table `scan_logs` — Suivi d'exécution

| Champ | Type | Description |
|-------|------|-------------|
| `id` | uuid | Clé primaire |
| `executed_at` | timestamp | Date d'exécution du cron |
| `zones_processed` | int | Nombre de zones traitées |
| `agencies_found` | int | Nombre d'agences trouvées (brut) |
| `agencies_new` | int | Nombre de nouvelles agences (pas déjà en base) |
| `api_requests_used` | int | Nombre de requêtes Google API consommées |

---

## 3. Logique pour couvrir toute la France

### Principe fondamental : grille nationale unique + subdivision adaptative

On ne part PAS des communes pour générer les rectangles. On crée UNE SEULE grille sur toute la bounding box de la France, puis on adapte la finesse selon la densité. Les communes INSEE servent uniquement à déterminer la densité et à filtrer les zones vides.

Pourquoi : une grille unique garantit mathématiquement zéro trou et zéro chevauchement. Chaque cellule est définie par sa position (ligne, colonne) dans la grille. La cellule (i, j) touche la cellule (i, j+1) sans jamais la chevaucher. C'est comme les pixels d'un écran.

---

### Étape 1 : Génération initiale de la queue (une seule fois, zéro coût)

**1a. Créer la carte de densité**

On télécharge le fichier des communes INSEE (gratuit, ~35 000 communes avec coordonnées GPS et code densité : 1 = dense, 2 = intermédiaire, 3 = rural, 4 = très rural).

On pose une grille grossière de cases de 10km × 10km sur la bounding box de la France (environ 42.3°N à 51.1°N, -5.1°E à 9.6°E). Pour chaque case de 10km, on regarde quelles communes INSEE tombent dedans :

- Si au moins une commune de densité 1 → la case est classée **dense**
- Si au moins une commune de densité 2 (et aucune de densité 1) → classée **intermédiaire**
- Si uniquement des communes de densité 3 ou 4 → classée **rural**
- Si aucune commune → classée **vide**, on la jette. Pas de requête dans l'océan ni à l'étranger.

**1b. Subdiviser selon la densité**

Chaque case de 10km classée **dense** est subdivisée en rectangles de **500m × 500m**. Soit 20×20 = 400 sous-rectangles. Ils sont parfaitement contigus, zéro chevauchement, zéro trou (subdivision mathématique interne d'un carré en sous-carrés).

Chaque case de 10km classée **intermédiaire** est subdivisée en rectangles de **2km × 2km**. Soit 5×5 = 25 sous-rectangles. Même logique.

Chaque case de 10km classée **rural** reste telle quelle. Un seul rectangle de 10km. Une seule requête.

**1c. Remplir la table `scan_zones`**

Tous les sous-rectangles (et les cases rurales non subdivisées) sont insérés dans `scan_zones` avec `status = 'pending'`.

**1d. Attribuer les priorités**

- Priorité 1 : Bordeaux et sa métropole
- Priorité 2 : autres grandes villes (Paris, Lyon, Marseille, Toulouse, Nice, Nantes, etc.)
- Priorité 3 : villes intermédiaires
- Priorité 4 : zones rurales

La priorité est déterminée par la position géographique de la zone : on identifie dans quelle métropole/ville tombe chaque zone, et on attribue la priorité en conséquence.

**Estimation du volume** : environ 15 000 à 20 000 zones au total dans la queue.

---

### Étape 2 : Le cron quotidien (n8n ou pg_cron)

Chaque jour (ou à la fréquence souhaitée), le cron exécute :

**2a. Récupérer les prochaines zones**

```sql
SELECT * FROM scan_zones
WHERE status = 'pending'
ORDER BY priority ASC, id ASC
LIMIT {quota_quotidien};
```

**2b. Crash recovery**

Avant de traiter les nouvelles zones, le cron remet en `pending` les zones bloquées :

```sql
UPDATE scan_zones
SET status = 'pending'
WHERE status = 'processing'
AND scanned_at < NOW() - INTERVAL '10 minutes';
```

**2c. Pour chaque zone**

1. Passer le status à `processing`
2. Lancer une requête **Text Search (New)** :
   - `textQuery`: "agence immobilière"
   - `includedTypes`: ["real_estate_agency"]
   - `locationRestriction`: rectangle avec les coordonnées (sw_lat, sw_lng) → (ne_lat, ne_lng)
   - `FieldMask` : `places.id,places.displayName,places.formattedAddress,places.location,places.nationalPhoneNumber,places.websiteUri`
   - `pageSize`: 20
3. Si la réponse contient un `nextPageToken`, paginer (page 2, page 3) pour récupérer tous les résultats
4. **Si le total atteint 60 résultats (saturation = 3 pages de 20)** :
   - Marquer la zone comme `saturated`
   - Générer 4 sous-rectangles (couper le rectangle en 4 quarts égaux)
   - Insérer les 4 sous-rectangles dans `scan_zones` en `pending` avec la même priorité et `parent_id` pointant vers la zone saturée
   - Les sous-zones seront traitées dans les prochaines exécutions du cron
5. **Si le total est inférieur à 60** : marquer la zone comme `done`
6. Pour chaque agence trouvée : `INSERT INTO agencies ... ON CONFLICT (place_id) DO NOTHING`
7. Écrire une ligne dans `scan_logs`

---

### Étape 3 : Le scan se termine tout seul

Jour après jour, les zones `pending` diminuent. Les zones `saturated` sont remplacées par des sous-zones plus fines qui finissent aussi par être `done`. Quand toute la table `scan_zones` est en `done` ou `saturated` (avec enfants `done`), la France est intégralement couverte.

---

### Étape 4 : Re-scan périodique (optionnel, plus tard)

Tous les 6 mois par exemple, remettre toutes les zones en `pending` pour capter les nouvelles agences. Le `ON CONFLICT (place_id) DO NOTHING` empêche les doublons : les agences existantes sont ignorées, seules les nouvelles sont ajoutées.

---

## 4. Garanties du système

### Zéro trou
La grille de 10km couvre toute la bounding box de la France. Chaque case est soit jetée (vide), soit subdivisée intégralement. Une subdivision d'un carré en sous-carrés remplit parfaitement le carré parent. Pas de place pour un trou.

### Zéro chevauchement
Chaque subdivision reste à l'intérieur de sa case parente de 10km. Les sous-rectangles de la case (3,7) ne débordent jamais sur la case (3,8). Les frontières sont les mêmes à tous les niveaux.

### Zéro requête dans l'océan
Les cases de 10km qui ne contiennent aucune commune INSEE sont jetées avant d'entrer dans la queue.

### Zéro requête en double
Chaque zone a un statut. Le cron ne prend que les `pending`. Une zone `done` n'est plus jamais touchée.

### Zéro doublon en base
`ON CONFLICT (place_id) DO NOTHING` sur la table `agencies`.

### Crash recovery
Si le cron plante en cours d'exécution, les zones en `processing` depuis plus de 10 minutes sont automatiquement remises en `pending` au prochain run.

---

## 5. Optimisation des coûts (API Places New, mars 2025+)

### Field Masks

On demande uniquement les champs nécessaires pour rester dans le tier de pricing le plus bas possible :
- `places.id`, `places.displayName`, `places.formattedAddress`, `places.location` → tier Pro
- `places.nationalPhoneNumber`, `places.websiteUri` → tier Pro aussi

Pas de champs Enterprise (photos, reviews, etc.) = pas de surcoût.

### Tier gratuit

Depuis mars 2025, le tier Pro offre 5 000 requêtes gratuites par mois. À raison de ~10-15 requêtes par jour, on reste dans le tier gratuit ou très proche pendant les premiers mois.

### Estimation de coût total

- ~15 000 à 20 000 requêtes pour couvrir toute la France
- Tier Pro Text Search : ~32$ pour 1 000 requêtes (après le tier gratuit)
- Coût estimé total : **300-500$** étalé sur plusieurs mois
- Avec le tier gratuit mensuel de 5 000 requêtes, le coût réel est significativement réduit

---

## 6. Stack technique

- **Orchestration** : n8n (cron quotidien) ou pg_cron Supabase
- **API** : Google Places API (New) — Text Search endpoint
- **Base de données** : Supabase (PostgreSQL)
- **Données INSEE** : fichier gratuit des communes françaises avec coordonnées et code densité
- **Script de génération** : TypeScript (one-shot, génère la queue initiale)
- **Dashboard** : page admin React dans Victoria