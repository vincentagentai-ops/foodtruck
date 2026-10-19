'use strict';

// Point d'entrée : `npm start` (ou `pm2 start ecosystem.config.js`).

const { charger } = require('./src/config');
const { creerApplication } = require('./src/app');
const { demarrerMaintenance } = require('./src/maintenance');
const { version } = require('./package.json');

const config = charger();
const app = creerApplication(config);
config.avertissements.forEach(a => console.warn(`ATTENTION : ${a}`));

app.locals.stockage.initialiser().then(() => {
    const { migration } = app.locals.stockage;
    if (migration.migre) {
        console.log(`Données migrées au format 3.2.0. Copie des fichiers d'origine : ${migration.copies.join(', ')}`);
    }
    app.listen(config.port, () => {
        console.log(`Food Trucks démarré sur http://localhost:${config.port} (données : ${config.dossierDonnees})`);
        if (!config.admin.motDePasse) {
            console.warn('ADMIN_PASSWORD non défini : espace administrateur désactivé.');
        }
        if (!config.mail.hote) {
            console.warn("SMTP_HOST non défini : aucun mail ne sera envoyé lors d'un ajout d'établissement.");
        }
        // Marqueur de version sur les courbes des statistiques (enregistré au premier démarrage d'une nouvelle version)
        app.locals.statistiques.noterVersion(version).catch(err => console.error('Marqueur de version non enregistré :', err.message));
        // Sauvegarde quotidienne, agrégats statistiques, purge à 13 mois, seuils d'archivage automatique
        demarrerMaintenance({ config, statistiques: app.locals.statistiques, contributions: app.locals.contributions });
    });
}).catch(err => {
    console.error('Démarrage impossible :', err);
    process.exit(1);
});
