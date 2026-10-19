# Dossier technique — Food Trucks (v3.0.0)

## 1. Architecture

```
Navigateur ──HTTP──> Node.js (Express 4)
                       ├─ fichiers statiques : public/ (HTML, CSS, JS sans framework)
                       ├─ API publique       : /api/config, /api/foodtrucks, /api/suggestions, /api/log
                       ├─ espace protégé     : /admin/*, /api/admin/*  (HTTP Basic)
                       └─ données            : data/*.csv, data/*.log
                                └─ (option) SMTP : mail à chaque suggestion
```

- **Node.js ≥ 20.12** (testé en 24), **Express 4**, **nodemailer**, **Chart.js 4** (servi localement).
- Une seule instance (les écritures sont sérialisées dans le processus) ; pm2 pour l'exécution en service.

## 2. Arborescence

```
server.js               point d'entrée (lit la config, initialise les données, écoute le port)
ecosystem.config.js     configuration pm2
.env.example            modèle de configuration (copier en .env)
src/
  config.js             lecture des variables d'environnement (.env chargé par process.loadEnvFile)
  app.js                application Express : routes, authentification, journal d'accès, erreurs
  csv.js                lecture/écriture CSV RFC 4180 (guillemets, \r\n, BOM, lignes vides)
  validation.js         normalisation (jours, prix) et contrôle des foodtrucks
  stockage.js           accès fichiers : file d'attente des écritures, écriture atomique, journaux JSONL
  statistiques.js       calcul des statistiques d'usage et d'accès, filtre par dates
public/
  index.html, 404.html  pages publiques
  css/styles.css        style commun
  js/commun.js          échappement HTML, appels API, journalisation, notifications, bandeau test
  js/accueil.js         page d'accueil
  img/logo.png
  admin/                pages protégées : index.html + admin.js, statistiques.html + statistiques.js
data/                   données d'exploitation (créé au démarrage, hors git)
data-exemple/           jeu de données de référence (copie des CSV d'origine)
scripts/                scripts Windows (installation, mise à jour, démarrage)
test/                   tests node:test (unitaires + API)
docs/                   documentation
```

## 3. Fichiers de données

