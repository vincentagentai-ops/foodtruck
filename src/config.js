'use strict';

// Configuration lue dans les variables d'environnement (fichier .env à la racine, facultatif).

const path = require('path');
const fs = require('fs');
const net = require('net');

const RACINE = path.join(__dirname, '..');
const FICHIER_ENV = path.join(RACINE, '.env');

if (fs.existsSync(FICHIER_ENV) && typeof process.loadEnvFile === 'function') {
    process.loadEnvFile(FICHIER_ENV); // Node >= 20.12 ; n'écrase pas les variables déjà définies
}

const MOTS_CLES_PROXY = ['loopback', 'linklocal', 'uniquelocal'];

/**
 * TRUST_PROXY -> valeur pour `app.set('trust proxy', …)` et avertissements éventuels.
 * Accepte « loopback », une IP, une plage (10.0.0.0/8) ou une liste séparée par des virgules.
 * « true » reste accepté mais fait confiance à n'importe quel X-Forwarded-For (IP falsifiable).
 */
function lireTrustProxy(valeur) {
    const v = String(valeur || '').trim();
    if (!v || v.toLowerCase() === 'false') return { valeur: false, avertissements: [] };
    if (v.toLowerCase() === 'true') {
        return {
            valeur: true,
            avertissements: ["TRUST_PROXY=true fait confiance à tout en-tête X-Forwarded-For : l'adresse IP des visiteurs "
                + 'peut être falsifiée. Indiquez plutôt « loopback » ou l\'adresse IP du proxy.'],
        };
    }
    const elements = v.split(',').map(e => e.trim()).filter(Boolean);
    const invalides = elements.filter(e => {
        if (MOTS_CLES_PROXY.includes(e.toLowerCase())) return false;
        const [ip, masque] = e.split('/');
        if (!net.isIP(ip)) return true;
        return masque !== undefined && !/^\d{1,3}$/.test(masque);
    });
    if (invalides.length) {
        return {
            valeur: false,
            avertissements: [`TRUST_PROXY ignoré : valeur(s) non reconnue(s) ${invalides.join(', ')} `
                + '(attendu : loopback, une adresse IP ou une liste séparée par des virgules).'],
        };
    }
    return { valeur: elements.map(e => (MOTS_CLES_PROXY.includes(e.toLowerCase()) ? e.toLowerCase() : e)), avertissements: [] };
}

function entier(valeur, defaut) {
    const n = parseInt(valeur, 10);
    return Number.isInteger(n) && n >= 0 ? n : defaut;
}

function charger(env = process.env) {
    const dossierDonnees = env.DATA_DIR ? path.resolve(RACINE, env.DATA_DIR) : path.join(RACINE, 'data');
    const trustProxy = lireTrustProxy(env.TRUST_PROXY);
    return {
        port: parseInt(env.PORT, 10) || 3000,
        environnement: env.APP_ENV || 'production', // "test" affiche un bandeau « Environnement de test »
        titre: env.SITE_TITLE || 'Food Trucks Basso Cambo',
        dossierDonnees,
        fichierFoodtrucks: path.join(dossierDonnees, 'foodtrucks.csv'),
        fichierLieux: path.join(dossierDonnees, 'lieux.csv'),
        fichierAValider: path.join(dossierDonnees, 'foodtruckAValider.csv'),
        // Anciens journaux uniques (avant la 3.1.0) : encore lus, plus écrits
        fichierUsage: path.join(dossierDonnees, 'usage.log'),
        fichierAcces: path.join(dossierDonnees, 'acces.log'),
        fichierAgregats: path.join(dossierDonnees, 'stats-jours.json'),
        fichierSecret: path.join(dossierDonnees, 'secret-stats.json'),
        // Sauvegardes quotidiennes : par défaut « sauvegardes » à côté du dossier des données
        dossierSauvegardes: env.BACKUP_DIR
            ? path.resolve(RACINE, env.BACKUP_DIR)
            : path.join(path.dirname(dossierDonnees), 'sauvegardes'),
        joursSauvegarde: Math.max(1, entier(env.BACKUP_DAYS, 30)),
        moisConservationJournaux: 13,
        secretStatistiques: env.STATS_SECRET || '', // vide = généré et enregistré dans data/secret-stats.json
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
        trustProxy: trustProxy.valeur,
        // Écritures acceptées uniquement depuis les pages du site : en-tête Origin égal à l'hôte demandé, ou à l'un
        // de ces hôtes (nom ou nom:port, séparés par des virgules ; utile derrière un proxy qui change l'hôte)
        hotesAutorises: String(env.HOTES_AUTORISES || '').split(',').map(h => h.trim().toLowerCase()).filter(Boolean),
        // Limites de fréquence des écritures publiques, par navigateur et par heure (par IP : × LIMITE_FACTEUR_IP)
        limites: {
            evenements: entier(env.LIMITE_EVENEMENTS, 600),
            contributions: entier(env.LIMITE_CONTRIBUTIONS, 60), // ajouts, modifications, avis, présences, signalements
            facteurIp: Math.max(1, entier(env.LIMITE_FACTEUR_IP, 5)),
        },
        journaliserAcces: env.ACCESS_LOG !== 'false',
        avertissements: [...trustProxy.avertissements],
    };
}

module.exports = { charger, lireTrustProxy, RACINE };
