# Déploiement et mise à jour — procédure simple

Serveur : Windows, dossier `C:\SITES\FoodTrucksNodejs`, Node.js + pm2 (déjà en place).
Prérequis : **Node.js 20.12 ou plus** (`node -v` dans une invite de commandes ; sinon installer la version LTS
depuis nodejs.org) et pm2 (`npm install -g pm2`). **Le serveur n'a pas besoin d'accès à Internet ni au registre
npm** : le zip de livraison contient déjà les dépendances (`node_modules`).

---

## A. Mettre à jour (cas habituel)

1. Sur le PC de développement : lancer `scripts/preparer-livraison.sh` → fichier `livraisons/foodtruck-X.Y.Z.zip`
   (il contient `node_modules` ; le PC a besoin d'Internet pour le préparer).
2. Copier le zip sur le serveur et **l'extraire dans un dossier temporaire**, par exemple `C:\SITES\foodtruck-maj`
   (et **pas** par-dessus le site).
3. Dans ce dossier temporaire, double-cliquer sur **`scripts\mettre-a-jour.bat`**. Le script :
   - copie `data\` dans `C:\SITES\FoodTrucksNodejs\sauvegardes\avant-mise-a-jour-<date>\` ;
   - arrête le site ;
   - **remplace entièrement** `src\`, `public\`, `admin\`, `scripts\`, `docs\`, `data-exemple\` et `node_modules\`
     (robocopy /MIR : les fichiers retirés dans la nouvelle version disparaissent aussi du serveur) et les fichiers de
     la racine (`server.js`, `package.json`…) ;
   - ne touche **jamais** à `data\`, `sauvegardes\` ni `.env` ; n'appelle pas npm ;
   - redémarre le site (`pm2 restart foodtruck`) et enregistre l'état pm2.

   Si le site n'est pas dans `C:\SITES\FoodTrucksNodejs`, lancer le script depuis une invite de commandes en donnant
   le dossier : `scripts\mettre-a-jour.bat D:\Sites\FoodTrucks`.
4. Ouvrir le site et vérifier qu'il s'affiche ; supprimer le dossier temporaire.

En cas de problème : `pm2 logs foodtruck` affiche les erreurs.

---

## B. Passer directement à la 3.4.0 depuis une version 3.x (une seule fois)

La mise à jour se fait **en une seule fois**, quelle que soit la version installée (3.0.0, 3.1.0, 3.2.0 ou 3.3.0) :
au premier démarrage, le site met les données au format actuel, en gardant une copie des fichiers d'origine. Il est
inutile d'installer les versions intermédiaires.

1. **Sauvegarde préalable** (en plus de celle que fait le script) : copier tout `C:\SITES\FoodTrucksNodejs` en
   `C:\SITES\FoodTrucksNodejs_avant_3.4.0`.
2. **Mise à jour** : procédure A avec le zip 3.4.0 (depuis la 3.0.0, le script supprime aussi l'ancien dossier
   `public\admin`).
3. **`.env`** (Bloc-notes) : rien d'obligatoire. Facultatif : `LIMITE_CONTRIBUTIONS=60` (remplace
   `LIMITE_SUGGESTIONS`, qui n'est plus lu) ; `HOTES_AUTORISES=` seulement si le site est appelé à travers un proxy qui
   change le nom d'hôte (voir point 5). Après modification : `pm2 restart foodtruck`.
4. **Vérifications** dans `pm2 logs foodtruck --lines 50` :
   - si la version installée était antérieure à la 3.2.0 : « Données migrées au format 3.2.0. Copie des fichiers
     d'origine : …foodtrucks-avant-migration-<date>.csv » (3.2.0 est le format actuel du catalogue) ;
   - « Sauvegarde du jour : … » (si ce n'était pas déjà fait aujourd'hui) ;
   - depuis la 3.0.0 seulement : « Copie des journaux avant la première purge : …\sauvegardes\journaux-avant-premiere-purge »
     puis « Journaux antérieurs au … purgés » (la première purge retire les lignes de plus de 13 mois ; les
     statistiques restent consultables grâce aux agrégats) ;
   - aucune ligne « ATTENTION » ni « Maintenance (agregats) impossible » (si `TRUST_PROXY=true` est signalé : sans
     proxy, mettre `TRUST_PROXY=false`).

   Dans `data\` apparaissent au besoin `lieux.csv`, les fichiers de contributions, `stats-etat.json` (état interne du
   calcul des statistiques) ; `stats-jours.json` passe au format 2. Au premier démarrage, les statistiques sont
   **recalculées une fois** depuis les journaux existants (quelques secondes).
5. **Vérifier dans le navigateur, depuis un poste de collègue** (pas depuis le serveur) :
   - la page d'accueil liste les mêmes établissements qu'avant ; « Quoi de neuf ? » et « Données et confidentialité »
     en bas de page ; bouton **Semaine** ; **Mon carnet** en bas de page ; en mode sombre Windows, le site s'affiche
     en sombre ;
   - ouvrir une fiche : bloc « Pour moi », **Copier pour Teams** puis collage dans Teams ; cliquer **✔ Il est là**
     puis le recliquer ; donner un avis puis le **Supprimer** ;
   - si une action affiche « Requête refusée : elle ne provient pas d'une page de ce site » : renseigner dans `.env`
     `HOTES_AUTORISES=` avec le nom utilisé dans la barre d'adresse (ex. `foodtrucks,foodtrucks.entreprise.local`),
     puis `pm2 restart foodtruck` ;
   - `/admin/` demande le mot de passe ; `/%61dmin/index.html` doit répondre « Page introuvable » ; la section
     **À surveiller** est en haut (traiter les **suggestions héritées** s'il en reste) ;
   - `/admin/statistiques.html` → bouton **Tout** : courbe remplie, tuiles remplies ; **Exporter → Par jour** ouvre un
     CSV. Le trait de version `v3.4.0` apparaît ; ceux des versions intermédiaires non installées n'apparaissent pas.
6. **Mise en route** dans `/admin/` (voir `docs/GUIDE_ADMINISTRATEUR.md`) :
   - depuis la 3.0.0 (≈ 1 h) : créer les lieux, puis pour chaque établissement choisir le lieu, le type
     (restaurant / foodtruck), cocher les paiements et étiquettes, saisir les horaires (« Saisie initiale après la mise
     à jour 3.1.0 ») ;
   - depuis la 3.0.0 ou la 3.1.0 (≈ 15 min, À surveiller) : fusionner les doublons connus (les deux fiches
     L'épicurieux : fiche conservée = celle du mercredi, par exemple), vérifier les seuils ;
   - pour tous : section « Plan des emplacements », déposer l'image du quartier et placer les lieux (fichiers
     `data\plan.json` et `data\plan-image.png`, `.jpg` ou `.webp`, sauvegardés chaque jour avec le reste) ;
   - puis suivre « Après la mise à jour 3.4.0 » (et, selon la version d'origine, 3.3.0 / 3.2.0) dans le guide.
7. **Informer les collègues** (annonce, page « Données et confidentialité »). Depuis la 3.0.0 : faire inscrire le
   traitement au registre par le correspondant RGPD / DPO.
8. **Après quelques jours**, si tout va bien : supprimer `C:\SITES\FoodTrucksNodejs_avant_3.4.0`, les fichiers
   `data\…-avant-migration-<date>.csv` et, s'il existe, `sauvegardes\journaux-avant-premiere-purge\` (adresses IP de
   plus de 13 mois).

**Revenir à la version précédente** si nécessaire : `pm2 stop foodtruck`, remettre le dossier
`C:\SITES\FoodTrucksNodejs_avant_3.4.0` à la place du site, `pm2 restart foodtruck`. Les contributions faites
entre-temps (avis, présences, ajouts) seraient perdues : copier d'abord `data\` à part pour pouvoir les reprendre.

---

## C. Première installation (serveur neuf)

1. Extraire le zip dans `C:\SITES\FoodTrucksNodejs`.
2. Double-cliquer sur **`scripts\installer.bat`**. Le Bloc-notes s'ouvre sur `.env` : régler au minimum

   ```
   PORT=80
   ADMIN_PASSWORD=un-mot-de-passe-solide
   CONTACT_EMAIL=votre.adresse@entreprise.fr
   SMTP_HOST=nom-du-serveur-smtp-interne
   SMTP_IGNORE_TLS_ERRORS=true
   ```

   enregistrer, fermer le Bloc-notes : le site démarre (`npm install` n'est lancé que si `node_modules` manque).
3. Vérifier : la page d'accueil, puis `/admin/` (identifiant `admin` + le mot de passe choisi).

**Démarrage automatique** : si le site ne redémarre pas après un redémarrage du serveur, lancer
`scripts\demarrer.bat` ; pour l'automatiser, installer une fois `npm install -g pm2-windows-startup` puis
`pm2-startup install` (pm2 relance alors les applications enregistrées par `pm2 save`).

---

## D. Environnement de test (facultatif)

Copier le site dans un autre dossier (ex. `C:\SITES\FoodTrucksTest`) **avec une copie de `data\`**, puis dans son
`.env` : `PORT=3000`, `APP_ENV=test` (bandeau « Environnement de test »), `BACKUP_DIR=C:\SITES\FoodTrucksTest\sauvegardes`.
Dans `ecosystem.config.js`, changer `name: 'foodtruck'` en `name: 'foodtruck-test'` puis lancer
`pm2 start ecosystem.config.js`. Pour le mettre à jour : `scripts\mettre-a-jour.bat C:\SITES\FoodTrucksTest`, puis
`pm2 restart foodtruck-test`.

---

## E. Lancer en local (PC de développement)

```bash
npm install
cp .env.example .env    # puis renseigner ADMIN_PASSWORD
npm start               # ou « npm run dev » : redémarre à chaque modification du code
```

Site : http://localhost:3000 — Tests : `npm test`.
Attention : le serveur migre, sauvegarde et purge le dossier `DATA_DIR` du `.env`. Pour des essais sans toucher à une
copie de production, lancer avec un dossier temporaire :
`DATA_DIR=/tmp/essai/data BACKUP_DIR=/tmp/essai/sauvegardes npm start` (après `cp data-exemple/*.csv /tmp/essai/data/`).

---

## F. Restaurer une sauvegarde

Les sauvegardes quotidiennes sont dans `C:\SITES\FoodTrucksNodejs\sauvegardes\AAAA-MM-JJ\` (30 jours) ; celles faites
avant chaque mise à jour dans `sauvegardes\avant-mise-a-jour-<date>\`.

1. Arrêter le site : `pm2 stop foodtruck`.
2. Mettre de côté l'état actuel : copier `data\` en `data_avant_restauration\`.
3. Copier **les fichiers voulus** de la sauvegarde dans `data\` en remplaçant l'existant. En général :
   `foodtrucks.csv`, `lieux.csv` (le catalogue). Pour revenir entièrement à un jour donné, copier tous ses fichiers
   (`.csv`, `.json`, `.jsonl`).
   Attention : `foodtrucks.csv` et `historique.jsonl` vont ensemble (les versions de l'historique doivent correspondre
   aux fiches) ; restaurez-les ensemble. Pour annuler une seule modification, utilisez plutôt « Restaurer cette
   version » sur la fiche. Les avis, présences et signalements (`avis.jsonl`, `presences.jsonl`,
   `signalements.jsonl`) ne sont qu'ajoutés : restaurer une ancienne copie fait perdre les contributions plus récentes.
   Ne restaurez pas un ancien `stats-jours.json` par-dessus un plus récent sans raison : il contient les statistiques
   agrégées (un fichier plus ancien en contient moins).
4. Redémarrer : `pm2 restart foodtruck`, puis vérifier la page d'accueil et `/admin/`.
5. Une fois vérifié, supprimer `data_avant_restauration\`.

Les journaux techniques `acces-AAAA-MM.log` (adresses IP) ne font pas partie des sauvegardes quotidiennes.
