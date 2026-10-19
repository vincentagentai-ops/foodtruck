# Dossier technique — Food Trucks (v3.2.0)

## 1. Architecture

```
Navigateur ──HTTP──> Node.js (Express 4)
                       ├─ en-têtes de sécurité (CSP…), contrôle Origin + JSON sur les écritures, cookie ft_v, journal technique
                       ├─ fichiers statiques : public/ (HTML, CSS, JS sans framework)
                       ├─ API publique       : lecture (/api/etablissements, /api/quoi-de-neuf…) et contributions
                       │                       (ajout, modification, restauration, avis, présence, signalements)
                       ├─ espace protégé     : /admin/* (dossier admin/), /api/admin/*  (HTTP Basic)
                       ├─ données            : catalogue CSV, contributions JSONL (état reconstruit en mémoire), journaux
                       └─ maintenance horaire : sauvegarde quotidienne, agrégats, purge à 13 mois, seuils d'archivage
                                └─ (option) SMTP : mail à chaque ajout d'établissement
```

- **Node.js ≥ 20.12** (testé en 24), **Express 4**, **nodemailer**, **Chart.js 4** (servi localement). Aucune nouvelle
  dépendance en 3.1.0 ni en 3.2.0 (cookies, HMAC, limites, sauvegardes, distance d'édition : JavaScript pur / modules
  intégrés de Node).
- Une seule instance (les écritures sont sérialisées dans le processus, compteurs de limites en mémoire) ; pm2.

## 2. Arborescence

```
server.js               point d'entrée : config, initialisation (migration), écoute, maintenance
ecosystem.config.js     configuration pm2
.env.example            modèle de configuration (copier en .env)
src/
  config.js             variables d'environnement (.env), TRUST_PROXY, limites, sauvegardes
  app.js                application Express : sécurité (Origin, JSON), cookie, journaux, routes, authentification, erreurs
  identite.js           jeton d'auteur des contributions (HMAC, clé distincte de l'audience), nom déclaré
  etablissements.js     catalogue collaboratif : création, modification versionnée (409 + différences), délai de grâce,
                        historique.jsonl, restauration, doublons (normalisation, distance d'édition), fusion
  contributions.js      avis, présences, signalements, état reconstruit depuis les JSONL, seuils (masquage, incertain,
                        archive), « Quoi de neuf », « À surveiller », blocages, purge des présences à 13 mois
  csv.js                CSV RFC 4180 ; colonnes retrouvées par leur nom (anciens fichiers lus sans perte)
  validation.js         listes fermées (catégories, étiquettes, paiements), normalisation, contrôle des saisies
  migration.js          migration automatique 3.0.0 -> 3.1.0 -> 3.2.0 avec copie de sauvegarde
  stockage.js           file d'attente des écritures, écriture atomique avec réessais, JSON, cache des JSONL, secret
  audience.js           cookie ft_v, HMAC, liste blanche d'évènements, exclusions, normalisation des chemins
  statistiques.js       journaux -> faits -> agrégats (jour, semaine, mois), stats-jours.json, purge
  sauvegarde.js         copie quotidienne de data/ et rotation
  maintenance.js        enchaînement quotidien (sauvegarde, rotation, agrégats, purges, seuils), relancé toutes les heures
  limites.js            limites de fréquence en mémoire (par IP et par navigateur)
public/                 pages publiques : index.html, confidentialite.html, 404.html, css/, img/,
                        js/commun.js, js/accueil.js (liste), js/fiche.js (fiche), js/formulaires.js (ajout / modification)
admin/                  pages protégées (hors de public/) : index.html + admin.js + surveillance.js (« À surveiller »),
                        statistiques.html + statistiques.js
data/                   données d'exploitation (hors git)
sauvegardes/            copies quotidiennes (hors git ; BACKUP_DIR)
data-exemple/           jeu de données de référence au format 3.1.0
scripts/                livraison (sh) et scripts Windows (installation, mise à jour, démarrage)
test/                   tests node:test : unitaires, API, données (migration, agrégats, purge, sauvegarde), collaboration
docs/                   documentation
```

