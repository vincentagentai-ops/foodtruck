# Prompts de mise en œuvre — phases 1 à 4

À lancer **dans l'ordre**, une session par phase, chacune après la fusion de la précédente dans `main`.
Chaque prompt est autonome : copiez le contenu du bloc tel quel.

Avant de lancer la phase 1 : `AUDIT_ET_PROPOSITIONS.md` et ce fichier doivent être commités sur `main`, sinon une
session ouverte dans un nouvel espace de travail (worktree) ne les verra pas.

---

## Phase 1 — Socle, mesure et aide au choix (version 3.1.0)

```text
Tu travailles sur le site interne « Food Trucks » (Node.js + Express 4, données CSV, sans base de données), dans ce dépôt.
Mission : réaliser la PHASE 1 de la feuille de route.

1. AVANT DE CODER
- Lis AUDIT_ET_PROPOSITIONS.md (surtout §2.9, §2.12, Parties 3, 6 et 7), puis README.md et docs/DOSSIER_TECHNIQUE.md.
- Lis tout le code de src/, public/ et test/ : le projet est petit, respecte son style (noms et commentaires en français, JavaScript sans framework côté navigateur, tests node:test).
- Vérifie que `main` est à jour et que package.json est en 3.0.0. Crée la branche `phase-1-socle-mesure`.
- Lance `npm test` pour partir d'un état vert.

2. DÉCISIONS DÉJÀ PRISES (ne pas les remettre en question)
- Pas d'appui de l'équipe informatique : pas de HTTPS, pas de SSO, pas de changement DNS/proxy. Serveur Windows, un seul processus pm2, port 80.
- Postes de travail uniquement (le site reste lisible sur petit écran, mais le mobile n'est pas une priorité).
- Les RESTAURANTS sont intégrés dès cette phase, en plus des foodtrucks.
- Cookie anonyme de mesure d'audience mis en place tout de suite, avec une page d'information « Données et confidentialité ».
- Aucune statistique nominative.
- Conservation : agrégats statistiques SANS LIMITE ; journaux bruts (IP, identifiant de navigateur) purgés après 13 MOIS.
- Un seul administrateur (HTTP Basic actuel conservé).
- Contraintes permanentes : fonctionnement sans Internet, pas de base de données, pas de nouvelle dépendance d'exécution sauf nécessité absolue (et alors en JavaScript pur, justifiée dans le compte rendu).

3. PÉRIMÈTRE (identifiants de l'audit)
Socle
- T1 : les pages de public/admin/ ne doivent plus être servies par le statique général (aujourd'hui /%61dmin/index.html répond 200 sans mot de passe). Sors-les de public/ ou exclus-les ; teste les variantes encodées et de casse.
- T2 : nouvelle route POST /api/evenements avec une liste blanche de types d'évènements ({type, cible, page}) ; les types réservés au serveur (actions admin, contributions) sont refusés. /api/log reste accepté pour les anciens libellés publics mais refuse ceux commençant par « Admin » ou « Ajout de ». Taille limitée.
- T3 : limites de fréquence en mémoire (nouveau module, par IP et par identifiant de navigateur) sur toutes les écritures publiques (suggestions, évènements). Seuils larges, configurables dans .env.
- T4 : TRUST_PROXY accepte « loopback », une IP ou une liste ; la valeur « true » reste acceptée mais affiche un avertissement au démarrage (elle permet de falsifier l'IP).
- T5 : identifiant stable et nouveau modèle de données (voir §4). Migration automatique au démarrage, avec copie de sauvegarde du CSV d'origine avant toute réécriture.
- T6 : en-têtes de sécurité (CSP avec script-src 'self', X-Content-Type-Options, frame-ancestors 'none', Referrer-Policy) ; supprime les styles en ligne (404.html, statistiques.html) pour ne pas avoir à autoriser 'unsafe-inline'.
- T8 : sauvegarde quotidienne automatique de data/ (CSV, JSON, JSONL) dans un dossier configurable (BACKUP_DIR, par défaut sauvegardes/ à côté de data/), une copie datée par jour, 30 jours conservés. Documente la restauration pas à pas.
- T9 : journaux mensuels (acces-AAAA-MM.log, usage-AAAA-MM.jsonl) ; les anciens acces.log et usage.log restent lus. Agrégats quotidiens (stats-jours.json : pages vues, navigateurs actifs, évènements par type, consultations par établissement…) calculés et conservés sans limite. La purge des journaux bruts de plus de 13 mois ne supprime RIEN tant que les agrégats de la période ne sont pas écrits et relus avec succès. Attention : les journaux existants remontent à janvier 2025, la première purge concernera donc déjà des données ; fais une copie de ces journaux avant la première purge.
- T10 : réessais courts du renommage atomique sur EPERM/EBUSY/EACCES (fichier ouvert dans Excel ou antivirus sous Windows).
- T12 : scripts/preparer-livraison.sh produit un zip qui contient node_modules (installation de production) ; scripts/mettre-a-jour.bat remplace entièrement src/, public/, scripts/ et node_modules/ (par exemple robocopy /MIR depuis le zip extrait dans un dossier temporaire) sans toucher à data/ ni .env, et n'appelle plus npm install. Mets à jour docs/DEPLOIEMENT.md.
Mesure
- S1 : indicateurs corrigés : exclure /admin, /api/admin, /api/log, /api/evenements, les statuts ≥ 400 et les robots ; normaliser les chemins (décodage, minuscules) ; « Jour sélectionné » seulement sur clic, avec un évènement « chargement » distinct ; suggestions comptées côté serveur ; libellés honnêtes sur la page Statistiques (préciser « navigateurs », pas « personnes ») et rupture de série signalée.
- S2 : évènements typés {ts, v, type, cible, page, version}, dont clic_site et clic_maps séparés, sur l'id de l'établissement ; écouter aussi auxclick.
- S3 : cookie ft_v posé par le serveur s'il est absent : 128 bits aléatoires, HttpOnly, SameSite=Lax, durée 13 mois, non prolongée. Dans les journaux, stocker uniquement un HMAC de cet identifiant avec un secret serveur (STATS_SECRET dans .env, généré et enregistré dans data/ s'il est absent). Page Statistiques : navigateurs actifs jour / semaine / mois, nouveaux et récurrents.
- Page /confidentialite.html liée en pied de page : données collectées, finalités, durées (agrégats sans limite, journaux bruts 13 mois), accès réservé à l'administrateur, contact.
Aide au choix
- U1 : recherche texte + filtres (catégorie de cuisine, prix maximum, type foodtruck/restaurant), mémorisés dans le navigateur.
- U2 : catégories de cuisine en liste fermée (le libellé libre est conservé) et étiquettes (végétarien possible, halal, sans gluten…).
- U4 : lieux lisibles : nom du lieu et temps de marche affichés, regroupement ou tri par lieu (le tri actuel sur l'URL Google Maps disparaît) ; le lien Maps devient secondaire.
- U6 : bouton « Au hasard » parmi les résultats filtrés du jour.
- U7 : favoris stockés dans le navigateur (localStorage, par id) ; bandeau « Vos favoris présents aujourd'hui ».
- U9 : badge « Nouveau » pendant 15 jours et encadré « Nouveaux cette semaine ».
- U11 : horaires et moyens de paiement (titres-restaurant papier, titres-restaurant carte, CB, espèces) affichés et filtrables.
- L'administration (ajout, modification, export CSV, pré-remplissage) gère tous les nouveaux champs et les lieux.

4. MODÈLE DE DONNÉES CIBLE (à affiner si tu as une meilleure idée, en le justifiant)
- foodtrucks.csv : id, nom, type (foodtruck|restaurant), cuisine (libellé libre), categorie, etiquettes (séparées par ;), jours (Lundi à Vendredi, séparés par ;), lieu (id), horaires, prix, paiements (séparés par ;), site, emplacement (lien Maps, devient facultatif si un lieu est renseigné), statut (actif|incertain|archive), cree_le, maj_le, version. Les colonnes manquantes d'un ancien fichier sont lues comme vides. Un restaurant ouvert toute la semaine a simplement les 5 jours.
- lieux.csv : id, nom, description, minutes_a_pied, maps.
- La migration attribue une catégorie par correspondance avec le libellé existant (Autre sinon), ne fusionne aucune ligne (les doublons comme L'épicurieux seront fusionnés en phase 2), et laisse les lieux vides : l'interface affiche alors « Lieu à préciser » avec le lien Maps. Mets à jour data-exemple/.
- La file de suggestions (foodtruckAValider.csv) reste en place pendant cette phase ; elle sera remplacée en phase 2.

5. TESTS À AJOUTER (au minimum)
Pages admin inaccessibles sous toutes les variantes d'URL ; évènements inconnus ou réservés refusés ; limites de fréquence ; TRUST_PROXY ; migration aller-retour d'un CSV v3.0.0 (aucune perte, ids stables après modification, copie de sauvegarde créée) ; cookie posé une seule fois avec les bons attributs ; exclusions statistiques ; agrégats égaux au calcul brut ; purge qui ne supprime rien sans agrégats ; sauvegarde quotidienne et rotation ; réessai du renommage (simulé). Vérifie aussi les pages dans le navigateur (poste de travail).

6. LIVRABLE
- Version 3.1.0 dans package.json, CHANGELOG.md, documentation à jour (GUIDE_UTILISATEUR, GUIDE_ADMINISTRATEUR, DOSSIER_TECHNIQUE, SPECIFICATIONS, DEPLOIEMENT).
- `npm test` vert. Commits sur la branche ; ne fusionne pas dans main et ne pousse pas sans mon accord.
- Compte rendu final : ce qui est fait, ce qui est testé, ce qui ne l'est pas, et la procédure exacte à suivre sur le serveur Windows (sauvegarde préalable, mise à jour, vérifications, saisie initiale des lieux et des paiements).
```

