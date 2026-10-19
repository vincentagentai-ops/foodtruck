'use strict';

// Lecture / écriture CSV conforme RFC 4180 (séparateur virgule, guillemets doubles).
// Gère les virgules et guillemets dans les valeurs (ex. URL Google Maps longues),
// les fins de ligne Windows (\r\n) et l'absence de saut de ligne final.

const COLONNES = ['nom', 'cuisine', 'jours', 'emplacement', 'prix', 'site'];
const ENTETE = 'Nom,Cuisine,Jours,Emplacement,Prix,Site';

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

/** Lignes CSV -> objets foodtruck. `avecEntete` : la première ligne est l'en-tête. */
function versFoodtrucks(texte, avecEntete) {
    let lignes = parserCSV(texte);
    if (avecEntete || (lignes[0] && lignes[0][0].trim().toLowerCase() === 'nom')) {
        lignes = lignes.slice(1);
    }
    return lignes.map(l => {
        const ft = {};
        COLONNES.forEach((col, i) => { ft[col] = (l[i] || '').trim(); });
        return ft;
    });
}

/** Objets foodtruck -> texte CSV. */
function depuisFoodtrucks(foodtrucks, avecEntete) {
    const lignes = foodtrucks.map(ft => COLONNES.map(col => ft[col] || ''));
    if (avecEntete) lignes.unshift(ENTETE.split(','));
    return serialiserCSV(lignes);
}

module.exports = { COLONNES, ENTETE, parserCSV, serialiserCSV, versFoodtrucks, depuisFoodtrucks };
