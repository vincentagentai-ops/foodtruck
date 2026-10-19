# Dossier technique — Food Trucks (v3.1.0)

## 1. Architecture

```
Navigateur ──HTTP──> Node.js (Express 4)
                       ├─ en-têtes de sécurité (CSP…), cookie anonyme ft_v, journal technique
                       ├─ fichiers statiques : public/ (HTML, CSS, JS sans framework)
                       ├─ API publique       : /api/config, /api/foodtrucks, /api/lieux, /api/suggestions, /api/evenements
                       ├─ espace protégé     : /admin/* (dossier admin/), /api/admin/*  (HTTP Basic)
                       ├─ données            : data/*.csv, data/*.jsonl, data/*.log, data/*.json
                       └─ maintenance horaire : sauvegarde quotidienne, agrégats, purge à 13 mois
                                └─ (option) SMTP : mail à chaque suggestion
```

- **Node.js ≥ 20.12** (testé en 24), **Express 4**, **nodemailer**, **Chart.js 4** (servi localement). Aucune nouvelle
  dépendance en 3.1.0 (cookies, HMAC, limites, sauvegardes : modules intégrés de Node).
- Une seule instance (les écritures sont sérialisées dans le processus, compteurs de limites en mémoire) ; pm2.

## 2. Arborescence

```
server.js               point d'entrée : config, initialisation (migration), écoute, maintenance
ecosystem.config.js     configuration pm2
.env.example            modèle de configuration (copier en .env)
src/
  config.js             variables d'environnement (.env), TRUST_PROXY, limites, sauvegardes
  app.js                application Express : sécurité, cookie, journaux, routes, authentification, erreurs
  csv.js                CSV RFC 4180 ; colonnes retrouvées par leur nom (anciens fichiers lus sans perte)
  validation.js         listes fermées (catégories, étiquettes, paiements), normalisation, contrôle des saisies
  migration.js          migration automatique 3.0.0 -> 3.1.0 avec copie de sauvegarde
  stockage.js           file d'attente des écritures, écriture atomique avec réessais, JSON, journaux JSONL, secret
  audience.js           cookie ft_v, HMAC, liste blanche d'évènements, exclusions, normalisation des chemins
  statistiques.js       journaux -> faits -> agrégats (jour, semaine, mois), stats-jours.json, purge
  sauvegarde.js         copie quotidienne de data/ et rotation
  maintenance.js        enchaînement quotidien (sauvegarde, rotation, agrégats, purge), relancé toutes les heures
  limites.js            limites de fréquence en mémoire (par IP et par navigateur)
public/                 pages publiques : index.html, confidentialite.html, 404.html, css/, js/, img/
admin/                  pages protégées (hors de public/) : index.html + admin.js, statistiques.html + statistiques.js
data/                   données d'exploitation (hors git)
sauvegardes/            copies quotidiennes (hors git ; BACKUP_DIR)
data-exemple/           jeu de données de référence au format 3.1.0
scripts/                livraison (sh) et scripts Windows (installation, mise à jour, démarrage)
test/                   tests node:test : unitaires, API, données (migration, agrégats, purge, sauvegarde)
docs/                   documentation
```

## 3. Fichiers de données

