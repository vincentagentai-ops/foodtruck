'use strict';

// Normalisation et contrôle des données saisies (suggestion publique ou ajout administrateur).

const JOURS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi'];
const LONGUEUR_MAX = { nom: 80, cuisine: 80, jours: 60, emplacement: 1000, prix: 30, site: 1000 };

function retirerAccents(s) {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * "lundi, Mercredi et jeudi" -> { jours: ['Lundi','Mercredi','Jeudi'], invalides: [] }
 * Les doublons sont retirés et l'ordre de la semaine est rétabli.
 */
function normaliserJours(saisie) {
    const morceaux = String(saisie || '')
        .split(/[\s,;/]+|\bet\b/i)
        .map(j => j.trim())
        .filter(j => j && j.toLowerCase() !== 'et');
    const trouves = new Set();
    const invalides = [];
    for (const m of morceaux) {
        const jour = JOURS.find(j => retirerAccents(j.toLowerCase()) === retirerAccents(m.toLowerCase()));
        if (jour) trouves.add(jour); else invalides.push(m);
    }
    return { jours: JOURS.filter(j => trouves.has(j)), invalides };
}

/** "10 à 15 €" / "10,15" / "10-15" -> "10-15" ; "12€" -> "12" ; vide -> "". */
function normaliserPrix(saisie) {
    let p = String(saisie || '').replace(/€|euros?/gi, '').trim();
    if (!p) return '';
    p = p.replace(/\s*(?:à|a|-|–|,|\/)\s*/gi, '-').replace(/\s+/g, '');
    return p;
}

function estUrl(s) {
    try {
        const u = new URL(s);
        return u.protocol === 'http:' || u.protocol === 'https:';
    } catch {
        return false;
    }
}

/**
 * Valide un foodtruck. Retourne { foodtruck, erreurs } ; `erreurs` est vide si tout va bien.
 */
function validerFoodtruck(donnees) {
    const d = donnees || {};
    const erreurs = [];
    const texte = cle => String(d[cle] == null ? '' : d[cle]).replace(/[\r\n\t]+/g, ' ').trim();

    const ft = {
        nom: texte('nom'),
        cuisine: texte('cuisine'),
        emplacement: texte('emplacement'),
        prix: normaliserPrix(texte('prix')),
        site: texte('site'),
    };
    const { jours, invalides } = normaliserJours(d.jours);
    ft.jours = jours.join(';');

    if (!ft.nom) erreurs.push('Le nom est obligatoire.');
    if (!ft.cuisine) erreurs.push('Le type de cuisine est obligatoire.');
    if (jours.length === 0) erreurs.push('Indiquez au moins un jour entre lundi et vendredi.');
    if (invalides.length) erreurs.push(`Jour(s) non reconnu(s) : ${invalides.join(', ')} (du lundi au vendredi uniquement).`);
    if (!ft.emplacement) erreurs.push("L'emplacement Google Maps est obligatoire.");
    else if (!estUrl(ft.emplacement)) erreurs.push("L'emplacement doit être une adresse web (https://…).");
    if (ft.site && !estUrl(ft.site)) erreurs.push('Le site doit être une adresse web (https://…).');
    if (ft.prix && !/^\d+(?:[.,]\d+)?(?:-\d+(?:[.,]\d+)?)?$/.test(ft.prix)) {
        erreurs.push('Le prix doit être un nombre ou une fourchette (ex : 12 ou 10-15).');
    }
    for (const [cle, max] of Object.entries(LONGUEUR_MAX)) {
        if (ft[cle].length > max) erreurs.push(`Le champ « ${cle} » dépasse ${max} caractères.`);
    }
    // Protection contre l'injection de formules si le CSV est ouvert dans Excel
    for (const cle of ['nom', 'cuisine']) {
        if (/^[=+\-@]/.test(ft[cle])) erreurs.push(`Le champ « ${cle} » ne peut pas commencer par = + - ou @.`);
    }
    return { foodtruck: ft, erreurs };
}

module.exports = { JOURS, normaliserJours, normaliserPrix, estUrl, validerFoodtruck };