| Fichier | Format | Rôle |
|---|---|---|
| `foodtrucks.csv` | CSV avec en-tête `Nom,Cuisine,Jours,Emplacement,Prix,Site` | Foodtrucks publiés |
| `foodtruckAValider.csv` | idem (l'ancien format sans en-tête est accepté en lecture) | Suggestions en attente |
| `usage.log` | 1 objet JSON par ligne `{timestamp, ip, event}` | Évènements d'usage envoyés par les pages |
| `acces.log` | 1 objet JSON par ligne `{timestamp, ip, url, method, status, durationMs, userAgent}` | Journal des requêtes (pages et API, pas les images/CSS/JS) |

- Écriture CSV : le fichier est **réécrit en entier** dans un fichier temporaire puis renommé (pas de fichier à
  moitié écrit, saut de ligne final unique). Les valeurs contenant `,` `"` ou un saut de ligne sont entre guillemets.
- Les fichiers CSV peuvent être modifiés à la main **serveur arrêté ou sans action admin simultanée** ; ils sont relus
  à chaque requête (pas de cache).
- Évènements d'usage reconnus : `Jour sélectionné : <jour>`, `Tri sur la colonne : <colonne>`,
  `Consultation : <nom>`, `Clic sur l'envoi de mail`, `Clic sur suggérer foodtruck`,
  `Clic sur envoyer foodtruck : succès|erreur`, et côté serveur `Ajout de : …`, `Admin clic sur Valider|Supprimer
  foodtruck : …`, `Admin modification foodtruck : …`, `Admin suppression foodtruck publié : …`. Les anciens libellés
  (`Clic sur generer CSV`, `Clic sur la page …`) restent comptés.

## 4. API

### Publique

| Méthode | URL | Corps / réponse |
|---|---|---|
| GET | `/api/config` | `{titre, environnement, contactEmail, jours, version}` |
| GET | `/api/foodtrucks` | `[{nom, cuisine, jours, emplacement, prix, site}]` |
| POST | `/api/suggestions` (alias `/api/suggest-foodtruck`) | foodtruck → `201 {message}` ou `400 {error, details[]}` |
| POST | `/api/log` | `{event}` (300 caractères max) → `204` |
| GET | `/data/foodtrucks.csv` | CSV publié (compatibilité) |

### Administrateur (en-tête `Authorization: Basic …`)

| Méthode | URL | Corps |
|---|---|---|
| GET | `/api/admin/suggestions` | — |
| POST | `/api/admin/suggestions/:index/valider` | `{original, foodtruck}` |
| DELETE | `/api/admin/suggestions/:index` | `{original}` |
| GET | `/api/admin/foodtrucks` | — |
| POST | `/api/admin/foodtrucks` | foodtruck |
| PUT | `/api/admin/foodtrucks/:index` | `{original, foodtruck}` |
| DELETE | `/api/admin/foodtrucks/:index` | `{original}` |
| GET | `/api/admin/export/foodtrucks.csv` | téléchargement |
| GET | `/api/admin/statistiques?debut=AAAA-MM-JJ&fin=AAAA-MM-JJ` | `{periode, usage, acces}` |

`original` = la ligne telle qu'affichée : le serveur vérifie qu'elle est toujours à `index` (sinon la recherche
ailleurs dans le fichier, sinon `409`). Les foodtrucks n'ont pas d'identifiant pour garder un CSV simple.

Codes : `400` données invalides (avec `details`), `401` authentification, `404`, `409` conflit, `503` admin désactivé
(`ADMIN_PASSWORD` vide), `500` erreur interne (détail dans la console / logs pm2).

Anciennes adresses redirigées : `/administration.html`, `/generationCSV.html`, `/ajouterFoodtruck.html` → `/admin/` ;
`/statistiques.html` → `/admin/statistiques.html` ; `/data/Foodtruck_logo.PNG` → `/img/logo.png`.

## 5. Configuration (`.env`)

Voir `.env.example` (commenté). Principales variables : `PORT`, `APP_ENV` (`test` = bandeau), `DATA_DIR`,
`ADMIN_USER`, `ADMIN_PASSWORD`, `CONTACT_EMAIL`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`,
`SMTP_PASSWORD`, `SMTP_IGNORE_TLS_ERRORS`, `MAIL_FROM`, `MAIL_TO`, `TRUST_PROXY`, `ACCESS_LOG`.
Les variables déjà définies dans l'environnement priment sur le `.env`.

## 6. Sécurité

- Espace admin en HTTP Basic, comparaison à temps constant ; sans `ADMIN_PASSWORD`, l'admin est désactivé.
  Le mot de passe circule en clair sur HTTP : acceptable sur le réseau interne, sinon placer un proxy HTTPS devant.
- Échappement HTML de toutes les données affichées, liens limités à `http(s):`.
- Validation serveur de toutes les saisies ; corps JSON limité à 20 ko ; refus des valeurs commençant par `= + - @`
  (injection de formules si le CSV est ouvert dans Excel).
- `data/` n'est pas servi ; `x-powered-by` désactivé.
- `TRUST_PROXY=true` seulement derrière un proxy de confiance (sinon l'en-tête `X-Forwarded-For` est ignoré).

## 7. Tests

`npm test` (node:test, aucune dépendance) : 21 tests — CSV (virgules, guillemets, BOM, lignes vides), validation,
statistiques, et parcours API complet sur un dossier temporaire (suggestion → validation corrigée → publication,
rejet, conflit 409, ajout/modification/suppression admin, authentification, dossier data non exposé, journal corrompu,
JSON invalide). Les pages ont été vérifiées manuellement dans le navigateur (bureau et téléphone).

## 8. Exploitation

- Logs applicatifs : sortie console (`pm2 logs foodtruck`).
- `acces.log` grossit d'environ 1 à 2 Mo par an au rythme actuel : l'archiver si besoin (voir guide administrateur).
- Sauvegarde : copier le dossier `data/` (ou télécharger le CSV depuis l'admin).
