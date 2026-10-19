'use strict';

// Normalisation et contrôle des données saisies (suggestion publique ou saisie administrateur),
// et listes fermées du catalogue (catégories, étiquettes, paiements).

const JOURS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi'];
const TYPES = ['foodtruck', 'restaurant'];
const STATUTS = ['actif', 'incertain', 'archive'];
const CATEGORIES = ['Africaine', 'Asiatique', 'Burgers', 'Créole', 'Crêpes', 'Française', 'Grillades', 'Indienne',
    'Italienne / Pizza', 'Libanaise / Orientale', 'Mexicaine', 'Salades', 'Sandwichs / Bagels', 'Autre'];
const ETIQUETTES = ['Végétarien possible', 'Végan possible', 'Halal', 'Sans gluten possible', 'Fait maison'];
const PAIEMENTS = ['Titres-restaurant papier', 'Titres-restaurant carte', 'CB', 'Espèces'];

// Catégorie déduite du libellé libre (migration, suggestion sans catégorie) : premier motif reconnu
const MOTIFS_CATEGORIES = [
    [/japon|cor[ée]e|tha[iï]|vietnam|asiat|chin|bibim|sushi|ramen|bo bun|wok/i, 'Asiatique'],
    [/liban|orient|kebab|falafel|turc|grec|syri|marocain|couscous/i, 'Libanaise / Orientale'],
    [/cr[êe]pe|galette/i, 'Crêpes'],
    [/bagel|sandwich|tartine|panini|wrap/i, 'Sandwichs / Bagels'],
    [/pizza|piad|itali|p[âa]tes/i, 'Italienne / Pizza'],
    [/mexic|tacos|burrito/i, 'Mexicaine'],
    [/afric|s[ée]n[ée]gal|ivoir/i, 'Africaine'],
    [/indien|curry|tandoori/i, 'Indienne'],
    [/grill|barbecue|bbq/i, 'Grillades'],
    [/cr[ée]ole|antill|r[ée]union/i, 'Créole'],
    [/salad/i, 'Salades'],
    [/burger/i, 'Burgers'],
    [/fran[çc]ais|traditionn|bistro|cuisine maison/i, 'Française'],
];

const LONGUEUR_MAX = {
    nom: 80, cuisine: 80, jours: 60, emplacement: 1000, prix: 30, site: 1000, horaires: 60, lieu: 40,
};

