# Inventaire de l'existant (dossier `FoodTrucksNodejs`)

Ce document décrit ce qui a été trouvé dans `~/Téléchargements/FoodTrucksNodejs` le 19/10/2026, et ce qu'il est
devenu dans le projet propre `~/dev/foodtruck` (version 3.0.0).

## 1. Projets et versions trouvés

| Élément | Contenu | Statut |
|---|---|---|
| `FoodTrucksNodejs_v1.zip` (23/01/2025) | Première version Node.js : `server.js` (journaux d'usage et d'accès), `public/` (index, script.js, generationCSV, statistiques), `data/`, `node_modules/` | Historique, remplacé |
| `FoodTrucksNodejs_v2..zip` (21/02/2025) | v1 + page `stats2.html`, formulaire `ajouterFoodtruck.html` ; pas encore de suggestion ni d'administration | Historique, remplacé |
| Dossier racine (« prod ») | v2 + modale « Suggérer un foodtruck », envoi de mail, page `administration.html`, nouveau style (`styles.css`), port 80 | **Base de la v3** |
| `FoodTrucksTest/` | Copie de la prod en cours d'évolution, port 3000 : comptage des actions séparé, guillemets CSV, filtre de dates (côté page seulement), journalisation des clics admin, bandeau « Environnement de test » | Améliorations **reprises et terminées** dans la v3 |
| `node_modules/` | express 4.21.2, nodemailer 6.10.0 | Réinstallé (`npm install`) |

## 2. Documentation trouvée

| Fichier | Contenu | Devenu |
|---|---|---|
| `readme.txt` | Commandes pm2 (`pm2 restart 1`, `pm2 start server.js` dans `C:\SITES\FoodTrucksNodejs`) | `docs/DEPLOIEMENT.md` |
| `startFoodTruckServer.bat` | `cd C:\SITES\FoodTrucksNodejs` + `pm2 start server.js` | `scripts/demarrer.bat` |
| `changelog.txt` | v3, v4 (avant Node.js), Nodejs v1, Nodejs v2 | `CHANGELOG.md` |
| `Todo.txt` | Stats qui ne s'affichent pas, filtre par dates, notation, virgules dans les URL, comptage mail/génération confondus, sauts de ligne dans le CSV | Tous traités sauf la notation (voir §4) |

## 3. Données trouvées

