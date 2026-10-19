# Food Trucks

Site interne et **collaboratif** qui liste les foodtrucks et restaurants autour du travail (Basso Cambo), jour par
jour ou sur la semaine : recherche, filtres, regroupement par lieu et plan local des emplacements, favoris,
préférences, « déjà essayé / à tester », carnet personnel (dans le navigateur), liens partageables et « Copier pour
Teams », thème sombre ; les collègues ajoutent, corrigent, confirment la présence
du jour, donnent leur avis et signalent, sans validation préalable (historique et restauration, seuils automatiques,
page « À surveiller » pour l'administrateur) ; statistiques d'usage anonymes.
Node.js + Express, catalogue en CSV et contributions en JSONL, sans base de données ni dépendance Internet.

## Démarrage rapide

```bash
npm install
cp .env.example .env      # renseigner au moins ADMIN_PASSWORD
npm start                 # http://localhost:3000  — administration : /admin/
npm test                  # tests automatisés
```

Au premier lancement, `data/` est créé vide ; pour partir des données d'exemple :
`cp data-exemple/*.csv data/`. Un ancien `foodtrucks.csv` (3.0.0) est migré automatiquement au démarrage
(copie de sauvegarde à côté), de même qu'un fichier 3.1.0 (ajout de la colonne `lieux_jours`).

Attention : `npm run dev` / `npm start` utilisent le `DATA_DIR` du `.env`. Pour des essais, préférez un dossier
temporaire : `DATA_DIR=/tmp/essai-ft BACKUP_DIR=/tmp/essai-ft-sauvegardes npm start`.

## Documentation

| Document | Pour qui |
|---|---|
| [docs/GUIDE_UTILISATEUR.md](docs/GUIDE_UTILISATEUR.md) | Les visiteurs du site |
| [docs/GUIDE_ADMINISTRATEUR.md](docs/GUIDE_ADMINISTRATEUR.md) | Les administrateurs (À surveiller, établissements, fusion, lieux, statistiques, sauvegardes, réglages) |
| [docs/DEPLOIEMENT.md](docs/DEPLOIEMENT.md) | Installer / mettre à jour sur le serveur, restaurer une sauvegarde |
| [docs/SPECIFICATIONS.md](docs/SPECIFICATIONS.md) | Spécifications fonctionnelles |
| [docs/DOSSIER_TECHNIQUE.md](docs/DOSSIER_TECHNIQUE.md) | Architecture, API, données, sécurité, tests |
| [docs/INVENTAIRE.md](docs/INVENTAIRE.md) | Ce qui existait avant la v3 et les bugs corrigés |
| [CHANGELOG.md](CHANGELOG.md) | Historique des versions |

## Arborescence

```
server.js  src/  public/  admin/  test/  docs/  scripts/  data-exemple/  data/ et sauvegardes/ (hors git)
```

Version actuelle : **3.4.0**.
