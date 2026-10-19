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
  fichiers `.csv`, `.json` et `.jsonl` de `data\` dans `sauvegardes\AAAA-MM-JJ\` (à côté de `data\`, ou dans
  `BACKUP_DIR`). Les 30 dernières copies sont gardées. Pensez à faire copier ce dossier ailleurs (autre disque,
  sauvegarde du serveur).
- **Manuelle** : bouton **Télécharger le CSV (sauvegarde)** (établissements, ouvrable dans Excel), liens
  **Télécharger lieux.csv** et **Télécharger avis.csv** (fin de « À surveiller »). Dans ces exports, un texte qui
  commence par `=`, `+`, `-`, `@` est précédé d'une apostrophe pour qu'Excel ne l'exécute pas comme une formule.
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
  redirections). **Établissements ajoutés** : suggestions (avant la 3.2.0) puis ajouts directs, comptés par le serveur.
- **Contributions** (dans « Utilisation des fonctions ») : ajouts, modifications, restaurations, avis, présences,
  signalements, comptés par le serveur **sans identifiant de navigateur** (ils n'entrent pas dans les navigateurs
  actifs et ne peuvent pas être reliés aux pages vues).
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
| `foodtruckAValider.csv` | Suggestions héritées (ancienne file), jusqu'à leur traitement |
| `usage-AAAA-MM.jsonl` | Évènements d'audience du mois (empreinte anonyme du navigateur, sans IP) |
| `acces-AAAA-MM.log` | Journal technique du mois (adresses IP) |
| `stats-jours.json` | Statistiques agrégées, conservées sans limite |
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
