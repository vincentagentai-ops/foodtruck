# Guide administrateur — Food Trucks

## Se connecter

Adresse : **`/admin/`** (ou le lien « Espace administrateur » en bas de la page d'accueil).
Le navigateur demande un identifiant et un mot de passe : ceux définis dans le fichier `.env` du serveur
(`ADMIN_USER`, par défaut `admin`, et `ADMIN_PASSWORD`).

Pour vous déconnecter, fermez le navigateur.
Message « Espace administrateur désactivé » : `ADMIN_PASSWORD` est vide dans `.env` (voir « Réglages »).

## Votre rôle depuis la 3.2.0 : filet de sécurité

Les collègues **publient directement** : ajouts, corrections, présences du jour, avis, signalements. Il n'y a plus de
file de validation. Vous n'intervenez qu'en cas de problème, quand vous le souhaitez (une fois par semaine suffit en
général), depuis la section **À surveiller** en haut de `/admin/`. Si `SMTP_HOST` est réglé, vous recevez un mail à
chaque **ajout** d'établissement (rien à faire si tout va bien).

Ce qui protège le site sans vous : l'**historique** de chaque fiche (tout le monde peut restaurer une version), la
**suppression logique** (rien n'est effacé par les collègues), les **seuils automatiques** (avis masqué au 3e
signalement de navigateurs différents ; établissement « incertain » puis archivé s'il est signalé disparu et jamais
confirmé), le **délai de grâce** de 30 min de l'auteur d'un ajout, et les limites de fréquence.

## À surveiller

| Bloc | Ce que vous y faites |
|---|---|
| **Suggestions héritées de l'ancienne file** (affiché seulement s'il en reste) | Propositions envoyées avant la 3.2.0 : **Compléter et publier** (chargée dans le formulaire, vérifiez puis **Publier la suggestion**) ou **Écarter**. À traiter une dernière fois |
| **Signalements ouverts** | « N'est plus présent », « Info erronée », « Contenu inapproprié » (avec l'avis visé), « Doublon ». **Clore** quand c'est réglé ; **Masquer l'avis** sans attendre le seuil ; **Bloquer** le navigateur à l'origine d'abus. Les signalements devenus sans objet disparaissent seuls (présence confirmée depuis, fiche corrigée depuis, fermeture passée) |
| **Avis masqués** | Masqués automatiquement (3 signalements) ou par vous. **Rétablir** (les signalements sont clos) ; **Supprimer définitivement** (contenu illicite, demande d'effacement : irréversible) ; **Bloquer** l'auteur |
| **Ajouts et modifications sensibles** (30 jours) | Ajouts, changements de nom, de lieu, de lien Maps, et statuts changés automatiquement. **Restaurer la version N** annule un vandalisme ; **Archiver** retire un ajout fantaisiste |
| **Établissements incertains ou archivés** | **Remettre actif** (les signalements « n'est plus présent » sont clos, sinon le seuil le ré-archiverait) ou **Modifier** |
| **Fusionner deux fiches** | Doublon, ou établissement présent à plusieurs endroits selon le jour (ex. L'épicurieux) : voir ci-dessous |
| **Navigateurs bloqués** | Liste des blocages en cours ; **Débloquer** |
| **Seuils** | Réglages de la modération automatique (voir ci-dessous) |

La colonne **Navigateur** affiche les 8 premiers caractères d'un **jeton anonyme** : il permet de voir que plusieurs
contributions viennent du même navigateur et de le bloquer, pas de savoir qui c'est (et il ne correspond à rien dans
les statistiques). Le **nom déclaré** n'est pas vérifié.

**Bloquer** suspend les contributions de ce navigateur pendant la durée réglée (7 jours par défaut) : il peut toujours
consulter le site. Ses contributions passées restent : restaurez ou masquez-les si besoin.

### Fusionner deux fiches

Choisissez la **fiche conservée** et la **fiche absorbée**, puis **Fusionner**. La fiche conservée reçoit les jours de
l'autre — avec le lieu (ou le lien Maps) de l'autre pour ces jours, s'il est différent —, l'union des étiquettes et
paiements, et les informations qui lui manquaient. Les **avis**, **présences**, **signalements** et l'**historique** de
la fiche absorbée sont rattachés à la fiche conservée (si un même navigateur avait un avis sur les deux, seul le plus
récent compte). L'ancienne fiche disparaît de la liste ; son adresse et les favoris des collègues suivent la fiche
conservée. Vérifiez ensuite le résultat avec **Modifier** (champ « Lieu selon le jour »).

### Seuils (enregistrés dans `data\config-moderation.json`)

| Seuil | Défaut | Effet |
|---|---|---|
| Avis masqué après N signalements « inapproprié » | 3 | Navigateurs distincts ; plusieurs signalements du même navigateur comptent pour un |
| « N'est plus présent » : navigateurs distincts | 2 | Signalements postérieurs à la dernière confirmation « Il est là » |
| Jours sans confirmation avant « incertain » | 14 | Comptés depuis la dernière confirmation (ou, s'il n'y en a jamais eu, depuis le premier signalement) ; grisé, en fin de liste |
| Jours sans confirmation avant archivage | 30 | Masqué du public, restaurable par vous |
| Délai de grâce de l'auteur d'un ajout | 30 min | Seul l'auteur peut modifier ou retirer son ajout pendant ce délai |
| Durée d'un blocage | 7 jours | Durée appliquée par le bouton **Bloquer** |

Les seuils sont réévalués à chaque signalement ou présence et toutes les heures. Une fiche passée « incertain »
automatiquement redevient active si un collègue confirme sa présence.

## Ajouter ou modifier un établissement

Les collègues le font eux-mêmes depuis la page d'accueil ; l'administration reste utile pour le **statut**, les
corrections en masse et le champ « Lieu selon le jour ». Vos modifications sont enregistrées dans l'historique de la
fiche (« par l'administrateur ») et ne sont pas soumises au délai de grâce.

Formulaire **Ajouter un établissement** : remplissez puis **Ajouter et publier**. Dans la liste **Établissements**,
le bouton **Modifier** charge une fiche dans le même formulaire (**Enregistrer les modifications**, ou **Annuler**).

| Champ | Règle |
|---|---|
| Nom, Cuisine (libellé libre) | Obligatoires. Le libellé libre (« Bowls végétariens ») est affiché tel quel. |
| Type | Foodtruck ou Restaurant. Un restaurant ouvert toute la semaine a simplement les 5 jours cochés. |
| Catégorie | Liste fermée qui sert au filtre « Cuisine ». Laissée vide, elle est déduite du libellé (« Autre » sinon). |
| Lieu | Choisi dans la liste des lieux (voir ci-dessous). Sans lieu, la fiche est classée dans « Lieu à préciser ». |
| Lien Google Maps | Obligatoire seulement s'il n'y a pas de lieu. |
| Lieu selon le jour | Pour un établissement qui change de place : `Jeudi=parking-nord;Vendredi=https://maps.app.goo.gl/…` (identifiant de lieu ou lien Maps). Vide = lieu habituel tous les jours. Les collègues le règlent avec des listes dans leur formulaire. |
| Horaires | Texte libre court (« 11h30-14h »). |
| Prix | « 12 », « 10-15 » ou « 10 à 15 € ». |
| Jours, Étiquettes, Paiements | Cases à cocher. |
| Statut | **Actif** (affiché), **Incertain** (affiché en fin de liste avec « Présence à confirmer »), **Archivé** (masqué du public, restaurable en repassant à Actif). |

- **Raccourci** : si vous avez reçu un mail du modèle de la page d'accueil (« Nom : …, Type de cuisine : …,
  Lieu : …, Paiements acceptés : … »), ouvrez **Pré-remplir à partir d'un texte**, collez le texte et cliquez sur
  **Pré-remplir le formulaire**.
- **Supprimer** efface définitivement la fiche **avec ses avis, présences, signalements et son historique**
  (demande d'effacement, contenu illicite). Pour un retrait temporaire, préférez le statut **Archivé** ; pour un
  doublon, la **fusion**.
- Chaque fiche a un **identifiant** stable et une **version** : si quelqu'un l'a modifiée entre l'affichage et
  l'enregistrement, l'enregistrement est refusé (« modifié entre-temps ») ; rechargez la page.
- Un établissement présent à des endroits différents selon le jour (L'épicurieux) : fusionnez les deux fiches
  (« À surveiller » → **Fusionner deux fiches**).

La liste **Établissements** se filtre par texte (nom, cuisine, jour, lieu…) et par statut ; les fiches archivées
apparaissent grisées.

## Lieux

Section **Lieux** : un lieu = un nom (« Parking Nord »), une description (« devant le bâtiment B »), un temps de marche
en minutes et, si possible, un lien Google Maps. Les établissements du même lieu sont regroupés sur la page
d'accueil, du plus proche au plus loin.

- **Ajouter** : remplissez la dernière ligne du tableau puis **Ajouter**. L'identifiant (« parking-nord ») est
  créé à partir du nom et ne change plus, même si le nom est modifié ensuite.
- **Modifier** : changez les champs de la ligne puis **Enregistrer**.
- **Supprimer** n'est possible que si aucun établissement n'utilise le lieu (comme lieu habituel ou pour un jour).

## Plan des emplacements

Section **Plan des emplacements** (sous **Lieux**) : une image du quartier affichée sur la page d'accueil, dépliable,
avec les **lieux du jour numérotés** du plus proche au plus loin (même numéro que le titre du lieu dans la liste). Elle
remplace Google Maps pour l'essentiel, **sans Internet** ; les liens Maps restent en complément.

1. **Préparer l'image** : capture d'écran d'un plan (outil Capture d'écran de Windows : Win+Maj+S, puis enregistrer),
   photo ou scan d'un plan dessiné… Formats **PNG, JPEG ou WebP**, **3 Mo au plus** (une capture d'écran fait en
   général quelques centaines de Ko). Cadrez large : tous les lieux doivent être dessus. Pas de SVG ni de PDF (refusés).
2. **Image du plan** → choisir le fichier → **Enregistrer cette image**. Elle est enregistrée dans
   `data\plan-image.png` (ou `.jpg`, `.webp`) et sauvegardée chaque jour avec les données. Une nouvelle image remplace
   l'ancienne ; **les positions sont gardées** : vérifiez-les si le cadrage a changé.
3. **Placer les lieux** : choisissez un lieu dans **Lieu à placer**, puis **cliquez sur le plan** à son emplacement.
   Le lieu suivant non placé est proposé automatiquement. Les lieux placés sont précédés de ✓. Pour corriger, choisissez
   le lieu et cliquez ailleurs. Au clavier : donnez le focus au plan (Tab), flèches pour déplacer le repère (Maj +
   flèche : par pas de 5 %), **Entrée** pour enregistrer, **Échap** pour annuler.
4. **retirer du plan** (liste à droite) enlève un lieu ; **Retirer le plan** enlève l'image (les positions sont
   gardées pour une prochaine image). Un lieu supprimé est aussi retiré du plan.

Un lieu du jour pas encore placé figure dans la légende avec « pas encore placé sur le plan ». Les établissements
sans lieu (« Lieu à préciser ») n'apparaissent pas sur le plan.

## Après la mise à jour 3.5.0

1. Au premier démarrage, `foodtrucks.csv` reçoit deux colonnes en fin : **photo** et **fidelite** (copie
   `foodtrucks-avant-migration-<date>.csv` gardée à côté). Les photos validées sur la planche sont attribuées d'après
   le nom de l'établissement : vérifiez sur la page d'accueil que chaque carte a la bonne photo (Libanais et Les
   canailles n'en ont pas encore).
2. Les collègues peuvent désormais **changer la photo** (« Modifier les infos ») : les fichiers envoyés sont dans
   `data\photo-<empreinte>.jpg`, sauvegardés chaque jour. Un changement de photo apparaît dans **À surveiller**, et
   l'historique de la fiche permet de revenir à l'ancienne.
3. Cochez **Propose une carte de fidélité** pour les établissements concernés (formulaire de la fiche, ici ou sur la
   page d'accueil).

## Après la mise à jour 3.4.0

1. Déposez le **plan des emplacements** et placez les lieux (ci-dessus) ; sans plan, la page d'accueil ne montre
   simplement pas la rubrique.
2. Ouvrez la page d'accueil, dépliez le plan et vérifiez la numérotation sur un jour chargé.
3. Annoncez aux collègues les nouveautés : vue **Semaine**, **Mes préférences**, **Déjà essayé / À tester**,
   **Mon carnet**, **Copier pour Teams** et les liens partageables (voir le guide utilisateur).
4. Dans **Statistiques**, les nouvelles fonctionnalités apparaissent dans « Fonctionnalités utilisées » au fil des
   visites (trait `v3.4.0` sur la courbe).

## Après la mise à jour 3.3.0

1. Ouvrez **Statistiques** : la première ouverture (ou la maintenance au démarrage) recalcule les statistiques depuis
   les journaux existants ; cela prend au plus quelques secondes.
2. Vérifiez que la courbe **Fréquentation** (bouton **Tout**) montre les traits `v3.1.0`, `v3.2.0` et `v3.3.0`.
3. Ouvrez une fois l'administration **depuis chacun des navigateurs** que vous utilisez pour consulter le site : ils
   seront exclus des statistiques à partir de ce jour.

## Après la mise à jour 3.2.0

1. **À surveiller** : traitez une dernière fois les **suggestions héritées** (publier ou écarter).
2. Fusionnez les doublons connus (les deux fiches L'épicurieux, par exemple).
3. Vérifiez les **seuils** (les valeurs par défaut conviennent pour commencer).
4. Annoncez le fonctionnement collaboratif aux collègues (texte proposé dans le compte rendu de mise à jour) et donnez
   quelques premiers avis vous-même pour lancer le mouvement.

## Saisie initiale après la mise à jour 3.1.0 (rappel)

La migration a gardé toutes les données, attribué une catégorie à partir du libellé et laissé les lieux vides.
Comptez environ une heure pour :

1. Créer les **lieux** (section Lieux), avec le temps de marche.
2. Pour chaque établissement : **Modifier** → choisir le lieu, le **type** (les établissements ouverts toute la
   semaine sont souvent des restaurants), vérifier la catégorie, cocher les **paiements**, les étiquettes, saisir les
   horaires.
3. Vérifier la page d'accueil (regroupement par lieu, filtres).

## Sauvegarder et restaurer

- **Automatique** : chaque jour (au démarrage puis toutes les heures, une seule copie par jour), le site copie les
  fichiers `.csv`, `.json`, `.jsonl` et l'image du plan de `data\` dans `sauvegardes\AAAA-MM-JJ\` (à côté de `data\`, ou dans
  `BACKUP_DIR`). Les 30 dernières copies sont gardées. Pensez à faire copier ce dossier ailleurs (autre disque,
  sauvegarde du serveur).
- **Manuelle** : bouton **Télécharger le CSV (sauvegarde)** (établissements, ouvrable dans Excel), liens
  **Télécharger lieux.csv** et **Télécharger avis.csv** (fin de « À surveiller »). Dans ces exports, un texte qui
  commence par `=`, `+`, `-`, `@` est précédé d'une apostrophe pour qu'Excel ne l'exécute pas comme une formule.
- **Restaurer** : voir `docs/DEPLOIEMENT.md`, partie F.

## Statistiques

Bouton **Statistiques** (ou `/admin/statistiques.html`). La page se lit de haut en bas : l'essentiel tient dans les
cinq tuiles du haut, le détail vient ensuite.

**Ce que comptent les chiffres.** Un « navigateur » est un navigateur web sur un poste (cookie anonyme), pas une
personne : un collègue qui utilise deux postes compte deux fois, deux collègues sur le même poste comptent une fois,
un cookie effacé ou une navigation privée crée un « nouveau » navigateur. Les valeurs sont donc des **approximations
du nombre de collègues (≈)** : fiez-vous surtout aux **tendances** et aux comparaisons d'une période à l'autre.
L'administration n'est pas comptée, ni vos propres consultations du site public **à partir du jour où vous vous êtes
connecté à l'administration** depuis ce navigateur ; les robots et les erreurs non plus. Aucun chiffre n'est
nominatif et la page ne doit pas servir à surveiller des collègues.

### Période

**7 jours**, **30 jours** (par défaut), **Trimestre** (90 jours), **Personnalisée** (dates Du / Au puis **Afficher**)
ou **Tout**. Les périodes finissent aujourd'hui ; la journée en cours est **provisoire** (elle est complétée jusqu'à
minuit). Sauf pour « Tout », chaque tuile est comparée à la **période précédente de même durée** (▲ hausse en vert,
▼ baisse en rouge, valeur précédente entre parenthèses). Pas de comparaison si la période précédente date d'avant la
3.1.0 (anciens chiffres par adresse IP, non comparables).

### Les cinq tuiles

| Tuile | Ce que c'est | Limites |
|---|---|---|
| **Navigateurs actifs par jour** | Moyenne, sur les jours où il y a eu au moins une visite, du nombre de navigateurs différents venus ce jour-là | Les jours sans visite (week-ends, fériés) ne baissent pas la moyenne |
| **Navigateurs actifs par semaine** | Moyenne du nombre de navigateurs différents venus sur les 7 derniers jours (fenêtre glissante, recalculée chaque jour) | Lisse les variations : réagit avec quelques jours de retard |
| **Nouveaux navigateurs** | Navigateurs vus pour la toute première fois pendant la période | Comprend les cookies effacés, les nouveaux postes, et les navigateurs revenus après plus de 13 mois |
| **Retour à S+1** | Parmi les navigateurs venus une semaine (lundi–dimanche), part revenue la semaine suivante, pour les semaines de la période dont la suivante est terminée (« 33 navigateurs sur 40 ») | « – » si aucune semaine n'est encore mesurable (période de 7 jours en cours de semaine, par exemple). Écart affiché en points |
| **Contributions** | Ajouts, modifications, restaurations, avis (publiés ou modifiés), présences déclarées et signalements, comptés par le serveur ; « par N contributeurs distincts » | Les contributeurs sont comptés sur les contributions elles-mêmes (navigateurs, pas personnes) ; les présences de plus de 13 mois sont purgées, leurs auteurs ne sont plus comptés |

### Graphiques et tableaux

- **Fréquentation** : barres = navigateurs actifs chaque jour ; courbe = navigateurs actifs sur 7 jours glissants.
  Traits orange verticaux : **mise en service d'une version** (`v3.2.0`, `v3.3.0`…), pour voir l'effet d'une nouveauté
  sur la fréquentation. Trait gris « Rupture de série » et courbe grise pointillée : avant la 3.1.0, comptage par
  adresse IP (non comparable).
- **Nouveaux et récurrents par semaine** : nouveaux (première venue cette semaine-là) et récurrents (déjà venus avant).
  La semaine en cours est marquée « (en cours) ».
- **Jours et heures de visite** (carte de chaleur) : pour chaque jour de la semaine et chaque heure, nombre de
  navigateurs actifs, additionné sur les jours de la période (un collègue venu trois lundis à midi compte 3 dans la
  case « Lun 12h »). Plus la case est foncée, plus il y a de monde. Le week-end n'apparaît que s'il y a eu des visites.
- **De la visite au déplacement** (entonnoir) : une **visite** est une suite de pages et de clics d'un navigateur sans
  pause de plus de 30 minutes (coupée à minuit). On voit la part des visites qui ouvrent une fiche, combien de ces
  fiches ne sont **pas suivies d'un clic** vers Google Maps ou le site (la fiche a suffi, ou n'a pas convaincu), et les
  clics faits directement depuis la liste.
- **Fonctionnalités utilisées** : part des visites qui utilisent au moins une fois la fiche, Maps, le site, le
  changement de jour, la recherche, les filtres, le classement, « Au hasard », les favoris, « Nouveaux / Quoi de
  neuf », l'historique, les formulaires et, depuis la 3.4.0, la vue semaine, les marques « Déjà essayé / À tester »,
  « Copier pour Teams », l'arrivée par un lien partagé, les préférences, le carnet et le plan des emplacements. Le
  bandeau « Vos favoris présents aujourd'hui » n'est pas mesuré (il s'affiche sans clic). Seul l'**usage** est compté :
  le contenu des favoris, préférences, marques et carnets reste dans les navigateurs et n'est jamais envoyé au serveur.
- **Établissements** : fiches ouvertes, clics vers le site et vers Maps, confirmations « Il est là » sur la période ;
  nombre d'avis et note **actuels** (note affichée à partir de 3 avis, comme sur le site).
- **Contributions par semaine** : barres par type et courbe des contributeurs distincts. Au-dessus : nombre de
  **nouveaux contributeurs** de la période et part d'entre eux qui ont **contribué à nouveau** (un autre jour) dans
  les 14 jours ; ceux dont les 14 jours ne sont pas écoulés sont « encore dans leur délai ». On ne peut pas savoir si
  un contributeur est revenu simplement **consulter** le site : par principe, contributions et visites ne sont pas
  reliées.
- **Fidélité par cohorte** : les navigateurs arrivés une semaine donnée et la part encore active 1, 2, 3… semaines
  plus tard (cases vides : semaines pas encore terminées).
- **Recherches sans résultat** : textes cherchés (30 premiers caractères) qui n'ont rien donné **parmi les
  établissements du jour affiché, avec les filtres en cours** : un texte fréquent peut révéler un établissement ou une
  cuisine qui manque — ou simplement un autre jour.
- **Exporter** : trois fichiers CSV pour Excel (par jour, par semaine, par établissement) sur la période affichée,
  sans aucun identifiant.
- **Détails techniques** (à déplier) : requêtes au serveur, erreurs, temps de réponse moyen, navigateurs (Edge,
  Chrome…), pages vues, jours consultés (clics sur un bouton de jour), tableau par mois (avec retour à M+1), liste de
  tous les évènements, dernier jour enregistré dans les agrégats.
- **Limites de mesure** : rappel permanent, en bas de page, de ce qui précède.

### Où trouver la réponse à…

| Question | Où regarder |
|---|---|
| Combien de collègues utilisent le site ? | Tuiles **Navigateurs actifs par jour / par semaine** ; mois dans **Détails techniques → Par mois** |
| Les gens reviennent-ils ? | Tuile **Retour à S+1** ; **Nouveaux et récurrents par semaine** ; **Fidélité par cohorte** ; retour M+1 par mois |
| Quels jours et à quelles heures ? | **Jours et heures de visite** ; jours choisis dans la liste : **Détails techniques → Jours consultés** |
| Quelles fonctionnalités servent ? | **Fonctionnalités utilisées** (% des visites) |
| Quels établissements intéressent ? | Tableau **Établissements** (fiches, clics, présences, avis) ; export « Par établissement » |
| Les fiches sont-elles consultées sans aller sur Maps ? | **De la visite au déplacement** : ligne « dont … sans clic vers Maps ni le site » |
| Le collaboratif fonctionne-t-il ? | Tuile **Contributions** (et contributeurs distincts) ; **Contributions par semaine** |
| Les contributeurs reviennent-ils (après un avis, par exemple) ? | Texte au-dessus de **Contributions par semaine** (retour dans les 14 jours) |
| Une nouveauté a-t-elle eu un effet ? | Traits de version sur **Fréquentation**, puis période personnalisée avant / après et comparaison des tuiles |
| Manque-t-il des établissements ? | **Recherches sans résultat** |

### Ce qui est conservé

Les statistiques sont calculées **une fois par jour terminé** et enregistrées dans `data\stats-jours.json` (sans
aucun identifiant, conservé sans limite) : les périodes anciennes restent consultables après la purge des journaux
bruts (13 mois). Les journées d'avant la 3.3.0 sont recalculées automatiquement au premier démarrage tant que leurs
journaux existent ; pour les périodes plus anciennes, visites, fonctionnalités, entonnoir et cohortes sont à zéro
(non mesurés).

## Réglages (fichier `.env` sur le serveur)

Ouvrez `C:\SITES\FoodTrucksNodejs\.env` avec le Bloc-notes, modifiez, enregistrez, puis lancez
`scripts\demarrer.bat` (ou `pm2 restart foodtruck`) pour appliquer.

| Réglage | Rôle |
|---|---|
| `ADMIN_USER`, `ADMIN_PASSWORD` | Identifiants de l'administration (changer le mot de passe = modifier ici) |
| `CONTACT_EMAIL` | Adresse du lien « Écrire à l'administrateur » et de la page de confidentialité (vide = lien masqué) |
| `SMTP_HOST`, `SMTP_PORT`, … | Serveur de mail pour être prévenu des ajouts d'établissements (vide = pas de mail). Au bureau : serveur SMTP interne, port 25, `SMTP_IGNORE_TLS_ERRORS=true` |
| `MAIL_TO` | Destinataire de ces mails (par défaut `CONTACT_EMAIL`) |
| `SITE_TITLE` | Titre de l'onglet du navigateur |
| `PORT` | Port d'écoute (80 en production) |
| `APP_ENV` | `test` affiche le bandeau « Environnement de test » |
| `ACCESS_LOG` | `false` pour ne plus remplir le journal technique `acces-AAAA-MM.log` |
| `TRUST_PROXY` | Seulement derrière un proxy : `loopback` ou l'adresse IP du proxy (`true` est déconseillé : un message d'avertissement s'affiche au démarrage) |
| `BACKUP_DIR`, `BACKUP_DAYS` | Dossier des sauvegardes quotidiennes et nombre de jours conservés (30) |
| `STATS_SECRET` | Secret d'anonymisation des statistiques ; vide = généré dans `data\secret-stats.json`. Ne pas le changer ensuite |
| `LIMITE_CONTRIBUTIONS`, `LIMITE_EVENEMENTS`, `LIMITE_FACTEUR_IP` | Nombre maximum de contributions (60) / d'évènements (600) par navigateur et par heure (× facteur par adresse IP). Au-delà : message « Trop de requêtes ». 0 = sans limite |
| `HOTES_AUTORISES` | Noms sous lesquels le site est appelé, si les ajouts et avis sont refusés avec « Requête refusée : elle ne provient pas d'une page de ce site » (proxy qui change le nom d'hôte). Ex. `foodtrucks,foodtrucks.entreprise.local` |

## Fichiers de données (dépannage)

Les données sont dans `data\` :

| Fichier | Contenu |
|---|---|
| `foodtrucks.csv` | Établissements : `id,nom,type,cuisine,categorie,etiquettes,jours,lieu,horaires,prix,paiements,site,emplacement,statut,cree_le,maj_le,version,lieux_jours` |
| `lieux.csv` | Lieux : `id,nom,description,minutes_a_pied,maps` |
| `historique.jsonl` | Une ligne par ajout / modification / restauration / fusion / changement de statut, avec la fiche avant et après |
| `avis.jsonl` | Avis (une ligne par publication, modification, suppression, masquage) |
| `presences.jsonl` | Confirmations « Il est là » / « Pas là aujourd'hui » (purgées après 13 mois ; totaux dans `stats-presences.json`) |
| `signalements.jsonl` | Signalements et leur clôture |
| `config-moderation.json` | Seuils et navigateurs bloqués |
| `plan.json`, `plan-image.png` (ou `.jpg`, `.webp`) | Plan des emplacements : description de l'image et position de chaque lieu (en % de la largeur et de la hauteur) ; l'image elle-même |
| `foodtruckAValider.csv` | Suggestions héritées (ancienne file), jusqu'à leur traitement |
| `usage-AAAA-MM.jsonl` | Évènements d'audience du mois (empreinte anonyme du navigateur, sans IP) |
| `acces-AAAA-MM.log` | Journal technique du mois (adresses IP) |
| `stats-jours.json` | Statistiques agrégées (sans identifiant) et dates des versions, conservées sans limite |
| `stats-etat.json` | État interne du calcul des statistiques (empreintes anonymes et dates de première / dernière visite) ; s'il est supprimé, tout est recalculé depuis les journaux |
| `secret-stats.json` | Secret d'anonymisation (à ne pas diffuser) |
| `usage.log`, `acces.log` | Anciens journaux (avant 3.1.0), encore lus ; leurs lignes de plus de 13 mois sont purgées |
| `…-avant-migration-<date>.csv` | Copies faites avant une migration (3.1.0, 3.2.0) ; peuvent être supprimées une fois la migration vérifiée |

Les fichiers `.jsonl` ne s'éditent qu'en dernier recours (Bloc-notes, une ligne JSON par contribution) : le site les
relit automatiquement s'ils changent. Préférez « À surveiller ».

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
- `stats-etat.json` (empreintes anonymes et dates de visite, nécessaires au calcul quotidien) : chaque empreinte en
  est retirée 13 mois après sa dernière visite. Jamais affiché ni exporté.
- Les **confirmations de présence** (`presences.jsonl`) sont purgées de la même façon après 13 mois ; les totaux par
  jour et par établissement sont gardés dans `stats-presences.json`.
- Les **contributions** (fiches, historique, avis, signalements) sont conservées tant qu'elles sont publiées. Demande
  d'effacement d'un collègue : **Supprimer définitivement** l'avis concerné (À surveiller, ou via la fiche) ; pour une
  fiche entière, **Supprimer** dans la liste des établissements.
- Ne diffusez pas les journaux ni les sauvegardes (adresses IP, jetons anonymes).
- Erreurs de l'application et messages de sauvegarde / purge : `pm2 logs foodtruck`.

## En cas de problème

| Symptôme | Que faire |
|---|---|
| Le site ne répond plus | `pm2 list` : si `foodtruck` n'est pas « online », lancer `scripts\demarrer.bat` ; sinon `pm2 logs foodtruck` |
| « Impossible de charger la liste » | Vérifier `data\foodtrucks.csv` (fichier présent, lisible) et `pm2 logs foodtruck` |
| Pas de mail lors d'un ajout | Vérifier `SMTP_HOST` / `MAIL_TO` dans `.env`, puis `pm2 logs foodtruck` (« Envoi du mail … impossible ») |
| « Trop de requêtes en peu de temps » | Limite de fréquence atteinte (souvent plusieurs postes derrière une même adresse) : augmenter `LIMITE_FACTEUR_IP` ou les limites dans `.env` |
| « Purge des journaux reportée » dans les logs | Les agrégats n'ont pas pu être enregistrés (disque plein, droits) : rien n'a été supprimé ; corriger puis redémarrer |
| Mot de passe oublié | Le redéfinir dans `.env` (`ADMIN_PASSWORD`) puis redémarrer |
| Les collègues ne peuvent ni ajouter ni donner d'avis : « Requête refusée : elle ne provient pas d'une page de ce site » | Le site est appelé sous un nom que le serveur ne reconnaît pas (proxy) : renseigner `HOTES_AUTORISES` dans `.env` puis redémarrer |
| « Cookie du site absent » | Le navigateur du collègue bloque les cookies : la consultation fonctionne, pas les contributions |
| Vandalisme | « À surveiller » → **Restaurer la version N**, puis **Bloquer** le navigateur |
| Un établissement a disparu de la liste | « Établissements incertains ou archivés » : archivé par le seuil (signalé disparu) ou retiré par son auteur → **Remettre actif** |
