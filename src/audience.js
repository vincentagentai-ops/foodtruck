'use strict';

// Mesure d'audience anonyme :
// - cookie ft_v (identifiant aléatoire de navigateur, 13 mois, jamais prolongé) ;
// - dans les journaux, uniquement un HMAC de cet identifiant (secret serveur) ;
// - évènements typés en liste blanche ({ts, v, type, cible, page, version}) ;
// - règles d'exclusion (admin, API, erreurs, robots) et normalisation des chemins.

const crypto = require('crypto');
const path = require('path');

const NOM_COOKIE = 'ft_v';
const DUREE_COOKIE_S = 395 * 24 * 60 * 60; // ≈ 13 mois

// Évènements que les pages peuvent envoyer (POST /api/evenements)
const TYPES_PUBLICS = [
    'chargement', // affichage initial de la liste (cible : jour affiché)
    'jour_clic', // clic sur un bouton de jour (cible : jour)
    'recherche', // recherche texte (cible : texte tronqué)
    'filtre', // changement de filtre (cible : « nom=valeur »)
    'filtres_effaces',
    'tri', // cible : critère
    'hasard', // bouton « Au hasard » (cible : id tiré)
    'clic_site', // lien vers le site (cible : id)
    'clic_maps', // lien Google Maps (cible : id)
    'favori_ajout', 'favori_retrait', // cible : id
    'nouveau_clic', // clic dans l'encadré « Nouveaux cette semaine » (cible : id)
    'suggestion_ouverte', 'suggestion_erreur',
    'clic_mail',
];
// Évènements écrits uniquement par le serveur (refusés s'ils viennent d'une page)
const TYPES_SERVEUR = ['page_vue', 'suggestion', 'admin_ajout', 'admin_modification', 'admin_suppression',
    'admin_validation', 'admin_rejet', 'admin_lieu', 'ancien', 'jour_ancien', 'consultation_ancien'];

const CHEMINS_PUBLICS = ['/index.html', '/confidentialite.html'];

/** Lit l'en-tête Cookie. */
function lireCookies(entete) {
    const cookies = {};
    for (const morceau of String(entete || '').split(';')) {
        const i = morceau.indexOf('=');
        if (i > 0) cookies[morceau.slice(0, i).trim()] = morceau.slice(i + 1).trim();
    }
    return cookies;
}

const idValide = id => typeof id === 'string' && /^[A-Za-z0-9_-]{22}$/.test(id);
const nouvelIdNavigateur = () => crypto.randomBytes(16).toString('base64url'); // 128 bits

function enteteCookie(id) {
    return `${NOM_COOKIE}=${id}; Max-Age=${DUREE_COOKIE_S}; Path=/; HttpOnly; SameSite=Lax`;
}

/** HMAC de l'identifiant : seul ce condensé est écrit dans les journaux. */
function hacher(secret, id) {
    if (!id || !secret) return null;
    return crypto.createHmac('sha256', secret).update(id).digest('hex').slice(0, 32);
}

