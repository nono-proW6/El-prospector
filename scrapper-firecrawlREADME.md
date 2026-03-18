# Scraper Firecrawl — Récupération données de prospection

## Objectif

Scraper les sites web des agences immobilières pour récupérer :
- **Annonces immobilières** réelles (biens en vente/location)
- **Emails** de contact
- **Numéros de téléphone**

Ces données alimentent le système de prospection (personnalisation des approches, qualification des leads).

---

## Logique en 4 étapes

### Étape 1 : Map du site (`/map`)

Pour chaque agence ayant un `website` dans la table `agencies` :

- Appel Firecrawl `/map` sur l'URL du site
- Résultat : liste complète de toutes les pages/URLs du site

**Coût** : 1 crédit Firecrawl par site.

---

### Étape 2 : Filtrage IA des pages pertinentes

On envoie la liste des URLs récupérées à une IA (Claude) avec un prompt du type :

> "Voici la liste des pages d'un site d'agence immobilière. Quelles pages contiennent probablement des annonces, des coordonnées de contact (email, téléphone), ou des informations utiles pour la prospection ? Retourne uniquement les URLs pertinentes."

**Pages typiquement pertinentes** :
- `/nos-biens`, `/annonces`, `/vente`, `/location` → annonces
- `/contact`, `/agence`, `/equipe`, `/a-propos` → emails, téléphones
- Page d'accueil → parfois emails/téléphones dans le footer

**Pages à ignorer** :
- `/mentions-legales`, `/politique-de-confidentialite`, `/cgu`
- `/blog/*`, `/actualites/*` (sauf si pertinent)
- Pages de pagination excessives (`?page=47`)

**Coût** : tokens IA uniquement (pas de crédit Firecrawl).

---

### Étape 3 : Scrape Firecrawl des pages retenues

Pour chaque URL retenue par l'IA :

- Appel Firecrawl `/scrape` sur la page
- Résultat : contenu de la page (markdown ou HTML structuré)

**Coût** : 1 crédit Firecrawl par page scrapée. C'est ici que le filtrage IA (étape 2) permet d'économiser en ne scrapant que les pages utiles au lieu de tout le site.

---

### Étape 4 : Extraction IA des données

On envoie le contenu scrapé de chaque page à une IA avec un prompt d'extraction :

> "Extrais les données suivantes de cette page : annonces (titre, prix, surface, type, localisation), emails, numéros de téléphone. Retourne un JSON structuré."

**Données extraites** :
- **Annonces** : titre, prix, surface, nb pièces, type (vente/location), localisation, description courte
- **Contact** : emails, téléphones, noms des agents si disponibles

**Coût** : tokens IA uniquement.

---

## Résumé des coûts par agence

| Étape | Outil | Coût |
|-------|-------|------|
| 1. Map | Firecrawl `/map` | 1 crédit |
| 2. Filtrage | IA (Claude) | ~tokens (faible) |
| 3. Scrape | Firecrawl `/scrape` | ~3-8 crédits (pages retenues) |
| 4. Extraction | IA (Claude) | ~tokens (modéré) |

**Total estimé par agence** : ~5-10 crédits Firecrawl + tokens IA.

---

## Pipeline

```
agencies (Supabase, avec website)
    │
    ▼
[Étape 1] Firecrawl /map → liste URLs
    │
    ▼
[Étape 2] IA filtre → URLs pertinentes
    │
    ▼
[Étape 3] Firecrawl /scrape → contenu pages
    │
    ▼
[Étape 4] IA extraction → JSON structuré
    │
    ▼
Stockage Supabase (annonces, contacts enrichis)
```

---

## Notes

- Ce scraper s'exécute **après** le scraper Google Maps (qui remplit la table `agencies`)
- Le filtrage IA (étape 2) est la clé pour minimiser les coûts Firecrawl
- On peut paralléliser les scrapes pour gagner du temps
- Prévoir un rate limit pour ne pas surcharger les sites ni l'API Firecrawl
