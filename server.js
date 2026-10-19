'use strict';

// Point d'entrée : `npm start` (ou `pm2 start ecosystem.config.js`).

const { charger } = require('./src/config');
const { creerApplication } = require('./src/app');

const config = charger();
const app = creerApplication(config);

app.locals.stockage.initialiser().then(() => {
    app.listen(config.port, () => {
        console.log(`Food Trucks démarré sur http://localhost:${config.port} (données : ${config.dossierDonnees})`);
        if (!config.admin.motDePasse) {
            console.warn('ADMIN_PASSWORD non défini : espace administrateur désactivé.');
        }
        if (!config.mail.hote) {
            console.warn("SMTP_HOST non défini : aucun mail ne sera envoyé lors d'une suggestion.");
        }
    });
}).catch(err => {
    console.error('Démarrage impossible :', err);
    process.exit(1);
});
