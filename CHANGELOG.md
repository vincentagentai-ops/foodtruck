# Changelog

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/). Versions numérotées MAJEUR.MINEUR.CORRECTIF.

## [3.3.0] — 2026-10-19

Phase 3 de la feuille de route (`AUDIT_ET_PROPOSITIONS.md` §6.4) : tableau de bord des statistiques, lisible en
30 secondes, sans aucune statistique nominative.

### Ajouté
- **Page Statistiques refondue** : période (7 jours, 30 jours, trimestre, personnalisée, tout) **comparée à la période
  précédente** ; tuiles navigateurs actifs par jour, par semaine (7 jours glissants), nouveaux, **retour à S+1**,
  contributions et **contributeurs distincts** ; courbe des actifs avec **marqueurs de version** et rupture de série
  3.1.0 ; nouveaux / récurrents par semaine ; **carte de chaleur** heure × jour de semaine ; **entonnoir** visite →
  fiche → Maps / site (fiches sans clic) ; **fonctionnalités en % des visites** ; tableau par établissement (fiches,
  clics, présences confirmées, avis, note) ; contributions par type et par semaine et **retour des nouveaux
  contributeurs dans les 14 jours** ; **cohortes hebdomadaires** ; **recherches sans résultat** ; détails techniques
  repliés ; encadré « Limites de mesure » complété.
- **Export CSV des agrégats** (par jour, par semaine, par établissement), sans aucun identifiant.
- **Visites** : suite d'évènements d'un navigateur sans pause de plus de 30 minutes (coupée à minuit).
- **Marqueurs de version** : chaque démarrage sur une nouvelle version enregistre `{version, date}` (les versions
  précédentes sont reprises des journaux la première fois).
- Évènement `recherche_vide` (recherche sans résultat, texte tronqué à 30 caractères) envoyé par la page d'accueil.

### Modifié
- **Calcul quotidien incrémental** : chaque jour terminé est agrégé une seule fois (jour, semaine, mois, cohortes) ;
  la page ne relit plus tous les journaux bruts, seulement les agrégats et la journée en cours. État interne dans
  `stats-etat.json` (empreinte anonyme → première et dernière visite, oubliée 13 mois après la dernière visite).
  Recalcul automatique depuis les journaux au premier démarrage (agrégats 3.2.0 conservés pour les jours purgés).
- **Exclusions** : le navigateur de l'administrateur est exclu de l'audience à partir du jour de sa connexion
  (évènement serveur `admin_vu`) ; les évènements envoyés par des robots ne sont plus enregistrés.
- Une empreinte inactive depuis plus de 13 mois redevient « nouvelle » (son cookie a expiré).
- Page « Données et confidentialité » : état interne des statistiques et sa durée de conservation.
- `npm test` : 70 tests (nouveau fichier `test/statistiques.test.js`).

## [3.2.0] — 2026-10-19

Phase 2 de la feuille de route (`AUDIT_ET_PROPOSITIONS.md`) : le site devient collaboratif, sans validation préalable
(« wiki de confiance, réparable »).

### Ajouté
- **Ajouter un établissement** publié immédiatement, avec avertissement de **doublon** (nom approché, même lien Maps)
  et lien vers la fiche existante, sans blocage ; **délai de grâce** de 30 min pendant lequel l'auteur garde la main
  (correction, retrait).
- **Fiche d'un établissement** : infos « modifiables par tous », présence du jour, avis « opinions signées »,
  historique, liens, signalements.
- **Modification des infos par tous**, avec version attendue : si la fiche a changé entre-temps, refus et tableau des
  différences.
- **Historique** de chaque fiche (`historique.jsonl`, ajout seul) et **« Restaurer cette version »**.
- **Présence du jour** : « Il est là » / « Pas là aujourd'hui », une déclaration par navigateur et par jour,
  « Confirmé par N collègues (dernière à HHhMM) ».
- **Avis** : note 1–5, commentaire ≤ 280 caractères, critères (qualité-prix, portions, attente), plat conseillé ; un
  par navigateur et par établissement, modifiable et supprimable par son auteur ; moyenne à partir de 3 avis.
- **Signalements** : n'est plus présent, fermé exceptionnellement le JJ/MM (bandeau ce jour-là), info erronée,
  doublon, contenu inapproprié (avis masqué au 3e signalement de navigateurs distincts).
- **Seuils automatiques** : « n'est plus présent » par 2 navigateurs et pas de confirmation depuis 14 jours →
  incertain ; 30 jours → archivé (restaurable). Seuils réglables dans l'administration (`config-moderation.json`).
- Fil **« Quoi de neuf ? »** (ajouts, modifications, avis, fermetures).
- **Nom déclaré** facultatif (30 caractères), mémorisé dans le navigateur, affiché « nom déclaré ».
- **Lieu différent selon le jour** (colonne `lieux_jours`) ; **fusion de deux fiches** par l'administrateur (avis,
  présences, signalements et historique rattachés ; ancien identifiant redirigé).