| Fichier | Format | Rôle | Conservation |
|---|---|---|---|
| `foodtrucks.csv` | CSV, en-tête `id,nom,type,cuisine,categorie,etiquettes,jours,lieu,horaires,prix,paiements,site,emplacement,statut,cree_le,maj_le,version` | Établissements | — |
| `lieux.csv` | CSV `id,nom,description,minutes_a_pied,maps` | Lieux | — |
| `foodtruckAValider.csv` | mêmes colonnes que le catalogue (l'ancien format sans en-tête reste lu) | Suggestions en attente | jusqu'au traitement |
| `usage-AAAA-MM.jsonl` | `{ts, v, type, cible, page, version[, nav]}` | Évènements d'audience (v = HMAC du cookie) | 13 mois |
| `acces-AAAA-MM.log` | `{timestamp, ip, url, method, status, durationMs, userAgent}` | Journal technique | 13 mois |
| `stats-jours.json` | `{version, jours, semaines, mois, maj}` | Agrégats des périodes terminées | sans limite |
| `secret-stats.json` | `{secret}` | Secret du HMAC si `STATS_SECRET` est vide | — |
| `usage.log`, `acces.log` | anciens journaux (avant 3.1.0) | Lus pour l'historique (« ancien calcul » par IP), plus écrits | lignes de plus de 13 mois purgées |

- **Écriture CSV / JSON** : fichier réécrit en entier dans un fichier temporaire puis renommé ; sous Windows, le
  renommage est réessayé (50 à 800 ms, 5 fois) si le fichier est verrouillé (`EPERM`, `EBUSY`, `EACCES`).
- **Lecture CSV** : les colonnes sont retrouvées par leur nom (casse et accents ignorés) ; une colonne absente est lue
  vide ; un fichier sans en-tête est lu avec les colonnes de la 3.0.0.
- Les CSV sont relus à chaque requête (pas de cache) : une modification à la main est prise en compte immédiatement.

### Migration (au démarrage)

`migration.js` : si `foodtrucks.csv` n'a pas toutes les colonnes, ou si une ligne n'a pas d'`id`, de `statut`, de
`version`, de `categorie` ou de `type` : copie en `foodtrucks-avant-migration-AAAAMMJJ-HHMMSS.csv`, puis réécriture
avec un identifiant (6 caractères aléatoires) pour chaque ligne qui n'en a pas, type `foodtruck`, catégorie déduite du
libellé (motifs, « Autre » sinon), statut `actif`, version 1, `cree_le` vide (date inconnue : pas de badge
« Nouveau »). Aucune ligne n'est fusionnée ni supprimée ; un identifiant dupliqué (copier-coller) est remplacé sur la
deuxième ligne. Même principe pour `foodtruckAValider.csv` (réécrit au nouveau format) ; `lieux.csv` est créé vide.

## 4. Mesure d'audience et statistiques

- **Cookie** `ft_v` : 16 octets aléatoires (base64url), posé sur la première réponse non statique si absent ou
  invalide : `Max-Age` 395 jours, `Path=/`, `HttpOnly`, `SameSite=Lax` (pas `Secure` : site en HTTP). Jamais prolongé.
- **Empreinte** : `v = HMAC-SHA256(secret, cookie)` tronqué à 32 caractères hexadécimaux. Les journaux d'audience ne
  contiennent ni le cookie ni l'IP ; le journal technique contient l'IP mais pas l'empreinte.
- **Pages vues** : écrites par le serveur (`page_vue`) pour un GET de `/index.html` ou `/confidentialite.html` (après
  normalisation : décodage, minuscules, `/` → `/index.html`), statut 2xx ou 304, navigateur non robot (liste de
  motifs : bot, curl, python, agent vide…).
- **Évènements des pages** : `POST /api/evenements {type, cible, page}` ; types en liste blanche (`audience.js`,
  `TYPES_PUBLICS`) ; types réservés au serveur → 403, inconnus → 400 ; corps ≤ 2 ko (413 au-delà) ; cible tronquée
  à 80 caractères. `POST /api/log` (anciennes pages en cache) : libellés convertis en évènements typés ; ceux
  commençant par « Admin » ou « Ajout de » → 403.
- **Faits** : chaque ligne de journal (nouveau ou ancien) est ramenée à `{date, heure, source: navigateur|ip, id,
  type, cible, page, nav}`. Les anciens journaux donnent la source `ip`.
- **Agrégat d'un jour** : `pagesVues`, `pages`, `actifs` (empreintes distinctes, hors actions admin), `actifsIp`
  (ancien calcul), `nouveaux` (première apparition de l'empreinte ce jour-là), `heures` (actifs distincts par heure),
  `navigateurs` (familles, actifs distincts), `evenements` (par type), `joursConsultes` (`jour_clic`),
  `consultations` (`{id: {site, maps, autres}}`, `nom:<nom>` pour l'ancien calcul), `technique` (requêtes, erreurs,
  durée totale). **Semaine** (ISO) et **mois** : `actifs`, `actifsIp`, `nouveaux`, `recurrents`.
- **Enregistrement** : `stats-jours.json` reçoit les périodes **terminées** (jour < aujourd'hui, semaine / mois dont
  le dernier jour est passé), une seule fois ; elles ne sont jamais recalculées. Les périodes en cours sont calculées
  à la volée. La réponse de `/api/admin/statistiques` fusionne les deux : le résultat est identique au calcul brut,
  avant comme après la purge (test « Agrégats enregistrés = calcul brut »).
- **Purge** (`Statistiques.purger`) : limite = aujourd'hui − 13 mois. Fichiers mensuels dont le mois est antérieur au
  mois de la limite : supprimés ; anciens fichiers uniques : réécrits sans les lignes antérieures à la limite (les
  lignes non datées sont gardées). Préalable obligatoire : agrégats mis à jour, **relus depuis le disque**, et présents
  pour chaque jour (et sa semaine / son mois) concerné ; sinon rien n'est supprimé et la raison est journalisée.
  Avant la première purge, les fichiers touchés sont copiés dans `<sauvegardes>/journaux-avant-premiere-purge/`.
- Rupture de série : `periode.debutNavigateurs` (premier jour avec des navigateurs actifs) permet à la page de la
  signaler.

## 5. API

### Publique

| Méthode | URL | Corps / réponse |
|---|---|---|
| GET | `/api/config` | `{titre, environnement, contactEmail, version, jours, types, categories, etiquettes, paiements}` |
| GET | `/api/foodtrucks` | établissements non archivés (toutes les colonnes) |
| GET | `/api/lieux` | lieux |
| POST | `/api/suggestions` (alias `/api/suggest-foodtruck`) | établissement → `201 {message}`, `400 {error, details[]}`, `429` |
| POST | `/api/evenements` | `{type, cible?, page?}` → `204`, `400`, `403`, `413`, `429` |
| POST | `/api/log` | `{event}` (ancien) → `204`, `400`, `403`, `429` |
| GET | `/data/foodtrucks.csv` | CSV des établissements non archivés (compatibilité) |

### Administrateur (en-tête `Authorization: Basic …`)

| Méthode | URL | Corps |
|---|---|---|
| GET | `/api/admin/suggestions` | — |
| POST | `/api/admin/suggestions/:index/valider` | `{original, foodtruck}` → `{message, foodtruck}` (avec id) |
| DELETE | `/api/admin/suggestions/:index` | `{original}` |
| GET | `/api/admin/foodtrucks` | tous les établissements (archivés compris) |
| POST | `/api/admin/foodtrucks` | établissement → `201 {message, foodtruck}` |
| PUT | `/api/admin/foodtrucks/:id` | `{version, foodtruck}` → `200`, `404`, `409` (version différente) |
| DELETE | `/api/admin/foodtrucks/:id` | `{version}` |
| GET | `/api/admin/export/foodtrucks.csv`, `/api/admin/export/lieux.csv` | téléchargement |
| GET / POST | `/api/admin/lieux` | liste (avec `utilisations`) / ajout `{nom, description, minutes_a_pied, maps}` |
| PUT / DELETE | `/api/admin/lieux/:id` | modification / suppression (`409` si le lieu est utilisé) |
| GET | `/api/admin/statistiques?debut=AAAA-MM-JJ&fin=AAAA-MM-JJ` | `{periode, totaux, jours[], semaines[], mois[], pages, heures, navigateurs, evenements, joursConsultes, consultations, technique, noms}` — aucun identifiant de navigateur |

Codes : `400` données invalides (avec `details`), `401` authentification, `403` évènement réservé, `404`, `409`
conflit, `413` corps trop gros, `429` limite de fréquence (`Retry-After`), `503` admin désactivé, `500` erreur interne
(détail dans les logs pm2).

Anciennes adresses redirigées : `/administration.html`, `/generationCSV.html`, `/ajouterFoodtruck.html` → `/admin/` ;
`/statistiques.html` → `/admin/statistiques.html` ; `/data/Foodtruck_logo.PNG` → `/img/logo.png`.

## 6. Configuration (`.env`)

Voir `.env.example` (commenté). Variables : `PORT`, `APP_ENV`, `SITE_TITLE`, `DATA_DIR`, `ADMIN_USER`,
`ADMIN_PASSWORD`, `CONTACT_EMAIL`, `SMTP_*`, `MAIL_FROM`, `MAIL_TO`, `TRUST_PROXY`, `ACCESS_LOG`, `BACKUP_DIR`,
`BACKUP_DAYS`, `STATS_SECRET`, `LIMITE_SUGGESTIONS`, `LIMITE_EVENEMENTS`, `LIMITE_FACTEUR_IP`.
Les variables déjà définies dans l'environnement priment sur le `.env`.

## 7. Sécurité

- **Administration** : HTTP Basic, comparaison à temps constant ; sans `ADMIN_PASSWORD`, l'admin est désactivé. Les
  pages sont dans `admin/`, servies **uniquement** par la route protégée `/admin` : aucune variante d'adresse
  (`/%61dmin/`, `/ADMIN/`, `//admin/`, `/admin%2F…`) ne les atteint par le statique public ; en plus, toute adresse qui se normalise en `/admin…` sans passer par la
  route protégée reçoit un 404 avant le statique public (même si un ancien `public/admin` restait sur le serveur).
  Tests dédiés. Le mot de
  passe circule en clair sur HTTP : acceptable sur le réseau interne (HTTPS hors périmètre).
- **En-têtes** : `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'
  data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'`,
  `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin`. Aucune balise `style`,
  attribut `style=` ou script en ligne dans les pages (test dédié).
- **Saisies** : validation serveur, listes fermées, longueurs maximales, refus de `= + - @` en tête des textes libres
  (injection de formules Excel) ; échappement HTML de toutes les données affichées ; liens limités à `http(s):`.
- **Écritures publiques** : JSON obligatoire (preflight CORS pour une autre origine), corps ≤ 20 ko (2 ko pour les
  évènements), limites de fréquence par navigateur et par IP (fenêtre d'une heure, en mémoire).
- **TRUST_PROXY** : `loopback`, IP ou liste → seuls ces proxys sont crus pour `X-Forwarded-For` ; `true` accepté
  avec avertissement au démarrage ; valeur invalide ignorée avec avertissement.
- `data/` n'est pas servi ; `x-powered-by` désactivé.

## 8. Tests

`npm test` (node:test, aucune dépendance) : 42 tests.

- `test/unitaires.test.js` : CSV (virgules, guillemets, BOM, colonnes par nom, anciens formats), validation (nouveaux
  champs, listes fermées, lieu ou Maps, formules), catégories, TRUST_PROXY, limites de fréquence, réessais du
  renommage (simulés), normalisation et exclusions d'audience, liste blanche d'évènements, identifiant et HMAC.
- `test/api.test.js` : migration au démarrage, en-têtes de sécurité et absence de styles / scripts en ligne, `data/`
  non exposé, **pages admin inaccessibles sous 23 variantes d'adresse**, cookie posé une fois (attributs, jamais dans
  les journaux), évènements refusés (inconnus, réservés, trop gros), `/api/log`, suggestion → publication (id, compte
  serveur), rejet / conflit, lieux, ajout / modification / suppression par id avec 409, archivage, statistiques
  (exclusions, aucun identifiant dans la réponse), limites (429), TRUST_PROXY réel.
- `test/donnees.test.js` : migration aller-retour d'un CSV 3.0.0 (aucune perte, copie, ids stables après modification
  et redémarrage, ligne ajoutée à la main), agrégats (actifs, nouveaux / récurrents, ancien calcul par IP, exclusions),
  **agrégats = calcul brut avant et après purge**, **purge qui ne supprime rien sans agrégats** (écriture impossible,
  relecture impossible, agrégats incomplets) puis purge normale avec copie préalable, limite des 13 mois, sauvegarde
  quotidienne, restauration et rotation, maintenance complète.

Les pages ont été vérifiées dans un navigateur (poste de travail) sur un dossier de données temporaire.

## 9. Exploitation

- Logs applicatifs : `pm2 logs foodtruck` (démarrage, migration, sauvegarde du jour, purge, erreurs).
- Maintenance automatique : au démarrage puis toutes les heures (sauvegarde du jour si absente, rotation 30 jours,
  agrégats, purge à 13 mois).
- Mise à jour : zip autonome + `scripts\mettre-a-jour.bat` (voir `docs/DEPLOIEMENT.md`).
- Seuils où une base SQLite deviendrait pertinente : voir `AUDIT_ET_PROPOSITIONS.md` §7.2 (très loin à ce jour).
