# Food Trucks

Site interne qui liste les foodtrucks autour du travail (Basso Cambo), jour par jour : consultation, tri,
suggestions des collègues, administration et statistiques d'usage. Node.js + Express, données en CSV, sans base
de données ni dépendance Internet.

## Démarrage rapide

```bash
npm install
cp .env.example .env      # renseigner au moins ADMIN_PASSWORD
npm start                 # http://localhost:3000  — administration : /admin/
npm test                  # tests automatisés
```

Au premier lancement, `data/` est créé vide ; pour partir des données d'origine :
`cp data-exemple/*.csv data/`.

## Documentation

| Document | Pour qui |
|---|---|
| [docs/GUIDE_UTILISATEUR.md](docs/GUIDE_UTILISATEUR.md) | Les visiteurs du site |
| [docs/GUIDE_ADMINISTRATEUR.md](docs/GUIDE_ADMINISTRATEUR.md) | Les administrateurs (suggestions, ajouts, statistiques, réglages) |
| [docs/DEPLOIEMENT.md](docs/DEPLOIEMENT.md) | Installer / mettre à jour sur le serveur (procédure simple) |
| [docs/SPECIFICATIONS.md](docs/SPECIFICATIONS.md) | Spécifications fonctionnelles |
| [docs/DOSSIER_TECHNIQUE.md](docs/DOSSIER_TECHNIQUE.md) | Architecture, API, données, sécurité, tests |
| [docs/INVENTAIRE.md](docs/INVENTAIRE.md) | Ce qui existait avant la v3 et les bugs corrigés |
| [CHANGELOG.md](CHANGELOG.md) | Historique des versions |

## Arborescence

```
server.js  src/  public/  test/  docs/  scripts/  data-exemple/  data/ (hors git)
```

Version actuelle : **3.0.0**.