- Administration : section **« À surveiller »** (suggestions héritées, signalements, avis masqués, ajouts et
  modifications sensibles, fiches incertaines / archivées, fusion, blocage temporaire d'un navigateur, seuils) ;
  export `avis.csv` ; restauration d'une version.
- Charte de 5 lignes sous les formulaires.
- Page « Données et confidentialité » complétée (contributions, jeton d'auteur, nom déclaré, présences).

### Sécurité
- Toutes les écritures exigent du JSON (`415` sinon) et un en-tête `Origin` du site (`403` sinon ; `HOTES_AUTORISES`
  pour les noms supplémentaires).
- Auteur des contributions = HMAC du cookie avec une clé propre aux contributions : jamais le cookie en clair, non
  reliable aux journaux d'audience ; contributions comptées par le serveur sans identifiant de navigateur.
- Contribution impossible sans cookie déjà présent ; limites de fréquence (`LIMITE_CONTRIBUTIONS`, 60 par heure et par
  navigateur) ; blocage temporaire par l'administrateur.
- Exports CSV : valeurs commençant par `= + - @`, tabulation ou retour chariot préfixées d'une apostrophe.

### Modifié
- **Fin de la file de suggestions** : `/api/suggestions` redirige (308) vers `/api/etablissements` ; les suggestions
  encore en attente apparaissent une dernière fois dans « À surveiller » (« suggestions héritées »).
- Migration automatique au démarrage (ajout de la colonne `lieux_jours`, copie du fichier d'origine).
- Suppression définitive d'une fiche par l'administrateur : ses avis, présences, signalements et son historique sont
  effacés aussi.
- Statistiques : « Établissements ajoutés » (suggestions puis ajouts directs) ; nouveaux types d'évènements.
- Présences brutes purgées après 13 mois (totaux gardés dans `stats-presences.json`).
- `LIMITE_SUGGESTIONS` n'est plus lu (remplacé par `LIMITE_CONTRIBUTIONS`).
- `npm test` : 63 tests.

## [3.1.0] — 2026-10-19

Phase 1 de la feuille de route (`AUDIT_ET_PROPOSITIONS.md`) : socle, mesure d'audience anonyme et aide au choix.

### Ajouté
- **Restaurants** en plus des foodtrucks (champ « type »).
- Nouveau modèle de données : identifiant stable, catégorie de cuisine (liste fermée, libellé libre conservé),
  étiquettes (végétarien possible, halal, sans gluten…), lieu, horaires, moyens de paiement (titres-restaurant papier
  ou carte, CB, espèces), statut (actif, incertain, archivé), dates de création / modification, version.
  **Migration automatique** au démarrage, avec copie du CSV d'origine (`…-avant-migration-<date>.csv`).
- **Lieux** (`lieux.csv` : nom, description, minutes à pied, lien Maps) gérés dans l'administration ; la page d'accueil
  regroupe les établissements par lieu (le plus proche d'abord), « Lieu à préciser » sinon.
- Page d'accueil : **recherche** texte, **filtres** (cuisine, prix maximum, type, régime, paiement) mémorisés dans le
  navigateur, classement par lieu / nom / prix, bouton **« Au hasard »**, **favoris** (étoile, bandeau « Vos favoris
  présents aujourd'hui »), badge **« Nouveau »** (15 jours) et encadré « Nouveaux cette semaine », horaires et
  paiements affichés.
- Administration : un formulaire unique pour ajouter, modifier ou publier une suggestion (tous les champs), section
  Lieux, filtre par statut, export de `lieux.csv`, pré-remplissage étendu (lieu, horaires, paiements, type…).
- **Mesure d'audience anonyme** : cookie `ft_v` (aléatoire, 13 mois, non prolongé) ; seuls des HMAC de cet identifiant
  sont journalisés ; évènements typés en liste blanche (`POST /api/evenements`) ; page Statistiques en **navigateurs
  actifs** par jour / semaine / mois, nouveaux et récurrents, rupture de série signalée, encadré « Limites de mesure ».
- Page **« Données et confidentialité »** (`/confidentialite.html`), liée en pied de page.
- **Sauvegarde quotidienne** automatique de `data/` (CSV, JSON, JSONL) dans `sauvegardes/AAAA-MM-JJ/`, 30 jours conservés.
- **Journaux mensuels** (`acces-AAAA-MM.log`, `usage-AAAA-MM.jsonl`), **agrégats** quotidiens / hebdomadaires /
  mensuels conservés sans limite (`stats-jours.json`), **purge** des journaux bruts de plus de 13 mois (jamais avant que
  les agrégats soient écrits et relus ; copie des anciens journaux avant la première purge).
- Limites de fréquence (suggestions, évènements) par navigateur et par IP, réglables dans `.env`.
- Livraison autonome : le zip contient `node_modules` ; `mettre-a-jour.bat` remplace entièrement les dossiers de code
  (robocopy /MIR) sans `npm install`.

### Corrigé / sécurité
- Pages d'administration servies sans mot de passe via une adresse encodée (`/%61dmin/index.html`) : elles sont sorties
  de `public/` (dossier `admin/`).
- Statistiques falsifiables : `/api/log` refuse désormais les libellés d'administration ; les suggestions et les actions
  d'administration sont comptées par le serveur ; taille des évènements limitée.
- `TRUST_PROXY` accepte `loopback`, une IP ou une liste ; `true` affiche un avertissement (IP falsifiable).
- En-têtes de sécurité : CSP sans `unsafe-inline`, `nosniff`, `frame-ancestors 'none'`, `Referrer-Policy` ; styles en
  ligne supprimés.
- Statistiques : administration, API, erreurs, redirections et robots exclus ; chemins normalisés ; « Jour sélectionné »
  compté uniquement sur clic (évènement « chargement » distinct) ; clics Site et Maps séparés, clic molette compté.
- Écriture des fichiers : réessais si le fichier est momentanément verrouillé sous Windows (Excel, antivirus).
- Modifications de l'administration repérées par identifiant et version (409 si modifié entre-temps).

### Modifié
- `usage.log` et `acces.log` ne sont plus écrits (encore lus pour l'historique, comptés par adresse IP : « ancien
  calcul »). Les statistiques d'avant le 3.1.0 ne sont pas comparables aux nouvelles.
- Le lien Google Maps devient secondaire et facultatif si un lieu est renseigné.
- `npm test` lance `test/*.test.js` (42 tests).

## [3.0.0] — 2026-10-19

Reprise complète du projet dans `~/dev/foodtruck` (fusion de la prod v2 et des évolutions de `FoodTrucksTest`).
Détail des problèmes corrigés : `docs/INVENTAIRE.md` §4.

### Ajouté
- Espace administrateur `/admin/` protégé par mot de passe : suggestions (validation avec correction, rejet),
  ajout manuel avec pré-remplissage depuis un texte, modification / retrait des foodtrucks publiés, recherche,
  téléchargement du CSV.
- Statistiques : filtre par période traité par le serveur (dates, 7 j, 30 j, tout), chiffres clés, fréquentation
  par jour, compteurs d'actions séparés, foodtrucks consultés, navigateurs regroupés.
- Configuration par fichier `.env` (port, mot de passe, mail, environnement de test…).
- Sélection du jour par boutons, repère du jour courant, message le week-end, affichage en fiches sur téléphone.
- Formulaire de suggestion avec jours à cocher et erreurs détaillées.
- Configuration pm2 (`ecosystem.config.js`), scripts Windows d'installation / mise à jour, script de livraison.
- Tests automatisés (`npm test`) et documentation (spécifications, dossier technique, déploiement, guides).

### Corrigé
- Dossier `data/` (journaux avec IP, suggestions) n'est plus public ; administration et API d'écriture protégées.
- Injection HTML dans l'accueil et les statistiques.
- Plantage du serveur sur une ligne de journal vide ou corrompue, ou une suggestion sans jours.
- Virgules dans les URL et lignes CSV collées / vides en trop (lecture-écriture CSV conforme).
- Corrections de l'administrateur ignorées à la validation ; doublons lors de la validation.
- Graphiques de la page Statistiques jamais affichés.
- Comptage commun « envoi de mail / génération CSV ».
- Journal d'accès : une ligne par requête (au lieu de deux), pages HTML enfin journalisées.
- Week-end : « Pas de Food Trucks pour . » ; tri par prix avec prix vides ; double flèche de tri.
- Ajout manuel (`generationCSV.html`) cassé par une fonction manquante ; `ajouterFoodtruck.html` en erreur de syntaxe.

### Supprimé
- Routes `/api/ajouter-foodtruck` et `/add-foodtruck` (écriture directe non protégée).
- Pages `generationCSV.html`, `ajouterFoodtruck.html`, `administration.html`, `statistiques.html` (anciennes
  adresses redirigées vers `/admin/`), `styles_original.css`, chargement inutile de PapaParse et des CDN.
- Copie séparée `FoodTrucksTest` (remplacée par `APP_ENV=test`).

## [Nodejs v2] — 2025-02-21
- Formulaire pour renseigner le CSV manuellement, avec contrôle des jours.
- Partie génération d'une ligne CSV masquée par défaut.
- Page de statistiques.
- Bouton « Suggérer foodtruck » et page d'administration.

## [Nodejs v1] — 2025-01-23
- Passage à Node.js, réorganisation de l'arborescence.
- `server.js` à des fins de statistiques.
- Journaux d'usage (`usage.log` : clics, redirections, tris) et d'accès (`acces.log`).

## [v4]
- Page `generationCSV.html` : meilleure gestion des saisies.
- Améliorations CSS, logo et disposition.

## [v3]
- Page `generationcsv.html` et lien.
- Logo.
- Affichage de la colonne Prix.
