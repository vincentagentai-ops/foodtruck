# Spécifications fonctionnelles — Food Trucks (v3.4.0)

## 1. Objectif

Site interne listant les foodtrucks **et restaurants** présents autour du lieu de travail (Basso Cambo, Toulouse),
jour par jour, pour répondre en un coup d'œil à la question « Qu'est-ce que je veux manger aujourd'hui ? ».
Utilisé depuis les postes de travail (lisible sur petit écran, sans optimisation mobile particulière).
Depuis la 3.2.0, le site est **collaboratif** : les collègues ajoutent, corrigent, confirment et notent eux-mêmes ;
tout est publié immédiatement, historisé et réparable ; l'administrateur n'est qu'un filet de sécurité.

## 2. Acteurs

| Acteur | Accès | Besoins |
|---|---|---|
| Visiteur (collègue) | Libre, sans compte | Voir les établissements du jour, chercher, filtrer, garder ses favoris, ouvrir le site / le plan |
| Contributeur (tout collègue dont le navigateur accepte le cookie du site) | Jeton anonyme de navigateur + nom déclaré facultatif | Ajouter, corriger, restaurer une version, confirmer la présence du jour, donner / modifier / supprimer son avis, signaler |
| Administrateur (un seul) | Identifiant + mot de passe (`/admin/`) | Surveiller (signalements, avis masqués, modifications sensibles), restaurer, fusionner, purger, bloquer temporairement un navigateur, régler les seuils, gérer les lieux, consulter les statistiques |

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
| lieux_jours | non | Lieu différent selon le jour : `Jeudi=parking-nord;Vendredi=https://…` (identifiant de lieu ou lien Maps) ; seuls les jours de présence sont gardés |

Un établissement présent à plusieurs endroits selon le jour est **une seule fiche** (`lieux_jours`), obtenue au besoin
par fusion (A9).

### 3.3 Contributions (fichiers JSONL en ajout seul)

