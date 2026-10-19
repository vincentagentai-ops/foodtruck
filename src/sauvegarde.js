'use strict';

// Sauvegarde quotidienne de data/ (fichiers .csv, .json, .jsonl et image du plan) dans <BACKUP_DIR>/AAAA-MM-JJ/,
// avec conservation des 30 dernières copies datées. La copie est faite dans un dossier temporaire puis
// renommée : un dossier daté présent est toujours complet.

const fs = require('fs/promises');
const path = require('path');
const { decalerJours, dateLocale } = require('./statistiques');

const EXTENSIONS = /\.(csv|json|jsonl|png|jpg|webp)$/i; // images : plan des emplacements
const DOSSIER_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Fait la copie du jour si elle n'existe pas encore. Retourne le dossier créé, ou null. */
async function sauvegarderSiNecessaire(config, jour = dateLocale(new Date())) {
    const cible = path.join(config.dossierSauvegardes, jour);
    if (await fs.stat(cible).catch(() => null)) return null;
    const temporaire = `${cible}.tmp`;
    await fs.rm(temporaire, { recursive: true, force: true });
    await fs.mkdir(temporaire, { recursive: true });
    const noms = await fs.readdir(config.dossierDonnees);
    for (const nom of noms.filter(n => EXTENSIONS.test(n) && !n.endsWith('.tmp'))) {
        const source = path.join(config.dossierDonnees, nom);
        if ((await fs.stat(source)).isFile()) await fs.copyFile(source, path.join(temporaire, nom));
    }
    await fs.rename(temporaire, cible);
    return cible;
}

/** Supprime les copies datées de plus de `config.joursSauvegarde` jours. Retourne les dossiers supprimés. */
async function rotation(config, jour = dateLocale(new Date())) {
    const limite = decalerJours(jour, -config.joursSauvegarde);
    let noms = [];
    try { noms = await fs.readdir(config.dossierSauvegardes); } catch { return []; }
    const supprimes = [];
    for (const nom of noms.filter(n => DOSSIER_DATE.test(n) && n <= limite)) {
        await fs.rm(path.join(config.dossierSauvegardes, nom), { recursive: true, force: true });
        supprimes.push(nom);
    }
    return supprimes;
}

module.exports = { sauvegarderSiNecessaire, rotation };