function retirerAccents(s) {
    return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function cle(s) {
    return retirerAccents(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Catégorie de la liste fermée correspondant au libellé de cuisine (« Autre » sinon). */
function categorieDepuisCuisine(cuisine) {
    const trouve = MOTIFS_CATEGORIES.find(([motif]) => motif.test(String(cuisine || '')));
    return trouve ? trouve[1] : 'Autre';
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

/**
 * Valeurs d'une liste fermée, séparées par « ; » (ou tableau) -> { valeurs (ordre de la liste), invalides }.
 * La comparaison ignore la casse, les accents et la ponctuation (« titres restaurant papier » est reconnu).
 */
function normaliserListe(saisie, liste) {
    const morceaux = (Array.isArray(saisie) ? saisie : String(saisie || '').split(/[;\n]+/))
        .map(m => String(m).trim()).filter(Boolean);
    const trouves = new Set();
    const invalides = [];
    for (const m of morceaux) {
        const valeur = liste.find(v => cle(v) === cle(m));
        if (valeur) trouves.add(valeur); else invalides.push(m);
    }
    return { valeurs: liste.filter(v => trouves.has(v)), invalides };
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

function texteDe(d, nom) {
    return String(d[nom] == null ? '' : d[nom]).replace(/[\r\n\t]+/g, ' ').trim();
}

/**
 * Valide un établissement (foodtruck ou restaurant). Retourne { foodtruck, erreurs } ; `erreurs` est vide si tout va bien.
 * Seuls les champs saisissables sont produits (id, statut, dates et version sont gérés par le serveur, sauf `statut`
 * que l'administrateur peut choisir). `options.lieux` : identifiants de lieux existants.
 */
function validerFoodtruck(donnees, options = {}) {
    const d = donnees || {};
    const erreurs = [];
    const texte = nom => texteDe(d, nom);

    const ft = {
        nom: texte('nom'),
        type: texte('type').toLowerCase() || 'foodtruck',
        cuisine: texte('cuisine'),
        categorie: '',
        etiquettes: '',
        jours: '',
        lieu: texte('lieu'),
        horaires: texte('horaires'),
        prix: normaliserPrix(texte('prix')),
        paiements: '',
        site: texte('site'),
        emplacement: texte('emplacement'),
        statut: texte('statut').toLowerCase() || 'actif',
    };
    const { jours, invalides } = normaliserJours(d.jours);
    ft.jours = jours.join(';');

    const categorie = texte('categorie');
    if (categorie) {
        ft.categorie = CATEGORIES.find(c => cle(c) === cle(categorie)) || '';
        if (!ft.categorie) erreurs.push(`Catégorie inconnue : ${categorie} (choisir dans la liste).`);
    } else {
        ft.categorie = categorieDepuisCuisine(ft.cuisine);
    }
    const etiquettes = normaliserListe(d.etiquettes, ETIQUETTES);
    ft.etiquettes = etiquettes.valeurs.join(';');
    if (etiquettes.invalides.length) erreurs.push(`Étiquette(s) inconnue(s) : ${etiquettes.invalides.join(', ')}.`);
    const paiements = normaliserListe(d.paiements, PAIEMENTS);
    ft.paiements = paiements.valeurs.join(';');
    if (paiements.invalides.length) erreurs.push(`Moyen(s) de paiement inconnu(s) : ${paiements.invalides.join(', ')}.`);

    if (!ft.nom) erreurs.push('Le nom est obligatoire.');
    if (!TYPES.includes(ft.type)) erreurs.push('Le type doit être « foodtruck » ou « restaurant ».');
    if (!ft.cuisine) erreurs.push('Le type de cuisine est obligatoire.');
    if (jours.length === 0) erreurs.push('Indiquez au moins un jour entre lundi et vendredi.');
    if (invalides.length) erreurs.push(`Jour(s) non reconnu(s) : ${invalides.join(', ')} (du lundi au vendredi uniquement).`);
    if (ft.lieu && options.lieux && !options.lieux.includes(ft.lieu)) erreurs.push(`Lieu inconnu : ${ft.lieu}.`);
    if (!ft.emplacement && !ft.lieu) erreurs.push("Indiquez un lieu ou l'emplacement Google Maps.");
    if (ft.emplacement && !estUrl(ft.emplacement)) erreurs.push("L'emplacement doit être une adresse web (https://…).");
    if (ft.site && !estUrl(ft.site)) erreurs.push('Le site doit être une adresse web (https://…).');
    if (ft.prix && !/^\d+(?:[.,]\d+)?(?:-\d+(?:[.,]\d+)?)?$/.test(ft.prix)) {
        erreurs.push('Le prix doit être un nombre ou une fourchette (ex : 12 ou 10-15).');
    }
    if (!STATUTS.includes(ft.statut)) erreurs.push('Le statut doit être actif, incertain ou archive.');
    for (const [nom, max] of Object.entries(LONGUEUR_MAX)) {
        if (ft[nom].length > max) erreurs.push(`Le champ « ${nom} » dépasse ${max} caractères.`);
    }
    // Protection contre l'injection de formules si le CSV est ouvert dans Excel
    for (const nom of ['nom', 'cuisine', 'horaires']) {
        if (/^[=+\-@]/.test(ft[nom])) erreurs.push(`Le champ « ${nom} » ne peut pas commencer par = + - ou @.`);
    }
    return { foodtruck: ft, erreurs };
}

/** Valide un lieu. Retourne { lieu, erreurs }. */
function validerLieu(donnees) {
    const d = donnees || {};
    const erreurs = [];
    const lieu = {
        nom: texteDe(d, 'nom'),
        description: texteDe(d, 'description'),
        minutes_a_pied: texteDe(d, 'minutes_a_pied'),
        maps: texteDe(d, 'maps'),
    };
    if (!lieu.nom) erreurs.push('Le nom du lieu est obligatoire.');
    if (lieu.nom.length > 60) erreurs.push('Le nom du lieu dépasse 60 caractères.');
    if (lieu.description.length > 200) erreurs.push('La description dépasse 200 caractères.');
    if (lieu.minutes_a_pied && !/^\d{1,2}$/.test(lieu.minutes_a_pied)) {
        erreurs.push('Le temps de marche est un nombre de minutes (0 à 99).');
    }
    if (lieu.maps && !estUrl(lieu.maps)) erreurs.push('Le lien Maps doit être une adresse web (https://…).');
    for (const nom of ['nom', 'description']) {
        if (/^[=+\-@]/.test(lieu[nom])) erreurs.push(`Le champ « ${nom} » ne peut pas commencer par = + - ou @.`);
    }
    return { lieu, erreurs };
}

/** « Parking Nord » -> « parking-nord » (identifiant lisible d'un lieu). */
function slug(texte) {
    return cle(texte).replace(/ /g, '-').slice(0, 30) || 'lieu';
}

module.exports = {
    JOURS, TYPES, STATUTS, CATEGORIES, ETIQUETTES, PAIEMENTS,
    normaliserJours, normaliserListe, normaliserPrix, estUrl, categorieDepuisCuisine,
    validerFoodtruck, validerLieu, slug,
};