---

## Phase 2 — Collaboration (version 3.2.0)

```text
Tu travailles sur le site interne « Food Trucks » (Node.js + Express 4, données CSV/JSONL, sans base de données), dans ce dépôt.
Mission : réaliser la PHASE 2 de la feuille de route : transformer le site en outil collaboratif sans validation préalable.

1. AVANT DE CODER
- Vérifie que la phase 1 est fusionnée dans main : package.json en 3.1.0, colonne id dans le CSV, POST /api/evenements, cookie ft_v. Sinon arrête-toi et signale-le.
- Lis AUDIT_ET_PROPOSITIONS.md (Parties 4, 5 et 7 en priorité, §3.3), le CHANGELOG 3.1.0 et docs/DOSSIER_TECHNIQUE.md, puis tout le code. Respecte le style existant.
- Crée la branche `phase-2-collaboration` depuis main ; `npm test` doit être vert au départ.

2. DÉCISIONS DÉJÀ PRISES
- Publication immédiate de toutes les contributions ; aucune validation préalable.
- Identification : jeton anonyme de navigateur (cookie ft_v existant) comme jeton d'auteur + pseudonyme FACULTATIF déclaré, affiché avec la mention « nom déclaré ». Pas de compte, pas de SSO, pas de lien par mail.
- Archivage automatique par seuil, toujours restaurable.
- Un seul administrateur, filet de sécurité uniquement.
- Pas de HTTPS ni d'appui de l'informatique ; fonctionnement sans Internet ; un seul processus ; pas de base de données.
- Conservation : agrégats sans limite ; données brutes personnelles (journaux, présences) 13 mois ; contributions conservées tant qu'elles sont publiées, effaçables sur demande par l'admin.
- Aucune statistique nominative.

3. PÉRIMÈTRE
- T7 : contrôle de l'en-tête Origin sur toutes les écritures (liste d'hôtes autorisés configurable) ; JSON obligatoire.
- U3 : fiche établissement (panneau ou modale) : infos factuelles (bloc « modifiable par tous »), présence du jour, avis (bloc « opinions signées »), historique, liens.
- C1 : « Ajouter un établissement » publié immédiatement, avec détection de doublons (nom normalisé sans accents ni mots vides, distance d'édition ≤ 2 ou inclusion, même lieu ou même lien Maps) : avertissement avec lien vers la fiche existante, sans blocage. Délai de grâce de 30 min pendant lequel l'auteur garde la main.
- C2 : modification des infos factuelles par tous, avec version attendue : si la fiche a changé entre-temps, 409 et affichage des différences.
- C3 : historique.jsonl en ajout seul ({ts, cible, version, auteur, pseudo, action, avant, apres}) ; onglet Historique sur la fiche ; « Restaurer cette version ».
- C4 : confirmation de présence du jour (« Il est là » / « Pas là aujourd'hui »), une par navigateur, établissement et jour, modifiable ; affichage « Confirmé par N collègues (dernière à HHhMM) ».
- C5 : signalements : n'est plus présent, fermé exceptionnellement le JJ/MM (bandeau ce jour-là), info erronée, contenu inapproprié.
- C6/C7 : avis : note 1–5 obligatoire, commentaire ≤ 280 caractères en texte brut, critères optionnels à choix fermés (qualité-prix, portions, attente : < 5 min, 5–15 min, > 15 min), plat conseillé ≤ 60 caractères ; un avis par navigateur et par établissement, modifiable et supprimable (suppression logique) par son auteur ; moyenne affichée avec le nombre d'avis, « Pas encore assez d'avis » sous 3 avis.
- C9 : fil « Quoi de neuf » (ajouts, modifications, avis, fermetures signalées).
- C12 : page admin « À surveiller » (remplace la file de suggestions) : contenus masqués, signalements ouverts, modifications des champs sensibles (nom, lieu, emplacement), restauration, suppression définitive (purge), blocage temporaire d'un identifiant de navigateur, réglage des seuils.
- C13 : avis masqué automatiquement après 3 signalements de navigateurs distincts.
- C14 : fusion de deux fiches par l'admin (avis, historique et présences rattachés) ; utile pour les établissements multi-lieux comme L'épicurieux : une fiche peut avoir un lieu différent selon le jour.
- I1 : pseudonyme facultatif (≤ 30 caractères) mémorisé dans le navigateur, envoyé avec les contributions.
- Seuils d'archivage : « n'est plus présent » signalé par 2 navigateurs distincts ET aucune confirmation depuis 14 jours → statut incertain (grisé, en fin de liste) ; 30 jours sans confirmation → archive (masqué, restaurable).
- Fin de la file de suggestions : les suggestions encore en attente apparaissent une dernière fois dans « À surveiller » comme « suggestions héritées » à publier ou écarter ; /api/suggestions renvoie vers la nouvelle route.
- Charte de 5 lignes sous les formulaires (rester factuel et bienveillant, parler des plats et pas des personnes…).
- Statistiques : chaque contribution est journalisée par le SERVEUR comme évènement typé (jamais par le navigateur).

4. ARCHITECTURE ATTENDUE
- Catalogue en CSV (inchangé) ; contributions en JSONL en ajout seul : historique.jsonl, avis.jsonl, presences.jsonl, signalements.jsonl ; seuils dans config-moderation.json. État courant reconstruit en mémoire au démarrage et tenu à jour ; relecture si un fichier a été modifié à la main.
- Toutes les écritures passent par la file d'attente existante de src/stockage.js.
- Nouveaux modules courts : src/etablissements.js, src/contributions.js, src/identite.js (jeton + pseudo), réutilisation de src/limites.js.
- L'auteur est stocké comme HMAC du cookie (jamais le cookie en clair) ; il ne doit pas pouvoir être relié aux journaux d'audience.
- Affichage des textes saisis uniquement par textContent ou par l'échappement existant ; neutralisation de = + - @ tabulation et retour chariot en tête de tout texte libre exporté en CSV.
- La sauvegarde quotidienne et la purge de la phase 1 couvrent les nouveaux fichiers (présences brutes purgées après 13 mois, agrégats conservés).

5. TESTS À AJOUTER (au minimum)
Publication immédiate ; doublon détecté ; 409 avec différences ; restauration d'une version ; un avis par navigateur, modification et suppression réservées à l'auteur ; masquage au 3e signalement distinct (et pas au 3e du même navigateur) ; présence une par navigateur et par jour ; seuils incertain/archive avec dates simulées ; textes malveillants (<script>, =CMD()) neutralisés à l'affichage et à l'export ; requête d'une autre origine refusée ; limites de fréquence ; reconstruction de l'état depuis les JSONL après redémarrage ; deux écritures simultanées ; fusion de fiches. Vérifie les parcours dans le navigateur.

6. LIVRABLE
- Version 3.2.0, CHANGELOG, guides utilisateur et administrateur réécrits pour le fonctionnement collaboratif, dossier technique et spécifications à jour, page de confidentialité complétée (contributions, pseudonyme).
- `npm test` vert. Commits sur la branche ; ne fusionne pas et ne pousse pas sans mon accord.
- Compte rendu : fait, testé, non testé, procédure de mise à jour du serveur, et texte court d'annonce à envoyer aux collègues.
```

