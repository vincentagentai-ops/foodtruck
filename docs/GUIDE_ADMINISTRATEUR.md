# Guide administrateur — Food Trucks

## Se connecter

Adresse : **`/admin/`** (ou le lien « Espace administrateur » en bas de la page d'accueil).
Le navigateur demande un identifiant et un mot de passe : ceux définis dans le fichier `.env` du serveur
(`ADMIN_USER`, par défaut `admin`, et `ADMIN_PASSWORD`).

Pour vous déconnecter, fermez le navigateur.
Message « Espace administrateur désactivé » : `ADMIN_PASSWORD` est vide dans `.env` (voir « Réglages »).

## Traiter les suggestions

La section **Suggestions à valider** liste les propositions envoyées par les visiteurs (le nombre apparaît
entre parenthèses). Si `SMTP_HOST` est réglé, vous recevez aussi un mail à chaque suggestion.

1. **Compléter et publier** : la suggestion est chargée dans le formulaire (titre « Publier une suggestion »).
   Vérifiez chaque champ (lien Google Maps, jours…), complétez le lieu, les paiements, les horaires…
2. Cliquez sur **Publier la suggestion** : l'établissement est publié avec vos corrections et reçoit un identifiant.
3. **Rejeter** : la suggestion est supprimée (après confirmation).

Si un message signale une erreur (jour non reconnu, lien invalide…), corrigez le champ puis cliquez de nouveau.
« Cet élément a été modifié entre-temps » : un autre administrateur a agi en même temps, rechargez la page.

## Ajouter ou modifier un établissement

Formulaire **Ajouter un établissement** : remplissez puis **Ajouter et publier**. Dans la liste **Établissements**,
le bouton **Modifier** charge une fiche dans le même formulaire (**Enregistrer les modifications**, ou **Annuler**).

| Champ | Règle |
|---|---|
| Nom, Cuisine (libellé libre) | Obligatoires. Le libellé libre (« Bowls végétariens ») est affiché tel quel. |
| Type | Foodtruck ou Restaurant. Un restaurant ouvert toute la semaine a simplement les 5 jours cochés. |
| Catégorie | Liste fermée qui sert au filtre « Cuisine ». Laissée vide, elle est déduite du libellé (« Autre » sinon). |
| Lieu | Choisi dans la liste des lieux (voir ci-dessous). Sans lieu, la fiche est classée dans « Lieu à préciser ». |
| Lien Google Maps | Obligatoire seulement s'il n'y a pas de lieu. |
| Horaires | Texte libre court (« 11h30-14h »). |
| Prix | « 12 », « 10-15 » ou « 10 à 15 € ». |
| Jours, Étiquettes, Paiements | Cases à cocher. |
| Statut | **Actif** (affiché), **Incertain** (affiché en fin de liste avec « Présence à confirmer »), **Archivé** (masqué du public, restaurable en repassant à Actif). |

- **Raccourci** : si vous avez reçu un mail du modèle de la page d'accueil (« Nom : …, Type de cuisine : …,
  Lieu : …, Paiements acceptés : … »), ouvrez **Pré-remplir à partir d'un texte**, collez le texte et cliquez sur
  **Pré-remplir le formulaire**.
- **Supprimer** retire définitivement la fiche (et son identifiant). Pour un retrait temporaire, préférez le statut
  **Archivé**.
- Chaque fiche a un **identifiant** stable et une **version** : si quelqu'un l'a modifiée entre l'affichage et
  l'enregistrement, l'enregistrement est refusé (« modifié entre-temps ») ; rechargez la page.
