# Spécifications fonctionnelles — Food Trucks (v3.0.0)

## 1. Objectif

Site interne listant les foodtrucks présents autour du lieu de travail (Basso Cambo, Toulouse), jour par jour,
pour répondre en un coup d'œil à la question « Qu'est-ce que je veux manger aujourd'hui ? ».

## 2. Acteurs

| Acteur | Accès | Besoins |
|---|---|---|
| Visiteur (collègue) | Libre, sans compte | Voir les foodtrucks du jour, ouvrir l'emplacement / le site, suggérer un foodtruck |
| Administrateur | Identifiant + mot de passe (`/admin/`) | Valider/rejeter les suggestions, ajouter, corriger, retirer un foodtruck, consulter les statistiques |

## 3. Données

Un foodtruck :

| Champ | Obligatoire | Règle |
|---|---|---|
| Nom | oui | 80 caractères max, ne commence pas par `= + - @` |
| Cuisine | oui | 80 caractères max, ne commence pas par `= + - @` |
| Jours | oui | Un ou plusieurs jours du lundi au vendredi ; stocké « Lundi;Jeudi » dans l'ordre de la semaine |
| Emplacement | oui | Lien http(s), en pratique Google Maps |
| Prix | non | Nombre (« 12 ») ou fourchette (« 10-15 ») en euros ; « 10 à 15 € » est accepté et normalisé |
| Site | non | Lien http(s) |

Un même foodtruck présent à deux endroits différents selon le jour = deux lignes (ex. L'épicurieux).

## 4. Fonctions — partie publique

- **F1 – Liste du jour** : à l'ouverture, les foodtrucks du jour sont affichés (le samedi et le dimanche : ceux du
  lundi, avec un message). Le jour courant est repéré par une pastille verte.
- **F2 – Changer de jour** : boutons Lundi à Vendredi.
- **F3 – Trier** : clic sur un en-tête (Nom, Cuisine, Emplacement, Prix), second clic = ordre inverse. Le tri par prix
  utilise le prix minimum ; les prix inconnus sont toujours en fin de liste.
- **F4 – Liens** : le nom ouvre le site du foodtruck (s'il est connu), « Voir sur Google Maps » ouvre l'emplacement,
  dans un nouvel onglet.
- **F5 – Suggérer un foodtruck** : formulaire (nom, cuisine, jours à cocher, emplacement, prix, site). Contrôle dans le
  navigateur puis sur le serveur ; les erreurs sont listées dans le formulaire. La suggestion est mise en attente
  (non visible) et un mail est envoyé à l'administrateur si le SMTP est configuré.
- **F6 – Contact** : lien « Envoyez-moi un mail » (si `CONTACT_EMAIL` est défini) avec un modèle de message.
- **F7 – Affichage téléphone** : sous 640 px, le tableau devient une liste de fiches.

## 5. Fonctions — administration (`/admin/`)

- **A1 – Suggestions à valider** : tableau éditable ; « Valider » publie la suggestion (avec les corrections
  saisies), « Rejeter » la supprime après confirmation.
- **A2 – Ajouter un foodtruck** : formulaire publié directement ; option « Pré-remplir à partir d'un texte » qui
  reconnaît les lignes « Nom : … », « Type de cuisine : … », « Jours : … », « Emplacement Google Maps : … »,
  « Fourchette de prix : … », « Site : … » (format du mail type de la page d'accueil).
- **A3 – Foodtrucks publiés** : recherche, modification en ligne (« Enregistrer »), retrait après confirmation.
- **A4 – Sauvegarde** : téléchargement du CSV des foodtrucks publiés.
- **A5 – Statistiques** (`/admin/statistiques.html`) : période (dates, 7 j, 30 j, tout) ; chiffres clés (visiteurs
  uniques, pages vues, suggestions, requêtes) ; graphiques fréquentation par jour, jours consultés, activité par heure ;
  tableaux actions, foodtrucks consultés, tris, pages, navigateurs, jours de la semaine.
- **A6 – Conflits** : si une ligne a été modifiée entre l'affichage et l'action (deux administrateurs), l'action est
  refusée avec le message « Rechargez la page ».

## 6. Hors périmètre / évolutions possibles

- Notation ou avis des utilisateurs sur les foodtrucks (idée de la Todo, nécessiterait d'éviter les votes multiples).
- Horaires et menus du jour ; carte interactive.
- Comptes administrateurs multiples, historique des modifications.
- Rotation automatique des journaux.

## 7. Exigences non fonctionnelles

- Pas de base de données : fichiers CSV lisibles et modifiables à la main (UTF-8).
- Fonctionne sans accès Internet (aucune ressource externe ; Chart.js est servi par l'application).
- Données personnelles : seules l'adresse IP et le navigateur des visiteurs sont journalisés, accessibles uniquement
  aux administrateurs.
- Navigateurs : Chrome, Edge, Firefox récents.