---

## Phase 3 — Tableau de bord des statistiques (version 3.3.0)

```text
Tu travailles sur le site interne « Food Trucks » (Node.js + Express 4, données CSV/JSONL), dans ce dépôt.
Mission : réaliser la PHASE 3 de la feuille de route : un tableau de bord de statistiques fiable et lisible pour l'administrateur.

1. AVANT DE CODER
- Vérifie que la phase 2 est fusionnée dans main (package.json en 3.2.0, avis et historique en JSONL). Sinon arrête-toi et signale-le.
- Lis AUDIT_ET_PROPOSITIONS.md §2.9 et Partie 6 (§6.1 à 6.4 et 6.9), le CHANGELOG 3.1.0 et 3.2.0, puis src/statistiques.js, les modules d'audience et d'agrégats de la phase 1, et public/admin/statistiques.*.
- Crée la branche `phase-3-statistiques` ; `npm test` vert au départ.

2. DÉCISIONS DÉJÀ PRISES
- Aucune statistique nominative : tout est calculé sur l'identifiant anonyme de navigateur (HMAC), jamais affiché ni exporté.
- Les chiffres sont des NAVIGATEURS, pas des personnes : les libellés doivent le dire.
- Agrégats conservés sans limite ; journaux bruts purgés après 13 mois (déjà en place).
- Fonctionnement sans Internet (Chart.js servi localement, déjà en place) ; pas de nouvelle dépendance sauf nécessité justifiée.

3. PÉRIMÈTRE
- S4 : page Statistiques refondue selon le §6.4 :
  - Sélecteur de période (7 j, 30 j, trimestre, personnalisée) avec comparaison à la période précédente.
  - Tuiles : actifs par jour, actifs par semaine, nouveaux, retour à S+1, contributions (nombre et contributeurs distincts).
  - Courbe des actifs par jour et par semaine glissante avec marqueurs de version.
  - Nouveaux et récurrents par semaine ; carte de chaleur heure × jour de semaine, en navigateurs.
  - Entonnoir visite → fiche ouverte → clic Maps ou site ; utilisation des fonctionnalités (part des visites qui utilisent la recherche, les filtres, le hasard, les favoris, la fiche…).
  - Tableau par établissement : consultations, confirmations de présence, avis, note.
  - Contributions par type et par semaine ; retour des contributeurs dans les 14 jours.
  - Recherches sans résultat (texte tronqué).
  - Section repliée « Détails techniques » (requêtes, erreurs, temps de réponse, navigateurs) et encadré fixe « Limites de mesure ».
- S5 : agrégats complets : sessions (pause > 30 min), rétention, cohortes hebdomadaires ; calcul quotidien incrémental ; la page lit les agrégats et ne relit plus tous les journaux bruts ; les périodes purgées restent consultables via les agrégats.
- S6 : marqueurs de version : chaque démarrage sur une nouvelle version enregistre {version, date} ; ils apparaissent sur les courbes.
- Export CSV des agrégats (sans aucun identifiant) depuis la page.
- Avant/après : la rupture de série du 3.1.0 est indiquée sur les courbes.

4. TESTS À AJOUTER
Jeux de données fabriqués couvrant : DAU/WAU/MAU, nouveaux et récurrents, sessions, rétention S+1, cohortes, entonnoir, contributions ; égalité agrégats incrémentaux = calcul complet ; période chevauchant une purge ; aucun identifiant présent dans les réponses de l'API ni dans l'export ; robots et admin exclus. Vérifie la page dans le navigateur avec un jeu de données de démonstration.

5. LIVRABLE
- Version 3.3.0, CHANGELOG, guide administrateur (lecture de chaque indicateur et de ses limites), dossier technique.
- `npm test` vert. Commits sur la branche ; ne fusionne pas et ne pousse pas sans mon accord.
- Compte rendu : fait, testé, non testé, et les 10 questions de l'audit (§7 de la demande initiale : combien de collègues, retour, jours et horaires, fonctionnalités, établissements, fiches sans clic Maps, collaboratif, retour après avis, effet des nouveautés) avec, pour chacune, l'endroit du tableau de bord qui y répond.
```