| Fichier | Contenu | Devenu |
|---|---|---|
| `data/foodtrucks.csv` | 19 foodtrucks publiés (Nom, Cuisine, Jours, Emplacement, Prix, Site) | `data-exemple/` (référence) et `data/` (exploitation, hors git) |
| `data/foodtruckAValider.csv` | 1 suggestion en attente (Saveur de Corée), sans en-tête | idem |
| `data/usage.log` | ~1 200 évènements (jours choisis, tris, clics) depuis le 12/02/2025 | `data/` (hors git) — relu par la page Statistiques |
| `data/acces.log` | ~9 900 lignes (requêtes + lignes « duration ») depuis le 28/01/2025 | `data/` (hors git) — relu par la page Statistiques |
| `data/Foodtruck_logo.PNG` | Logo (636×434) | `public/img/logo.png` |
| `FoodTrucksTest/data/*` | Données de test (lignes « dfgfhg… », « Rovès' Truck ») | Non reprises |

Les journaux contiennent les adresses IP des visiteurs : ils ne sont **jamais** versionnés (`.gitignore`).

## 4. Bugs relevés et corrections

| # | Problème dans l'existant | Gravité | Correction v3 |
|---|---|---|---|
| 1 | Tout le dossier `data/` était public : n'importe qui pouvait lire `acces.log` (IP), `usage.log`, les suggestions | Haute | Seule la liste publiée est servie (`/api/foodtrucks`, et `/data/foodtrucks.csv` pour compatibilité) |
| 2 | Pages d'administration et de statistiques, et API d'ajout/validation/suppression, accessibles sans mot de passe | Haute | Espace `/admin/` et `/api/admin/*` protégés par identifiant/mot de passe (`.env`) |
| 3 | `/api/ajouter-foodtruck` et `/add-foodtruck` permettaient à quiconque d'écrire directement dans la liste publiée | Haute | Supprimés ; l'ajout direct est réservé à l'administrateur |
| 4 | Injection HTML/JS : les valeurs du CSV et les évènements de `/api/log` étaient insérés tels quels (`innerHTML`) dans l'accueil et les statistiques | Haute | Échappement systématique, liens limités à http(s) |
| 5 | Une ligne vide ou corrompue dans un journal faisait **planter le serveur** (`JSON.parse` dans un callback) | Haute | Lecture tolérante : ligne ignorée |
| 6 | Suggestion sans champ « jours » : erreur serveur (`jours.split` sur `undefined`) ; aucune validation côté serveur | Moyenne | Validation complète côté serveur (champs, jours, URL, longueurs, prix) |
| 7 | Virgules dans les URL Google Maps longues : la ligne CSV était décalée (Todo) | Moyenne | Vrai lecteur/écrivain CSV (guillemets RFC 4180) |
| 8 | Ajout en fin de fichier sans saut de ligne final : la nouvelle ligne se collait à la précédente ; ou ligne vide en trop (Todo) | Moyenne | Le fichier est réécrit entièrement, normalisé, de façon atomique |
| 9 | Validation admin : les corrections saisies dans le tableau étaient ignorées ; une ligne avec guillemets n'était pas retirée des suggestions mais ajoutée aux publiés (doublon) | Moyenne | Validation par position + vérification, les champs corrigés sont enregistrés |
| 10 | Page Statistiques : graphiques jamais affichés (écouteur `DOMContentLoaded` posé après l'évènement) (Todo) | Moyenne | Graphiques créés directement ; Chart.js servi localement (plus de CDN) |
| 11 | Clic mail, génération CSV et ajout comptés dans un même compteur « envois de mail » (Todo) | Faible | Compteurs séparés par action |
| 12 | Filtre de dates des statistiques : absent en prod, côté page seulement en test (le serveur ignorait les dates) (Todo) | Faible | Filtre traité par le serveur, raccourcis 7 j / 30 j / tout |
| 13 | `acces.log` : 2 lignes par requête (requête + « duration »), durée faussée si plusieurs requêtes simultanées d'une même IP ; « requêtes totales » doublées | Faible | Une ligne par requête avec code HTTP et durée ; anciennes lignes « duration » ignorées |
| 14 | Les pages HTML n'étaient jamais journalisées (servies avant le journal d'accès) | Faible | Journal placé avant les fichiers statiques ; visiteurs calculés sur toutes les requêtes pour l'historique |
| 15 | Le week-end, la liste déroulante prenait la valeur « Samedi » inexistante : « Pas de Food Trucks pour . » | Faible | Le week-end, affichage du lundi avec un message |
| 16 | Tri par prix : prix vides mal placés ; double flèche de tri (CSS + script) | Faible | Prix inconnus toujours en fin de liste ; un seul indicateur |
| 17 | `generationCSV.html` : `formaterPrix` non défini dans `scriptAjout.js` → l'ajout manuel ne fonctionnait pas ; validation des jours exécutée deux fois | Moyenne | Remplacé par le formulaire d'ajout de l'administration |
| 18 | `ajouterFoodtruck.html` : erreur de syntaxe JavaScript (apostrophe non échappée), page inutilisable | Faible | Supprimée (remplacée par l'administration) |
| 19 | Administration : un fichier de suggestions vide affichait une ligne vide ; aucun retour après une action | Faible | Message « Aucune suggestion », notifications |
| 20 | Adresse mail personnelle, serveur SMTP et port écrits en dur ; `nodemailer` recréé à chaque suggestion | Faible | Paramètres dans `.env` ; mail désactivable |
| 21 | Liens « cachés » (opacité 0) pour accéder à la génération CSV et aux statistiques | Faible | Lien « Espace administrateur » discret en pied de page, protégé par mot de passe |
| 22 | Deux copies du code (prod / test) à maintenir | — | Un seul code ; l'environnement de test se règle par `APP_ENV=test` et `PORT` |
| 23 | Écritures concurrentes possibles sur les CSV | Faible | File d'attente des écritures dans le processus |
| 24 | `papaparse` chargé mais jamais utilisé, `styles_original.css` inutilisé | — | Retirés |

Non traité (idée de la Todo) : notation des foodtrucks par les utilisateurs — voir `docs/SPECIFICATIONS.md` §6.
