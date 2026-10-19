# Spécifications fonctionnelles — Food Trucks (v3.1.0)

## 1. Objectif

Site interne listant les foodtrucks **et restaurants** présents autour du lieu de travail (Basso Cambo, Toulouse),
jour par jour, pour répondre en un coup d'œil à la question « Qu'est-ce que je veux manger aujourd'hui ? ».
Utilisé depuis les postes de travail (lisible sur petit écran, sans optimisation mobile particulière).

## 2. Acteurs

| Acteur | Accès | Besoins |
|---|---|---|
| Visiteur (collègue) | Libre, sans compte | Voir les établissements du jour, chercher, filtrer, garder ses favoris, ouvrir le site / le plan, suggérer un établissement |
| Administrateur (un seul) | Identifiant + mot de passe (`/admin/`) | Valider/rejeter les suggestions, ajouter, corriger, archiver un établissement, gérer les lieux, consulter les statistiques |

## 3. Données

### 3.1 Établissement (`foodtrucks.csv`)

| Champ | Obligatoire | Règle |
|---|---|---|
| id | auto | Identifiant stable (6 caractères), attribué à la création ou par la migration ; ne change jamais |
| nom | oui | 80 caractères max, ne commence pas par `= + - @` |
| type | oui (défaut foodtruck) | `foodtruck` ou `restaurant` |
| cuisine | oui | Libellé libre, 80 caractères max, ne commence pas par `= + - @` |
| categorie | oui (déduite si vide) | Liste fermée : Africaine, Asiatique, Burgers, Créole, Crêpes, Française, Grillades, Indienne, Italienne / Pizza, Libanaise / Orientale, Mexicaine, Salades, Sandwichs / Bagels, Autre |
| etiquettes | non | Liste fermée, séparées par `;` : Végétarien possible, Végan possible, Halal, Sans gluten possible, Fait maison |
| jours | oui | Un ou plusieurs jours du lundi au vendredi ; stocké « Lundi;Jeudi » dans l'ordre de la semaine |
| lieu | non | Identifiant d'un lieu de `lieux.csv` |
| horaires | non | Texte court (60 caractères), ex. « 11h30-14h » |
| prix | non | Nombre (« 12 ») ou fourchette (« 10-15 ») en euros ; « 10 à 15 € » est accepté et normalisé |
| paiements | non | Liste fermée, séparés par `;` : Titres-restaurant papier, Titres-restaurant carte, CB, Espèces |
| site | non | Lien http(s) |
| emplacement | si pas de lieu | Lien http(s) Google Maps ; facultatif quand un lieu est renseigné |
| statut | oui (défaut actif) | `actif` (affiché), `incertain` (affiché en fin de liste, « présence à confirmer »), `archive` (masqué) |
| cree_le, maj_le | auto | Dates AAAA-MM-JJ (vides pour les établissements antérieurs à la 3.1.0) |
| version | auto | Entier incrémenté à chaque modification (détection des modifications concurrentes) |

Un même établissement présent à deux endroits différents selon le jour reste en deux fiches dans cette version
(fusion prévue en phase 2).

### 3.2 Lieu (`lieux.csv`)

`id` (dérivé du nom à la création, stable), `nom` (obligatoire, 60 car.), `description` (200 car.), `minutes_a_pied`
(0 à 99), `maps` (lien http(s) facultatif).

## 4. Fonctions — partie publique

- **F1 – Liste du jour** : à l'ouverture, les établissements du jour (statuts actif et incertain) sont affichés ; le
  samedi et le dimanche, ceux du lundi, avec un message. Le jour courant est repéré par une pastille verte.
- **F2 – Changer de jour** : boutons Lundi à Vendredi.
- **F3 – Regroupement par lieu** : les fiches sont regroupées par lieu (« Parking Nord · 3 min à pied »), lieux
  triés par temps de marche, « Lieu à préciser » en dernier. Classement alternatif par nom ou par prix (prix minimum,
  prix inconnus en fin de liste). Dans un groupe, les fiches « incertain » sont en dernier.
- **F4 – Fiche** : nom, badges (Nouveau, Restaurant, Présence à confirmer), catégorie et libellé, prix, horaires,
  étiquettes, paiements, liens « Site / menu » et « Plan Google Maps » (secondaire ; lien du lieu à défaut).
- **F5 – Recherche** : texte libre sur nom, cuisine, catégorie, étiquettes, paiements, type et nom du lieu ; accents et
  casse ignorés ; tous les mots doivent être trouvés.
