# Changelog

Format inspiré de [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/). Versions numérotées MAJEUR.MINEUR.CORRECTIF.

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
