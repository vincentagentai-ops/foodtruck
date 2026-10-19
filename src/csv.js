'use strict';

// Lecture / écriture CSV conforme RFC 4180 (séparateur virgule, guillemets doubles).
// Gère les virgules et guillemets dans les valeurs (ex. URL Google Maps longues),
// les fins de ligne Windows (\r\n) et l'absence de saut de ligne final.
// Les colonnes sont retrouvées par leur nom dans l'en-tête : un ancien fichier (colonnes manquantes)
// est lu avec des valeurs vides, et les colonnes inconnues sont ignorées.

// Catalogue des établissements (3.2.0 : colonne lieux_jours ajoutée en fin, « Jeudi=parking-nord;Vendredi=https://… » ;
// 3.5.0 : colonnes photo (adresse de la photo) et fidelite (« oui » si l'établissement a une carte de fidélité) ajoutées en fin)
const COLONNES = ['id', 'nom', 'type', 'cuisine', 'categorie', 'etiquettes', 'jours', 'lieu', 'horaires', 'prix',
    'paiements', 'site', 'emplacement', 'statut', 'cree_le', 'maj_le', 'version', 'lieux_jours', 'photo', 'fidelite'];
// Format de la 3.0.0 et des versions précédentes (aussi utilisé sans en-tête par l'ancien foodtruckAValider.csv)
const ANCIENNES_COLONNES = ['nom', 'cuisine', 'jours', 'emplacement', 'prix', 'site'];
const COLONNES_LIEUX = ['id', 'nom', 'description', 'minutes_a_pied', 'maps'];

/** Découpe un texte CSV en lignes de valeurs (tableau de tableaux). */
function parserCSV(texte) {
    const lignes = [];
    let ligne = [];
    let valeur = '';
    let entreGuillemets = false;
    const t = texte.replace(/^﻿/, ''); // BOM éventuel (fichier enregistré par Excel)

    for (let i = 0; i < t.length; i++) {
        const c = t[i];
        if (entreGuillemets) {
            if (c === '"') {
                if (t[i + 1] === '"') { valeur += '"'; i++; } else { entreGuillemets = false; }
            } else {
                valeur += c;
            }
        } else if (c === '"') {
            entreGuillemets = true;
        } else if (c === ',') {
            ligne.push(valeur);
            valeur = '';
        } else if (c === '\n' || c === '\r') {
            if (c === '\r' && t[i + 1] === '\n') i++;
            ligne.push(valeur);
            lignes.push(ligne);
            ligne = [];
            valeur = '';
        } else {
            valeur += c;
        }
    }
    if (valeur !== '' || ligne.length > 0) {
        ligne.push(valeur);
        lignes.push(ligne);
    }
    // Ignore les lignes vides (sauts de ligne en trop)
    return lignes.filter(l => l.some(v => v.trim() !== ''));
}

/** Encadre une valeur de guillemets si nécessaire. */
function echapper(valeur) {
    const v = valeur == null ? '' : String(valeur);
    return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Transforme un tableau de lignes en texte CSV (avec saut de ligne final). */
function serialiserCSV(lignes) {
    return lignes.map(l => l.map(echapper).join(',')).join('\n') + '\n';
}

/** « Minutes à pied » -> « minutes_a_pied » (comparaison des noms de colonnes). */
function nomColonne(texte) {
    return String(texte).normalize('NFD').replace(/[̀-ͯ]/g, '')
        .trim().toLowerCase().replace(/[\s-]+/g, '_');
}

/**
 * Texte CSV -> objets. La première ligne est un en-tête si elle contient le nom d'une colonne connue
 * en première position (« id » ou « nom ») ; sinon les colonnes sont `sansEntete`, dans l'ordre.
 */
function versObjets(texte, colonnes, sansEntete = colonnes) {
    let lignes = parserCSV(texte);
    let ordre = sansEntete;
    if (lignes[0] && ['id', 'nom'].includes(nomColonne(lignes[0][0]))) {
        ordre = lignes[0].map(nomColonne);
        lignes = lignes.slice(1);
    }
    return lignes.map(l => {
        const objet = {};
        for (const col of colonnes) {
            const i = ordre.indexOf(col);
            objet[col] = i >= 0 ? (l[i] || '').trim() : '';
        }
        return objet;
    });
}

/**
 * Neutralise une valeur exportée pour Excel : un texte commençant par = + - @ tabulation ou retour chariot
 * serait interprété comme une formule ; il est préfixé d'une apostrophe.
 */
function neutraliser(valeur) {
    const v = valeur == null ? '' : String(valeur);
    return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

/** Objets -> texte CSV avec en-tête. `options.export` : valeurs neutralisées (fichier destiné à Excel). */
function depuisObjets(objets, colonnes, options = {}) {
    const valeur = v => (options.export ? neutraliser(v) : (v == null ? '' : v));
    return serialiserCSV([colonnes, ...objets.map(o => colonnes.map(col => valeur(o[col])))]);
}

/** A-t-on lu un fichier au format complet ? (sinon : migration nécessaire) */
function enteteComplete(texte, colonnes) {
    const premiere = parserCSV(texte)[0];
    if (!premiere) return false;
    const entete = premiere.map(nomColonne);
    return colonnes.every(c => entete.includes(c));
}

const versFoodtrucks = texte => versObjets(texte, COLONNES, ANCIENNES_COLONNES);
const depuisFoodtrucks = (foodtrucks, options) => depuisObjets(foodtrucks, COLONNES, options);
const versLieux = texte => versObjets(texte, COLONNES_LIEUX);
const depuisLieux = (lieux, options) => depuisObjets(lieux, COLONNES_LIEUX, options);

module.exports = {
    COLONNES, ANCIENNES_COLONNES, COLONNES_LIEUX,
    parserCSV, serialiserCSV, versObjets, depuisObjets, enteteComplete, neutraliser,
    versFoodtrucks, depuisFoodtrucks, versLieux, depuisLieux,
};
