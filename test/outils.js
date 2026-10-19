'use strict';

// Outils communs aux tests : application sur un dossier de données temporaire, appels HTTP.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { charger } = require('../src/config');
const { creerApplication } = require('../src/app');

const UA_NAVIGATEUR = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function dossierTemporaire(fichiers = {}) {
    const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'foodtruck-test-'));
    for (const [nom, contenu] of Object.entries(fichiers)) fs.writeFileSync(path.join(dossier, nom), contenu);
    return dossier;
}

/**
 * Démarre l'application sur un dossier temporaire. Retourne { config, app, appel, fermer, dossier }.
 * `env` complète la configuration (DATA_DIR et BACKUP_DIR pointent toujours vers le dossier temporaire).
 */
async function demarrer({ fichiers = {}, env = {}, options = {} } = {}) {
    const racine = dossierTemporaire();
    const dossier = path.join(racine, 'data');
    fs.mkdirSync(dossier);
    for (const [nom, contenu] of Object.entries(fichiers)) fs.writeFileSync(path.join(dossier, nom), contenu);
    const config = charger({ ADMIN_PASSWORD: 'secret-test', STATS_SECRET: 'secret-statistiques-de-test-0123456789', ...env, DATA_DIR: dossier, BACKUP_DIR: path.join(racine, 'sauvegardes') });
    const app = creerApplication(config, { journal: { log() {}, error() {} }, ...options });
    await app.locals.stockage.initialiser();
    const serveur = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
    const base = `http://127.0.0.1:${serveur.address().port}`;

    async function appel(methode, url, corps, entetes = {}) {
        const r = await fetch(base + url, {
            method: methode,
            headers: { 'Content-Type': 'application/json', 'User-Agent': UA_NAVIGATEUR, ...entetes },
            body: corps === undefined ? undefined : (typeof corps === 'string' ? corps : JSON.stringify(corps)),
            redirect: 'manual',
        });
        const texte = await r.text();
        let json = null;
        try { json = JSON.parse(texte); } catch { /* pas du JSON */ }
        return { statut: r.status, json, texte, entetes: r.headers };
    }

    function fermer() {
        serveur.close();
        fs.rmSync(racine, { recursive: true, force: true });
    }
    return { config, app, appel, fermer, dossier, racine, base };
}

/** Attend que les écritures de journaux (asynchrones, après la réponse) soient faites. */
const patienter = (ms = 60) => new Promise(r => setTimeout(r, ms));

const AUTH = { Authorization: `Basic ${Buffer.from('admin:secret-test').toString('base64')}` };

module.exports = { demarrer, dossierTemporaire, patienter, AUTH, UA_NAVIGATEUR };