## 3. Fichiers de données

| Fichier | Format | Rôle | Conservation |
|---|---|---|---|
| `foodtrucks.csv` | CSV, en-tête `id,nom,type,cuisine,categorie,etiquettes,jours,lieu,horaires,prix,paiements,site,emplacement,statut,cree_le,maj_le,version,lieux_jours` | Établissements | — |
| `lieux.csv` | CSV `id,nom,description,minutes_a_pied,maps` | Lieux | — |
| `historique.jsonl` | `{ts, cible, version, auteur, pseudo, action, avant, apres[, raison, vers, absorbe]}` | Versions des fiches (copies complètes) | tant que la fiche existe |
| `avis.jsonl` | `{ts, id, cible, auteur, pseudo, note, texte, criteres, plat, action}` | Avis | tant qu'ils sont publiés (purge par l'admin) |
| `presences.jsonl` | `{ts, date, cible, auteur, etat}` | Présence du jour | 13 mois (totaux dans `stats-presences.json`, sans limite) |
| `signalements.jsonl` | `{ts, id, cible, type, date?, texte?, avis?, auteur, action}` | Signalements et clôtures | — |
| `config-moderation.json` | `{seuils, blocages}` | Seuils et blocages | — |
| `foodtruckAValider.csv` | mêmes colonnes que le catalogue (l'ancien format sans en-tête reste lu) | Suggestions héritées (avant 3.2.0) | jusqu'au traitement |
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
- **JSONL des contributions** : ajout en fin de fichier dans la file d'attente (`ajouterLigne` / `ajouterEvenement`),
  jamais de réécriture sauf purge par l'administrateur ou purge à 13 mois (réécriture atomique). Les lignes sont
  gardées en mémoire (`lireLignes`) et relues si la date de modification ou la taille du fichier change (édition à la
  main, restauration d'une sauvegarde). L'état courant (avis par fiche, présences du jour, signalements ouverts,
  alias de fusion) est recalculé depuis ces lignes quand l'une d'elles change (`Contributions.etat`).
- **Opérations en série** : création, modification (contrôle de version), un avis par navigateur, fusion… sont
  vérifiées et écrites dans la même tâche de la file d'attente : deux requêtes simultanées ne peuvent pas créer deux
  avis du même navigateur ni écraser une modification (test « Écritures simultanées »).

### Migration (au démarrage)

`migration.js` : si `foodtrucks.csv` n'a pas toutes les colonnes, ou si une ligne n'a pas d'`id`, de `statut`, de
`version`, de `categorie` ou de `type` : copie en `foodtrucks-avant-migration-AAAAMMJJ-HHMMSS.csv`, puis réécriture
avec un identifiant (6 caractères aléatoires) pour chaque ligne qui n'en a pas, type `foodtruck`, catégorie déduite du
libellé (motifs, « Autre » sinon), statut `actif`, version 1, `cree_le` vide (date inconnue : pas de badge
« Nouveau »). Aucune ligne n'est fusionnée ni supprimée ; un identifiant dupliqué (copier-coller) est remplacé sur la
deuxième ligne. Même principe pour `foodtruckAValider.csv` (réécrit au nouveau format) ; `lieux.csv` est créé vide.
En 3.2.0, l'ajout de la colonne `lieux_jours` déclenche la même migration (copie puis réécriture, colonne vide).
Les fichiers JSONL des contributions sont créés à la première contribution.

## 4 bis. Collaboration

- **Identité** : `auteur = HMAC-SHA256(cléAuteur, cookie ft_v)` tronqué à 24 caractères, avec
  `cléAuteur = HMAC-SHA256(secret, "food-trucks:auteur-contributions:v1")`. L'empreinte d'audience (`v`) utilise le
  secret directement : les deux ne se recoupent pas, et l'on ne retrouve pas le cookie depuis l'un ou l'autre. Une
  contribution exige un cookie **déjà présent** dans la requête (sinon chaque requête serait un nouvel auteur). Le
  nom déclaré (`pseudo`, ≤ 30 car.) est libre. Les évènements statistiques des contributions sont écrits avec
  `v: null`.
- **Doublons** : nom normalisé (accents, ponctuation, mots vides retirés), Levenshtein ≤ 2 ou inclusion (noms de
  4 caractères ou plus ; égalité en dessous), ou même lien Maps ; fiches archivées ignorées.
- **Versions** : chaque changement incrémente `version` et ajoute une entrée d'historique avec la fiche complète avant
  et après. 409 : `{error, actuelle, differences: [{champ, libelle, base, actuelle, vous}]}` (différences entre la
  version attendue, retrouvée dans l'historique, et la version actuelle).
- **Délai de grâce** : l'entrée `creer` de l'historique donne l'auteur et l'heure ; pendant `delaiGraceMinutes`, les
  autres auteurs reçoivent 403. Ajouts de l'administrateur : pas de délai.
- **Fusion** : la fiche absorbée est retirée du CSV ; une entrée `{cible: absorbée, action: fusion, vers: conservée}`
  sert d'**alias** : avis, présences et signalements de l'ancien identifiant sont rattachés à la fiche conservée au
  calcul de l'état (aucune réécriture des JSONL). `GET /api/etablissements` renvoie `alias` (favoris des navigateurs).
- **Seuils** (`Contributions.appliquerSeuils`), après chaque présence / signalement, au réglage des seuils et dans la
  maintenance horaire : voir SPECIFICATIONS §4 « Effets automatiques ». Les changements sont historisés
  (`statut_auto`, auteur `systeme`).
- **Signalements sans objet** (calculés, sans écriture) : « plus présent » antérieur à une confirmation, « info erronée »
  antérieure à une modification, fermeture passée, avis supprimé.
- **Purge des présences** : comme les journaux (§4) : totaux par jour et par fiche écrits dans `stats-presences.json`,
  relus, puis seulement réécriture de `presences.jsonl` sans les lignes de plus de 13 mois.

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
| GET | `/api/config` | `{titre, environnement, contactEmail, version, jours, types, categories, etiquettes, paiements, criteres, signalements, champs, delaiGraceMinutes, avisMinimum}` |
| GET | `/api/foodtrucks` | établissements non archivés (toutes les colonnes ; compatibilité) |
| GET | `/api/etablissements` | `{date, etablissements: [fiche + resume], alias}` ; `resume` = `{nbAvis, note, presence: {presents, absents, derniere, monEtat}, fermetures[], plusPresent, erreurs[]}` |
| GET | `/api/etablissements/:id` | `{etablissement, resume, avis[] (sans auteur, avec mien), monAvis, grace}` ; 404 si archivé |
| GET | `/api/etablissements/:id/historique` | `{version, entrees: [{ts, version, action, pseudo, raison, parAdmin, automatique, ancienneFiche, champs[], restaurable, versionAvant}]}` |
| GET | `/api/doublons?nom=&lieu=&emplacement=&sauf=` | `[{id, nom, categorie, jours, lieu, raisons[]}]` |
| GET | `/api/quoi-de-neuf` | 30 derniers `{ts, type: ajout|modification|restauration|avis|fermeture, cible, nom, pseudo, detail?, note?, date?}` |
| GET | `/api/lieux` | lieux |
| POST | `/api/etablissements` | champs de la fiche + `pseudo` → `201 {message, etablissement, doublons}` |
| PUT | `/api/etablissements/:id` | `{version, etablissement, pseudo}` → `200`, `403` (délai de grâce), `409 {actuelle, differences}` |
| DELETE | `/api/etablissements/:id` | `{version}` → archivage par l'auteur pendant le délai de grâce (`403` sinon) |
| POST | `/api/etablissements/:id/restaurer/:version` | `{versionActuelle, pseudo}` → `200`, `404`, `409` |
| POST / DELETE | `/api/etablissements/:id/avis` | `{note, texte, criteres, plat, pseudo}` → `201` (créé) / `200` (modifié) ; DELETE : son propre avis (`404` sinon) |
| POST | `/api/etablissements/:id/presence` | `{etat: present|absent|aucun}` → `{message, resume}` |
| POST | `/api/signalements` | `{cible, type, date?, texte?, avis?}` → `201`, `200` (déjà signalé par ce navigateur) |
| POST | `/api/suggestions`, `/api/suggest-foodtruck` | `308` vers `/api/etablissements` (anciennes pages) |
| POST | `/api/evenements` | `{type, cible?, page?}` → `204`, `400`, `403`, `413`, `429` |
| POST | `/api/log` | `{event}` (ancien) → `204`, `400`, `403`, `429` |
| GET | `/data/foodtrucks.csv` | CSV des établissements non archivés (compatibilité) |

### Administrateur (en-tête `Authorization: Basic …`)

| Méthode | URL | Corps |
|---|---|---|
| GET | `/api/admin/surveillance` | `{signalements, masques, modifications, seuils, blocages, heritees, horsLigne}` |
| POST | `/api/admin/signalements/traiter` | `{ids[], decision}` |
| POST | `/api/admin/avis/:id/masquer`, `/api/admin/avis/:id/retablir` | — |
| DELETE | `/api/admin/avis/:id` | purge définitive (avis et signalements qui le visent) |
| POST | `/api/admin/etablissements/:id/restaurer/:version` | `{versionActuelle}` (statut restauré aussi) |
| POST | `/api/admin/fusion` | `{garder, absorber}` |
| POST | `/api/admin/blocages` | `{auteur, jours}` (0 = débloquer) |
| PUT | `/api/admin/moderation` | `{seuils}` → `400` si hors bornes |
| GET | `/api/admin/export/avis.csv` | avis (textes neutralisés) |
| GET | `/api/admin/suggestions` | suggestions héritées |
| POST | `/api/admin/suggestions/:index/valider` | `{original, foodtruck}` → `{message, foodtruck}` (avec id) |
| DELETE | `/api/admin/suggestions/:index` | `{original}` |
| GET | `/api/admin/foodtrucks` | tous les établissements (archivés compris) |
| POST | `/api/admin/foodtrucks` | établissement → `201 {message, foodtruck}` |
| PUT | `/api/admin/foodtrucks/:id` | `{version, foodtruck}` → `200`, `404`, `409` (version différente) |
| DELETE | `/api/admin/foodtrucks/:id` | `{version}` → suppression définitive de la fiche et de ses contributions |
| GET | `/api/admin/export/foodtrucks.csv`, `/api/admin/export/lieux.csv` | téléchargement |
| GET / POST | `/api/admin/lieux` | liste (avec `utilisations`) / ajout `{nom, description, minutes_a_pied, maps}` |
| PUT / DELETE | `/api/admin/lieux/:id` | modification / suppression (`409` si le lieu est utilisé) |
| GET | `/api/admin/statistiques?debut=AAAA-MM-JJ&fin=AAAA-MM-JJ` | `{periode, totaux, jours[], semaines[], mois[], pages, heures, navigateurs, evenements, joursConsultes, consultations, technique, noms}` — aucun identifiant de navigateur |

Codes : `400` données invalides (avec `details`) ou cookie absent, `401` authentification, `403` évènement réservé,
autre origine, navigateur bloqué ou délai de grâce, `404`, `409` conflit, `413` corps trop gros, `415` corps non JSON,
`429` limite de fréquence (`Retry-After`), `503` admin désactivé, `500` erreur interne (détail dans les logs pm2).

Anciennes adresses redirigées : `/administration.html`, `/generationCSV.html`, `/ajouterFoodtruck.html` → `/admin/` ;
`/statistiques.html` → `/admin/statistiques.html` ; `/data/Foodtruck_logo.PNG` → `/img/logo.png`.

## 6. Configuration (`.env`)

Voir `.env.example` (commenté). Variables : `PORT`, `APP_ENV`, `SITE_TITLE`, `DATA_DIR`, `ADMIN_USER`,
`ADMIN_PASSWORD`, `CONTACT_EMAIL`, `SMTP_*`, `MAIL_FROM`, `MAIL_TO`, `TRUST_PROXY`, `ACCESS_LOG`, `BACKUP_DIR`,
`BACKUP_DAYS`, `STATS_SECRET`, `LIMITE_CONTRIBUTIONS`, `LIMITE_EVENEMENTS`, `LIMITE_FACTEUR_IP`, `HOTES_AUTORISES`.
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
- **Saisies** : validation serveur, listes fermées, longueurs maximales, refus de `= + - @` en tête du nom, de la
  cuisine et des horaires ; textes des avis et signalements en texte brut sur une ligne (caractères de contrôle
  retirés) ; échappement HTML de toutes les données affichées (`Commun.html`, jamais de HTML interprété) ; liens
  limités à `http(s):`. **Exports CSV** (établissements, lieux, avis, `/data/foodtrucks.csv`) : toute valeur
  commençant par `= + - @`, tabulation ou retour chariot est préfixée d'une apostrophe.
- **Écritures** (POST / PUT / PATCH / DELETE, publiques et admin) : `Content-Type: application/json` obligatoire
  (`415` sinon : un formulaire HTML d'un autre site ne passe pas) ; en-tête `Origin`, s'il est présent, égal à l'hôte
  demandé ou à l'un des `HOTES_AUTORISES` (`403` sinon ; `Origin: null` refusé). Corps ≤ 20 ko (2 ko pour les
  évènements), limites de fréquence par navigateur et par IP (fenêtre d'une heure, en mémoire) : contributions 60,
  évènements 600 (× 5 par IP). Navigateurs bloqués par l'administrateur : `403`.
- **TRUST_PROXY** : `loopback`, IP ou liste → seuls ces proxys sont crus pour `X-Forwarded-For` ; `true` accepté
  avec avertissement au démarrage ; valeur invalide ignorée avec avertissement.
- `data/` n'est pas servi ; `x-powered-by` désactivé.

## 8. Tests

`npm test` (node:test, aucune dépendance) : 63 tests.

- `test/unitaires.test.js` : CSV (virgules, guillemets, BOM, colonnes par nom, anciens formats), validation (nouveaux
  champs, listes fermées, lieu ou Maps, formules), catégories, TRUST_PROXY, limites de fréquence, réessais du
  renommage (simulés), normalisation et exclusions d'audience, liste blanche d'évènements, identifiant et HMAC.
- `test/api.test.js` : migration au démarrage, en-têtes de sécurité et absence de styles / scripts en ligne, `data/`
  non exposé, **pages admin inaccessibles sous 23 variantes d'adresse**, cookie posé une fois (attributs, jamais dans
  les journaux), évènements refusés (inconnus, réservés, trop gros), `/api/log`, suggestion → publication (id, compte
  serveur), rejet / conflit, lieux, ajout / modification / suppression par id avec 409, archivage, statistiques
  (exclusions, aucun identifiant dans la réponse), limites (429), TRUST_PROXY réel.
- `test/collaboration.test.js` : doublons (normalisation, distance), publication immédiate et historique, délai de
  grâce et retrait, modification par tous et 409 avec différences, historique et restauration (y compris version
  d'avant l'historique), un avis par navigateur (modification, suppression réservée à l'auteur, moyenne), masquage au
  3e signalement distinct et pas au 3e du même navigateur, présence une par navigateur et par jour (remise à zéro le
  lendemain), fermeture et info erronée, seuils incertain / archive avec dates simulées et restauration, fusion
  (jours, lieu selon le jour, avis, présences, historique, alias), textes malveillants (affichage échappé, export
  neutralisé), autre origine / non-JSON refusés et hôtes autorisés, blocage et seuils, écritures simultanées, fil
  « Quoi de neuf », contributions journalisées sans identifiant, reconstruction de l'état après redémarrage et
  relecture d'un fichier modifié à la main, purge des présences à 13 mois avec agrégats, sauvegarde des nouveaux fichiers.
  Migration 3.1.0 -> 3.2.0.
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
