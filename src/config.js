'use strict';

// Configuration lue dans les variables d'environnement (fichier .env à la racine, facultatif).

const path = require('path');
const fs = require('fs');

const RACINE = path.join(__dirname, '..');
const FICHIER_ENV = path.join(RACINE, '.env');

if (fs.existsSync(FICHIER_ENV) && typeof process.loadEnvFile === 'function') {
    process.loadEnvFile(FICHIER_ENV); // Node >= 20.12 ; n'écrase pas les variables déjà définies
}

function charger(env = process.env) {
    const dossierDonnees = env.DATA_DIR ? path.resolve(RACINE, env.DATA_DIR) : path.join(RACINE, 'data');
    return {
        port: parseInt(env.PORT, 10) || 3000,
        environnement: env.APP_ENV || 'production', // "test" affiche un bandeau « Environnement de test »
        titre: env.SITE_TITLE || 'Food Trucks Basso Cambo',
        dossierDonnees,
        fichierFoodtrucks: path.join(dossierDonnees, 'foodtrucks.csv'),
        fichierAValider: path.join(dossierDonnees, 'foodtruckAValider.csv'),
        fichierUsage: path.join(dossierDonnees, 'usage.log'),
        fichierAcces: path.join(dossierDonnees, 'acces.log'),
        admin: {
            utilisateur: env.ADMIN_USER || 'admin',
            motDePasse: env.ADMIN_PASSWORD || '', // vide = espace administrateur désactivé
        },
        contactEmail: env.CONTACT_EMAIL || '',
        mail: {
            hote: env.SMTP_HOST || '', // vide = pas d'envoi de mail lors d'une suggestion
            port: parseInt(env.SMTP_PORT, 10) || 25,
            securise: env.SMTP_SECURE === 'true',
            utilisateur: env.SMTP_USER || '',
            motDePasse: env.SMTP_PASSWORD || '',
            ignorerCertificat: env.SMTP_IGNORE_TLS_ERRORS === 'true',
            expediteur: env.MAIL_FROM || 'noreply@foodtrucks.local',
            destinataire: env.MAIL_TO || env.CONTACT_EMAIL || '',
        },
        trustProxy: env.TRUST_PROXY === 'true',
        journaliserAcces: env.ACCESS_LOG !== 'false',
    };
}

module.exports = { charger, RACINE };