| Fichier | Contenu | Règles |
|---|---|---|
| `historique.jsonl` | `{ts, cible, version, auteur, pseudo, action, avant, apres}` ; action : creer, modifier, restaurer, retirer, statut_auto, fusion | Copie complète de la fiche avant / après : toute version connue est restaurable |
| `avis.jsonl` | `{ts, id, cible, auteur, pseudo, note, texte, criteres, plat, action}` ; action : creer, modifier, supprimer, masquer, retablir | Note 1–5 obligatoire ; texte brut ≤ 280 car. ; critères à choix fermés (qualité-prix : bon / correct / cher ; portions : copieuses / normales / petites ; attente : < 5 min / 5–15 min / > 15 min) ; plat ≤ 60 car. ; un avis actif par navigateur et par fiche |
| `presences.jsonl` | `{ts, date, cible, auteur, etat}` ; etat : present, absent, aucun (retrait) | Dernière déclaration d'un navigateur pour la fiche et le jour ; purge à 13 mois (totaux gardés) |
| `signalements.jsonl` | `{ts, id, cible, type, date?, texte?, avis?, auteur, action: signaler}` puis `{ts, id, action: traiter}` | Types : plus_present, ferme (date entre aujourd'hui et +60 j), erreur (précision obligatoire ≤ 200 car.), inapproprie (avis visé), doublon ; un même navigateur ne compte qu'une fois |
| `config-moderation.json` | `{seuils, blocages}` | Réglé par l'administrateur |

`auteur` est un **jeton anonyme** (HMAC du cookie `ft_v` avec une clé propre aux contributions) ; `pseudo` est le nom
déclaré (≤ 30 car., facultatif, affiché « nom déclaré »). L'auteur n'est jamais publié : l'API indique seulement
`mien` pour les avis du navigateur qui consulte.

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
- **F4 – Carte dans la liste** : nom (ouvre la fiche), badges (Nouveau, Restaurant, Présence à confirmer), catégorie
  et libellé, prix, horaires, étiquettes, paiements, note des collègues (« ★ 4,3 (12 avis) » ; « Pas encore assez
  d'avis » sous 3 avis), présence du jour (le jour courant seulement), bandeau « Fermé exceptionnellement » le jour
  concerné, liens « Fiche, avis, présence », « Site / menu », « Plan Google Maps ». Le lieu affiché et le regroupement
  tiennent compte du lieu du jour (`lieux_jours`).
- **F5 – Recherche** : texte libre sur nom, cuisine, catégorie, étiquettes, paiements, type et nom du lieu ; accents et
  casse ignorés ; tous les mots doivent être trouvés.
- **F6 – Filtres** : catégorie, prix maximum (8, 10, 12, 15 € ; prix inconnus exclus), type, régime (étiquette),
  moyen de paiement ; combinables ; mémorisés dans le navigateur avec le classement ; « Effacer les filtres ».
- **F7 – Au hasard** : tire un établissement parmi les résultats affichés, le met en évidence et ouvre sa fiche ;
  option « que je n'ai pas essayé » (U8) ; pas deux fois de suite le même, sauf s'il est seul.
- **F8 – Favoris** : étoile sur chaque fiche ; liste d'identifiants dans le stockage local du navigateur ; bandeau
  « Vos favoris présents aujourd'hui / le <jour> ».
- **F9 – Nouveautés** : badge « Nouveau » pendant 15 jours après `cree_le` ; encadré « Nouveaux cette semaine » (7 jours).
- **F10 – Ajouter un établissement (C1)** : formulaire (nom, type, catégorie, cuisine, jours, lieu habituel, lieu
  selon le jour, lien Maps, prix, horaires, paiements, étiquettes, site, nom déclaré). Pendant la saisie du nom :
  avertissement de **doublon** (nom normalisé sans accents, ponctuation ni mots vides — le, la, food, truck… —,
  distance d'édition ≤ 2 ou inclusion ; ou même lien Maps ; « même lieu » précisé), avec lien vers la fiche existante,
  **sans blocage**. Publication immédiate ; mail à l'administrateur si le SMTP est configuré. **Délai de grâce** :
  pendant 30 min, seul l'auteur (même navigateur) peut modifier la fiche ou la **retirer** (archivage).
- **F11 – Fiche (U3)** : fenêtre en trois blocs — « Aujourd'hui » (présence), « Infos — modifiables par tous »
  (jours et lieu de chaque jour, liens, Modifier / Historique / Signaler), « Avis des collègues — opinions
  personnelles, signées » (moyenne, avis, formulaire).
- **F12 – Modifier les infos (C2)** : mêmes champs que l'ajout ; version attendue envoyée ; si la fiche a changé :
  refus (409) et tableau des différences (version actuelle / votre saisie), « Repartir de la version actuelle ».
  Le statut n'est pas modifiable par les collègues.
- **F13 – Historique (C3)** : liste des versions (action, nom déclaré, date, champs avant → après) ; « Restaurer
  cette version » (nouvelle version ; statut non restauré) ; la version antérieure à la première modification
  enregistrée est aussi restaurable.
- **F14 – Présence du jour (C4)** : « Il est là » / « Pas là aujourd'hui », une déclaration par navigateur, fiche et
  jour, modifiable ou retirable ; affichage « Confirmé par N collègues (dernière à HHhMM) », « Signalé absent par N ».
- **F15 – Signalements (C5)** : n'est plus présent, fermé exceptionnellement le JJ/MM (bandeau ce jour-là), info
  erronée (note sur la fiche jusqu'à la prochaine modification), doublon ; contenu inapproprié sur un avis.
- **F16 – Avis (C6/C7)** : note, commentaire, critères, plat conseillé, nom déclaré ; un par navigateur et par fiche,
  modifiable et supprimable (suppression logique) par son auteur ; date relative, mention « modifié » ; moyenne avec
  le nombre d'avis, « Pas encore assez d'avis » sous 3 avis.
- **F17 – Quoi de neuf (C9)** : 30 derniers ajouts, modifications, restaurations, avis et fermetures signalées.
- **F18 – Charte** de 5 lignes sous les formulaires d'ajout / de modification et d'avis.
- **F19 – Contact** : lien « Écrire à l'administrateur » (si `CONTACT_EMAIL` est défini).
- **F20 – Données et confidentialité** : page d'information (données, finalités, durées, accès, contact,
  contributions et nom déclaré), liée en pied de page.

- **F21 – Vue semaine (U5)** : bouton « Semaine » ; grille Lundi–Vendredi × établissements filtrés, lieu de chaque jour,
  « Fermé » si une fermeture est signalée ; favoris en tête et en surbrillance ; clic sur un jour → détail du jour.
- **F22 – Déjà essayé / À tester (U8)** : marques dans le stockage local ; badges sur la liste ; filtre « Déjà essayé ? »
  (pas encore essayé, à tester, déjà essayés).
- **F23 – Partage (U10)** : jour, vue, recherche, filtres, classement et fiche ouverte dans l'adresse (lien
  partageable) ; « Copier pour Teams » dans la fiche : « Midi : X (cuisine, prix), lieu, confirmé à HHhMM — on y va ? »
  + lien de la fiche, avec repli par sélection du texte (site en HTTP).
- **F24 – Confort d'affichage (U12)** : barre des jours collante, thème sombre suivant le système, lien d'évitement,
  navigation au clavier, contrastes AA des couleurs principales (vérifiés par test).
- **F25 – Préférences (U13)** : filtres par défaut appliqués à chaque ouverture, particularités privilégiées (classées
  en premier dans chaque lieu) ; stockage local.
- **F26 – Carnet (U14)** : « J'y ai mangé aujourd'hui » dans la fiche ; liste datée, nombre d'adresses testées,
  retrait d'une ligne, « Tout effacer » ; stockage local.
- **F27 – Plan local (U15)** : image du quartier déposée par l'administrateur, lieux du jour numérotés (même numéro que
  dans la liste), clic → lieu dans la liste ; sans Internet ; le lien Maps reste disponible.

### Effets automatiques (seuils réglables)

| Règle | Défaut |
|---|---|
| Avis masqué au N-ième signalement « inapproprié » de navigateurs distincts (C13) | 3 |
| « N'est plus présent » par N navigateurs distincts (depuis la dernière confirmation) **et** aucune confirmation depuis J1 jours → `incertain` | 2 navigateurs, 14 jours |
| … aucune confirmation depuis J2 jours → `archive` (masqué, restaurable) | 30 jours |
| Sans aucune confirmation, les jours se comptent depuis le premier signalement ; une confirmation ultérieure rend la fiche de nouveau active si son statut avait été changé automatiquement | — |
| Délai de grâce de l'auteur d'un ajout | 30 min |

## 5. Fonctions — administration (`/admin/`)

- **A1 – À surveiller (C12)** : suggestions héritées de l'ancienne file (publier / écarter) ; signalements ouverts
  (clore, masquer l'avis, bloquer) ; avis masqués (rétablir, supprimer définitivement, bloquer) ; ajouts et
  modifications des champs sensibles (nom, lieu, lieu selon le jour, lien Maps) et statuts automatiques sur 30 jours
  (restaurer la version précédente, archiver) ; fiches incertaines ou archivées (remettre actif) ; blocages ; seuils.
- **A2 – Formulaire établissement** : ajout, modification, publication d'une suggestion ; tous les champs du §3.1 ;
  pré-remplissage à partir d'un texte « Clé : valeur ».
- **A3 – Établissements** : recherche, filtre par statut, modification (historisée « par l'administrateur »),
  suppression définitive avec toutes les contributions liées (l'archivage passe par le statut). Remettre une fiche
  « actif » clôt ses signalements « n'est plus présent ».
- **A4 – Lieux** : ajout, modification en ligne, suppression si inutilisé ; nombre d'établissements par lieu.
- **A10 – Plan des emplacements (U15)** : dépôt d'une image PNG / JPEG / WebP (3 Mo au plus) enregistrée dans `data/`,
  placement de chaque lieu par un clic (ou au clavier), retrait d'un lieu ou de l'image.
- **A5 – Sauvegarde** : téléchargement de `foodtrucks.csv`, `lieux.csv` et `avis.csv` (textes neutralisés pour Excel) ;
  sauvegarde quotidienne automatique (tous les fichiers de `data/`).
- **A6 – Statistiques** (`/admin/statistiques.html`, tableau de bord 3.3.0) : période (7 j, 30 j, trimestre,
  personnalisée, tout) comparée à la période précédente ; tuiles navigateurs actifs par jour et par semaine (7 jours
  glissants), nouveaux, retour à S+1, contributions et contributeurs distincts ; courbe des actifs avec marqueurs de
  version et rupture de série 3.1.0 ; nouveaux / récurrents par semaine ; carte de chaleur heure × jour de semaine ;
  entonnoir visite → fiche → Maps / site ; fonctionnalités en % des visites (visite = pause de plus de 30 min) ;
  tableau par établissement (fiches, clics, présences confirmées, avis, note) ; contributions par type et par semaine,
  retour des nouveaux contributeurs dans les 14 jours ; cohortes hebdomadaires ; recherches sans résultat ; exports CSV
  sans identifiant (jour, semaine, établissement) ; détails techniques repliés ; encadré « Limites de mesure ».
  Calcul quotidien incrémental : la page ne lit que les agrégats (plus la journée en cours).
- **A7 – Conflits** : modification ou suppression refusée si la fiche a changé entre-temps (version) — « Rechargez la page ».
- **A8 – Blocage** : suspension des contributions d'un jeton de navigateur pendant N jours (consultation possible).
- **A9 – Fusion (C14)** : la fiche conservée reçoit les jours de l'autre (avec son lieu pour ces jours), l'union des
  étiquettes et paiements, les champs manquants ; avis, présences, signalements et historique suivent ; l'ancien
  identifiant est redirigé vers la fiche conservée.

## 6. Mesure d'audience

- Cookie `ft_v` : 128 bits aléatoires, `HttpOnly`, `SameSite=Lax`, 13 mois, posé une fois, jamais prolongé.
- Journaux : HMAC de l'identifiant (secret serveur), jamais l'identifiant ni l'IP dans le journal d'audience.
- Évènements typés envoyés par les pages (liste blanche) : chargement, jour_clic, recherche, filtre, filtres_effaces,
  recherche_vide (3.3.0), tri, hasard, clic_site, clic_maps, favori_ajout, favori_retrait, nouveau_clic, suggestion_ouverte, suggestion_erreur,
  clic_mail, fiche_ouverte, historique_ouvert, ajout_ouvert, ajout_erreur, modification_ouverte, doublon_vu,
  quoi_de_neuf_clic ; depuis la 3.4.0 : vue_semaine, marque_essaye, marque_a_tester, marque_retiree, hasard_non_essaye,
  copie_teams, lien_ouvert, preferences, carnet_ajout, carnet_retrait, carnet_ouvert, carnet_efface, plan_ouvert,
  plan_lieu_clic, donnees_locales_effacees (l'usage seulement, jamais le contenu des données personnelles). Écrits par le serveur uniquement : page_vue, suggestion, admin_*, et les contributions (ajout,
  modification, restauration, retrait, avis, avis_modifie, avis_supprime, presence, signalement, avis_masque_auto,
  statut_auto) — celles-ci **sans identifiant de navigateur**, pour qu'elles ne puissent pas être reliées à l'audience.
- Exclusions : administration, API, statuts ≥ 400 et redirections, robots (pages et évènements), requêtes autres que
  GET pour les pages vues ; navigateur de l'administrateur à partir du jour de sa connexion (évènement serveur `admin_vu`).
- Aucune statistique nominative ; agrégats conservés sans limite ; journaux bruts purgés après 13 mois.

## 7. Hors périmètre de cette version (feuille de route)

- Reportés : classements (C8), bons plans (C10), « On y va ? » (C11), agrégats pré-calculés (T14).
- Écartés : géolocalisation (U16), HTTPS (T11), SSO et autres identifications vérifiées (I2 à I4), comptes
  administrateurs multiples (T13).

## 8. Exigences non fonctionnelles

- Pas de base de données : fichiers CSV lisibles et modifiables à la main (UTF-8), journaux JSONL.
- Fonctionne sans accès Internet (aucune ressource externe ; Chart.js est servi par l'application) ; livraison sans npm.
- Un seul processus (pm2), port 80, serveur Windows ; pas de HTTPS ni de SSO.
- Sécurité : CSP stricte, pages d'administration hors du dossier public, limites de fréquence (contributions : 60 par
  heure et par navigateur), validation serveur, écritures acceptées uniquement en JSON et depuis les pages du site
  (en-tête `Origin`), textes saisis toujours affichés échappés, exports CSV neutralisés (`= + - @` tabulation, retour
  chariot en tête).
- Données personnelles : voir la page « Données et confidentialité » ; durées : journaux bruts et présences 13 mois,
  agrégats sans limite, contributions tant qu'elles sont publiées (effaçables par l'administrateur), sauvegardes 30 jours.
- Aucune statistique nominative.
- Navigateurs : Chrome, Edge, Firefox récents.