- Un établissement présent à des endroits différents selon le jour (L'épicurieux) reste pour l'instant en deux fiches
  (la fusion arrive avec la version suivante).

La liste **Établissements** se filtre par texte (nom, cuisine, jour, lieu…) et par statut ; les fiches archivées
apparaissent grisées.

## Lieux

Section **Lieux** : un lieu = un nom (« Parking Nord »), une description (« devant le bâtiment B »), un temps de marche
en minutes et, si possible, un lien Google Maps. Les établissements du même lieu sont regroupés sur la page
d'accueil, du plus proche au plus loin.

- **Ajouter** : remplissez la dernière ligne du tableau puis **Ajouter**. L'identifiant (« parking-nord ») est
  créé à partir du nom et ne change plus, même si le nom est modifié ensuite.
- **Modifier** : changez les champs de la ligne puis **Enregistrer**.
- **Supprimer** n'est possible que si aucun établissement n'utilise le lieu.

## Saisie initiale après la mise à jour 3.1.0

La migration a gardé toutes les données, attribué une catégorie à partir du libellé et laissé les lieux vides.
Comptez environ une heure pour :

1. Créer les **lieux** (section Lieux), avec le temps de marche.
2. Pour chaque établissement : **Modifier** → choisir le lieu, le **type** (les établissements ouverts toute la
   semaine sont souvent des restaurants), vérifier la catégorie, cocher les **paiements**, les étiquettes, saisir les
   horaires.
3. Vérifier la page d'accueil (regroupement par lieu, filtres).

## Sauvegarder et restaurer

- **Automatique** : chaque jour (au démarrage puis toutes les heures, une seule copie par jour), le site copie les
  fichiers `.csv`, `.json` et `.jsonl` de `data\` dans `sauvegardes\AAAA-MM-JJ\` (à côté de `data\`, ou dans
  `BACKUP_DIR`). Les 30 dernières copies sont gardées. Pensez à faire copier ce dossier ailleurs (autre disque,
  sauvegarde du serveur).
- **Manuelle** : bouton **Télécharger le CSV (sauvegarde)** (établissements, ouvrable dans Excel) et lien
  **Télécharger lieux.csv**.
- **Restaurer** : voir `docs/DEPLOIEMENT.md`, partie F.

## Statistiques

Bouton **Statistiques** (ou `/admin/statistiques.html`). Par défaut : les 30 derniers jours.

- Choisissez une période (**Du / Au** puis **Filtrer**) ou un raccourci (**7 derniers jours**, **30 derniers
  jours**, **Tout**).
- **Navigateurs actifs par jour / semaine / mois** : nombre de navigateurs différents ayant utilisé le site (moyenne
  sur la période). Un navigateur ≈ un collègue sur un poste, mais une personne qui change de poste ou efface ses
  cookies compte plusieurs fois : suivez les **tendances** plutôt que les valeurs exactes.
- **Nouveaux navigateurs** : vus pour la première fois ; **récurrents** : déjà venus (graphique par semaine).
- **Pages vues** : pages publiques réellement affichées (sans l'administration, les robots, les erreurs ni les
  redirections). **Suggestions reçues** : comptées par le serveur à l'enregistrement.
- **Jours consultés** : clics sur les boutons de jour (le jour affiché à l'ouverture n'est plus compté).
- **Activité par heure** : navigateurs actifs dans chaque tranche horaire.
- **Utilisation des fonctions** : recherche, filtres, « Au hasard », favoris, clics Site / Maps…
- **Établissements consultés** : clics sur « Site / menu » et « Plan Google Maps », séparés.
- **Détails techniques** : pages, navigateurs, mois, requêtes, erreurs et temps de réponse du serveur.
- **Rupture de série** : avant la 3.1.0, les visiteurs étaient comptés par **adresse IP** (courbe grise « ancien
  calcul ») et le jour affiché au chargement était compté comme un clic. Ces anciennes valeurs ne sont pas
  comparables aux nouvelles.

Aucune statistique n'est nominative : l'identifiant de navigateur n'est jamais affiché ni exporté.

## Réglages (fichier `.env` sur le serveur)

Ouvrez `C:\SITES\FoodTrucksNodejs\.env` avec le Bloc-notes, modifiez, enregistrez, puis lancez
`scripts\demarrer.bat` (ou `pm2 restart foodtruck`) pour appliquer.

| Réglage | Rôle |
|---|---|
| `ADMIN_USER`, `ADMIN_PASSWORD` | Identifiants de l'administration (changer le mot de passe = modifier ici) |
| `CONTACT_EMAIL` | Adresse du lien « Envoyez-moi un mail » et de la page de confidentialité (vide = lien masqué) |
| `SMTP_HOST`, `SMTP_PORT`, … | Serveur de mail pour être prévenu des suggestions (vide = pas de mail). Au bureau : serveur SMTP interne, port 25, `SMTP_IGNORE_TLS_ERRORS=true` |
| `MAIL_TO` | Destinataire des mails de suggestion (par défaut `CONTACT_EMAIL`) |
| `SITE_TITLE` | Titre de l'onglet du navigateur |
| `PORT` | Port d'écoute (80 en production) |
| `APP_ENV` | `test` affiche le bandeau « Environnement de test » |
| `ACCESS_LOG` | `false` pour ne plus remplir le journal technique `acces-AAAA-MM.log` |
| `TRUST_PROXY` | Seulement derrière un proxy : `loopback` ou l'adresse IP du proxy (`true` est déconseillé : un message d'avertissement s'affiche au démarrage) |
| `BACKUP_DIR`, `BACKUP_DAYS` | Dossier des sauvegardes quotidiennes et nombre de jours conservés (30) |
| `STATS_SECRET` | Secret d'anonymisation des statistiques ; vide = généré dans `data\secret-stats.json`. Ne pas le changer ensuite |
| `LIMITE_SUGGESTIONS`, `LIMITE_EVENEMENTS`, `LIMITE_FACTEUR_IP` | Nombre maximum de suggestions / d'évènements par navigateur et par heure (× facteur par adresse IP). Au-delà : message « Trop de requêtes ». 0 = sans limite |

## Fichiers de données (dépannage)

Les données sont dans `data\` :

| Fichier | Contenu |
|---|---|
| `foodtrucks.csv` | Établissements : `id,nom,type,cuisine,categorie,etiquettes,jours,lieu,horaires,prix,paiements,site,emplacement,statut,cree_le,maj_le,version` |
| `lieux.csv` | Lieux : `id,nom,description,minutes_a_pied,maps` |
| `foodtruckAValider.csv` | Suggestions en attente (mêmes colonnes, sans identifiant) |
| `usage-AAAA-MM.jsonl` | Évènements d'audience du mois (empreinte anonyme du navigateur, sans IP) |
| `acces-AAAA-MM.log` | Journal technique du mois (adresses IP) |
| `stats-jours.json` | Statistiques agrégées, conservées sans limite |
| `secret-stats.json` | Secret d'anonymisation (à ne pas diffuser) |
| `usage.log`, `acces.log` | Anciens journaux (avant 3.1.0), encore lus ; leurs lignes de plus de 13 mois sont purgées |
| `…-avant-migration-<date>.csv` | Copies faites avant la migration 3.1.0 (peuvent être supprimées une fois la migration vérifiée) |

Modification à la main (Excel, Bloc-notes) : **site arrêté** de préférence, enregistrer en **UTF-8** ; listes
séparées par `;` ; une valeur contenant une virgule entre guillemets. Une ligne ajoutée sans `id` en reçoit un au
prochain démarrage (avec copie du fichier). Préférez l'administration : elle contrôle les saisies.

## Journaux et durées de conservation

- Les journaux bruts (`usage-*.jsonl`, `acces-*.log`, anciens `usage.log` / `acces.log`) sont **purgés
  automatiquement après 13 mois**. La purge ne supprime rien tant que les statistiques agrégées de la période ne sont
  pas enregistrées et relues : les statistiques restent consultables après la purge.
- Avant la **première** purge, les anciens journaux sont copiés dans `sauvegardes\journaux-avant-premiere-purge\`.
  Ils contiennent des adresses IP : une fois les statistiques vérifiées, **supprimez ce dossier** (ou archivez-le
  selon la politique de conservation de votre service).
- Ne diffusez pas les journaux ni les sauvegardes (adresses IP).
- Erreurs de l'application et messages de sauvegarde / purge : `pm2 logs foodtruck`.

## En cas de problème

| Symptôme | Que faire |
|---|---|
| Le site ne répond plus | `pm2 list` : si `foodtruck` n'est pas « online », lancer `scripts\demarrer.bat` ; sinon `pm2 logs foodtruck` |
| « Impossible de charger la liste » | Vérifier `data\foodtrucks.csv` (fichier présent, lisible) et `pm2 logs foodtruck` |
| Pas de mail de suggestion | Vérifier `SMTP_HOST` / `MAIL_TO` dans `.env`, puis `pm2 logs foodtruck` (« Envoi du mail … impossible ») |
| « Trop de requêtes en peu de temps » | Limite de fréquence atteinte (souvent plusieurs postes derrière une même adresse) : augmenter `LIMITE_FACTEUR_IP` ou les limites dans `.env` |
| « Purge des journaux reportée » dans les logs | Les agrégats n'ont pas pu être enregistrés (disque plein, droits) : rien n'a été supprimé ; corriger puis redémarrer |
| Mot de passe oublié | Le redéfinir dans `.env` (`ADMIN_PASSWORD`) puis redémarrer |
