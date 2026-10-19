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

1. Vérifiez chaque champ, en particulier le lien Google Maps et les jours. Corrigez directement dans le tableau
   (orthographe, majuscules…).
2. **Valider** : le foodtruck est publié immédiatement, avec vos corrections.
3. **Rejeter** : la suggestion est supprimée (après confirmation).

Si un message signale une erreur (jour non reconnu, lien invalide…), corrigez le champ puis cliquez de nouveau.
« Cet élément a été modifié entre-temps » : un autre administrateur a agi en même temps, rechargez la page.

## Ajouter un foodtruck

Section **Ajouter un foodtruck** : remplissez le formulaire puis **Ajouter et publier**.

- **Jours** : écrivez-les séparés par des virgules, points-virgules ou « et » (« lundi, jeudi », « Mardi et
  Jeudi ») ; seuls le lundi à vendredi sont acceptés.
- **Prix** : « 12 », « 10-15 » ou « 10 à 15 € ».
- **Raccourci** : si vous avez reçu un mail du modèle de la page d'accueil (« Nom : …, Type de cuisine : …, … »),
  ouvrez **Pré-remplir à partir d'un texte**, collez le texte du mail et cliquez sur **Pré-remplir le formulaire**.
- Un foodtruck présent à des endroits différents selon le jour s'ajoute en plusieurs lignes (une par emplacement).

## Modifier ou retirer un foodtruck publié

Section **Foodtrucks publiés** : la zone **Rechercher** filtre la liste (nom, cuisine, jour…).

- **Modifier** : changez les champs de la ligne puis cliquez sur **Enregistrer** sur cette ligne.
- **Retirer** : **Supprimer** (après confirmation). Pour une absence temporaire, préférez modifier les jours.

## Sauvegarder

- Bouton **Télécharger le CSV (sauvegarde)** : la liste publiée, ouvrable dans Excel.
- Sauvegarde complète : copier le dossier `data\` du serveur (listes, suggestions, journaux).

## Statistiques

Bouton **Statistiques** (ou `/admin/statistiques.html`).

- Choisissez une période (**Du / Au** puis **Filtrer**) ou un raccourci (**7 derniers jours**, **30 derniers jours**,
  **Tout**).
- **Visiteurs uniques** : nombre d'adresses IP différentes ; **Pages vues** : pages ouvertes (compté seulement
  depuis la v3) ; **Suggestions envoyées** ; **Requêtes au serveur**.
- **Fréquentation par jour** : visiteurs et pages vues jour par jour.
- **Jours consultés** : quels jours les visiteurs regardent (clics sur les boutons de jour et affichage initial).
- **Activité par heure** : à quelle heure le site est utilisé.
- **Actions** : clics sur « Envoyez-moi un mail », formulaires de suggestion ouverts / envoyés / refusés,
  validations, rejets, ajouts, modifications.
- **Foodtrucks consultés** : clics sur le site ou l'emplacement de chaque foodtruck (depuis la v3).
- **Statistiques détaillées** (à déplier) : tris par colonne, pages, navigateurs, jours de la semaine.

## Réglages (fichier `.env` sur le serveur)

Ouvrez `C:\SITES\FoodTrucksNodejs\.env` avec le Bloc-notes, modifiez, enregistrez, puis lancez
`scripts\demarrer.bat` (ou `pm2 restart foodtruck`) pour appliquer.

| Réglage | Rôle |
|---|---|
| `ADMIN_USER`, `ADMIN_PASSWORD` | Identifiants de l'administration (changer le mot de passe = modifier ici) |
| `CONTACT_EMAIL` | Adresse du lien « Envoyez-moi un mail » (vide = lien masqué) |
| `SMTP_HOST`, `SMTP_PORT`, … | Serveur de mail pour être prévenu des suggestions (vide = pas de mail). Au bureau : serveur SMTP interne, port 25, `SMTP_IGNORE_TLS_ERRORS=true` |
| `MAIL_TO` | Destinataire des mails de suggestion (par défaut `CONTACT_EMAIL`) |
| `SITE_TITLE` | Titre de l'onglet du navigateur |
| `PORT` | Port d'écoute (80 en production) |
| `APP_ENV` | `test` affiche le bandeau « Environnement de test » |
| `ACCESS_LOG` | `false` pour ne plus remplir `acces.log` |

## Modifier les fichiers à la main (dépannage)

Les données sont dans `data\` : `foodtrucks.csv` (publiés), `foodtruckAValider.csv` (suggestions).
Format : une ligne par foodtruck, `Nom,Cuisine,Jours,Emplacement,Prix,Site`, jours séparés par `;`.
Une valeur contenant une virgule doit être entre guillemets (`"https://…,…"`). Enregistrer en **UTF-8**.
Préférez l'administration : elle contrôle les saisies et gère les guillemets automatiquement.

## Journaux

- `data\usage.log` et `data\acces.log` alimentent les statistiques. Ils contiennent les adresses IP des visiteurs :
  ne les diffusez pas.
- S'ils deviennent trop gros, arrêtez le site, renommez-les (ex. `acces-2025.log`) et redémarrez : de nouveaux
  fichiers sont créés (les statistiques repartent alors de zéro).
- Erreurs de l'application : `pm2 logs foodtruck`.

## En cas de problème

| Symptôme | Que faire |
|---|---|
| Le site ne répond plus | `pm2 list` : si `foodtruck` n'est pas « online », lancer `scripts\demarrer.bat` ; sinon `pm2 logs foodtruck` |
| « Impossible de charger la liste des foodtrucks » | Vérifier `data\foodtrucks.csv` (fichier présent, lisible) et `pm2 logs foodtruck` |
| Pas de mail de suggestion | Vérifier `SMTP_HOST` / `MAIL_TO` dans `.env`, puis `pm2 logs foodtruck` (« Envoi du mail … impossible ») |
| Mot de passe oublié | Le redéfinir dans `.env` (`ADMIN_PASSWORD`) puis redémarrer |
