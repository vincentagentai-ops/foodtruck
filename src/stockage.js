'use strict';

// Accès aux fichiers de données. Toutes les écritures passent par une file d'attente
// (pas d'écritures concurrentes) et sont atomiques (fichier temporaire puis renommage).

const fs = require('fs/promises');
const { versFoodtrucks, depuisFoodtrucks } = require('./csv');

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
        for (const fichier of [this.config.fichierFoodtrucks, this.config.fichierAValider]) {
            try {
                await fs.access(fichier);
            } catch {
                await this.ecrireFichier(fichier, []);
            }
        }
    }

    async lireFichier(fichier) {
        try {
            return versFoodtrucks(await fs.readFile(fichier, 'utf8'));
        } catch (err) {
            if (err.code === 'ENOENT') return [];
            throw err;
        }
    }

    async ecrireFichier(fichier, foodtrucks) {
        const temporaire = `${fichier}.${process.pid}.tmp`;
        await fs.writeFile(temporaire, depuisFoodtrucks(foodtrucks, true), 'utf8');
        await fs.rename(temporaire, fichier);
    }

    lireFoodtrucks() { return this.lireFichier(this.config.fichierFoodtrucks); }
    lireAValider() { return this.lireFichier(this.config.fichierAValider); }

    /** Applique `modifier(liste)` (qui retourne la nouvelle liste) au fichier, en série. */
    modifier(fichier, modifier) {
        return this.enSerie(async () => {
            const liste = await this.lireFichier(fichier);
            const nouvelle = await modifier(liste);
            await this.ecrireFichier(fichier, nouvelle);
            return nouvelle;
        });
    }

    ajouterSuggestion(ft) {
        return this.modifier(this.config.fichierAValider, liste => [...liste, ft]);
    }

    ajouterFoodtruck(ft) {
        return this.modifier(this.config.fichierFoodtrucks, liste => [...liste, ft]);
    }

    /** Ajoute une ligne de journal (JSON par ligne). */
    journaliser(fichier, entree) {
        return fs.appendFile(fichier, JSON.stringify(entree) + '\n', 'utf8');
    }

    async lireJournal(fichier) {
        let texte;
        try {
            texte = await fs.readFile(fichier, 'utf8');
        } catch (err) {
            if (err.code === 'ENOENT') return [];
            throw err;
        }
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

module.exports = { Stockage, ErreurHttp };