---

## Phase 4 — Évolutions complémentaires (version 3.4.0)

```text
Tu travailles sur le site interne « Food Trucks » (Node.js + Express 4, données CSV/JSONL), dans ce dépôt.
Mission : réaliser la PHASE 4 de la feuille de route : des améliorations de confort retenues par le responsable du site.

1. AVANT DE CODER
- Vérifie que la phase 3 est fusionnée dans main (package.json en 3.3.0). Sinon arrête-toi et signale-le.
- Lis AUDIT_ET_PROPOSITIONS.md §3.2 et Partie 4, le CHANGELOG des versions 3.1 à 3.3, puis le code front (public/) et les routes concernées.
- Crée la branche `phase-4-confort` ; `npm test` vert au départ.

2. DÉCISIONS DÉJÀ PRISES
- Postes de travail uniquement, pas de HTTPS (l'API presse-papiers et la géolocalisation ne sont pas disponibles en HTTP : prévoir un repli par sélection du texte ; pas de géolocalisation).
- Données personnelles côté navigateur uniquement pour tout ce qui est personnel (localStorage) ; rien de nominatif côté serveur.
- Fonctionnement sans Internet ; pas de nouvelle dépendance sauf nécessité justifiée.
- Hors périmètre, à ne pas développer : reportés à plus tard C8 (classements), C10 (bons plans), C11 (« On y va ? »), T14 (agrégats pré-calculés) ; écartés la géolocalisation (U16), HTTPS (T11), le SSO et les autres identifications vérifiées (I2 à I4), les comptes administrateurs multiples (T13).

3. PÉRIMÈTRE
- U5 : vue semaine : grille Lundi–Vendredi × établissements, favoris mis en évidence, lisible sur un poste de travail.
- U8 : marques « Déjà essayé » / « À tester » dans le navigateur ; filtre « Pas encore essayé » ; le bouton « Au hasard » propose l'option « que je n'ai pas essayé ».
- U10 : liens partageables (jour, filtres, fiche ouverte dans l'adresse) et bouton « Copier pour Teams » qui produit un texte prêt à coller (« Midi : X (cuisine, prix), lieu, confirmé à HHhMM — on y va ? »), avec repli par sélection du texte puisque le site est en HTTP.
- U12 : confort d'affichage : barre des jours collante, thème sombre suivant le réglage du système, accessibilité clavier et contrastes (vérifier au moins le niveau AA sur les couleurs principales).
- U13 : préférences alimentaires mémorisées dans le navigateur (filtres par défaut, étiquettes à privilégier).
- U14 : carnet personnel dans le navigateur : « J'y ai mangé aujourd'hui », liste datée, nombre d'adresses testées ; bouton pour tout effacer.
- U15 : plan local des emplacements, sans Internet : l'administrateur dépose une image du quartier (enregistrée dans data/) et place chaque lieu par un clic ; la page publique affiche le plan avec les lieux du jour numérotés ; le lien Maps reste en complément.
- Statistiques : chaque nouvelle fonctionnalité émet ses évènements typés pour apparaître dans « Utilisation des fonctionnalités ».
- Page de confidentialité : mentionner ce qui est gardé dans le navigateur et comment l'effacer.

4. TESTS
Tests unitaires de la logique (filtres, hasard avec exclusions, construction et lecture des liens partageables, texte « Copier pour Teams ») ; routes admin du plan (dépôt d'image : types et taille limités, accès protégé, image non exécutable) ; vérification manuelle dans le navigateur, thème clair et sombre.

5. LIVRABLE
- Version 3.4.0, CHANGELOG, guides utilisateur et administrateur, dossier technique.
- `npm test` vert. Commits sur la branche ; ne fusionne pas et ne pousse pas sans mon accord.
- Compte rendu : fait, testé, non testé, procédure de mise à jour du serveur.
```
