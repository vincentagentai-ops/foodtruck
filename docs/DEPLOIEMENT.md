# Déploiement et mise à jour — procédure simple

Serveur : Windows, dossier `C:\SITES\FoodTrucksNodejs`, Node.js + pm2 (déjà en place pour l'ancienne version).
Prérequis : **Node.js 20.12 ou plus** (`node -v` dans une invite de commandes ; sinon installer la version LTS
depuis nodejs.org) et pm2 (`npm install -g pm2`).

---

## A. Mettre à jour (cas habituel)

1. Sur le PC : lancer `scripts/preparer-livraison.sh` → fichier `livraisons/foodtruck-X.Y.Z.zip`.
2. Copier le zip sur le serveur et **l'extraire dans `C:\SITES\FoodTrucksNodejs`** en remplaçant les fichiers.
   (Le zip ne contient ni `data\` ni `.env` : les données et réglages sont conservés.)
3. Double-cliquer sur **`scripts\mettre-a-jour.bat`**.
4. Ouvrir le site et vérifier qu'il s'affiche.

C'est tout. En cas de problème : `pm2 logs foodtruck` affiche les erreurs.

---

## B. Première installation de la v3 (une seule fois, remplace l'ancienne version)

1. **Sauvegarder** l'ancien dossier : copier `C:\SITES\FoodTrucksNodejs` en `C:\SITES\FoodTrucksNodejs_v2_sauvegarde`.
2. Arrêter l'ancienne version : dans une invite de commandes, `pm2 delete 1` (ou `pm2 list` pour voir son numéro).
3. Vider `C:\SITES\FoodTrucksNodejs` **sauf le dossier `data`**, puis y extraire le zip de la v3.
4. Double-cliquer sur **`scripts\installer.bat`**. Le Bloc-notes s'ouvre sur `.env` : régler au minimum

   ```
   PORT=80
   ADMIN_PASSWORD=un-mot-de-passe-solide
   CONTACT_EMAIL=votre.adresse@entreprise.fr
   SMTP_HOST=nom-du-serveur-smtp-interne
   SMTP_IGNORE_TLS_ERRORS=true
   ```

   enregistrer, fermer le Bloc-notes : le site démarre.
5. Vérifier : la page d'accueil, puis `/admin/` (identifiant `admin` + le mot de passe choisi).

Les anciens fichiers de `data\` (CSV et journaux) sont repris tels quels ; ils seront convertis au nouveau format
à la première modification.

**Démarrage automatique** : si le site ne redémarre pas après un redémarrage du serveur, lancer
`scripts\demarrer.bat` ; pour l'automatiser, installer une fois `npm install -g pm2-windows-startup` puis
`pm2-startup install` (pm2 relance alors les applications enregistrées par `pm2 save`).

---

## C. Environnement de test (facultatif)

Copier le site dans un autre dossier (ex. `C:\SITES\FoodTrucksTest`), puis dans son `.env` : `PORT=3000`,
`APP_ENV=test` (bandeau « Environnement de test »). Dans `ecosystem.config.js`, changer `name: 'foodtruck'` en
`name: 'foodtruck-test'` puis lancer `pm2 start ecosystem.config.js`.

---

## D. Lancer en local (PC de développement)

```bash
npm install
cp .env.example .env    # puis renseigner ADMIN_PASSWORD
npm start               # ou « npm run dev » : redémarre à chaque modification du code
```

Site : http://localhost:3000 — Tests : `npm test`.

## E. Revenir en arrière

Arrêter (`pm2 stop foodtruck`), remettre les fichiers de la version précédente (zip précédent de `livraisons/`)
sans toucher à `data\` ni `.env`, puis `scripts\mettre-a-jour.bat`.
