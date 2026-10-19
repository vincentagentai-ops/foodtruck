'use strict';

// Migration automatique des données au démarrage (3.0.0 -> 3.1.0 -> 3.2.0).
// 3.2.0 : colonne lieux_jours ajoutée (vide) en fin de foodtrucks.csv.
// - foodtrucks.csv : ajout des colonnes id, type, categorie, etiquettes, lieu, horaires, paiements, statut,
//   cree_le, maj_le, version ; un identifiant stable est attribué à chaque ligne (aucune ligne fusionnée).
// - foodtruckAValider.csv : réécrit au nouveau format (colonnes vides).
// - lieux.csv : créé vide.
// Avant toute réécriture, une copie du fichier d'origine est faite à côté (…-avant-migration-<date>.csv).

const fs = require('fs/promises');
const path = require('path');
const { COLONNES, COLONNES_LIEUX, enteteComplete, versFoodtrucks } = require('./csv');
const { CATEGORIES, TYPES, STATUTS, categorieDepuisCuisine } = require('./validation');
const { nouvelId } = require('./stockage');

function horodatage(date = new Date()) {
    const p = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}

/** Copie `fichier` en « <nom>-avant-migration-<date>.csv » et retourne le chemin de la copie. */
async function copieDeSecurite(fichier) {
    const { dir, name, ext } = path.parse(fichier);
    const copie = path.join(dir, `${name}-avant-migration-${horodatage()}${ext}`);
    await fs.copyFile(fichier, copie);
    return copie;
}

/** Complète une ligne du catalogue (valeurs par défaut, identifiant). Ne modifie pas les valeurs présentes. */
function completerLigne(ft, ids) {
    const ligne = { ...ft };
    if (!ligne.id) {
        ligne.id = nouvelId(ids);
        ids.push(ligne.id);
    }
    if (!TYPES.includes(ligne.type)) ligne.type = 'foodtruck';
    if (!CATEGORIES.includes(ligne.categorie)) ligne.categorie = categorieDepuisCuisine(ligne.cuisine);
    if (!STATUTS.includes(ligne.statut)) ligne.statut = 'actif';
    if (!/^\d+$/.test(ligne.version)) ligne.version = '1';
    return ligne;
}

function aMigrer(texte, liste) {
    return !enteteComplete(texte, COLONNES) || liste.some(ft => !ft.id || !ft.statut || !ft.version || !ft.categorie || !ft.type);
}

async function migrerDonnees(stockage) {
    const { config } = stockage;
    const resultat = { migre: false, copies: [] };

    // Catalogue
    const texte = await stockage.lireTexte(config.fichierFoodtrucks);
    if (texte === null) {
        await stockage.ecrireFichier(config.fichierFoodtrucks, []);
    } else {
        const liste = versFoodtrucks(texte);
        if (aMigrer(texte, liste)) {
            resultat.copies.push(await copieDeSecurite(config.fichierFoodtrucks));
            const ids = liste.map(ft => ft.id).filter(Boolean);
            // Identifiants en double (copier-coller dans Excel) : la deuxième ligne reçoit un nouvel identifiant
            const vus = new Set();
            const lignes = liste.map(ft => {
                if (ft.id && vus.has(ft.id)) ft = { ...ft, id: '' };
                if (ft.id) vus.add(ft.id);
                return completerLigne(ft, ids);
            });
            await stockage.ecrireFichier(config.fichierFoodtrucks, lignes);
            resultat.migre = true;
        }
    }

    // Suggestions en attente (pas d'identifiant : elles en reçoivent un à la publication)
    const attente = await stockage.lireTexte(config.fichierAValider);
    if (attente === null) {
        await stockage.ecrireFichier(config.fichierAValider, []);
    } else if (!enteteComplete(attente, COLONNES)) {
        resultat.copies.push(await copieDeSecurite(config.fichierAValider));
        await stockage.ecrireFichier(config.fichierAValider, versFoodtrucks(attente));
        resultat.migre = true;
    }

    // Lieux
    const lieux = await stockage.lireTexte(config.fichierLieux);
    if (lieux === null || !enteteComplete(lieux, COLONNES_LIEUX)) {
        if (lieux !== null) resultat.copies.push(await copieDeSecurite(config.fichierLieux));
        await stockage.ecrireLieux(lieux === null ? [] : await stockage.lireLieux());
    }
    return resultat;
}

module.exports = { migrerDonnees, completerLigne };
