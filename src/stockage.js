'use strict';

// Accès aux fichiers de données. Toutes les écritures passent par une file d'attente
// (pas d'écritures concurrentes) et sont atomiques (fichier temporaire puis renommage).

const fs = require('fs/promises');
const crypto = require('crypto');
const { versFoodtrucks, depuisFoodtrucks, versLieux, depuisLieux } = require('./csv');

const CODES_REESSAI = ['EPERM', 'EBUSY', 'EACCES'];

/**
 * Renomme `source` en `cible` en réessayant quelques fois si le fichier est momentanément verrouillé
 * (fichier ouvert dans Excel, antivirus sous Windows : EPERM / EBUSY / EACCES).
 */
async function renommerAvecReessais(source, cible, options = {}) {
    const renommer = options.renommer || fs.rename;
    const delais = options.delais || [50, 100, 200, 400, 800];
    for (let essai = 0; ; essai++) {
        try {
            return await renommer(source, cible);
        } catch (err) {
            if (!CODES_REESSAI.includes(err.code) || essai >= delais.length) throw err;
            await new Promise(resolve => setTimeout(resolve, delais[essai]));
        }
    }
}

/** Identifiant court et stable d'un établissement (6 caractères, sans caractères ambigus). */
function nouvelId(existants = []) {
    const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
    const pris = new Set(existants);
    for (;;) {
        const octets = crypto.randomBytes(6);
        const id = Array.from(octets, o => alphabet[o % alphabet.length]).join('');
        if (!pris.has(id)) return id;
    }
}

/** Date locale AAAA-MM-JJ. */
function aujourdhui(date = new Date()) {
    const p = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

class Stockage {
    constructor(config) {
        this.config = config;
        this.file = Promise.resolve();
    }

    /** Exécute `tache` après les écritures précédentes. */
    enSerie(tache) {
        const resultat = this.file.then(tache, tache);
        this.file = resultat.catch(() => {});
        return resultat;
    }

    async initialiser() {
        await fs.mkdir(this.config.dossierDonnees, { recursive: true });
        const { migrerDonnees } = require('./migration');
        this.migration = await migrerDonnees(this);
        await this.chargerSecret();
    }

    /** Secret du HMAC des identifiants de navigateur : STATS_SECRET, sinon généré une fois dans data/. */
    async chargerSecret() {
        if (this.config.secretStatistiques) {
            this.secret = this.config.secretStatistiques;
            return;
        }
        const existant = await this.lireJSON(this.config.fichierSecret, null);
        if (existant && typeof existant.secret === 'string' && existant.secret.length >= 32) {
            this.secret = existant.secret;
            return;
        }
        this.secret = crypto.randomBytes(32).toString('hex');
        await this.ecrireJSON(this.config.fichierSecret, {
            secret: this.secret,
            info: "Secret des statistiques (STATS_SECRET). Le changer fait apparaître tous les navigateurs comme nouveaux.",
        });
    }

    async lireTexte(fichier) {
        try {
            return await fs.readFile(fichier, 'utf8');
        } catch (err) {
            if (err.code === 'ENOENT') return null;
            throw err;
        }
    }

    /** Écrit `texte` dans un fichier temporaire puis le renomme (jamais de fichier à moitié écrit). */
    async ecrireTexte(fichier, texte) {
        const temporaire = `${fichier}.${process.pid}.tmp`;
        await fs.writeFile(temporaire, texte, 'utf8');
        try {
            await renommerAvecReessais(temporaire, fichier);
        } catch (err) {
            await fs.rm(temporaire, { force: true });
            throw err;
        }
    }

    async lireFichier(fichier) {
        const texte = await this.lireTexte(fichier);
        return texte === null ? [] : versFoodtrucks(texte);
    }

    ecrireFichier(fichier, foodtrucks) {
        return this.ecrireTexte(fichier, depuisFoodtrucks(foodtrucks));
    }

    lireFoodtrucks() { return this.lireFichier(this.config.fichierFoodtrucks); }
    lireAValider() { return this.lireFichier(this.config.fichierAValider); }

    async lireLieux() {
        const texte = await this.lireTexte(this.config.fichierLieux);
        return texte === null ? [] : versLieux(texte);
    }

    ecrireLieux(lieux) {
        return this.ecrireTexte(this.config.fichierLieux, depuisLieux(lieux));
    }

    /** Applique `modifier(liste)` (qui retourne la nouvelle liste) au fichier, en série. */
    modifier(fichier, modifier) {
        return this.enSerie(async () => {
            const liste = await this.lireFichier(fichier);
            const nouvelle = await modifier(liste);
            await this.ecrireFichier(fichier, nouvelle);
            return nouvelle;
        });
    }

    modifierLieux(modifier) {
        return this.enSerie(async () => {
            const nouvelle = await modifier(await this.lireLieux());
            await this.ecrireLieux(nouvelle);
            return nouvelle;
        });
    }

    ajouterSuggestion(ft) {
        return this.modifier(this.config.fichierAValider, liste => [...liste, ft]);
    }

    /** Ajoute un établissement validé : identifiant, dates et version sont attribués ici. */
    async ajouterFoodtruck(ft) {
        let ajoute;
        await this.modifier(this.config.fichierFoodtrucks, liste => {
            const jour = aujourdhui();
            ajoute = { ...ft, id: nouvelId(liste.map(f => f.id)), cree_le: jour, maj_le: jour, version: '1' };
            return [...liste, ajoute];
        });
        return ajoute;
    }

    async lireJSON(fichier, defaut) {
        const texte = await this.lireTexte(fichier);
        if (texte === null) return defaut;
        return JSON.parse(texte);
    }

    ecrireJSON(fichier, objet) {
        return this.ecrireTexte(fichier, JSON.stringify(objet, null, 1) + '\n');
    }

    /** Ajoute une ligne de journal (JSON par ligne). */
    journaliser(fichier, entree) {
        return fs.appendFile(fichier, JSON.stringify(entree) + '\n', 'utf8');
    }

    async lireJournal(fichier) {
        const texte = await this.lireTexte(fichier);
        if (texte === null) return [];
        const entrees = [];
        for (const ligne of texte.split('\n')) {
            if (!ligne.trim()) continue;
            try { entrees.push(JSON.parse(ligne)); } catch { /* ligne corrompue ignorée */ }
        }
        return entrees;
    }
}

/** Erreur « métier » renvoyée au client avec un code HTTP. */
class ErreurHttp extends Error {
    constructor(statut, message, details) {
        super(message);
        this.statut = statut;
        this.details = details;
    }
}

module.exports = { Stockage, ErreurHttp, renommerAvecReessais, nouvelId, aujourdhui };