/** Chemin normalisé : sans paramètres, décodé, en minuscules ; « / » -> « /index.html ». */
function normaliserChemin(url) {
    let chemin = String(url || '').split(/[?#]/)[0];
    try { chemin = decodeURIComponent(chemin); } catch { /* encodage invalide : laissé tel quel */ }
    chemin = chemin.toLowerCase().replace(/\/{2,}/g, '/');
    if (!chemin.startsWith('/')) chemin = `/${chemin}`;
    if (chemin === '/') return '/index.html';
    return chemin;
}

/** Requêtes exclues de l'audience (administration, API, journaux). */
function estExclu(chemin) {
    return chemin === '/admin' || chemin.startsWith('/admin/') || chemin.startsWith('/api/');
}

function estRobot(ua) {
    if (!ua) return true;
    return /bot|crawl|spider|slurp|curl|wget|python|java\/|go-http|okhttp|libwww|httpclient|axios|node-fetch|undici|powershell|headless|monitor|pingdom|uptime|scan|check_http|^node$/i.test(ua);
}

/** Famille de navigateur (sans version) pour la répartition des navigateurs. */
function famille(ua) {
    if (!ua) return 'Inconnu';
    if (estRobot(ua)) return 'Robot / outil';
    if (/Edg\//.test(ua)) return 'Edge';
    if (/OPR\//.test(ua)) return 'Opera';
    if (/Firefox\//.test(ua)) return 'Firefox';
    if (/Chrome\//.test(ua)) return 'Chrome';
    if (/Safari\//.test(ua)) return 'Safari';
    if (/Trident\//.test(ua)) return 'Internet Explorer';
    return 'Autre';
}

/** La requête terminée est-elle une page vue publique ? (GET, page HTML publique, succès, pas un robot) */
function estPageVue({ methode, chemin, statut, ua }) {
    if (methode !== 'GET' || estExclu(chemin) || estRobot(ua)) return false;
    if (!((statut >= 200 && statut < 300) || statut === 304)) return false; // ni erreurs ni redirections
    return CHEMINS_PUBLICS.includes(chemin);
}

function texteCourt(valeur, max) {
    if (valeur == null) return '';
    if (typeof valeur !== 'string') return null;
    return valeur.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max);
}

/**
 * Contrôle un évènement envoyé par une page. Retourne { evenement: {type, cible, page} }
 * ou { statut, erreur } (400 inconnu ou invalide, 403 type réservé au serveur).
 */
function validerEvenement(corps) {
    const c = corps && typeof corps === 'object' && !Array.isArray(corps) ? corps : {};
    if (typeof c.type !== 'string' || !c.type) return { statut: 400, erreur: 'Champ "type" manquant.' };
    if (TYPES_SERVEUR.includes(c.type)) return { statut: 403, erreur: 'Type d\'évènement réservé au serveur.' };
    if (!TYPES_PUBLICS.includes(c.type)) return { statut: 400, erreur: 'Type d\'évènement inconnu.' };
    const cible = texteCourt(c.cible, 80);
    const page = texteCourt(c.page, 100);
    if (cible === null || page === null) return { statut: 400, erreur: 'Champs "cible" et "page" : texte attendu.' };
    return { evenement: { type: c.type, cible, page: page ? normaliserChemin(page) : '' } };
}

/**
 * Anciens libellés en texte libre (usage.log avant la 3.1.0, ou anciennes pages encore en cache)
 * -> évènement typé, ou null si le libellé est ignoré (actions d'administration).
 * `recu` : libellé reçu par /api/log aujourd'hui (la suggestion est alors comptée par le serveur).
 */
function convertirAncienLibelle(texte, { recu = false } = {}) {
    const t = String(texte || '');
    const apres = prefixe => t.slice(prefixe.length).trim();
    if (/^admin/i.test(t) || /^ajout de/i.test(t)) return null;
    if (t.startsWith('Jour sélectionné : ')) return { type: 'jour_ancien', cible: apres('Jour sélectionné : ') };
    if (t.startsWith('Tri sur la colonne : ')) return { type: 'tri', cible: apres('Tri sur la colonne : ') };
    if (t.startsWith('Consultation : ')) return { type: 'consultation_ancien', cible: apres('Consultation : ') };
    if (t.startsWith('Clic sur suggérer foodtruck')) return { type: 'suggestion_ouverte', cible: '' };
    if (t.startsWith('Clic sur envoyer foodtruck : erreur')) return { type: 'suggestion_erreur', cible: '' };
    if (t.startsWith('Clic sur envoyer foodtruck : succès') && !recu) return { type: 'suggestion', cible: '' };
    if (t.startsWith("Clic sur l'envoi de mail")) return { type: 'clic_mail', cible: '' };
    return { type: 'ancien', cible: t.slice(0, 120) };
}

/** /api/log : les libellés d'administration et d'ajout ne sont plus acceptés depuis une page. */
function ancienLibelleAccepte(texte) {
    return !/^\s*admin/i.test(texte) && !/^\s*ajout de/i.test(texte);
}

/** Fichier mensuel : prefixe-AAAA-MM.ext (mois local). */
function fichierMensuel(dossier, prefixe, extension, date = new Date()) {
    const mois = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    return path.join(dossier, `${prefixe}-${mois}.${extension}`);
}

module.exports = {
    NOM_COOKIE, DUREE_COOKIE_S, TYPES_PUBLICS, TYPES_SERVEUR, CHEMINS_PUBLICS,
    lireCookies, idValide, nouvelIdNavigateur, enteteCookie, hacher,
    normaliserChemin, estExclu, estRobot, famille, estPageVue,
    validerEvenement, convertirAncienLibelle, ancienLibelleAccepte, fichierMensuel,
};
