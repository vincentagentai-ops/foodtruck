# Dossier technique — Food Trucks (v3.5.0)

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
  dépendance en 3.1.0, 3.2.0, 3.3.0 ni 3.4.0 (cookies, HMAC, limites, sauvegardes, distance d'édition, statistiques : JavaScript
  pur / modules intégrés de Node ; carte de chaleur et barres du tableau de bord en HTML).
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
  statistiques.js       journaux -> faits -> agrégats incrémentaux jour par jour (jour, semaine, mois, cohortes,
                        visites), stats-jours.json + stats-etat.json, marqueurs de version, contributeurs, purge
  sauvegarde.js         copie quotidienne de data/ et rotation
  maintenance.js        enchaînement quotidien (sauvegarde, rotation, agrégats, purges, seuils), relancé toutes les heures
  limites.js            limites de fréquence en mémoire (par IP et par navigateur)
  plan.js               plan local des emplacements (3.4.0) : image (PNG/JPEG/WebP reconnus à leurs octets), positions
  photos.js             photos des établissements (3.5.0) : envoi (POST /api/photos, mêmes contrôles que le plan),
                        data/photo-<empreinte sha256>.<ext>, service /photos/… (CSP sandbox) ; photos d'origine
                        public/img/etablissements/ + images.json (attribuées par nom à la migration)
public/                 pages publiques : index.html, confidentialite.html, 404.html, css/, img/,
                        js/commun.js, js/accueil.js (liste, vue semaine, plan, carnet), js/fiche.js (fiche),
                        js/formulaires.js (ajout / modification), js/logique.js (logique sans DOM, partagée avec les
                        tests), js/perso.js (données personnelles dans localStorage), js/confidentialite.js
admin/                  pages protégées (hors de public/) : index.html + admin.js + surveillance.js (« À surveiller »)
                        + plan.js (plan des emplacements), statistiques.html + statistiques.js
