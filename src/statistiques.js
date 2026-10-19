'use strict';

// Calcul des statistiques à partir des journaux usage.log et acces.log.

const { JOURS } = require('./validation');

// Libellé affiché <- début de l'évènement journalisé (historique compris).
const ACTIONS = [
    ["Clic sur l'envoi de mail", 'Clic sur « Envoyez-moi un mail »'],
    ['Clic sur suggérer foodtruck', 'Ouverture du formulaire de suggestion'],
    ['Clic sur envoyer foodtruck : succès', 'Suggestion envoyée'],
    ['Clic sur envoyer foodtruck : erreur', 'Suggestion refusée (erreur de saisie)'],
    ['Clic sur generer CSV', 'Génération de ligne CSV (ancienne page)'],
    ['Ajout de :', 'Ajout manuel par un administrateur'],
    ['Admin clic sur Valider foodtruck', 'Suggestion validée'],
    ['Admin clic sur Supprimer foodtruck', 'Suggestion rejetée'],
    ['Admin modification foodtruck', 'Foodtruck modifié'],
    ['Admin suppression foodtruck publié', 'Foodtruck retiré de la liste'],
];

/** Date locale AAAA-MM-JJ d'un horodatage ISO. */
function dateLocale(horodatage) {
    const d = new Date(horodatage);
    if (Number.isNaN(d.getTime())) return null;
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Garde les entrées comprises entre `debut` et `fin` (AAAA-MM-JJ, inclus, facultatifs). */
function filtrerParDate(entrees, debut, fin) {
    return entrees.filter(e => {
        const jour = dateLocale(e.timestamp);
        if (!jour) return false;
        if (debut && jour < debut) return false;
        if (fin && jour > fin) return false;
        return true;
    });
}

function incrementer(objet, cle) {
    objet[cle] = (objet[cle] || 0) + 1;
}

function statistiquesUsage(entrees) {
    const stats = {
        jours: Object.fromEntries(JOURS.map(j => [j, 0])),
        tris: {},
        pages: {},
        actions: Object.fromEntries(ACTIONS.map(([, libelle]) => [libelle, 0])),
        foodtrucksConsultes: {},
        total: 0,
    };
    for (const { event } of entrees) {
        if (typeof event !== 'string') continue;
        stats.total++;
        if (event.startsWith('Jour sélectionné : ')) {
            const jour = event.slice('Jour sélectionné : '.length);
            if (jour in stats.jours) stats.jours[jour]++;
        } else if (event.startsWith('Tri sur la colonne : ')) {
            incrementer(stats.tris, event.slice('Tri sur la colonne : '.length));
        } else if (event.startsWith('Clic sur la page ')) {
            incrementer(stats.pages, event.slice('Clic sur la page '.length));
        } else if (event.startsWith('Consultation : ')) {
            incrementer(stats.foodtrucksConsultes, event.slice('Consultation : '.length));
        } else {
            const action = ACTIONS.find(([prefixe]) => event.startsWith(prefixe));
            if (action) stats.actions[action[1]]++;
        }
    }
    return stats;
}

function navigateur(ua) {
    if (!ua) return 'Inconnu';
    if (/Edg\//.test(ua)) return 'Edge';
    if (/OPR\//.test(ua)) return 'Opera';
    if (/Firefox\//.test(ua)) return 'Firefox';
    if (/Chrome\//.test(ua)) return 'Chrome';
    if (/Safari\//.test(ua)) return 'Safari';
    if (/curl|bot|spider|crawl/i.test(ua)) return 'Robot / outil';
    return 'Autre';
}

function estPage(url) {
    const chemin = String(url).split('?')[0];
    return chemin === '/' || chemin.endsWith('.html') || chemin === '/admin' || chemin === '/admin/';
}

// Remarque : avant la v3, les pages HTML n'étaient pas journalisées (servies avant le journal) ;
// visiteurs, heures et navigateurs sont donc calculés sur toutes les requêtes pour couvrir l'historique.
function statistiquesAcces(entrees) {
    const requetes = entrees.filter(e => e.url); // les anciennes lignes « duration » seules sont ignorées
    const pages = requetes.filter(e => estPage(e.url) && (e.method || 'GET') === 'GET');
    const stats = {
        totalRequetes: requetes.length,
        pagesVues: pages.length,
        visiteursUniques: new Set(requetes.map(e => e.ip)).size,
        pagesVuesParPage: {},
        activiteParHeure: Array(24).fill(0),
        activiteParJourSemaine: Object.fromEntries([...JOURS, 'Samedi', 'Dimanche'].map(j => [j, 0])),
        pagesVuesParDate: {},
        visiteursParDate: {},
        navigateurs: {},
    };
    const nomsJours = ['Dimanche', ...JOURS, 'Samedi'];
    const visiteursParDate = {};
    const ipsParNavigateur = {};
    for (const e of pages) {
        const chemin = String(e.url).split('?')[0];
        incrementer(stats.pagesVuesParPage, chemin === '/' ? '/index.html' : chemin);
        const jour = dateLocale(e.timestamp);
        if (jour) incrementer(stats.pagesVuesParDate, jour);
    }
    for (const e of requetes) {
        const d = new Date(e.timestamp);
        if (!Number.isNaN(d.getTime())) {
            stats.activiteParHeure[d.getHours()]++;
            stats.activiteParJourSemaine[nomsJours[d.getDay()]]++;
            const jour = dateLocale(e.timestamp);
            (visiteursParDate[jour] = visiteursParDate[jour] || new Set()).add(e.ip);
        }
        if (e.userAgent) (ipsParNavigateur[navigateur(e.userAgent)] = ipsParNavigateur[navigateur(e.userAgent)] || new Set()).add(e.ip);
    }
    for (const [jour, ips] of Object.entries(visiteursParDate)) stats.visiteursParDate[jour] = ips.size;
    for (const [nav, ips] of Object.entries(ipsParNavigateur)) stats.navigateurs[nav] = ips.size;
    if (!stats.activiteParJourSemaine.Samedi && !stats.activiteParJourSemaine.Dimanche) {
        delete stats.activiteParJourSemaine.Samedi;
        delete stats.activiteParJourSemaine.Dimanche;
    }
    return stats;
}

module.exports = { statistiquesUsage, statistiquesAcces, filtrerParDate, dateLocale, navigateur, ACTIONS };
