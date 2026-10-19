# Audit fonctionnel et technique — Food Trucks v3.0.0 — et propositions d'évolution

Date : 19/10/2026 — Périmètre : dépôt `~/dev/foodtruck` (commit `6734733`), documentation, code, tests, copie locale
des journaux de production (`data/`, analysée **uniquement en agrégats**, aucune adresse IP n'est reproduite ici).

Conventions utilisées dans ce rapport :

- **[Constaté]** : vérifié dans le code, par les tests ou par une manipulation sur une instance temporaire.
- **[Hypothèse]** : plausible mais non vérifiable depuis le dépôt (infrastructure, usages, serveur de production).
- **[Recommandation]** : proposition de l'auditeur.
- Difficulté : **XS** (< ½ j), **S** (½–1 j), **M** (2–4 j), **L** (≥ 5 j ou dépendance externe). Les jours s'entendent
  pour un développeur qui connaît le projet.
- Priorité : **P1** (à faire d'abord), **P2** (cœur des évolutions), **P3** (ensuite), **P4** (optionnel).

Aucun fichier du projet n'a été modifié, à l'exception de la création de ce rapport. Les vérifications dynamiques
ont été faites sur une instance lancée dans un dossier temporaire hors du projet, puis supprimée.

---

## Sommaire

1. [Synthèse exécutive](#partie-1--synthèse-exécutive)
2. [Audit de l'existant](#partie-2--audit-de-lexistant)
3. [Catalogue des améliorations](#partie-3--catalogue-des-améliorations)
4. [Parcours utilisateur cible](#partie-4--parcours-utilisateur-cible)
5. [Fonctionnement collaboratif recommandé](#partie-5--fonctionnement-collaboratif-recommandé)
6. [Stratégie de statistiques et d'identification](#partie-6--stratégie-de-statistiques-et-didentification)
7. [Architecture cible](#partie-7--architecture-cible)
8. [Plan de mise en œuvre](#partie-8--plan-de-mise-en-œuvre)
9. [Décisions à prendre](#partie-9--décisions-à-prendre)
10. [Annexe — Contrôle de couverture de la demande](#annexe--contrôle-de-couverture-de-la-demande)

---

## Partie 1 — Synthèse exécutive

### État général

La v3.0.0 est une **base saine et bien rangée** : environ 1 500 lignes de code utiles, Express 4 sans framework
front, CSV lus/écrits correctement (RFC 4180, écriture atomique), validation serveur complète, échappement HTML
systématique, administration protégée, 21 tests automatisés qui passent, documentation abondante et globalement
fidèle au code. Les gros défauts de la v2 (dossier `data/` public, API d'écriture ouverte, XSS, plantages sur une
ligne de journal) sont réellement corrigés.

En revanche, le site reste un **annuaire en lecture seule** : une liste du jour, un tri, deux liens externes. Rien ne
donne de raison d'y revenir ni d'y contribuer, et la seule contribution possible passe par un administrateur.

### Ce que disent les données réelles [Constaté, agrégats de `data/acces.log` et `data/usage.log`]

- Depuis janvier 2025 : **250 adresses IP distinctes**, mais seulement **8 à 31 par mois**, et **2,1 IP par jour**
  en moyenne les jours où il y a de l'activité (maximum 45, au lancement en février 2025).
- Les sélections de jour (≈ chargements de page) passent de **247 en février 2025** à **13–38 par mois en 2026** :
  l'usage est faible et **en baisse**.
- **68 % des requêtes historiques du journal d'accès sont des appels à l'ancienne page de statistiques**, venant de
  7 IP : le compteur « Requêtes au serveur » a surtout mesuré… la consultation des statistiques.
- Avant la v3, les pages HTML n'étaient pas journalisées : il n'existe **aucun historique fiable de pages vues**.

Conclusion : les statistiques actuelles ne permettent pas de savoir combien de collègues utilisent le site, et
l'usage réel est modeste. L'enjeu prioritaire est **d'apporter de la valeur quotidienne** (savoir où manger
*aujourd'hui*, avec des infos fiables et fraîches) et de **mesurer correctement** pour juger l'effet des évolutions.

### Points forts

- Code lisible, découpé (`src/csv.js`, `src/validation.js`, `src/stockage.js`, `src/statistiques.js`), commenté en
  français, tests `node:test` sans dépendance.
- File d'attente d'écriture + écriture atomique (`src/stockage.js:16-46`) et détection de conflit optimiste
  (`retrouver`, `src/app.js:152-159`) : de bonnes bases pour ouvrir l'écriture à tous.
- Fonctionne sans CDN (Chart.js servi localement), déploiement pm2 documenté, scripts Windows.

### Principales limites

1. **Pas d'identifiant stable** des établissements : tout est adressé par position dans le CSV. Bloquant pour les
   avis, l'historique, les favoris et des statistiques par établissement.
2. **Statistiques peu fiables** : « visiteurs uniques » = IP distinctes sur *toutes* les requêtes (admin, API,
   erreurs 401/404 comprises) ; évènements d'usage en texte libre **falsifiables** par n'importe quel poste.
3. **Données pauvres pour décider** : pas d'adresse lisible ni de nom de lieu (le tri « Emplacement » trie des URL
   Google Maps), pas d'horaires, pas de moyens de paiement, catégories de cuisine non normalisées.
4. **Quelques failles concrètes** (détails §2.12) : pages d'administration lisibles sans mot de passe via une URL
   encodée, journal d'usage ouvert sans limite, `TRUST_PROXY=true` permettant de falsifier l'IP, aucune limite de
   fréquence sur les suggestions.
5. **Exploitation** : pas de sauvegarde automatique, pas de rotation des journaux (IP conservées sans limite de durée),
   mise à jour qui exige un accès au registre npm depuis le serveur.

### Opportunités les plus intéressantes

- **Confirmation de présence du jour** (« Il est là ✔ / Pas là aujourd'hui ✖ ») : très utile, très simple, et le
  meilleur moteur de retour quotidien.
- **Contribution directe avec historique et retour arrière** (modèle « wiki ») plutôt qu'une file de validation.
- **Avis courts** (note + une phrase + plat conseillé), modifiables par leur auteur, sans compte.
- **Favoris et « pas encore essayé » stockés dans le navigateur** : personnalisation sans aucune donnée personnelle
  côté serveur.
- **Mesure d'audience par identifiant anonyme de navigateur** : passe d'un comptage d'IP à un comptage de navigateurs,
  suffisant pour piloter le site, sans dépendre de l'informatique.

### Les cinq améliorations recommandées en priorité

| # | Amélioration | Pourquoi d'abord | Effort |
|---|---|---|---|
| 1 | **Socle : correctifs de sécurité + identifiant stable + sauvegarde automatique** (T1–T5, T8) | Prérequis de toute ouverture en écriture ; corrige des failles réelles | S–M |
| 2 | **Mesure fiable et structurée** : cookie anonyme d'audience, évènements typés, indicateurs corrigés (S1–S3) | Avoir une base de comparaison *avant* les nouveautés | S |
| 3 | **Aide au choix immédiate** : lieu lisible, filtres/recherche, favoris locaux, « Au hasard », badge Nouveau (U1, U4, U6, U7, U9) | Valeur visible dès la première visite, aucune donnée personnelle | S–M |
| 4 | **Contribution directe versionnée + confirmation de présence + signalements** (C1–C5, C9, C12) | Cœur de l'axe collaboratif, remplace la validation préalable | M |
| 5 | **Avis courts sans compte** (C6–C7), avec pseudonyme facultatif (I1) | Partage d'expérience ; dépend de 1 et 4 | M |

L'identification Windows (SSO) est **possible mais conditionnée à l'infrastructure** et n'est **pas nécessaire** pour
compter correctement les utilisateurs ; elle ne se justifie que si vous voulez des contributions *nominatives
vérifiées* (voir Partie 6 et décision n° 1).

---

## Partie 2 — Audit de l'existant

### 2.1 Méthode

1. Lecture intégrale, dans l'ordre demandé, de `README.md`, `docs/SPECIFICATIONS.md`, `docs/GUIDE_UTILISATEUR.md`,
   `docs/GUIDE_ADMINISTRATEUR.md`, `docs/DOSSIER_TECHNIQUE.md`, `docs/DEPLOIEMENT.md`, `docs/INVENTAIRE.md`,
   `CHANGELOG.md`.
2. Lecture intégrale du code : `server.js`, `src/*.js`, `public/**`, `test/*.js`, `scripts/*`, `package.json`,
   `package-lock.json` (versions), `ecosystem.config.js`, `.env.example`.
3. `npm test` (21/21 réussis), `npm audit --omit=dev` (0 vulnérabilité connue), `npm outdated` (Express 5 disponible,
   non requis).
4. Instance temporaire (dossier de données jetable) pour vérifier : contrôle d'accès, journal d'usage, limites,
   en-têtes de proxy, calcul des statistiques.
5. Agrégats calculés sur la copie locale des journaux de production (`data/`) et coup d'œil à l'ancien code
   (`~/Téléchargements/FoodTrucksNodejs`) pour interpréter l'historique.

### 2.2 Architecture constatée

```
Navigateur ──HTTP (port 80, toutes interfaces)──> Node.js 20.12+ / Express 4.22 (1 processus pm2)
   │                                                ├─ journal d'accès (middleware, avant tout)      src/app.js:45-62
   │                                                ├─ /admin/* statiques + /api/admin/* (HTTP Basic) src/app.js:70-102
   │                                                ├─ public/ statique (HTML/CSS/JS vanilla)         src/app.js:105
   │                                                ├─ API publique : config, foodtrucks, suggestions, log
   │                                                └─ data/ : foodtrucks.csv, foodtruckAValider.csv, usage.log, acces.log
   └─ liens sortants : Google Maps (maps.app.goo.gl), sites des foodtrucks  → nécessitent Internet côté poste
                                                    (option) SMTP interne : mail à chaque suggestion
```

Dépendances d'exécution (`package-lock.json`) : `express 4.22.3`, `nodemailer 10.1.7` (exige Node ≥ 20),
`chart.js 4.5.1`. Aucune dépendance de développement. Node local : 24.22. **La version de Node du serveur n'est pas
vérifiable** depuis le dépôt.

### 2.3 Inventaire des fonctionnalités

#### Effectivement présentes [Constaté]

| Fonction | Où |
|---|---|
| Liste du jour, week-end → lundi avec message, pastille du jour | `public/js/accueil.js:11-43` |
| Boutons Lundi–Vendredi | `accueil.js:17-35` |
| Tri par colonne (prix min, prix inconnus en fin) | `accueil.js:45-108` |
| Liens site / Google Maps (http(s) uniquement) | `accueil.js:79-94`, `public/js/commun.js:12-19` |
| Suggestion (modale, contrôle navigateur + serveur, erreurs détaillées, mail optionnel) | `accueil.js:121-181`, `src/app.js:117-148` |
| Lien « Envoyez-moi un mail » si `CONTACT_EMAIL` | `accueil.js:183-193` |
| Affichage en fiches sous 640 px | `public/css/styles.css` |
| Admin : valider (avec corrections) / rejeter, ajouter (avec pré-remplissage texte), modifier, retirer, rechercher, exporter CSV | `public/admin/admin.js`, `src/app.js:167-243` |
| Conflit de modification (409) | `src/app.js:152-159` |
| Statistiques filtrables par période | `src/statistiques.js`, `public/admin/statistiques.js` |
| Bandeau environnement de test, version en pied de page | `commun.js:69-79` |

#### Documentées mais absentes, incomplètes ou inexactes

| Documentation | Réalité |
|---|---|
| SPECIFICATIONS §7 « Fonctionne sans accès Internet » | Vrai pour l'application elle-même ; **faux pour l'usage** : le lien principal de chaque fiche (Google Maps, liens courts `maps.app.goo.gl`) et les sites exigent Internet depuis le poste. **L'installation et la mise à jour** (`scripts/installer.bat`, `mettre-a-jour.bat` → `npm install`) exigent l'accès au registre npm (ou un miroir) depuis le serveur. |
| DOSSIER_TECHNIQUE §6 « espace admin protégé » | Les **pages** `/admin/*` sont lisibles sans mot de passe via une URL encodée (§2.12-1). Les **données** (`/api/admin/*`) restent protégées. |
| GUIDE_ADMINISTRATEUR « Suggestions envoyées » | Compte un évènement envoyé **par le navigateur** après succès, pas les suggestions réellement enregistrées (§2.9). |
| GUIDE_ADMINISTRATEUR « Visiteurs uniques : nombre d'adresses IP différentes » | Exact, mais calculé sur **toutes** les requêtes (API, admin, erreurs), ce que le libellé ne dit pas. |
| GUIDE_UTILISATEUR « Signaler une erreur : Envoyez-moi un mail » | Le lien n'apparaît que si `CONTACT_EMAIL` est réglé ; sinon aucun moyen de signaler. |
| SPECIFICATIONS §7 « seules l'IP et le navigateur sont journalisés » | Sont aussi journalisés l'URL complète (avec paramètres), l'horodatage et les évènements de clic, liés à l'IP. Pas d'incohérence grave, mais à préciser pour l'information des collègues. |
| DOSSIER_TECHNIQUE §8 « acces.log grossit de 1–2 Mo/an » | Copie locale : 1,4 Mo en 21 mois, dont la moitié en lignes « duration » de l'ancien format. Cohérent ; à revoir dès que l'usage augmente ou qu'un identifiant est ajouté. |

#### Envisagées mais non développées (SPECIFICATIONS §6, INVENTAIRE)

Notation/avis, horaires et menus, carte interactive, comptes administrateurs multiples, historique des modifications,
rotation des journaux.

#### Impossibles à vérifier depuis le dépôt

- La version **réellement en production** (la v3 date du 19/10/2026 ; les journaux locaux sont ceux de la v2).
- La version de Node, la configuration `.env`, le port et la présence d'un proxy sur le serveur.
- La topologie réseau : NAT, proxy, postes virtuels (VDI/Citrix), durée des baux DHCP — déterminant pour la valeur des
  statistiques par IP.
- Le rattachement du serveur au domaine Active Directory, les navigateurs et stratégies (GPO) déployés.
- L'accès au site depuis les téléphones (Wi-Fi interne ? VPN ?) — la documentation évoque l'usage sur téléphone.
- La sauvegarde éventuelle du serveur par l'informatique.
- Le comportement du renommage atomique sous Windows quand le CSV est ouvert dans Excel (§2.8).

### 2.4 Données et CSV

- Modèle : `nom, cuisine, jours, emplacement, prix, site` (`src/csv.js:7`). **Aucun identifiant**, aucune date de
  création/modification, aucun auteur, aucun statut.
- Un établissement présent à deux endroits = deux lignes (ex. L'épicurieux) : impossible de rattacher avis ou
  statistiques au « même » établissement sans identifiant.
- Qualité des données d'exemple (`data-exemple/foodtrucks.csv`) [Constaté] : cuisines non normalisées
  (« Grillades »/« grillades », « Thailandais » sans accent, « Pizza »/« Pizza roulée »), espace parasite
  (« Bibim Pop, Coréen »), prix « 7 à 12 » non normalisé (l'affichage le gère), deux établissements partageant le même
  lien Maps (ce qui est normal : même parking). Un filtre « par cuisine » demandera une liste de catégories.
- Le champ « emplacement » est **uniquement un lien** : il n'y a ni nom de lieu ni adresse. Conséquences : le tri
  « Emplacement » trie des URL (`accueil.js:47`), on ne peut pas regrouper par lieu, ni afficher « à 3 min à pied ».
- Lecture : fichier relu à chaque requête, pas de cache (acceptable à cette échelle et utile pour les éditions
  manuelles). Écriture : réécriture complète dans un `.tmp` puis renommage (`src/stockage.js:42-46`).

### 2.5 Administration

- Un seul compte partagé (`ADMIN_USER`/`ADMIN_PASSWORD` dans `.env`), HTTP Basic, comparaison à temps constant
  (`src/app.js:65-88`). Pas de déconnexion (fermer le navigateur), pas de limitation des essais.
- Les actions admin sont journalisées dans `usage.log` avec l'IP mais **sans identité** : impossible de savoir
  *quel* administrateur a agi.
- Adressage des lignes par **index + contenu original** (`retrouver`) : robuste pour deux administrateurs, mais pas
  pour des dizaines de contributeurs (deux lignes strictement identiques sont indiscernables).
- Suppression **physique** (pas de corbeille, pas d'historique) ; seule la sauvegarde manuelle permet de revenir en
  arrière.

### 2.6 Authentification et contrôle d'accès

- Partie publique : aucune identification, aucun cookie.
- Partie admin : `app.use('/admin', exigerAdmin, express.static(...))` puis `app.use(express.static(public))`
  (`src/app.js:101-105`). Le dossier `public/admin/` est donc aussi servi par le statique général, ce qui crée le
  contournement décrit en §2.12-1.
- Le mot de passe circule en clair sur HTTP (documenté).

### 2.7 Validation des données

- Serveur (`src/validation.js`) : champs obligatoires, jours normalisés, URL http(s), longueurs, prix, refus de
  `= + - @` en tête du **nom** et de la **cuisine** (injection de formules Excel). Les autres champs sont des URL ou des
  valeurs normalisées : couverture correcte aujourd'hui. **À étendre** à tout futur texte libre (commentaires, plats).
- Client (`accueil.js:157-166`) : contrôles minimaux, doublés côté serveur. Bon principe.
- Pas de **détection de doublon** (une suggestion identique à un établissement publié est acceptée — vérifié).

### 2.8 Gestion des erreurs et accès concurrents

- Gestionnaire d'erreurs central, 400/409/500 cohérents, détail des 500 uniquement dans la console.
- Écritures CSV sérialisées dans le processus (`enSerie`) : correct **tant qu'il n'y a qu'un processus** (imposé par
  `ecosystem.config.js`, `instances: 1`).
- Journaux : `fs.appendFile` non sérialisé ; acceptable (petites lignes), mais pas garanti contre l'entrelacement.
- **Édition manuelle du CSV pendant le fonctionnement** : une écriture de l'application relit puis réécrit le fichier ;
  une modification manuelle faite entre les deux est perdue. Documenté (« serveur arrêté ou sans action admin »), mais
  ce risque devient permanent dès que *tout le monde* peut écrire.
- **[Hypothèse, Windows]** `fs.rename` sur un fichier ouvert par Excel ou verrouillé par l'antivirus échoue
  (`EPERM`/`EBUSY`) : l'écriture renverrait une erreur 500. Non testable sous Linux ; à vérifier sur le serveur.

### 2.9 Journalisation et statistiques : ce qui est réellement mesuré

#### Sources

| Journal | Écrit par | Contenu |
|---|---|---|
| `acces.log` | middleware `src/app.js:45-62`, toutes les requêtes sauf fichiers `.css/.js/.png/…` | horodatage, IP, URL complète, méthode, statut, durée, User-Agent |
| `usage.log` | `POST /api/log` (texte libre ≤ 300 caractères envoyé par les pages) + actions admin côté serveur | horodatage, IP, `event` (texte) |

#### Calcul de chaque indicateur et fiabilité

| Indicateur affiché | Calcul réel | Fiabilité / biais constatés |
|---|---|---|
| **Visiteurs uniques (adresses IP)** | `new Set(requetes.map(e => e.ip)).size` sur **toutes** les requêtes de la période (`src/statistiques.js:97`) | Compte des IP, pas des personnes. Inclut administrateurs, robots, outils, erreurs 401/404. Sous-estime derrière un NAT/proxy/VDI (une IP pour beaucoup de monde) ; surestime sur longue période avec le DHCP (une personne = plusieurs IP). Si un proxy existe et `TRUST_PROXY=false`, **tout le monde a l'IP du proxy**. |
| **Pages vues** | GET sur `/`, `*.html`, `/admin(/)` (`estPage`, `statistiques.js:84-87`) | Inclut les **401** (le navigateur demande d'abord sans mot de passe → chaque page admin compte double), les **404** en `.html`, les redirections 301 des anciennes adresses, les pages admin et statistiques. Variantes d'URL comptées séparément (`/ADMIN/index.html`, `/%61dmin/index.html` — vérifié). Pas d'historique avant la v3. |
| **Suggestions envoyées** | Nombre d'évènements `Clic sur envoyer foodtruck : succès` envoyés **par le navigateur** (`public/admin/statistiques.js:51`) | Ne compte pas une suggestion envoyée autrement que par la page ; peut être gonflé par n'importe qui via `/api/log`. Le serveur ne journalise pas lui-même la suggestion. |
| **Requêtes au serveur** | Nombre de lignes avec URL | Mesure de charge technique : chaque clic génère un `POST /api/log`, chaque visite ≈ 4–5 requêtes. Historiquement **68 % = appels de l'ancienne page de statistiques**. |
| **Fréquentation par jour** | IP distinctes par jour (toutes requêtes) + pages vues par jour | Deux séries sur des bases différentes ; mêmes biais. |
| **Jours consultés** | Évènements `Jour sélectionné : X` | L'évènement est envoyé **aussi au chargement** (`accueil.js:41`, même si `parUtilisateur=false`) : mesure surtout « quel jour de la semaine on charge la page » ; le week-end compte comme Lundi. |
| **Activité par heure / par jour de semaine** | Requêtes (pas visiteurs) selon l'heure locale du serveur | Pondéré par le nombre de requêtes (admin et clics compris). |
| **Actions** | Préfixe du texte libre (`ACTIONS`, `statistiques.js:8-19`) | **Falsifiable** : un `POST /api/log` avec `Admin clic sur Valider foodtruck : X` est compté comme une validation (vérifié). |
| **Foodtrucks consultés** | Évènements `Consultation : <nom>` sur clic gauche d'un lien | Ne distingue pas site et Google Maps ; clic molette / « ouvrir dans un nouvel onglet » non comptés ; homonymes et établissements multi-lieux fusionnés ; un renommage coupe l'historique. |
| **Tris, navigateurs** | Évènements ; IP distinctes par famille de navigateur | Une IP peut compter dans plusieurs familles. |

#### Évènements non enregistrés

Sessions, nouveaux/récurrents, durée, ouverture d'une fiche (il n'y a pas de fiche), distinction site/Maps, erreurs
JavaScript, refus de validation côté navigateur, identité de l'administrateur, enregistrement serveur des suggestions,
chargement initial distinct d'un clic sur un jour.

#### Différences avec les journaux du serveur

- `acces.log` ignore les fichiers statiques (`.css`, `.js`, `.png`) ; les journaux d'un proxy ou d'IIS les incluraient
  (≈ ×3 à ×5 de requêtes).
- `pm2 logs` ne contient que la console (erreurs, mails) : aucun chiffre d'audience.
- Derrière un proxy, l'IP de `acces.log` dépend de `TRUST_PROXY` ; le proxy, lui, voit l'IP du poste.

#### Améliorations possibles sans changer l'architecture

Exclure de l'audience `/admin`, `/api/admin`, `/api/log`, les statuts ≥ 400 et les robots ; normaliser les chemins
(minuscules, décodage) ; envoyer `Jour sélectionné` seulement sur clic et un évènement `Chargement` distinct ;
remplacer le texte libre par une **liste blanche d'évènements typés** ; journaliser les suggestions côté serveur ;
séparer `clic_site` et `clic_maps` ; écouter `auxclick` ; afficher sur la page des statistiques une note sur les biais.

### 2.10 Tests

- 21 tests (11 unitaires, 10 API) : CSV, validation, statistiques, parcours admin complet, 401, 409, JSON invalide,
  journal corrompu, dossier `data/` non exposé. Bonne couverture du cœur.
- Lacunes : contrôle d'accès des **pages** admin (le contournement n'est pas couvert), `/api/log` (contenu, taille,
  falsification), `TRUST_PROXY`, concurrence (deux écritures simultanées), front-end (aucun test navigateur ; vérifié
  manuellement selon la doc), comportement Windows (renommage, chemins).

### 2.11 Déploiement et exploitation

- pm2 + scripts `.bat`, `.env` hors livraison, zip produit par `scripts/preparer-livraison.sh` (exige `zip` sur un
  poste Linux/macOS).
- **Mise à jour par extraction par-dessus** : un fichier supprimé dans une nouvelle version **reste sur le serveur** et
  reste servi s'il est dans `public/`.
- `npm install --omit=dev` sur le serveur : nécessite l'accès au registre npm (Internet ou miroir interne). À défaut,
  livrer `node_modules` dans le zip (les dépendances actuelles sont du JavaScript pur, sans compilation).
- Sauvegarde : manuelle (copier `data\`). Pas de rotation des journaux : la procédure documentée remet les
  statistiques à zéro.
- Node écoute sur **toutes les interfaces** (`server.js:12`) : sans importance aujourd'hui, crucial si une
  authentification par en-tête de proxy est ajoutée (§6.5, approche D).

### 2.12 Problèmes techniques importants relevés

| # | Problème | Preuve | Impact | Correctif proposé |
|---|---|---|---|---|
| 1 | **Pages d'administration lisibles sans mot de passe** via un chemin encodé : `/%61dmin/index.html`, `/%61dmin/statistiques.js` → 200 | [Constaté] instance temporaire | Faible aujourd'hui (le HTML/JS admin ne contient pas de données ; les API restent protégées), mais c'est un contournement d'authentification | Ne pas servir `public/admin` par le statique général (déplacer dans `admin/` hors de `public/`, ou `express.static` avec exclusion) ; test dédié (**T1**) |
| 2 | **`/api/log` ouvert** : texte libre, sans limite de fréquence ; les libellés admin sont comptés comme actions admin | [Constaté] évènement `Admin clic sur Valider…` forgé et compté | Statistiques falsifiables ; un script peut remplir le disque (300 car. × requêtes illimitées) | Liste blanche d'évènements typés, refus des types serveur, limite par IP/navigateur (**T2**) |
| 3 | **Aucune limite sur les suggestions**, aucun anti-doublon | [Constaté] 50 suggestions acceptées d'affilée ; doublon exact de « Moya » accepté | Fichier et boîte mail de l'admin inondables par erreur (double clic, script) ; doublons | Limite de fréquence + détection de doublon (**T3**) |
| 4 | **`TRUST_PROXY=true` fait confiance à tout `X-Forwarded-For`** (`app.set('trust proxy', true)`) | [Constaté] IP journalisée = valeur forgée | IP falsifiables dans les journaux et pour toute future limite de fréquence | Valeur explicite : `loopback` ou l'IP du proxy (**T4**) |
| 5 | **Adressage par index** des établissements | Code | Bloque avis, historique, favoris, stats par établissement | Colonne `id` stable (**T5**) |
| 6 | Pas d'en-têtes de sécurité (CSP, `X-Content-Type-Options`, `frame-ancestors`) | Code | Aucune défense en profondeur le jour où des commentaires libres sont affichés | **T6**, avant l'ouverture des avis |
| 7 | Protection CSRF **incidente** : seules les requêtes `application/json` sont lues, ce qui force un *preflight* CORS | Code + test `text/plain` → 400 | Correct aujourd'hui ; fragile si un formulaire classique ou un cookie d'identité est ajouté | Vérifier l'en-tête `Origin` sur toute écriture (**T7**) |
| 8 | Pas de sauvegarde automatique ni de rétention des journaux (IP conservées sans limite) | Doc + code | Perte de données en cas d'erreur ; non-conformité probable aux durées de conservation | **T8**, **T9** |
| 9 | Compte admin unique, Basic sur HTTP, sans limitation d'essais | Code | Mot de passe partagé, interceptable sur le réseau, actions non attribuées | HTTPS (**T11**), admins nominatifs (**T13**) |
| 10 | Mise à jour par écrasement + `npm install` en ligne | `scripts/*.bat` | Fichiers obsolètes servis ; échec de mise à jour sans accès npm | **T12** |

### 2.13 Point de vue utilisateur

Un collègue qui ouvre le site à 11 h 50 voit une liste de 3 à 8 noms avec une cuisine, un prix et « Voir sur Google
Maps ». Il ne sait pas : *où* c'est sans ouvrir Maps (et sans Internet sur le poste, le lien ne marche pas), si le
camion est vraiment là aujourd'hui, si c'est bon, s'il accepte les titres-restaurant, ni ce que ses collègues en
pensent. Il n'a aucune raison de revenir demain plutôt que de se fier à l'habitude. Ce constat oriente les priorités.

---

## Partie 3 — Catalogue des améliorations

Colonne « Identité » : **Aucune** = fonctionne sans aucune identification ; **Navigateur** = identifiant anonyme de
navigateur (cookie) ; **Pseudo** = pseudonyme déclaré facultatif ; **SSO** = identité vérifiée. Colonne « Données
perso » : ce qui est conservé et où. Colonne « Réalisable » : **Immédiat** (architecture actuelle) ou **Évol.**
(demande une évolution d'architecture ou d'infrastructure).

### 3.1 Socle technique et sécurité (T)

| ID | Fonctionnalité | Description | Besoin | Valeur | Diff. | Dépendances | Risques | Prio |
|---|---|---|---|---|---|---|---|---|
| T1 | Fermer l'accès aux pages admin | Sortir `admin/` de `public/` ou exclure du statique général ; test | Sécurité | Supprime un contournement | XS | — | Aucun | P1 |
| T2 | Journal d'usage typé et protégé | Liste blanche `{type, cible, page}`, types serveur interdits côté client, taille et fréquence limitées | Fiabilité stats | Stats non falsifiables | S | — | Perte des anciens libellés (garder la lecture rétro-compatible) | P1 |
| T3 | Limites de fréquence | Compteur en mémoire par IP/navigateur sur toutes les écritures publiques (ex. 20 écritures/10 min) | Éviter abus involontaires | Protège disque, mail, données | S | — | Faux positifs derrière un NAT → seuils larges | P1 |
| T4 | `TRUST_PROXY` explicite | Accepter `loopback` / IP du proxy au lieu de `true` | Fiabilité IP | IP non falsifiable | XS | Connaître le proxy | Aucun | P1 |
| T5 | Identifiant stable + métadonnées | Colonnes `id`, `cree_le`, `maj_le`, `statut`, `version` dans le CSV ; migration automatique au démarrage | Prérequis collaboratif | Avis, historique, favoris, stats par établissement | M | — | Migration des données → sauvegarde préalable, test | P1 |
| T6 | En-têtes de sécurité | CSP stricte (`script-src 'self'`), `nosniff`, `frame-ancestors 'none'`, `Referrer-Policy` ; retirer les `style=""` en ligne | Sécurité | Défense en profondeur contre le XSS | S | — | Casser un style en ligne → tester les pages | P1–P2 |
| T7 | Contrôle `Origin` sur les écritures | Refuser POST/PUT/DELETE d'une autre origine | Anti-CSRF | Protège les futures écritures par cookie | XS | — | Nom d'hôte multiple → liste configurable | P2 |
| T8 | Sauvegarde automatique | Copie horodatée quotidienne de `data/` (tâche planifiée Windows ou interne à l'app), rétention 30 j, procédure de restauration testée | Robustesse | Retour arrière garanti | S | Accès serveur / tâche planifiée | Sauvegarde sur le même disque → prévoir une copie ailleurs (IT) | P1 |
| T9 | Rotation et rétention des journaux | Fichiers mensuels, purge automatique (durées §6.8), agrégats conservés | RGPD, perf | Données minimisées, stats durables | S | Décision sur durées | Perte d'historique brut (assumée) | P1 |
| T10 | Renommage robuste sous Windows | Réessais courts sur `EPERM/EBUSY` | Robustesse | Évite des 500 aléatoires | XS | — | — | P2 |
| T11 | HTTPS interne | Certificat de la PKI d'entreprise, éventuellement via IIS/proxy | Sécurité, fonctionnalités | Protège mot de passe/cookies ; débloque géolocalisation, presse-papiers, PWA | M–L | **Équipe IT** (certificat, DNS) | Configuration à maintenir (renouvellement) | P2 |
| T12 | Livraison autonome | Zip contenant `node_modules` ; suppression des fichiers obsolètes (installer dans un nouveau dossier puis basculer) | Exploitation hors Internet | Mise à jour sans registre npm | S | — | Zip plus gros | P2 |
| T13 | Administrateurs nominatifs | 2–5 comptes (fichier de hachés ou groupe AD si SSO) ; actions attribuées | Traçabilité | Savoir qui a fait quoi | S | (SSO optionnel) | — | P3 |
| T14 | Agrégats statistiques | Calcul quotidien (ou en cache) au lieu de relire tous les journaux | Performance | Stats instantanées même avec plus d'évènements | S | T9 | — | P3 |

### 3.2 Expérience utilisateur (U)

| ID | Fonctionnalité | Description | Besoin | Valeur | Diff. | Dépendances | Risques | Prio | Identité / données perso | Réalisable |
|---|---|---|---|---|---|---|---|---|---|---|
| U1 | Recherche + filtres | Champ de recherche, filtres cuisine, prix max, « ouvert/confirmé aujourd'hui », combinables, mémorisés localement | « Je veux des asiatiques à moins de 12 € » | Choix en 5 s | S | U2 pour la cuisine | Trop de filtres → 3 maximum visibles | P1 | Aucune | Immédiat |
| U2 | Catégories de cuisine et étiquettes | Liste fermée de catégories + étiquettes (végétarien possible, halal, sans gluten…) ; libellé libre conservé | Filtrer, préférences alimentaires | Données comparables | S | T5 | Étiquettes déclaratives → afficher « signalé par des collègues » | P1 | Aucune | Immédiat |
| U3 | Fiche établissement | Panneau/modale : lieu, jours, horaires, paiement, prix, avis, confirmations du jour, historique, liens | Tout savoir au même endroit | Support de toutes les contributions | M | T5 | Surcharge → sections repliées | P1–P2 | Aucune | Immédiat |
| U4 | Lieu lisible et regroupement | Champ `lieu` (« Parking Nord », « Place Y ») + temps de marche saisi une fois ; tri/regroupement par lieu ; remplace le tri sur URL | « C'est où ? » sans Internet | Décision sans ouvrir Maps | S | T5 | Lieux à créer une fois (contribution) | P1 | Aucune | Immédiat |
| U5 | Vue semaine | Grille Lundi–Vendredi × établissements, favoris en surbrillance | Planifier la semaine | Vision d'ensemble | S | — | Lisibilité mobile → liste par jour | P2 | Aucune | Immédiat |
| U6 | « Au hasard » | Tire un établissement du jour parmi les résultats filtrés, option « que je n'ai pas essayé » | « Je ne sais pas quoi manger » | Ludique, utile, 20 lignes de code | XS | U1 (U8 optionnel) | Gadget si mis trop en avant → bouton discret | P1 | Aucune | Immédiat |
| U7 | Favoris locaux | Étoile sur une fiche ; bandeau « Vos favoris présents aujourd'hui : … » | Retrouver vite ses options | Raison de revenir | S | T5 | Perte si cookies/stockage effacés ; pas de synchro entre postes | P1 | Aucune ; stocké **dans le navigateur** (`localStorage`) | Immédiat |
| U8 | « Déjà essayé » / « À tester » | Marques locales ; filtre « pas encore essayé » | « Qu'est-ce que je n'ai pas essayé ? » | Découverte | S | T5 | Idem U7 | P2 | Aucune ; navigateur | Immédiat |
| U9 | Nouveautés | Badge « Nouveau » 15 jours, encadré « Nouveaux cette semaine » | Découvrir les nouvelles adresses | Vie du site | XS | T5 (`cree_le`) | — | P1 | Aucune | Immédiat |
| U10 | Partage | Liens directs (`/?jour=jeudi&fiche=12`) ; bouton « Copier le programme du jour » (texte prêt à coller dans Teams/mail) | Proposer un déjeuner aux collègues | Diffusion du site | S | T5 ; T11 pour l'API presse-papiers (repli sans HTTPS) | — | P2 | Aucune | Immédiat |
| U11 | Horaires et paiements | Champs horaires (11h30–14h), titres-restaurant (papier/carte), CB, espèces | « Est-ce qu'il prend la carte Swile/ticket ? » | Info décisive au quotidien | S | T5 | Info périmée → confirmation C4/C5 | P1 | Aucune | Immédiat |
| U12 | Confort d'affichage | Barre des jours collante sur mobile, cartes plus aérées, thème sombre, accessibilité clavier/contraste | Usage téléphone | Agrément | S | — | — | P3 | Aucune | Immédiat |
| U13 | Préférences alimentaires locales | Filtres par défaut (ex. végétarien) mémorisés | Personnalisation | Gain de temps | XS | U1, U2 | — | P3 | Aucune ; navigateur | Immédiat |
| U14 | Carnet personnel | « J'y ai mangé le … » local, statistiques personnelles (« 12 adresses testées ») | Historique personnel | Ludique | S | U8 | Gadget → optionnel | P4 | Aucune ; navigateur | Immédiat |
| U15 | Plan local des emplacements | Image/SVG du quartier servie par le site avec les lieux numérotés | Se repérer **sans Internet** | Remplace Maps pour l'essentiel | M | U4 | Plan à dessiner une fois | P3 | Aucune | Immédiat |
| U16 | Distance réelle par géolocalisation | Calcul de distance depuis la position du navigateur | Distance | Faible ici (tout le monde part du même lieu) | M | **HTTPS obligatoire** (contexte sécurisé) | Demande de permission, donnée de localisation | Non recommandé (U4 suffit) | Localisation (non stockée) | Évol. |

### 3.3 Collaboration (C)

| ID | Fonctionnalité | Description | Besoin | Valeur | Diff. | Dépendances | Risques | Prio | Identité |
|---|---|---|---|---|---|---|---|---|---|
| C1 | Publication directe d'un établissement | Formulaire « Ajouter » publié immédiatement, avec détection de doublons (nom approché, même lieu/lien) et confirmation explicite si ressemblance | Enrichir sans attendre l'admin | Contenu à jour, implication | M | T3, T5, C3 | Doublons, erreurs → C3, C9, C14 | P2 | Navigateur (+ pseudo) |
| C2 | Modification des informations factuelles | Jours, horaires, prix, lieu, paiements, site éditables par tous ; conflit si la fiche a changé entre-temps (409 réutilisé) | Corriger sans passer par mail | Fiabilité | M | T5, C3 | Modifications accidentelles → historique + annulation | P2 | Navigateur (+ pseudo) |
| C3 | Historique et restauration | Chaque modification enregistre avant/après, date, auteur (navigateur/pseudo) ; bouton « Restaurer cette version » | Réparer une erreur | Rend la publication directe sûre | M | T5 | Croissance du fichier (faible) | P2 | — |
| C4 | Confirmation de présence du jour | Boutons « Il est là ✔ » / « Pas là aujourd'hui ✖ » ; affichage « Confirmé par 3 collègues à 12h05 » ; remise à zéro chaque jour | « Est-il vraiment là ? » | **Info la plus utile au quotidien**, moteur de retour | S | T5, T3 | Vote multiple → 1 par navigateur et par jour | P2 | Navigateur |
| C5 | Signalements | « N'est plus présent », « Fermé exceptionnellement le … » (date), « Info erronée », « Contenu inapproprié » ; effets automatiques (§5.6) | Remonter un problème | Données fraîches | S | T5 | Signalement malveillant → seuils + historique | P2 | Navigateur |
| C6 | Avis courts | Note 1–5 obligatoire, commentaire ≤ 280 caractères facultatif, critères optionnels (qualité-prix, portions, attente), « plat conseillé » | Partager son expérience | Aide au choix, vie du site | M | T5, T6, T7, I1 | Contenu déplacé → signalement, masquage | P2 | Navigateur (+ pseudo) |
| C7 | Modifier / supprimer son avis | Un avis par navigateur et par établissement, modifiable ; suppression logique | Corriger | Confiance | (inclus C6) | Jeton navigateur | Changement de navigateur = nouvel avis possible | P2 | Navigateur |
| C8 | Classements | « Les mieux notés » (moyenne bayésienne, ≥ 3 avis), « Coups de cœur du mois », « Les plus confirmés » | Découvrir | Émulation | S | C6 | Effet de popularité → afficher le nombre d'avis | P3 | — |
| C9 | Fil « Quoi de neuf » | Derniers ajouts, modifications, avis, fermetures signalées | Suivre l'actualité | Vie du site + **modération a posteriori par tous** | S | C1–C6 | — | P2 | — |
| C10 | Bons plans datés | Message court attaché à une fiche (« Menu spécial couscous jeudi », « −20 % cette semaine »), expire automatiquement | Partager une info ponctuelle | Fraîcheur | S | T5, T6 | Publicité déguisée → signalement | P3 | Navigateur (+ pseudo) |
| C11 | « On y va ? » | Proposition du jour : « Je vais chez X à 12h15 » + « Je viens » ; disparaît à 14 h | Déjeuner ensemble | Usage social original | M | I1 ou SSO | Donnée quasi nominative, risque gadget | P4 | Pseudo / SSO |
| C12 | Tableau « À surveiller » (admin) | Signalements ouverts, contenus masqués automatiquement, modifications de champs sensibles, activité inhabituelle | Intervenir rarement mais vite | Admin en filet de sécurité | S | C3, C5 | — | P2 | Admin |
| C13 | Masquage automatique | Avis masqué après 3 signalements de navigateurs distincts, en attente de décision admin | Gérer l'inapproprié sans admin en temps réel | Réactivité | XS | C5 | Abus du signalement → visible dans C12 | P2 | — |
| C14 | Fusion de doublons | L'admin fusionne deux fiches (avis et historique rattachés) | Cohérence | Propreté | S | T5, C3 | — | P3 | Admin |

### 3.4 Statistiques (S) et identification (I)

| ID | Fonctionnalité | Description | Besoin | Valeur | Diff. | Dépendances | Risques | Prio |
|---|---|---|---|---|---|---|---|---|
| S1 | Corriger les indicateurs actuels | Exclusions (admin, API, ≥ 400, robots), normalisation des chemins, libellés honnêtes, suggestions comptées côté serveur | Chiffres justes | Décisions fondées | S | — | Rupture de série → l'indiquer | P1 |
| S2 | Évènements typés | `{ts, v, s, type, cible, page, version}` (§6.3) | Mesurer les fonctionnalités | Répond aux questions du §7 | S | T2 | — | P1 |
| S3 | Identifiant anonyme de navigateur | Cookie 1re partie aléatoire, 13 mois max, non nominatif | Compter des navigateurs plutôt que des IP | DAU/WAU/MAU, retour, rétention | S | Information des collègues / avis DPO | Voir §6.5-B | P1 |
| S4 | Tableau de bord refondu | §6.4 | Piloter | Lisibilité | M | S1–S3, T14 | — | P3 |
| S5 | Agrégats et rétention | Agrégats quotidiens conservés, brut purgé | RGPD, perf | — | S | T9 | — | P3 |
| S6 | Marqueurs de version | Les dates de mise en production apparaissent sur les courbes | « Le site gagne-t-il en popularité après X ? » | Mesure d'impact | XS | S4 | — | P3 |
| I1 | Pseudonyme déclaratif | Nom affiché facultatif mémorisé dans le navigateur, joint aux contributions | Attribuer sans compte | Convivialité | S | S3/jeton | Usurpation de nom → mention « déclaré » | P2 |
| I2 | SSO Windows (Kerberos/NTLM) via proxy ou SSPI | §6.5-D | Identité vérifiée | Attribution fiable, 1 avis par personne | L | **IT** : domaine, SPN, navigateurs, HTTPS | Usurpation d'en-tête si mal monté | P3 (conditionnel) |
| I3 | Lien de connexion par mail interne | Saisie de l'adresse pro → lien à usage unique via le SMTP déjà configuré → cookie longue durée | Identité vérifiée sans AD | Alternative légère à I2 | M | SMTP interne (existant) | Stockage des adresses ; habitudes de clic sur liens | P3 (alternative) |
| I4 | Fournisseur d'identité d'entreprise (OIDC) | ADFS, Keycloak ou Entra ID | Identité vérifiée standard | Robuste, groupes | L | **IT** ; Entra ID = **Internet** | Dépendance externe | P4 |

### 3.5 Fiches détaillées des fonctionnalités clés

**C4 — Confirmation de présence du jour**
- *Besoin* : savoir si le camion est vraiment là avant de marcher 5 minutes sous la pluie.
- *Fonctionnement* : sur la fiche et dans la liste, deux boutons. Le premier collègue qui passe devant confirme ;
  l'affichage devient « ✔ Confirmé par 2 collègues (dernière 12h05) » ou « ⚠ Signalé absent par 1 collègue ».
  Une confirmation par navigateur, par établissement et par jour, modifiable.
- *Données* : `{date, etablissement, etat, navigateur, ts}` ; purge après 90 jours, agrégat conservé (taux de présence
  réel par jour de semaine → permet à terme de détecter qu'un camion n'est plus là le mardi).
- *Évolution* : suggestion automatique de correction des jours si absences répétées (« Absent 3 mardis de suite :
  retirer le mardi ? »).

**C1/C2/C3 — Contribution directe versionnée** : voir Partie 5.

**C6 — Avis courts** : voir Partie 5 §5.4.

**U4 — Lieu lisible**
- *Données* : petit référentiel `lieux` (`id`, nom, description, temps de marche, lien Maps facultatif). Chaque
  établissement référence un lieu par jour (un établissement multi-lieux = une seule fiche avec un lieu par jour, ce
  qui supprime les doublons de type L'épicurieux).
- *Évolution* : U15 (plan local), regroupement « Au parking Nord aujourd'hui : 3 camions ».

**U7/U8 — Favoris et « déjà essayé » locaux**
- *Fonctionnement* : `localStorage` (liste d'`id`). Aucune requête serveur, aucune donnée personnelle côté serveur.
  Mention dans l'aide : « vos favoris sont gardés dans ce navigateur uniquement ».
- *Évolution* : synchronisation entre postes uniquement si une identité est mise en place (I2/I3) — c'est la seule
  raison de lier favoris et identification.

---

## Partie 4 — Parcours utilisateur cible

Situation après les phases 1 et 2.

### 4.1 Consultation quotidienne (11 h 45, poste de travail)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ 🍴 Où manger aujourd'hui ?                         [Rechercher…        ] 🎲 │
│ [Lun] [Mar] [●Mer] [Jeu] [Ven]   [Semaine]                                   │
│ ★ Vos favoris présents aujourd'hui : Moya, Ô Tuk Tuk                         │
│ Filtres : [Cuisine ▾] [Prix max ▾] [✔ Confirmés aujourd'hui]  [Pas essayé]   │
├──────────────────────────────────────────────────────────────────────────────┤
│ PARKING NORD · 3 min à pied                                                  │
│  ★ Moya          Mexicain   10–14 €  ★4,3 (12)  ✔ confirmé 11h40 (2)  🎫 CB  │
│    Ô Tuk Tuk     Asiatique  10–15 €  ★4,0 (7)   — pas encore confirmé  🎫    │
│ PLACE DU MARCHÉ · 6 min                                                      │
│    L'épicurieux  Bagel      12 €     ★3,8 (5)   ⚠ signalé absent (1)   CB    │
│    Pickles       Salad bar  10–15 €  NOUVEAU    — 0 avis                     │
├──────────────────────────────────────────────────────────────────────────────┤
│ Quoi de neuf : Pickles ajouté par Camille · Spice Box fermé le 24/10 · …     │
└──────────────────────────────────────────────────────────────────────────────┘
```

Sur téléphone : même contenu en cartes, barre des jours et recherche collées en haut.

### 4.2 Recherche et choix

1. Le collègue tape « thaï » ou filtre « Asiatique » + « ≤ 12 € » : la liste se réduit, les filtres restent mémorisés.
2. Il compare : note et nombre d'avis, prix, temps de marche, confirmation du jour, paiements acceptés, côte à côte.
3. Indécis, il clique 🎲 « Au hasard » (option « que je n'ai pas essayé ») → la fiche s'ouvre avec un bouton
   « Copier pour Teams » : *« Midi : Ô Tuk Tuk (asiatique, 10–15 €), parking Nord, confirmé à 11h40 — on y va ? »*.

### 4.3 Ajout d'un établissement

1. « + Ajouter un établissement » → formulaire court : nom, type (foodtruck / restaurant), cuisine (liste), jours,
   lieu (liste des lieux connus ou « nouveau lieu »), prix, paiements, lien Maps et site facultatifs.
2. À la saisie du nom : « Un établissement ressemble à celui-ci : *Moya (Mexicain, mercredi, Parking Nord)*.
   C'est le même ? [Ouvrir sa fiche] [Non, c'est un autre] ».
3. Publication immédiate, message « Merci ! Visible par tous. Vous pouvez le corriger pendant 30 min depuis ce
   navigateur ; ensuite tout le monde peut l'améliorer. » ; l'ajout apparaît dans « Quoi de neuf » avec le badge
   Nouveau.

### 4.4 Publication d'un avis

Sur la fiche : ★★★★☆ (obligatoire), « Votre avis en une phrase » (280 caractères), menus déroulants facultatifs
(Qualité-prix / Portions / Attente : < 5 min, 5–15 min, > 15 min), « Plat conseillé ». Signature : pseudonyme
facultatif (« Camille ») ou « Un collègue ». Publication immédiate ; la moyenne et le nombre d'avis se mettent à jour.
Si ce navigateur a déjà donné un avis : le formulaire s'ouvre prérempli en mode « Modifier mon avis ».

### 4.5 Modification d'une contribution

- *Une information factuelle* : « Modifier les infos » sur la fiche → mêmes champs que l'ajout ; enregistrement
  immédiat ; si quelqu'un a modifié la fiche entre-temps : « La fiche vient d'être modifiée par un collègue,
  voici les différences — [Recharger] ». Chaque modification apparaît dans l'onglet « Historique » de la fiche avec
  « Restaurer cette version ».
- *Son avis* : « Modifier » / « Supprimer » visibles uniquement sur ses propres avis (même navigateur).

### 4.6 Signalement d'une erreur

« Signaler » sur la fiche : *N'est plus présent* · *Fermé exceptionnellement le [date]* · *Info erronée (préciser)* ·
*Contenu inapproprié* (sur un avis). Effet visible immédiatement (§5.6), sans attendre l'administrateur. Si
l'information est simplement fausse, le collègue est invité à la corriger lui-même (« Modifier les infos »).

---

## Partie 5 — Fonctionnement collaboratif recommandé

### 5.1 Principe : « wiki de confiance, réparable »

Tout le monde publie directement ; **rien n'est perdu** (historique, suppression logique) ; **tout est visible**
(fil « Quoi de neuf ») ; **les collègues se corrigent entre eux** ; l'administrateur n'est qu'un **filet de
sécurité**. C'est le modèle qui offre le meilleur rapport simplicité/sécurité pour une communauté interne de
quelques dizaines à quelques centaines de personnes : la validation préalable coûte du temps admin et décourage, alors
que la réparation a posteriori ne coûte presque rien si l'historique est fiable.

Comparatif des garde-fous envisagés :

| Mécanisme | Coût | Protection | Recommandé |
|---|---|---|---|
| Validation préalable systématique | Élevé (admin), friction forte | Forte | **Non** (sauf rien) |
| Publication immédiate + historique + restauration | Moyen (une fois) | Forte contre les erreurs | **Oui — pierre angulaire** |
| Suppression logique (statut `archive`/`masque`) | Faible | Forte | **Oui** |
| Signalement par les collègues + seuils automatiques | Faible | Bonne | **Oui** |
| Limites de fréquence | Faible | Bonne contre les accidents/scripts | **Oui**, seuils larges |
| Détection de doublons (avertissement, pas blocage) | Faible | Bonne | **Oui** |
| Délai de « grâce » 30 min pour l'auteur | Faible | Confort | Oui |
| Champs sensibles (nom, lien Maps) mis en évidence pour l'admin | Faible | Bonne | Oui (dans C12) |
| Validation pour les comptes « nouveaux » / réputation | Élevé | Moyenne | Non (disproportionné) |
| Filtre de mots grossiers | Moyen, faux positifs | Faible | Non (le signalement suffit) |

### 5.2 Identification des contributeurs

- **Par défaut** : identifiant anonyme de navigateur (cookie aléatoire, voir §6.5-B) qui sert de **jeton d'auteur**
  (« ce navigateur a écrit cet avis, il peut le modifier »). Aucune donnée nominative.
- **Facultatif** : pseudonyme déclaré, mémorisé dans le navigateur, affiché sous la contribution avec la mention
  « nom déclaré ». Il n'a aucune valeur de preuve.
- **Si vous voulez une attribution vérifiée** (décision n° 1) : SSO Windows ou lien par mail (I2/I3), en phase 3. Le
  modèle de données prévoit dès le départ un champ `auteur` qui pourra contenir un identifiant vérifié.

### 5.3 Informations factuelles (fiche établissement)

- Éditables par tous ; chaque enregistrement crée une **version** (avant/après, date, auteur).
- Concurrence : version attendue envoyée avec la modification ; si elle a changé → 409 et affichage des différences
  (généralisation du mécanisme `retrouver` existant).
- « N'est plus présent » ne supprime pas : statut `incertain` puis `archive` (§5.6) ; restaurable.
- Les informations factuelles sont **séparées visuellement** des avis : bloc « Infos (modifiables par tous) » vs bloc
  « Avis des collègues (opinion personnelle, signés) ».

### 5.4 Notes et avis

- **Un avis par navigateur et par établissement** (modifiable). Avec SSO : un par personne.
- Contenu : note 1–5 obligatoire ; commentaire ≤ 280 caractères en **texte brut** (affiché avec `textContent`,
  jamais `innerHTML`) ; critères optionnels à choix fermés (pas de texte libre supplémentaire) ; plat conseillé ≤ 60
  caractères.
- Date affichée (« il y a 3 jours »), mention « modifié » si édité.
- **Moyenne** : moyenne simple affichée avec le nombre d'avis (« ★ 4,3 · 12 avis ») ; en dessous de 3 avis :
  « Pas encore assez d'avis ». Pour les **classements** : moyenne bayésienne
  `(C × m + Σnotes) / (C + n)` avec `m` = moyenne générale, `C` = 3, pour éviter qu'un seul 5★ arrive premier.
  Option : pondérer les 12 derniers mois.
- **Nombre de participants** : nombre d'avis non masqués ; pour les confirmations, nombre de navigateurs distincts du
  jour.
- **Prévention des votes multiples** : cookie + limite par IP (larges) ; on assume qu'un collègue *déterminé* peut
  voter deux fois (autre navigateur). Pour un site de déjeuner interne, c'est acceptable ; si ce n'est pas le cas,
  c'est l'argument principal pour le SSO.

### 5.5 Doublons

À l'ajout : normalisation (minuscules, sans accents ni ponctuation, sans mots vides « le », « food », « truck ») et
comparaison approchée (distance d'édition ≤ 2 ou inclusion) + même lieu/même lien Maps → avertissement avec lien vers
la fiche existante. Pas de blocage. Doublon passé quand même : signalement « Doublon de… » → fusion par l'admin (C14).

### 5.6 Signalements et effets automatiques

| Signalement | Effet immédiat | Effet au seuil | Admin |
|---|---|---|---|
| Fermé exceptionnellement le JJ/MM | Bandeau « Fermé le … » ce jour-là | — | — |
| Absent aujourd'hui (C4 ✖) | « Signalé absent par N » | — | — |
| N'est plus présent | Mention « Présence à confirmer » | 2 navigateurs distincts **et** aucune confirmation sur 14 j → statut `incertain` (affiché en fin de liste, grisé) ; 30 j sans confirmation → `archive` (masqué, restaurable) | Peut restaurer |
| Info erronée | Note visible sur la fiche, invitation à corriger | — | Visible dans C12 |
| Contenu inapproprié (avis) | — | 3 navigateurs distincts → avis **masqué** en attente | Rétablit ou supprime |

### 5.7 Modifications, suppressions, historique

- Pas de suppression physique par les utilisateurs : statut `masque`/`archive` + entrée d'historique.
- Suppression physique réservée à l'administrateur (purge d'un contenu illicite, demande d'effacement RGPD).
- Historique conservé tant que la fiche existe ; pour les avis, seules les versions courantes sont affichées.

### 5.8 Rôle résiduel de l'administrateur

Réservé à l'admin, **sans intervention dans le fonctionnement normal** :
- Tableau « À surveiller » (C12) consulté quand il le souhaite (ou résumé hebdomadaire par mail interne).
- Restaurer une version, rétablir/supprimer un contenu masqué, fusionner des doublons, purger, gérer les lieux et
  catégories, ajuster les seuils (fichier de configuration), bloquer temporairement un identifiant de navigateur
  abusif, exporter/sauvegarder, consulter les statistiques.

### 5.9 Équilibre confiance / simplicité / fiabilité

- *Confiance* : publication immédiate, pas de compte obligatoire.
- *Simplicité* : formulaires courts, choix fermés, un seul bouton pour confirmer la présence.
- *Fiabilité* : historique + restauration + seuils + visibilité du fil d'activité. Une charte de 5 lignes affichée
  sous les formulaires (« Restez factuel et bienveillant ; parlez des plats, pas des personnes… ») complète le
  dispositif.

---

## Partie 6 — Stratégie de statistiques et d'identification

### 6.1 Indicateurs à conserver (corrigés)

Pages vues (pages publiques, statut < 400), fréquentation par jour, activité par heure et par jour de semaine **en
visiteurs** (et non en requêtes), jours consultés (sur clic uniquement), actions, établissements consultés (séparés
site/Maps), navigateurs (par identifiant de navigateur). « Requêtes au serveur » est déplacé dans une section
technique (avec temps de réponse et erreurs).

### 6.2 Indicateurs à ajouter

**Essentiels**

| Indicateur | Calcul | Question |
|---|---|---|
| Navigateurs actifs jour / semaine / mois (DAU, WAU, MAU) | Identifiants de navigateur distincts ayant chargé une page publique sur la période | Combien de collègues utilisent le site ? |
| Nouveaux / récurrents | Nouveau = 1re apparition de l'identifiant dans la période ; récurrent = déjà vu avant | Le site attire-t-il de nouvelles personnes ? |
| Taux de retour à S+1 / M+1 | Part des navigateurs actifs une semaine qui reviennent la suivante | Les gens reviennent-ils ? |
| Visites (sessions) | Suite d'évènements d'un navigateur sans pause > 30 min (calculé, pas de cookie de session) | Fréquence d'usage |
| Utilisation des fonctionnalités | Part des visites utilisant recherche, filtre, hasard, favoris, vue semaine, fiche | Quelles fonctionnalités servent ? |
| Entonnoir de décision | Visite → fiche ouverte → clic Maps/site | Les gens consultent-ils les fiches sans aller sur Maps ? |
| Contributions | Ajouts, modifications, avis, confirmations, signalements par semaine ; contributeurs distincts | Le collaboratif fonctionne-t-il ? |
| Retour après contribution | Part des contributeurs revenus dans les 14 jours | Les contributeurs reviennent-ils ? |

**Secondaires** : établissements les plus consultés/confirmés/notés, recherches sans résultat (texte tronqué,
utile pour découvrir des manques), répartition mobile/poste, erreurs JavaScript, temps de réponse.

### 6.3 Modifications des journaux

1. **`usage-AAAA-MM.jsonl`** (audience, sans IP) :
   `{"ts":"…","v":"<identifiant navigateur haché>","type":"fiche_ouverte","cible":"ft_12","page":"/","ver":"3.2.0"}`.
   Types en liste blanche : `chargement`, `jour_clic`, `recherche`, `filtre`, `hasard`, `fiche_ouverte`, `clic_maps`,
   `clic_site`, `favori_ajout`, `favori_retrait`, `copie_partage`, `vue_semaine`… Les évènements de contribution
   sont écrits **par le serveur** au moment de l'enregistrement (non falsifiables).
2. **`acces-AAAA-MM.log`** (technique et sécurité) : conservé avec IP, mais rétention courte (§6.8) ; ne sert plus à
   l'audience.
3. Identifiant stocké **haché avec un secret serveur** (HMAC) : les journaux seuls ne permettent pas de rejouer un
   cookie ni de relier un journal au jeton d'auteur des contributions.
4. Exclusions : `/admin`, `/api/admin`, robots, statuts ≥ 400.
5. Agrégats quotidiens (`stats-jours.json`) conservés au-delà de la purge du brut.

### 6.4 Tableau de bord proposé (une page, lisible en 30 secondes)

```
Période : [7 j] [30 j] [Trimestre] [Personnalisée]       comparé à la période précédente
┌─────────────┬─────────────┬─────────────┬─────────────┬─────────────┐
│ Actifs/jour │ Actifs/sem. │ Nouveaux    │ Retour S+1  │ Contribut°  │
│  14  ▲ +4   │  38  ▲ +9   │   6         │   52 %      │  23 (9 pers)│
└─────────────┴─────────────┴─────────────┴─────────────┴─────────────┘
[Courbe : actifs/jour + actifs/semaine glissante, marqueurs de versions ▼v3.1 ▼v3.2]
[Barres empilées : nouveaux vs récurrents par semaine]   [Heure × jour de semaine (carte de chaleur)]
[Entonnoir : visites → fiche → Maps/site]               [Fonctionnalités : % des visites]
[Tableau établissements : consultés · confirmés · avis · note]   [Contributions par type et par semaine]
▸ Détails techniques (requêtes, erreurs, navigateurs, temps de réponse)
▸ Limites de mesure (texte fixe expliquant ce que « navigateur actif » veut dire)
```

Les chiffres sont des **navigateurs**, pas des personnes : le libellé doit le dire (« ≈ collègues ») et la page
rappelle les limites.

### 6.5 Stratégies d'identification

#### Approche A — Adresse IP (actuelle)

- *Fonctionnement* : l'IP source de la connexion TCP (ou de `X-Forwarded-For` si proxy de confiance).
- *Limites* : plusieurs personnes derrière une IP (NAT, proxy, Wi-Fi invités, **postes virtuels VDI/Citrix** :
  tout le monde a l'IP du serveur de sessions) ; une personne change d'IP (DHCP, Wi-Fi/filaire, VPN, télétravail) ;
  un proxy mal déclaré écrase tout ; une IP n'est ni un navigateur, ni un poste, ni une personne.
- *Données réelles* : 168 des 250 IP n'apparaissent qu'un seul jour, 15 IP présentent plus de 3 navigateurs
  différents : impossible de distinguer « visiteur occasionnel » de « rotation DHCP », ou « IP partagée » de « mises
  à jour du navigateur ».
- *Usage recommandé* : sécurité et limites de fréquence uniquement, rétention courte.

#### Approche B — Identifiant anonyme persistant (cookie de navigateur)

- *Fonctionnement* : à la première requête sans cookie, le serveur pose `ft_v=<128 bits aléatoires>`
  (`HttpOnly`, `SameSite=Lax`, `Secure` si HTTPS, durée 13 mois non prolongée automatiquement au-delà). Chaque
  évènement est rattaché à cet identifiant (haché). Aucun JavaScript nécessaire, aucune dépendance.
- *Apport* : compte des **navigateurs**, distingue nouveaux/récurrents, mesure le retour, fonctionne derrière NAT et
  VDI (chaque session a son profil de navigateur), sert aussi de jeton d'auteur pour les contributions.
- *Limites* : effacement des cookies, navigation privée, changement de navigateur ou de poste, profils itinérants
  réinitialisés, téléphone + poste = 2 « visiteurs ». Tendance : **surestime** légèrement le nombre de personnes,
  mais de façon stable dans le temps — ce qui suffit pour suivre une tendance.
- *Confidentialité* : identifiant pseudonyme (donnée personnelle au sens du RGPD si on peut le rattacher à quelqu'un,
  par exemple via l'IP). Ne pas le croiser avec l'IP dans les rapports, ne jamais l'afficher, ne pas l'exporter.
- *Durée* : cookie ≤ 13 mois ; évènements bruts ≤ 13 mois (25 mois au maximum selon le cadre CNIL de la mesure
  d'audience) ; agrégats anonymes sans limite.
- *Précaution* : ne jamais présenter l'identifiant comme une identité (« navigateur n° … » plutôt que « utilisateur »).

#### Approche C — Identifiant saisi ou compte propre à l'application

- *Variante 1, pseudonyme déclaré* (recommandé pour les contributions) : aucune vérification, zéro friction, affiché
  « nom déclaré ». Risque : usurpation d'un nom de collègue (atténué par l'historique et le signalement).
- *Variante 2, compte avec mot de passe* : identité stable, synchronisation des favoris, mais il faut gérer création,
  mot de passe oublié, hachage, sessions, verrouillage — **coûteux et frictionnel** pour un site de déjeuner, et les
  collègues réutiliseront souvent leur mot de passe Windows : **déconseillé**.
- *Variante 3, lien de connexion par mail interne* (I3) : l'utilisateur saisit son adresse professionnelle, reçoit un
  lien à usage unique via le **SMTP interne déjà configuré**, obtient un cookie de session longue durée. Identité
  vérifiée (adresse pro), pas de mot de passe, pas d'AD. Coût moyen, données : adresses mail.

#### Approche D — Authentification Windows intégrée (Active Directory)

**Le navigateur n'envoie jamais spontanément le nom Windows.** Il ne le fait que si le **serveur demande une
authentification `Negotiate`** (Kerberos, repli NTLM) **et** si le navigateur est autorisé à répondre
automatiquement pour ce site. Conditions à réunir :

| Condition | Détail |
|---|---|
| Postes joints au domaine AD, session ouverte avec un compte du domaine | Sinon pas de ticket Kerberos ; téléphones et postes hors domaine n'auront pas de SSO |
| Serveur accessible par un **nom DNS** (pas une IP) | Kerberos repose sur le nom de service ; par IP, pas de Kerberos (repli NTLM ou échec) |
| **SPN** `HTTP/nom.du.serveur` enregistré sur le compte qui exécute le service | Opération de l'équipe AD ; pour un alias (CNAME), le SPN doit correspondre au nom utilisé |
| Navigateurs autorisés | Edge/Chrome sous Windows : site dans la zone « Intranet local » (GPO) ou stratégie `AuthServerAllowlist` ; Firefox : `network.negotiate-auth.trusted-uris` (stratégie) ; sinon une fenêtre de connexion apparaît |
| Composant serveur capable de `Negotiate` | Voir options ci-dessous |
| HTTPS recommandé | Kerberos fonctionne en HTTP, mais le cookie de session qui suit doit être protégé |
| NTLM | Repli possible mais **déprécié par Microsoft** ; ne pas en dépendre |

*Options techniques pour une application Node.js* — oui, **Node peut exploiter une identité déjà authentifiée par un
composant frontal**, sans implémenter l'authentification lui-même :

1. **IIS en frontal** (serveur Windows, rôle « Authentification Windows ») qui relaie vers Node :
   - via **HttpPlatformHandler** (`forwardWindowsAuthToken="true"`) : IIS transmet un *jeton Windows* (en-tête
     `X-IIS-WindowsAuthToken`) que Node doit exploiter avec du code natif → faisable mais technique ;
   - via **ARR/URL Rewrite** en proxy inverse avec un en-tête contenant l'utilisateur : montage répandu mais délicat
     (ordre d'exécution des modules, variables serveur autorisées) — **à valider par une maquette** ;
   - `iisnode` : n'est plus maintenu activement, à éviter.
2. **Apache httpd** avec `mod_auth_gssapi` (Linux surtout) ou équivalent SSPI sous Windows, puis
   `RequestHeader set X-Remote-User %{REMOTE_USER}s` vers Node.
3. **Node fait lui-même `Negotiate`** sur un serveur Windows joint au domaine, via un module natif SSPI (par ex.
   `node-expose-sspi`) : pas de frontal, mais dépendance native à surveiller (maintenance, binaires précompilés à
   vérifier, compatibilité de versions Node).
4. **Proxy d'identité** (ex. Keycloak avec fédération Kerberos + `oauth2-proxy`) : robuste mais lourd.

*Risque majeur — usurpation par en-tête* : si Node fait confiance à `X-Remote-User` sans garantie, **n'importe quel
poste peut envoyer `X-Remote-User: directeur`** directement au port de Node. Exigences : Node écoute **uniquement sur
`127.0.0.1`** (aujourd'hui il écoute sur toutes les interfaces, `server.js:12`) ou est filtré par pare-feu ; le
frontal **supprime** tout en-tête entrant du même nom avant d'ajouter le sien ; idéalement un **secret partagé**
(en-tête supplémentaire) vérifié par Node ; tests automatisés de refus.

*Contraintes avec l'architecture actuelle* : ajout d'un frontal (ou module natif), passage du port 80 au frontal,
écoute locale de Node, `TRUST_PROXY` précis, HTTPS conseillé, accès sans SSO à prévoir (téléphones, postes hors
domaine) : soit lecture seule anonyme, soit repli sur l'approche B.

#### Approche E — Autres solutions

- **Fournisseur d'identité d'entreprise via OIDC/SAML** (ADFS sur site, Keycloak interne, Entra ID) : standard,
  donne aussi les groupes (rôle admin). Entra ID est un **service en ligne** : incompatible avec la contrainte « sans
  Internet » si elle est stricte. Demande l'enregistrement de l'application par l'IT.
- **Lien de connexion par mail interne** : voir C-variante 3.
- *Non retenus* : nom de machine par DNS inverse (identifie un poste, pas une personne, et rien sous VDI) ;
  empreinte de navigateur (*fingerprinting*) — opaque, intrusive, déconseillée par la CNIL ; certificats clients —
  lourd à déployer.

### 6.6 Comparatif

| Critère | A. IP | B. Cookie anonyme | C1. Pseudo déclaré | C3. Lien par mail | D. SSO Windows | E. IdP OIDC |
|---|---|---|---|---|---|---|
| Précision du décompte | Faible (NAT/DHCP/VDI) | Bonne pour une tendance (surestime légèrement) | = B (s'appuie sur B) | Bonne pour les connectés seulement | Très bonne sur postes du domaine | Très bonne pour les connectés |
| Identification nominative | Non | Non | Déclarative, non fiable | Oui (adresse pro) | Oui (compte AD) | Oui |
| Modifications | Aucune | Middleware + journaux | Champ + stockage local | Écran de connexion, jetons, sessions | Frontal ou module natif, écoute locale, en-têtes | Client OIDC, sessions |
| Dépendance IT | Aucune (sauf proxy) | Aucune | Aucune | SMTP interne (existant) | **Forte** : domaine, SPN, DNS, GPO, éventuellement IIS/HTTPS | **Forte** ; Internet si Entra ID |
| Difficulté | — | S | S | M | L (+ délais IT) | L |
| Avantages | Déjà là | Simple, local, sans friction | Convivial | Vérifié sans AD | Transparent pour l'utilisateur | Standard, groupes |
| Inconvénients | Mesure faussée | Cookies effacés, multi-appareils | Aucune garantie | Une étape de connexion, adresses stockées | Téléphones/hors domaine exclus du SSO ; montage délicat | Infrastructure lourde |
| Risques de sécurité | IP falsifiable si `TRUST_PROXY` mal réglé | Vol de cookie (faible enjeu) ; HTTPS conseillé | Usurpation de nom | Liens transférés, boîtes partagées | **Usurpation par en-tête** si mal monté | Mauvaise configuration |
| Confidentialité | IP = donnée personnelle | Pseudonyme ; info des collègues | Faible | Donnée nominative | Nominative ; risque de surveillance perçue | Nominative |
| Maintenance | Nulle | Très faible | Très faible | Faible à moyenne | Moyenne (SPN, certificats, versions) | Moyenne |

### 6.7 Recommandation

- **Objectif 1 — mesurer le nombre de personnes** : **approche B** (cookie anonyme), immédiatement, combinée à
  l'IP pour la seule sécurité. Elle répond à toutes les questions du §7 avec une précision suffisante pour piloter, sans
  dépendre de l'informatique et sans donnée nominative. Un décompte « exact » des personnes n'apporterait rien de plus
  pour décider.
- **Objectif 2 — connaître nominativement les collaborateurs** : **pas nécessaire au départ**. Commencer par le
  pseudonyme déclaré + jeton de navigateur (C1). Si, après quelques mois, les avis multiples ou l'usurpation de noms
  posent un vrai problème, ou si vous voulez des favoris synchronisés entre postes, passer à **D (SSO Windows)** *si*
  l'IT confirme les prérequis, sinon à **C3 (lien par mail)**.
- **Jamais de statistiques d'audience nominatives** : même avec le SSO, l'identité sert à attribuer les contributions,
  pas à savoir *qui a consulté quoi*. Les statistiques restent calculées sur l'identifiant anonyme.

### 6.8 Prérequis à vérifier auprès de l'équipe informatique

*Immédiatement (utiles même sans SSO)* :
1. Y a-t-il un proxy, un NAT ou des postes virtuels (VDI/Citrix) entre les postes et le serveur ? Durée des baux DHCP ?
2. Par quel nom les collègues accèdent-ils au site (nom DNS, alias, IP) ?
3. Le serveur et `C:\SITES` sont-ils sauvegardés ? Peut-on planifier une tâche (sauvegarde, purge) ?
4. Version de Node installée sur le serveur ; le serveur a-t-il accès au registre npm ?
5. Les téléphones accèdent-ils au site (Wi-Fi interne, VPN) ?
6. Peut-on obtenir un certificat de la PKI interne pour HTTPS ?

*Pour le SSO (phase 3, si retenu)* :
7. Le serveur est-il joint au domaine ? Sous quel compte tournerait le service ?
8. L'équipe AD peut-elle enregistrer un SPN `HTTP/<nom>` ?
9. Navigateurs déployés (Edge, Chrome, Firefox) et possibilité d'ajouter le site à la zone Intranet / aux stratégies
   d'authentification ?
10. IIS est-il installé ou installable (rôle Authentification Windows) ? Existe-t-il un ADFS/Keycloak interne ?
11. Politique interne sur l'usage de l'identité AD par des applications non officielles.

### 6.9 Confidentialité, sécurité et cadre applicable

*Ceci n'est pas une analyse juridique : ce sont les points à examiner avec le DPO/correspondant RGPD et les RH.*

**Données strictement nécessaires au fonctionnement** : contenu des établissements ; contributions et leur auteur
(jeton ou pseudonyme) ; IP pour la sécurité et les limites de fréquence (rétention courte).

**Données facultatives de mesure d'audience** : identifiant anonyme de navigateur et évènements d'usage.

| Donnée | Finalité | Conservation proposée | Accès |
|---|---|---|---|
| IP dans `acces-*.log` | Sécurité, diagnostic | 6 mois (ordre de grandeur des recommandations CNIL sur la journalisation) | Admin technique |
| Identifiant de navigateur (cookie) | Audience, jeton d'auteur | Cookie 13 mois | — |
| Évènements d'audience bruts | Statistiques | 13 mois, puis agrégats anonymes | Admins (agrégats uniquement à l'écran) |
| Contributions (avis, modifications) | Fonctionnement | Tant que le contenu est publié ; effacement sur demande | Public (contenu) / admin (historique) |
| Pseudonyme / identité AD / adresse mail | Attribution | Comme les contributions | Public (nom affiché) |

Points d'attention :
- **Information des collègues** (RGPD art. 13–14) : une page « Données et confidentialité » courte, liée en pied de
  page : quoi, pourquoi, combien de temps, qui y accède, comment demander l'effacement.
- **Registre des traitements** (art. 30) : faire inscrire le traitement par le DPO.
- **Cookie d'audience** : la CNIL admet une exemption de consentement pour la mesure d'audience strictement limitée
  (finalité unique, statistiques anonymes, durée ≤ 13 mois, pas de recoupement, pas de transmission). L'applicabilité
  exacte à un intranet utilisé sur des postes professionnels est à confirmer avec le DPO ; en concevant B selon ces
  conditions, on reste dans le cas le plus favorable.
- **Contexte employeur** : tout dispositif permettant de suivre l'activité nominative des salariés appelle
  l'information préalable des salariés (Code du travail, L1222-4) et, le cas échéant, l'information-consultation du
  CSE (L2312-38). C'est la raison principale de **ne pas rendre les statistiques d'audience nominatives**.
- **Détournement de finalité** : interdire par écrit (page de confidentialité) l'usage des données pour évaluer ou
  contrôler les collègues (horaires de pause, etc.) ; l'activité par heure n'est affichée qu'en agrégat.
- **Droits d'accès** : statistiques réservées aux administrateurs ; journaux bruts accessibles uniquement sur le
  serveur ; sauvegardes contenant des IP traitées comme les journaux.
- **Contenus** : les avis portent sur des établissements tiers ; la charte demande de ne pas viser de personnes
  nommées (employés des camions, collègues).

---

## Partie 7 — Architecture cible

### 7.1 Options de stockage

| Critère | 1. CSV actuels + fichiers CSV en plus | 2. CSV (catalogue) + JSONL (contributions, historique, journaux) | 3. SQLite local | 4. Serveur de base (PostgreSQL…) |
|---|---|---|---|---|
| Complexité de développement | Faible au début, croissante (CSV mal adapté aux listes, textes longs, imbrication) | Faible | Moyenne (schéma, migrations, requêtes) | Élevée |
| Fiabilité | Bonne avec écriture atomique + file | Bonne : ajout en fin de fichier, pas de réécriture des contributions | Très bonne (transactions) | Très bonne |
| Concurrence | File en mémoire, **1 processus** | Idem | Transactions, plusieurs processus possibles | Native |
| Sauvegarde / restauration | Copie du dossier ; lisible à la main | Idem ; historique intégré | Copie du fichier **à froid** ou via l'API de sauvegarde (attention au mode WAL) | Outils dédiés, compétences |
| Performances (≤ 10⁵ lignes) | Largement suffisantes | Largement suffisantes (index en mémoire) | Excellentes | Excellentes |
| Maintenance / reprise | Très simple, modifiable dans Excel/Bloc-notes | Simple ; JSONL lisible dans un éditeur | Outil requis (DB Browser for SQLite) ; plus d'édition à la main | Administration d'un serveur |
| Hors Internet | Oui | Oui | Oui ; `node:sqlite` intégré à Node ≥ 22.5 (statut à vérifier selon la version) ou `better-sqlite3` (module natif : binaires à récupérer à l'installation) | Oui mais infrastructure en plus |
| Déploiement actuel | Inchangé | Inchangé | Peut exiger de monter la version de Node du serveur | Nouveau service |

### 7.2 Recommandation de stockage

**Option 2 : conserver le CSV pour le catalogue, ajouter des fichiers JSONL en ajout seul pour tout ce qui est
évènementiel.** Le catalogue (quelques dizaines de lignes) reste éditable dans Excel en dépannage ; les avis,
confirmations, signalements et l'historique sont naturellement des **flux d'évènements** : on n'y réécrit rien, on
ajoute, et l'état courant est reconstruit en mémoire (au démarrage, puis tenu à jour). L'historique et la
restauration en découlent presque gratuitement.

**Seuils où SQLite devient pertinent** (l'un d'eux suffit) :
- plus de ~100 000 évènements à relire au démarrage ou des statistiques qui dépassent ~1 s malgré les agrégats ;
- besoin de plusieurs processus (pm2 en cluster) ou d'un autre programme qui écrit dans les mêmes données ;
- opérations multi-fichiers fréquentes et critiques (fusions, imports) où une incohérence partielle serait coûteuse ;
- requêtes d'analyse ad hoc récurrentes que les agrégats ne couvrent pas ;
- incidents d'intégrité répétés malgré la file d'attente.

Au rythme constaté (quelques dizaines d'utilisateurs, ~1 200 évènements en 20 mois), ces seuils sont très loin.

### 7.3 Organisation cible des données

```
data/
  foodtrucks.csv         catalogue : id, nom, type, cuisine, etiquettes, jours_lieux, prix, paiements, horaires,
                         site, maps, statut, cree_le, maj_le, version      (colonnes ajoutées en fin, lecture rétro-compatible)
  lieux.csv              id, nom, description, minutes_a_pied, maps
  historique.jsonl       {ts, cible, version, auteur, action, avant, apres}           ← une ligne par modification
  avis.jsonl             {ts, id, cible, auteur, pseudo, note, texte, criteres, plat, action: creer|modifier|supprimer|masquer}
  presences.jsonl        {date, cible, etat: present|absent, auteur, ts}              ← purge > 90 j (agrégats gardés)
  signalements.jsonl     {ts, cible, type, date_concernee, texte, auteur, etat}
  usage-AAAA-MM.jsonl    audience (identifiant haché, sans IP)                        ← purge 13 mois
  acces-AAAA-MM.log      technique (IP)                                               ← purge 6 mois
  stats-jours.json       agrégats quotidiens
  config-moderation.json seuils (signalements, fréquence), modifiable par l'admin
sauvegardes/             copies quotidiennes horodatées (hors data/, rétention 30 j) + copie hors serveur (IT)
```

`foodtruckAValider.csv` disparaît (ou reste lu une dernière fois pour migrer la suggestion en attente).

### 7.4 Organisation du code (évolution, pas refonte)

- `src/stockage.js` : ajouter `ajouterEvenement(fichier, objet)` sérialisé dans la même file, et un petit cache
  mémoire par fichier JSONL (relu si la date de modification change, ce qui préserve l'édition manuelle).
- Nouveaux modules courts : `src/etablissements.js` (catalogue, versions, doublons), `src/contributions.js` (avis,
  présences, signalements, seuils), `src/identite.js` (cookie, pseudonyme, plus tard SSO), `src/limites.js`
  (fréquence), `src/audience.js` (évènements typés, agrégats).
- Routes publiques versionnées par ressource : `GET/POST /api/etablissements`, `PUT /api/etablissements/:id`,
  `GET /api/etablissements/:id/historique`, `POST /api/etablissements/:id/restaurer/:version`,
  `POST /api/etablissements/:id/avis`, `POST /api/etablissements/:id/presence`, `POST /api/signalements`,
  `POST /api/evenements` (remplace `/api/log`, l'ancien chemin reste accepté en lecture seule le temps de la
  transition).
- Front : rester en JavaScript sans framework ; découper `accueil.js` en `liste.js`, `fiche.js`, `formulaires.js`.

### 7.5 Mécanismes de protection

| Risque | Mécanisme |
|---|---|
| Saisie invalide | Validation serveur unique (`validation.js` étendu), choix fermés autant que possible, longueurs maximales |
| XSS dans les commentaires | Affichage par `textContent`/échappement existant, CSP `script-src 'self'`, pas de HTML/Markdown dans les avis |
| Injection de formules (exports CSV) | Neutralisation de `= + - @ \t \r` en tête de **tout** texte libre exporté |
| Requêtes d'un autre site | JSON obligatoire + contrôle `Origin` + cookie `SameSite=Lax` |
| Abus / accidents | Limites de fréquence par navigateur et IP, seuils de masquage, fil d'activité |
| Modifications concurrentes | Version attendue → 409 avec différences |
| Perte de données | Ajout seul pour les contributions, écriture atomique du CSV, sauvegarde quotidienne, restauration testée |
| Usurpation d'identité (si SSO) | Node sur `127.0.0.1`, en-tête nettoyé par le frontal + secret partagé |
| Journaux personnels | Séparation audience/technique, hachage, rotation, purge |
| Administration | Admins nominatifs, HTTPS, limitation des essais de mot de passe |

---

## Partie 8 — Plan de mise en œuvre

Les estimations tiennent compte de la taille réelle du projet (≈ 1 500 lignes) ; elles incluent tests et mise à jour
de la documentation.

### Phase 1 — Socle, mesure et améliorations simples à forte valeur (≈ 5–7 jours)

- **Périmètre** : T1, T2, T3, T4, T5, T8, T9 ; S1, S2, S3 (+ page « Données et confidentialité ») ; U1, U2, U4,
  U6, U7, U9, U11 ; T6.
- **Pourquoi la mesure ici** : il faut une base de comparaison **avant** les fonctionnalités collaboratives pour
  savoir si elles changent quelque chose.
- **Difficulté** : faible à moyenne ; le point délicat est la migration du CSV (ajout d'`id` et des nouvelles
  colonnes) et la saisie initiale des lieux/catégories/paiements (≈ 1 h de données).
- **Fichiers** : `src/app.js`, `src/stockage.js`, `src/csv.js`, `src/validation.js`, `src/statistiques.js`,
  `src/config.js`, `public/index.html`, `public/js/accueil.js`, `public/js/commun.js`, `public/css/styles.css`,
  `public/admin/*`, `scripts/*`, docs.
- **Tests** : pages admin inaccessibles sous toutes les variantes d'URL ; `/api/log`/`/api/evenements` refuse les
  types inconnus et serveur ; limites de fréquence ; `TRUST_PROXY` ; migration CSV aller-retour (ancien → nouveau →
  lecture), identifiants stables après modification ; cookie posé une fois, durée ; exclusions statistiques ; purge
  des journaux ; sauvegarde/restauration.
- **Risques** : migration des données de production (→ sauvegarde + essai sur une copie) ; rupture des séries
  statistiques (→ la documenter) ; avis DPO sur le cookie (→ à lancer en début de phase).
- **Terminé quand** : tests verts ; failles §2.12-1 à 4 fermées ; chaque établissement a un `id` ; le tableau de bord
  affiche des navigateurs actifs ; sauvegarde quotidienne vérifiée par une restauration ; recherche/filtres/favoris/
  hasard en production.

### Phase 2 — Fonctionnalités collaboratives (≈ 8–12 jours)

- **Dépend de** : T5 (identifiants), S3 (jeton d'auteur), T3/T6/T7 (protections).
- **Périmètre** : U3 (fiche), C1, C2, C3, C4, C5, C6/C7, C9, C12, C13, I1 ; T7, T10 ; fin de la file de validation
  (la page admin devient « À surveiller »).
- **Difficulté** : moyenne ; le cœur est l'historique/restauration et la détection de doublons.
- **Fichiers** : nouveaux `src/etablissements.js`, `src/contributions.js`, `src/identite.js`, `src/limites.js` ;
  `src/app.js` (routes) ; `public/js/fiche.js`, `public/js/formulaires.js` ; `public/admin/*` ; docs (guides
  utilisateur et admin, charte).
- **Tests** : publication immédiate ; doublon détecté ; conflit 409 avec différences ; restauration d'une version ;
  un avis par navigateur, modification/suppression réservées à l'auteur ; masquage au 3ᵉ signalement distinct ;
  présence : une par navigateur/jour, remise à zéro ; texte malveillant (`<script>`, `=CMD()`) neutralisé à
  l'affichage et à l'export ; requête d'une autre origine refusée ; reconstruction de l'état depuis les JSONL après
  redémarrage ; écriture concurrente (deux requêtes simultanées).
- **Risques** : vandalisme ou erreurs → historique + seuils ; adoption faible → mesurer (phase 1) et animer
  (annonce interne, premiers avis par l'équipe).
- **Terminé quand** : un collègue peut ajouter, corriger, confirmer, signaler et noter sans administrateur ; toute
  modification est restaurable en un clic ; l'admin n'a plus de file d'attente.

### Phase 3 — Statistiques avancées et identification (≈ 4–6 jours, hors délais IT ; SSO : + 3–5 jours si retenu)

- **Périmètre** : S4, S5, S6, T13, T14 ; C8 (classements) ; **conditionnel** : I2 (SSO) après maquette validée avec
  l'IT, sinon I3 ; T11 (HTTPS) recommandé dans tous les cas.
- **Dépend de** : S2/S3 (données), réponses de l'IT (§6.8), décision n° 1.
- **Fichiers** : `src/audience.js`, `src/statistiques.js`, `public/admin/statistiques.*` ; pour le SSO :
  configuration du frontal (IIS/Apache), `src/identite.js`, `server.js` (écoute locale), `.env.example`, docs de
  déploiement.
- **Tests** : calculs DAU/WAU/MAU, nouveaux/récurrents, sessions, rétention sur jeux de données fabriqués ;
  agrégats = calcul brut ; purge sans perte d'agrégats ; SSO : en-tête forgé refusé en accès direct, refusé si le
  secret manque, Node injoignable hors loopback, repli sans SSO pour téléphones.
- **Risques** : délais et disponibilité de l'IT ; complexité du montage SSO ; perception de surveillance (→
  communication, pas de statistiques nominatives).
- **Terminé quand** : le tableau de bord répond aux 10 questions du §7 de la demande ; si SSO : 100 % des postes du
  domaine identifiés sans saisie, test d'usurpation négatif.

### Phase 4 — Évolutions complémentaires (à la carte, 1–3 jours chacune)

U5 (vue semaine), U8 (déjà essayé), U10 (partage/copie Teams), U12, U13, U15 (plan local), C10 (bons plans),
C11 (« On y va ? »), C14 (fusion), synchronisation des favoris (si identité), résumé hebdomadaire par mail interne
pour l'admin ou les volontaires (SMTP existant). Notifications Teams : **dépendance externe** (service cloud et
webhook à autoriser par l'IT), non recommandées tant que la contrainte « sans Internet » s'applique.

À chaque phase : critères communs — documentation à jour (guides, dossier technique, CHANGELOG), livraison testée sur
l'environnement de test (`APP_ENV=test`) avec une copie des données de production.

---

## Partie 9 — Décisions à prendre

1. **Attribution des contributions** : anonyme (jeton de navigateur), pseudonyme déclaré facultatif *(recommandé
   pour commencer)*, ou identité vérifiée obligatoire (SSO/mail) dès le départ ?
2. **Cookie anonyme de mesure d'audience** : d'accord pour le mettre en place en phase 1, sous réserve d'un avis du
   DPO/correspondant RGPD (et des RH si nécessaire) que vous sollicitez ?
3. **Statistiques nominatives** : confirmez-vous qu'elles sont exclues (recommandation), l'identité éventuelle ne
   servant qu'aux contributions ?
4. **Périmètre éditorial** : intégrer les **restaurants** en plus des foodtrucks (impose horaires, « tous les
   jours », type d'établissement) ?
5. **Pouvoirs des collègues** : peuvent-ils archiver un établissement (« n'est plus présent ») par seuil automatique,
   ou seul l'administrateur archive ?
6. **Implication de l'équipe informatique** : pouvez-vous obtenir les réponses du §6.8 (proxy/VDI, nom DNS,
   sauvegarde, version de Node, HTTPS) ? Le SSO Windows est-il envisageable politiquement et techniquement ?
7. **Accès mobile** : les téléphones doivent-ils être pris en charge (conditionne le choix d'identification et
   l'ergonomie) ?
8. **Durées de conservation** proposées (IP 6 mois, audience 13 mois, présences 90 jours) : acceptables ou à aligner
   sur une politique interne ?
9. **Administration** : combien d'administrateurs, et doivent-ils être nominatifs ?

---

## Annexe — Contrôle de couverture de la demande

| Section de la demande | Traitée dans |
|---|---|
| §2 Lecture documentation, exploration du code, distinction présent/documenté/envisagé/invérifiable | Partie 2 (§2.1–2.3) |
| §3 Contraintes (CSV, hors Internet, déploiement, navigateurs, données internes) | §2.3, §2.11, §7.1, colonnes « Dépendances »/« Réalisable » |
| §4 A–D Expérience utilisateur, personnalisation (compte / données perso), vie du site | §3.2 (U1–U16), §3.5, Partie 4 |
| §5 A–D Contribution directe, avis, entraide, gestion des contributions | §3.3 (C1–C14), Partie 5 |
| §6 État des lieux des statistiques | §2.9 |
| §7 Mesure de la fréquentation, tableau de bord | §6.1–6.4 |
| §8 Identification A–E, comparatif, recommandation, deux objectifs | §6.5–6.8 |
| §9 Confidentialité, RGPD, CNIL | §6.9 |
| §10 Capacité de l'architecture, options de stockage, seuils de migration | Partie 7 (§7.1–7.3) |
| §11 Sécurité et robustesse rattachées au projet | §2.12, §7.5 |
| §12 Idées supplémentaires (besoin, valeur, fonctionnement, données, dépendances, difficulté, risques, évolution ; immédiat/archi) | Partie 3 (tableaux + §3.5) |
| §13 Parties 1 à 9 | Parties 1 à 9 |
| §14 Faits / hypothèses / recommandations ; informations manquantes | Conventions en tête, §2.3 « Impossibles à vérifier », §6.8 |
| §15 Livrables (rapport Markdown, aucun autre fichier modifié) | Ce fichier |