data/                   données d'exploitation (hors git)
sauvegardes/            copies quotidiennes (hors git ; BACKUP_DIR)
data-exemple/           jeu de données de référence au format 3.1.0
scripts/                livraison (sh) et scripts Windows (installation, mise à jour, démarrage)
test/                   tests node:test : unitaires, API, données (migration, agrégats, purge, sauvegarde), collaboration,
                        statistiques (tableau de bord 3.3.0), logique de la page d'accueil, plan, accessibilité (3.4.0)
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
| `plan.json` | `{image: {fichier, type, taille, maj} \| null, positions: {idLieu: {x, y}}}` (x, y en % de l'image, 1 décimale) | Plan des emplacements | — |
| `plan-image.png` / `.jpg` / `.webp` | image (3 Mo au plus) | Image du plan (un seul fichier : l'ancien format est supprimé au remplacement) | — |
| `foodtruckAValider.csv` | mêmes colonnes que le catalogue (l'ancien format sans en-tête reste lu) | Suggestions héritées (avant 3.2.0) | jusqu'au traitement |
| `usage-AAAA-MM.jsonl` | `{ts, v, type, cible, page, version[, nav]}` | Évènements d'audience (v = HMAC du cookie) | 13 mois |
| `acces-AAAA-MM.log` | `{timestamp, ip, url, method, status, durationMs, userAgent}` | Journal technique | 13 mois |
| `stats-jours.json` | `{version: 2, traiteJusqua, jours, semaines, mois, cohortes, versions, maj}` | Agrégats des jours terminés, **sans identifiant** ; marqueurs de version | sans limite |
| `stats-etat.json` | `{version, traiteJusqua, navigateurs: {empreinte: {p, d, a?}}, ips: {condensé: date}}` | État interne du calcul incrémental (première / dernière activité de chaque empreinte) ; jamais servi ni exporté | empreinte retirée 13 mois après sa dernière activité |
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

## 4 ter. Confort (3.4.0) : logique côté navigateur et plan

- **Données personnelles dans le navigateur uniquement** (`localStorage`, `perso.js`) : `ft_favoris`, `ft_filtres`,
  `ft_pseudo` (existants), `ft_preferences` `{filtres, privilegier[]}`, `ft_marques` `{id: essaye|a_tester}`,
  `ft_carnet` `[{id, nom, date}]` (500 entrées au plus), `ft_hasard_non_essaye`, `ft_plan_ouvert`. Rien n'est envoyé
  au serveur ; seuls des évènements d'usage typés le sont (ci-dessous). Fiches fusionnées : marques et carnet suivent
  l'alias (`Logique.suivreAlias`). Lecture défensive (`nettoyerCarnet`, `nettoyerPreferences`, `nettoyerFiltres`).
- **`public/js/logique.js`** : fonctions pures, chargées par la page (objet global `Logique`) et par `require` dans
  les tests : `correspond` (filtres + recherche + « Déjà essayé ? »), `tirerAuHasard` (`nonEssaye`, `exclure` = tirage
  précédent sauf candidat unique, `aleatoire` injectable), `construireLien` / `lireLien`, `texteTeams`, carnet,
  préférences (`scorePreference` : tri dans chaque lieu), `numeroterLieux`.
- **Liens partageables** : `?jour=jeudi&vue=semaine&q=…&categorie=…&prix=12&type=…&etiquette=…&paiement=…&essai=pas_essaye&tri=prix&fiche=<id>`
  (ordre stable ; `jour` omis s'il est le jour par défaut, `tri=lieu` omis). L'adresse est tenue à jour par
  `history.replaceState` (pas d'entrée d'historique). À l'ouverture, un lien reconnu l'emporte sur les filtres
  mémorisés **sans les écraser** (ils ne sont réécrits qu'à un changement fait par l'utilisateur) ; sinon les filtres
  par défaut des préférences, sinon les derniers filtres. Valeurs inconnues ignorées, textes tronqués à 80 caractères.
- **« Copier pour Teams »** : `navigator.clipboard` n'existe qu'en contexte sécurisé (HTTPS ou localhost) ; en HTTP,
  `Commun.copierTexte` sélectionne le texte dans une zone visible puis tente `document.execCommand('copy')` ; à défaut
  le texte reste sélectionné (Ctrl+C). Vérifié en HTTP sur une adresse IP du réseau local (copie réussie par le repli).
- **Plan** : `GET /api/plan` → `{image: '/plan/image?v=<maj>' | null, positions}` ; `GET /plan/image` relit le fichier,
  **revérifie le type sur les premiers octets** (sinon 404) et l'envoie avec `Content-Type` exact, `nosniff`,
  `Content-Disposition: inline`, `Content-Security-Policy: default-src 'none'; sandbox`, `Cache-Control: no-cache`.
  Dépôt : JSON `{type, donnees}` (base64, préfixe `data:` accepté) ; le corps n'est lu (limite ≈ 4 Mo) **qu'après**
  l'authentification (le lecteur JSON général de 20 ko est sauté pour cette seule adresse) ; types acceptés : PNG,
  JPEG, WebP, reconnus à leur signature ; type déclaré différent du contenu → 400 ; > 3 Mo → 413. Pas de SVG (script
  possible). Repères positionnés en CSSOM (`element.style.left`), compatible avec la CSP (`style-src 'self'`).
  Numérotation : lieux connus des établissements affichés (après filtres), du plus proche au plus loin.
- **Thème sombre** : `@media (prefers-color-scheme: dark)` redéfinit toutes les variables de couleur ; les paires
  texte / fond principales des deux thèmes sont vérifiées au niveau AA par `test/accessibilite.test.js` (4,5 pour le
  texte, 3 pour les contours de champ et les étoiles). Chart.js lit `--texte-2` et `--bordure`.
- **Barre des jours collante** (page d'accueil : l'en-tête n'y est plus collant), lien d'évitement, tableau de la vue
  semaine avec `caption`, `scope` et textes masqués « absent / présent » pour les lecteurs d'écran.

## 4. Mesure d'audience et statistiques

- **Cookie** `ft_v` : 16 octets aléatoires (base64url), posé sur la première réponse non statique si absent ou
  invalide : `Max-Age` 395 jours, `Path=/`, `HttpOnly`, `SameSite=Lax` (pas `Secure` : site en HTTP). Jamais prolongé.
- **Empreinte** : `v = HMAC-SHA256(secret, cookie)` tronqué à 32 caractères hexadécimaux. Les journaux d'audience ne
  contiennent ni le cookie ni l'IP ; le journal technique contient l'IP mais pas l'empreinte.
- **Pages vues** : écrites par le serveur (`page_vue`) pour un GET de `/index.html` ou `/confidentialite.html` (après
  normalisation : décodage, minuscules, `/` → `/index.html`), statut 2xx ou 304, navigateur non robot (liste de
  motifs : bot, curl, python, agent vide…).
- **Évènements des pages** : `POST /api/evenements {type, cible, page}` ; types en liste blanche (`audience.js`,
  `TYPES_PUBLICS`, dont `recherche_vide` depuis la 3.3.0 : recherche sans résultat parmi les établissements du jour
  affiché, texte tronqué à 30 caractères) ; types réservés au serveur → 403, inconnus → 400 ; corps ≤ 2 ko (413
  au-delà) ; cible tronquée à 80 caractères. Évènements envoyés par un robot (même liste de motifs) : `204` sans
  écriture. Depuis la 3.4.0 : `vue_semaine`, `marque_essaye`, `marque_a_tester`, `marque_retiree`,
  `hasard_non_essaye`, `copie_teams`, `lien_ouvert` (cible `fiche`, `filtres` ou `jour`), `preferences`,
  `carnet_ajout`, `carnet_retrait`, `carnet_ouvert`, `carnet_efface`, `plan_ouvert`, `plan_lieu_clic`,
  `donnees_locales_effacees` ; côté serveur `admin_plan`. Ils alimentent « Fonctionnalités utilisées » (`FONCTIONNALITES`
  de `statistiques.js` : semaine, essais, teams, lien, preferences, carnet, plan ; `hasard` inclut `hasard_non_essaye`)
  sans changement du format des agrégats. `POST /api/log` (anciennes pages en cache) : libellés convertis en évènements typés ; ceux commençant par
  « Admin » ou « Ajout de » → 403.
- **Navigateur de l'administrateur** : à la première requête authentifiée d'un navigateur qui a déjà un cookie,
  l'évènement serveur `admin_vu` est écrit (une fois par démarrage et par navigateur). Toute empreinte qui produit un
  évènement `admin_*` est marquée « administrateur » dans `stats-etat.json` et exclue de l'audience **à partir de ce
  jour** (jour compris : pages publiques, évènements, visites) ; les jours précédents ne sont pas recalculés.
- **Faits** : chaque ligne de journal (nouveau ou ancien) est ramenée à `{date, heure, t, source: navigateur|ip, id,
  type, cible, page, nav}`. Les anciens journaux donnent la source `ip`.

### Calcul incrémental (S5)

- `Statistiques.mettreAJourAgregats(aujourdhui)` (maintenance horaire et chaque affichage) traite, **dans l'ordre et
  une seule fois**, chaque jour terminé depuis `traiteJusqua` (`traiterJour`) ; seuls les journaux mensuels qui
  peuvent contenir ces jours sont relus (pas les anciens journaux uniques). État et agrégats sont écrits ensemble
  (état d'abord) avec la même date `traiteJusqua`.
- **Reprise complète** (`reconstruire`) : à la première exécution en 3.3.0 (agrégats `version` 1), ou si
  `traiteJusqua` diffère entre l'état et les agrégats (fichier restauré seul, écriture interrompue) : tout est recalculé
  depuis les journaux bruts ; les agrégats des périodes antérieures au plus ancien journal brut (purgé) sont gardés
  tels quels.
- **Journée en cours** : calculée à chaque affichage sur une copie (`avecJourneeEnCours`), jamais enregistrée.
- Par **jour** : `pagesVues`, `pages`, `actifs` (empreintes distinctes), `actifs7j` (empreintes actives sur les 7 jours
  glissants qui finissent ce jour ; un jour sans visite a aussi un agrégat tant que ce nombre n'est pas nul),
  `actifsIp` (ancien calcul), `nouveaux` (empreinte jamais vue), `visites` (suite d'évènements d'une empreinte sans
  pause de plus de 30 min, coupée à minuit), `fonctionnalites` (visites contenant au moins un évènement de chaque
  groupe : `FONCTIONNALITES`), `entonnoir` (`fiche` : visites avec `fiche_ouverte` ; `ficheClic` : avec fiche et
  `clic_maps` / `clic_site` ; `clicSansFiche`), `heures` (empreintes distinctes par heure), `navigateurs`,
  `evenements` (par type, contributions comprises), `joursConsultes`, `consultations` (`{id: {fiche, site, maps,
  autres}}`), `recherchesVides` (`{texte: n}`), `technique`.
- Par **semaine ISO** et par **mois** : `actifs`, `actifsIp`, `nouveaux` (première activité dans la période),
  `retenus` (actifs dans la période **et** dans la précédente). Ces comptes distincts sont tenus à jour sans garder de
  liste : une empreinte compte pour la semaine à sa première activité de la semaine (dernière activité connue
  antérieure au lundi), et pour `retenus` si cette dernière activité tombe dans la semaine précédente.
- **Cohortes** : `cohortes[semaine de première activité] = {debut, taille, semaines: [n0, n1, …]}` (26 semaines au plus).
- **Oubli** : une empreinte sans activité depuis 13 mois est retirée de l'état (son cookie a expiré) ; revenue, elle
  compterait comme nouvelle.
- `calculerAgregats(faits, techniques, aujourdhui)` est le **calcul complet** (même moteur, depuis un état vide) : le
  test « Calcul incrémental = calcul complet » compare les deux sur plusieurs exécutions successives.

### Lecture (`construireStatistiques`)

- **Tuiles** de la période [début, fin] et de la période précédente de même durée : `actifsJour` (moyenne des jours
  avec visites), `actifsSemaine` (moyenne de `actifs7j` sur les jours couverts par la mesure), `nouveaux`, `visites`,
  `pagesVues`, `retourS1` (`{taux, revenus, base}` : Σ `retenus` de S+1 / Σ `actifs` de S pour les semaines S qui
  recoupent la période et dont la suivante est terminée), `contributions` (types `TYPES_CONTRIBUTION`).
- Listes : `jours[]`, `semaines[]` (avec `recurrents`, `complete`, `retourS1`, contributions par type), `mois[]`
  (avec `retourM1`), `cohortes[]` (12 dernières, 9 semaines, `observees` = semaines terminées), `carteChaleur[7][24]`
  (lundi = 0), `entonnoir`, `fonctionnalites`, `recherchesVides` (30 premières), `versions`.
- **Contributeurs** (`statistiquesContributeurs`, dans la route) : à partir des fichiers de contributions (`avis.jsonl`
  créer / modifier / supprimer, `presences.jsonl`, `signalements.jsonl` signaler, `historique.jsonl`), en ne retenant
  que les jetons d'auteur (24 caractères hexadécimaux : ni `admin` ni `systeme`). `contributeurs` (distincts sur la
  période), `nouveaux` (première contribution connue dans la période), `revenus14` / `mesures14` / `tauxRetour14`
  (nouvelle contribution un autre jour dans les 14 jours, pour les fenêtres écoulées), `enObservation`, `parSemaine`.
  Ces fichiers ne sont pas des journaux d'audience : le jeton d'auteur (autre clé) n'est jamais relié à l'empreinte.
- **Établissements** : `fiche`, `site`, `maps` (agrégats de la période), `confirmations` (déclarations « présent » de la
  période : `presences.jsonl` + `stats-presences.json` pour les jours purgés), `avis` et `note` (situation actuelle ;
  note à partir de 3 avis).
- **Marqueurs de version** (S6) : `noterVersion(version)` au démarrage (`server.js`) ajoute `{version, date}` à
  `stats-jours.json` si la version diffère de la dernière enregistrée ; la première fois, les versions déjà présentes
  dans les journaux d'usage (champ `version`) sont reprises avec leur premier jour.
- **Rupture de série** : `periode.debutNavigateurs` (premier jour avec des navigateurs actifs) ; la page trace un
  marqueur et ne compare pas à une période précédente entièrement antérieure.
- **Purge** (`Statistiques.purger`) : limite = aujourd'hui − 13 mois. Fichiers mensuels dont le mois est antérieur au
  mois de la limite : supprimés ; anciens fichiers uniques : réécrits sans les lignes antérieures à la limite (les
  lignes non datées sont gardées). Préalable obligatoire : agrégats mis à jour, **relus depuis le disque**, et présents
  pour chaque jour (et sa semaine / son mois) concerné ; sinon rien n'est supprimé et la raison est journalisée.
  Avant la première purge, les fichiers touchés sont copiés dans `<sauvegardes>/journaux-avant-premiere-purge/`.
  Les périodes purgées restent consultables (test « Période chevauchant une purge »).

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
| GET | `/api/plan` | `{image: adresse \| null, positions: {idLieu: {x, y}}}` |
| GET | `/plan/image` | image du plan (type exact, `nosniff`, CSP `sandbox`) ; `404` sans plan |
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
| PUT / DELETE | `/api/admin/lieux/:id` | modification / suppression (`409` si le lieu est utilisé) ; la suppression retire aussi le lieu du plan |
| PUT / DELETE | `/api/admin/plan/image` | `{type, donnees}` (base64, PNG / JPEG / WebP, ≤ 3 Mo) → `201 {message, plan}`, `400`, `413` / retrait de l'image (positions gardées) |
| PUT / DELETE | `/api/admin/plan/positions/:lieu` | `{x, y}` (0 à 100) → `{message, plan}`, `400`, `404` (lieu inconnu) / retrait du lieu du plan |
| GET | `/api/admin/statistiques?debut=AAAA-MM-JJ&fin=AAAA-MM-JJ` | `{periode (precedente, debutNavigateurs, traiteJusqua…), tuiles, precedente, totaux, jours[], semaines[], mois[], cohortes[], carteChaleur, entonnoir, fonctionnalites, recherchesVides[], etablissements[], contributeurs, versions[], pages, heures, navigateurs, evenements, joursConsultes, consultations, technique, noms}` — aucun identifiant de navigateur ni jeton d'auteur |
| GET | `/api/admin/export/statistiques.csv?niveau=jours|semaines|etablissements&debut=&fin=` | agrégats de la période en CSV (valeurs neutralisées), sans identifiant |

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
  attribut `style=` ou script en ligne dans les pages (test dédié). Image du plan : voir §4 ter.
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

`npm test` (node:test, aucune dépendance) : 93 tests.

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

- `test/statistiques.test.js` (3.3.0) : journaux fabriqués — DAU, WAU (7 jours glissants et semaine ISO), MAU,
  nouveaux / récurrents, visites (pause de 30 min, coupure à minuit), fonctionnalités, entonnoir, retour à S+1,
  cohortes, carte de chaleur, recherches sans résultat, comparaison à la période précédente, journée en cours ;
  **calcul incrémental en plusieurs exécutions = calcul complet**, jour traité jamais recalculé, reprise complète si
  l'état manque ; mise à jour depuis les agrégats 3.2.0 ; **période chevauchant une purge** ; marqueurs de version ;
  contributeurs et retour à 14 jours ; API : **robots et navigateur de l'administrateur exclus**, **aucune empreinte,
  aucun jeton d'auteur ni cookie dans la réponse ni dans les trois exports CSV**, `stats-etat.json` non servi.

- `test/logique.test.js` (3.4.0) : filtres (cuisine, type, prix, régime, paiement, « Déjà essayé ? »), recherche,
  « Au hasard » avec exclusions (déjà essayé, tirage précédent, candidat unique, répartition), liens partageables
  (construction, lecture, aller-retour, valeurs inconnues ou dangereuses), texte « Copier pour Teams », carnet,
  marques et alias de fusion, préférences, numérotation du plan.
- `test/plan.test.js` (3.4.0) : détection du type (PNG, JPEG, WebP ; SVG, HTML, GIF refusés), routes protégées (y
  compris variantes de casse / d'encodage, gros corps sans mot de passe refusé avant lecture), types et taille
  limités, 415 / 400 / 403 (autre origine), image servie non exécutable, fichier remplacé à la main par du HTML → 404,
  positions (bornes, lieu inconnu, retrait, suppression du lieu), sauvegarde quotidienne de l'image, nouveaux
  évènements acceptés et comptés.
- `test/accessibilite.test.js` (3.4.0) : contrastes AA des couleurs principales (thèmes clair et sombre), thème sombre
  complet, langue, lien d'évitement et étiquettes des champs de la page d'accueil.

Les pages ont été vérifiées dans un navigateur (poste de travail) sur un dossier de données temporaire ; en 3.3.0, le
tableau de bord l'a été avec un jeu de démonstration de 4 mois (journaux d'avant et d'après la 3.1.0, contributions) ;
en 3.4.0, la page d'accueil (jour, semaine, plan, préférences, fiche, carnet, liens), l'administration du plan et la
page de confidentialité l'ont été en thème clair et en thème sombre.

## 9. Exploitation

- Logs applicatifs : `pm2 logs foodtruck` (démarrage, migration, sauvegarde du jour, purge, erreurs).
- Maintenance automatique : au démarrage puis toutes les heures (sauvegarde du jour si absente, rotation 30 jours,
  agrégats, purge à 13 mois).
- Mise à jour : zip autonome + `scripts\mettre-a-jour.bat` (voir `docs/DEPLOIEMENT.md`).
- Seuils où une base SQLite deviendrait pertinente : voir `AUDIT_ET_PROPOSITIONS.md` §7.2 (très loin à ce jour).