- **F6 – Filtres** : catégorie, prix maximum (8, 10, 12, 15 € ; prix inconnus exclus), type, régime (étiquette),
  moyen de paiement ; combinables ; mémorisés dans le navigateur avec le classement ; « Effacer les filtres ».
- **F7 – Au hasard** : tire un établissement parmi les résultats affichés et le met en évidence.
- **F8 – Favoris** : étoile sur chaque fiche ; liste d'identifiants dans le stockage local du navigateur ; bandeau
  « Vos favoris présents aujourd'hui / le <jour> ».
- **F9 – Nouveautés** : badge « Nouveau » pendant 15 jours après `cree_le` ; encadré « Nouveaux cette semaine » (7 jours).
- **F10 – Suggérer un établissement** : formulaire (nom, type, catégorie, cuisine, jours, lieu ou lien Maps, prix,
  horaires, paiements, site). Contrôle dans le navigateur puis sur le serveur ; suggestion mise en attente ; mail à
  l'administrateur si le SMTP est configuré.
- **F11 – Contact** : lien « Envoyez-moi un mail » (si `CONTACT_EMAIL` est défini) avec un modèle de message.
- **F12 – Données et confidentialité** : page d'information (données, finalités, durées, accès, contact), liée en pied
  de page.

## 5. Fonctions — administration (`/admin/`)

- **A1 – Suggestions** : liste ; « Compléter et publier » charge la suggestion dans le formulaire ; « Rejeter ».
- **A2 – Formulaire établissement** : ajout, modification, publication d'une suggestion ; tous les champs du §3.1 ;
  pré-remplissage à partir d'un texte « Clé : valeur ».
- **A3 – Établissements** : recherche, filtre par statut, modification, suppression définitive (l'archivage passe par
  le statut).
- **A4 – Lieux** : ajout, modification en ligne, suppression si inutilisé ; nombre d'établissements par lieu.
- **A5 – Sauvegarde** : téléchargement de `foodtrucks.csv` et `lieux.csv` ; sauvegarde quotidienne automatique.
- **A6 – Statistiques** (`/admin/statistiques.html`) : période (dates, 7 j, 30 j, tout) ; navigateurs actifs par jour /
  semaine / mois (moyennes), nouveaux, pages vues, suggestions ; courbes par jour (avec l'ancien calcul par IP),
  nouveaux / récurrents par semaine, jours consultés, activité par heure ; utilisation des fonctions, établissements
  consultés (site / Maps) ; détails techniques ; limites de mesure.
- **A7 – Conflits** : modification ou suppression refusée si la fiche a changé entre-temps (version) — « Rechargez la page ».

## 6. Mesure d'audience

- Cookie `ft_v` : 128 bits aléatoires, `HttpOnly`, `SameSite=Lax`, 13 mois, posé une fois, jamais prolongé.
- Journaux : HMAC de l'identifiant (secret serveur), jamais l'identifiant ni l'IP dans le journal d'audience.
- Évènements typés envoyés par les pages (liste blanche) : chargement, jour_clic, recherche, filtre, filtres_effaces,
  tri, hasard, clic_site, clic_maps, favori_ajout, favori_retrait, nouveau_clic, suggestion_ouverte, suggestion_erreur,
  clic_mail. Écrits par le serveur uniquement : page_vue, suggestion, admin_*.
- Exclusions : administration, API, statuts ≥ 400 et redirections, robots, requêtes autres que GET pour les pages vues.
- Aucune statistique nominative ; agrégats conservés sans limite ; journaux bruts purgés après 13 mois.

## 7. Hors périmètre de cette version (feuille de route)

- Phase 2 : contribution directe par tous (ajout, modification, historique, présence du jour, signalements, avis),
  fusion des fiches multi-lieux, fin de la file de suggestions.
- Phase 3 : tableau de bord statistique complet (rétention, cohortes, entonnoir, marqueurs de version).
- Phase 4 : vue semaine, « déjà essayé », partage, thème sombre, plan local des emplacements.

## 8. Exigences non fonctionnelles

- Pas de base de données : fichiers CSV lisibles et modifiables à la main (UTF-8), journaux JSONL.
- Fonctionne sans accès Internet (aucune ressource externe ; Chart.js est servi par l'application) ; livraison sans npm.
- Un seul processus (pm2), port 80, serveur Windows ; pas de HTTPS ni de SSO.
- Sécurité : CSP stricte, pages d'administration hors du dossier public, limites de fréquence, validation serveur.
- Données personnelles : voir la page « Données et confidentialité » ; durées : journaux bruts 13 mois, agrégats sans
  limite, sauvegardes 30 jours.
- Navigateurs : Chrome, Edge, Firefox récents.
