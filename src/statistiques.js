'use strict';

// Statistiques d'audience (3.3.0) : agrégats calculés jour par jour, de façon incrémentale, à partir des journaux
// bruts ; la page des statistiques ne lit que ces agrégats (plus la journée en cours).
//
// Sources lues :
// - usage-AAAA-MM.jsonl (3.1.0) : {ts, v, type, cible, page, version[, nav]} — v = HMAC du cookie ft_v ;
// - acces-AAAA-MM.log (3.1.0)   : journal technique (IP, URL, statut, durée) — ne sert plus à l'audience ;
// - usage.log et acces.log (avant la 3.1.0) : anciens libellés, visiteurs comptés par adresse IP.
//
// Fichiers écrits :
// - stats-jours.json : agrégats SANS identifiant, conservés sans limite : jours, semaines ISO, mois, cohortes
//   hebdomadaires, marqueurs de version, date du dernier jour traité ;
// - stats-etat.json  : état interne du calcul incrémental (empreinte de navigateur -> première et dernière date
//   d'activité). Jamais lu par l'API ni exporté ; une empreinte inactive depuis 13 mois en est retirée (comme les
//   journaux bruts, purgés après 13 mois).
//
// Chaque jour terminé est traité une seule fois, dans l'ordre des dates : « calcul complet » (tout reprendre depuis
// les journaux bruts) et « calcul incrémental » (reprendre au lendemain du dernier jour traité) donnent les mêmes
// agrégats. Les journées sont découpées en visites (pause de plus de 30 min), coupées à minuit.

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const {
    normaliserChemin, estPageVue, famille, convertirAncienLibelle,
} = require('./audience');
const { JOURS } = require('./validation');

const VERSION_AGREGATS = 2;
const PAUSE_VISITE_MS = 30 * 60 * 1000;
const COHORTE_SEMAINES_MAX = 26;
const MOIS_OUBLI = 13; // empreinte oubliée après 13 mois sans activité (durée du cookie)

// Fonctionnalités : une visite « utilise » une fonctionnalité si elle contient l'un de ces évènements
const FONCTIONNALITES = {
    recherche: ['recherche', 'recherche_vide'],
    filtres: ['filtre', 'filtres_effaces'],
    tri: ['tri'],
    jour: ['jour_clic'],
    hasard: ['hasard'],
    favoris: ['favori_ajout', 'favori_retrait'],
    fiche: ['fiche_ouverte'],
    historique: ['historique_ouvert'],
    nouveautes: ['nouveau_clic', 'quoi_de_neuf_clic'],
    maps: ['clic_maps'],
    site: ['clic_site'],
    ajout: ['ajout_ouvert'],
    modification: ['modification_ouverte'],
};
// Contributions comptées par le serveur (sans identifiant de navigateur)
const TYPES_CONTRIBUTION = ['suggestion', 'ajout', 'modification', 'restauration', 'avis', 'avis_modifie', 'presence', 'signalement'];

/** Date et heure locales d'un horodatage ISO. */
function dateEtHeure(horodatage) {
    const d = new Date(horodatage);
    if (Number.isNaN(d.getTime())) return null;
    const p = n => String(n).padStart(2, '0');
    return { date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, heure: d.getHours(), t: d.getTime() };
}

function dateLocale(horodatage) {
    const r = dateEtHeure(horodatage);
    return r && r.date;
}

/** Ajoute `n` jours à une date AAAA-MM-JJ. */
function decalerJours(date, n) {
    const [a, m, j] = date.split('-').map(Number);
    const d = new Date(Date.UTC(a, m - 1, j + n));
    return d.toISOString().slice(0, 10);
}

/** Nombre de jours de `a` à `b`. */
function ecartJours(a, b) {
    const t = d => { const [y, m, j] = d.split('-').map(Number); return Date.UTC(y, m - 1, j); };
    return Math.round((t(b) - t(a)) / 86400000);
}

/** Semaine ISO d'une date AAAA-MM-JJ : { cle: 'AAAA-Sww', debut (lundi), fin (dimanche) }. */
function semaine(date) {
    const [a, m, j] = date.split('-').map(Number);
    const d = new Date(Date.UTC(a, m - 1, j));
    const numeroJour = d.getUTCDay() || 7;
    const lundi = decalerJours(date, 1 - numeroJour);
    d.setUTCDate(d.getUTCDate() + 4 - numeroJour); // jeudi de la semaine : donne l'année ISO
    const annee = d.getUTCFullYear();
    const numero = Math.ceil(((d - Date.UTC(annee, 0, 1)) / 86400000 + 1) / 7);
    return { cle: `${annee}-S${String(numero).padStart(2, '0')}`, debut: lundi, fin: decalerJours(lundi, 6) };
}

/** Mois d'une date : { cle: 'AAAA-MM', debut, fin }. */
function mois(date) {
    const [a, m] = date.split('-').map(Number);
    const fin = new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10);
    return { cle: date.slice(0, 7), debut: `${date.slice(0, 7)}-01`, fin };
}

/** Moins `n` mois (date AAAA-MM-JJ ; le jour est ramené à la fin du mois si besoin). */
function moinsMois(date, n) {
    const [a, m, j] = date.split('-').map(Number);
    const total = a * 12 + (m - 1) - n;
    const annee = Math.floor(total / 12);
    const moisCible = total % 12;
    const dernier = new Date(Date.UTC(annee, moisCible + 1, 0)).getUTCDate();
    return `${annee}-${String(moisCible + 1).padStart(2, '0')}-${String(Math.min(j, dernier)).padStart(2, '0')}`;
}

/** Jour de la semaine d'une date : 0 = lundi … 6 = dimanche. */
function jourSemaine(date) {
    const [a, m, j] = date.split('-').map(Number);
    return (new Date(Date.UTC(a, m - 1, j)).getUTCDay() + 6) % 7;
}

function incrementer(objet, cle, n = 1) {
    objet[cle] = (objet[cle] || 0) + n;
}

const arrondi = (x, d = 1) => Math.round(x * 10 ** d) / 10 ** d;

// --- Lecture des journaux bruts -> faits

/** Entrée de usage-AAAA-MM.jsonl -> fait. */
function faitDepuisUsage(e) {
    const dh = e && typeof e.type === 'string' && dateEtHeure(e.ts);
    if (!dh) return null;
    return { ...dh, source: 'navigateur', id: e.v || null, type: e.type, cible: e.cible || '', page: e.page || '', nav: e.nav || '' };
}

/** Entrée de l'ancien usage.log ({timestamp, ip, event}) -> fait (ou null). */
function faitDepuisAncienUsage(e) {
    const dh = e && typeof e.event === 'string' && dateEtHeure(e.timestamp);
    if (!dh) return null;
    const ev = convertirAncienLibelle(e.event);
    if (!ev) return null;
    return { ...dh, source: 'ip', id: e.ip || null, type: ev.type, cible: ev.cible, page: '', nav: '' };
}

/** Entrée de l'ancien acces.log -> page vue (ou null). Les lignes sans statut (avant la v3) sont des appels d'API. */
function faitDepuisAncienAcces(e) {
    const dh = e && e.url && dateEtHeure(e.timestamp);
    if (!dh) return null;
    const chemin = normaliserChemin(e.url);
    const statut = e.status === undefined ? 200 : Number(e.status);
    if (!estPageVue({ methode: e.method || 'GET', chemin, statut, ua: e.userAgent })) return null;
    return { ...dh, source: 'ip', id: e.ip || null, type: 'page_vue', cible: '', page: chemin, nav: famille(e.userAgent) };
}

/** Ligne de journal d'accès (ancien ou mensuel) -> mesure technique. */
function techniqueDepuisAcces(e) {
    const dh = e && e.url && dateEtHeure(e.timestamp);
    if (!dh) return null;
    return { date: dh.date, statut: Number(e.status) || 0, duree: Number(e.durationMs) || 0 };
}

const estAdmin = type => type.startsWith('admin_');

// --- Calcul incrémental, jour par jour

function jourVide() {
    return {
        pagesVues: 0, pages: {}, actifs: 0, actifs7j: 0, actifsIp: 0, nouveaux: 0, visites: 0, heures: Array(24).fill(0),
        navigateurs: {}, evenements: {}, joursConsultes: {}, consultations: {}, fonctionnalites: {},
        entonnoir: { fiche: 0, ficheClic: 0, clicSansFiche: 0 }, recherchesVides: {},
        technique: { requetes: 0, erreurs: 0, dureeTotaleMs: 0 },
    };
}

function agregatsVides() {
    return { version: VERSION_AGREGATS, traiteJusqua: null, jours: {}, semaines: {}, mois: {}, cohortes: {}, versions: [] };
}

/** État interne : navigateurs {empreinte: {p: première date, d: dernière date, a: 1 si administrateur}}, ips {condensé: dernière date}. */
function etatVide() {
    return { version: VERSION_AGREGATS, traiteJusqua: null, navigateurs: {}, ips: {} };
}

const condenseIp = ip => crypto.createHash('sha256').update(String(ip)).digest('hex').slice(0, 16);

function periode(table, p) {
    return table[p.cle] || (table[p.cle] = { debut: p.debut, fin: p.fin, actifs: 0, actifsIp: 0, nouveaux: 0, retenus: 0 });
}

/** Découpe les faits d'un navigateur (triés) en visites : pause de plus de 30 minutes = nouvelle visite. */
function visites(faits) {
    const resultat = [];
    let courante = null;
    let dernier = -Infinity;
    for (const f of faits) {
        if (!courante || f.t - dernier > PAUSE_VISITE_MS) {
            courante = new Set();
            resultat.push(courante);
        }
        courante.add(f.type);
        dernier = f.t;
    }
    return resultat;
}

/**
 * Traite UN jour terminé (ou la journée en cours, sur une copie) : ajoute son agrégat à `agregats`
 * (jour, semaine, mois, cohortes) et met à jour `etat`. `faits` et `techniques` : ceux de ce jour.
 */
function traiterJour(agregats, etat, date, faits, techniques) {
    const j = jourVide();
    const tries = [...faits].sort((a, b) => a.t - b.t);

    // Navigateurs d'administration : une empreinte qui a fait une action d'administration est exclue de l'audience
    // à partir de ce jour (pages publiques consultées par l'administrateur comprises).
    for (const f of tries) {
        if (f.source === 'navigateur' && f.id && estAdmin(f.type)) {
            const e = etat.navigateurs[f.id] || (etat.navigateurs[f.id] = { p: null, d: null });
            e.a = 1;
        }
    }
    const estNavAdmin = f => f.source === 'navigateur' && f.id && etat.navigateurs[f.id] && etat.navigateurs[f.id].a;

    const navs = new Set();
    const ips = new Set();
    const heures = Array.from({ length: 24 }, () => new Set());
    const familles = {};
    const parNavigateur = new Map();
    for (const f of tries) {
        if (estNavAdmin(f) && !estAdmin(f.type)) continue;
        if (f.type === 'page_vue') {
            j.pagesVues++;
            incrementer(j.pages, f.page || '?');
        } else {
            incrementer(j.evenements, f.type);
        }
        if (f.type === 'jour_clic' && JOURS.includes(f.cible)) incrementer(j.joursConsultes, f.cible);
        if (f.type === 'recherche_vide' && f.cible) incrementer(j.recherchesVides, String(f.cible).toLowerCase().trim().slice(0, 30));
        if (['clic_site', 'clic_maps', 'consultation_ancien', 'fiche_ouverte'].includes(f.type) && f.cible) {
            const cle = f.type === 'consultation_ancien' ? `nom:${f.cible}` : f.cible;
            const c = j.consultations[cle] || (j.consultations[cle] = { fiche: 0, site: 0, maps: 0, autres: 0 });
            if (f.type === 'clic_site') c.site++;
            else if (f.type === 'clic_maps') c.maps++;
            else if (f.type === 'fiche_ouverte') c.fiche++;
            else c.autres++;
        }
        if (!f.id || estAdmin(f.type)) continue;
        (f.source === 'navigateur' ? navs : ips).add(f.id);
        heures[f.heure].add(`${f.source}:${f.id}`);
        if (f.type === 'page_vue' && f.nav) (familles[f.nav] = familles[f.nav] || new Set()).add(`${f.source}:${f.id}`);
        if (f.source === 'navigateur') {
            if (!parNavigateur.has(f.id)) parNavigateur.set(f.id, []);
            parNavigateur.get(f.id).push(f);
        }
    }
    for (const t of techniques) {
        j.technique.requetes++;
        if (t.statut >= 400) j.technique.erreurs++;
        j.technique.dureeTotaleMs += t.duree;
    }

    // Visites, fonctionnalités utilisées, entonnoir
    for (const liste of parNavigateur.values()) {
        for (const types of visites(liste)) {
            j.visites++;
            for (const [nom, declencheurs] of Object.entries(FONCTIONNALITES)) {
                if (declencheurs.some(t => types.has(t))) incrementer(j.fonctionnalites, nom);
            }
            const fiche = types.has('fiche_ouverte');
            const clic = types.has('clic_maps') || types.has('clic_site');
            if (fiche) j.entonnoir.fiche++;
            if (fiche && clic) j.entonnoir.ficheClic++;
            if (!fiche && clic) j.entonnoir.clicSansFiche++;
        }
    }

    // Nouveaux, semaines, mois (navigateurs distincts, retour à S+1 / M+1), cohortes
    const s = semaine(date);
    const sPrec = semaine(decalerJours(s.debut, -7));
    const m = mois(date);
    const mPrec = mois(decalerJours(m.debut, -1));
    for (const id of navs) {
        const e = etat.navigateurs[id] || (etat.navigateurs[id] = { p: null, d: null });
        if (!e.p) { e.p = date; j.nouveaux++; }
        const avant = e.d && e.d < date ? e.d : null; // dernière activité avant aujourd'hui
        if (!avant || avant < s.debut) {
            const w = periode(agregats.semaines, s);
            w.actifs++;
            if (e.p >= s.debut) w.nouveaux++;
            if (avant && avant >= sPrec.debut) w.retenus++;
            const c = semaine(e.p);
            const k = Math.round(ecartJours(c.debut, s.debut) / 7);
            if (k <= COHORTE_SEMAINES_MAX) {
                const cohorte = agregats.cohortes[c.cle] || (agregats.cohortes[c.cle] = { debut: c.debut, taille: 0, semaines: [] });
                if (k === 0) cohorte.taille++;
                while (cohorte.semaines.length <= k) cohorte.semaines.push(0);
                cohorte.semaines[k]++;
            }
        }
        if (!avant || avant < m.debut) {
            const p = periode(agregats.mois, m);
            p.actifs++;
            if (e.p >= m.debut) p.nouveaux++;
            if (avant && avant >= mPrec.debut) p.retenus++;
        }
        e.d = date;
    }
    for (const ip of ips) {
        const h = condenseIp(ip);
        const avant = etat.ips[h];
        if (!avant || avant < s.debut) periode(agregats.semaines, s).actifsIp++;
        if (!avant || avant < m.debut) periode(agregats.mois, m).actifsIp++;
        etat.ips[h] = date;
    }
    // Empreintes de l'administration : dernière activité tenue à jour (pour l'oubli à 13 mois)
    for (const f of tries) if (estNavAdmin(f)) etat.navigateurs[f.id].d = date;

    j.actifs = navs.size;
    j.actifsIp = ips.size;
    j.heures = heures.map(h => h.size);
    for (const [nav, ids] of Object.entries(familles)) j.navigateurs[nav] = ids.size;

    // Actifs sur 7 jours glissants (ce jour compris) et oubli des empreintes inactives depuis 13 mois
    const debut7 = decalerJours(date, -6);
    const oubli = moinsMois(date, MOIS_OUBLI);
    for (const [id, e] of Object.entries(etat.navigateurs)) {
        if (e.d && e.d < oubli) { delete etat.navigateurs[id]; continue; }
        if (!e.a && e.d && e.d >= debut7) j.actifs7j++;
    }
    for (const [h, d] of Object.entries(etat.ips)) if (d < oubli) delete etat.ips[h];

    if (faits.length || techniques.length || j.actifs7j) agregats.jours[date] = j;
    etat.traiteJusqua = date;
    agregats.traiteJusqua = date;
}

/** Regroupe faits et mesures techniques par date. */
function parDate(faits, techniques) {
    const f = new Map();
    const t = new Map();
    for (const x of faits) { if (!f.has(x.date)) f.set(x.date, []); f.get(x.date).push(x); }
    for (const x of techniques) { if (!t.has(x.date)) t.set(x.date, []); t.get(x.date).push(x); }
    return { f, t };
}

/**
 * Fait avancer le calcul jusqu'à `jusqua` inclus (jour par jour, à partir du lendemain du dernier jour traité,
 * ou de la première donnée). Modifie `agregats` et `etat`.
 */
function avancer(agregats, etat, faits, techniques, jusqua) {
    const { f, t } = parDate(faits, techniques);
    let date = etat.traiteJusqua ? decalerJours(etat.traiteJusqua, 1) : [...f.keys(), ...t.keys()].sort()[0];
    if (!date) return;
    for (; date <= jusqua; date = decalerJours(date, 1)) traiterJour(agregats, etat, date, f.get(date) || [], t.get(date) || []);
}

/**
 * Ajoute la journée en cours (non terminée) à une COPIE des agrégats : utilisée pour l'affichage, jamais enregistrée.
 */
function avecJourneeEnCours(agregats, etat, aujourdhui, faits, techniques) {
    const copie = structuredClone(agregats);
    const traite = copie.traiteJusqua;
    traiterJour(copie, structuredClone(etat), aujourdhui, faits, techniques);
    copie.traiteJusqua = traite; // la journée en cours n'est pas terminée
    return copie;
}

/**
 * Calcul complet à partir des faits bruts, tel qu'il apparaît le jour `aujourdhui` : jours terminés traités dans
 * l'ordre, puis journée en cours. Sans `aujourdhui` : tous les jours jusqu'à la dernière donnée, tous terminés.
 */
function calculerAgregats(faits, techniques = [], aujourdhui = null) {
    const agregats = agregatsVides();
    const etat = etatVide();
    if (!aujourdhui) {
        const fin = [...faits.map(f => f.date), ...techniques.map(x => x.date)].sort().pop();
        if (fin) avancer(agregats, etat, faits, techniques, fin);
        return agregats;
    }
    const hier = decalerJours(aujourdhui, -1);
    avancer(agregats, etat, faits.filter(f => f.date <= hier), techniques.filter(t => t.date <= hier), hier);
    if (!etat.traiteJusqua) { etat.traiteJusqua = hier; agregats.traiteJusqua = hier; }
    return avecJourneeEnCours(agregats, etat, aujourdhui, faits.filter(f => f.date === aujourdhui), techniques.filter(t => t.date === aujourdhui));
}

// --- Lecture des agrégats pour une période

const PERIODE_VIDE = { actifsJour: 0, actifsSemaine: 0, nouveaux: 0, visites: 0, pagesVues: 0, retourS1: null, contributions: 0 };

/** Tuiles principales d'une période [debut, fin] (bornes incluses). */
function tuiles(agregats, debut, fin) {
    const r = { ...PERIODE_VIDE };
    const dates = Object.keys(agregats.jours).filter(d => d >= debut && d <= fin);
    let sommeActifs = 0;
    let joursActifs = 0;
    let somme7j = 0;
    for (const d of dates) {
        const j = agregats.jours[d];
        if (j.actifs > 0) { joursActifs++; sommeActifs += j.actifs; }
        somme7j += j.actifs7j || 0;
        r.nouveaux += j.nouveaux;
        r.visites += j.visites || 0;
        r.pagesVues += j.pagesVues;
        r.contributions += TYPES_CONTRIBUTION.reduce((s, type) => s + (j.evenements[type] || 0), 0);
    }
    // Moyenne glissante sur 7 jours : sur tous les jours de la période couverts par la mesure (week-ends compris)
    const toutes = Object.keys(agregats.jours).sort();
    const debutCouvert = toutes.length && toutes[0] > debut ? toutes[0] : debut;
    const finCouverte = toutes.length && toutes[toutes.length - 1] < fin ? toutes[toutes.length - 1] : fin;
    const nbJours = toutes.length && debutCouvert <= finCouverte ? ecartJours(debutCouvert, finCouverte) + 1 : 0;
    r.actifsJour = joursActifs ? arrondi(sommeActifs / joursActifs) : 0;
    r.actifsSemaine = nbJours ? arrondi(somme7j / nbJours) : 0;
    r.retourS1 = retour(agregats, debut, fin);
    return r;
}

/** Retour à S+1 : navigateurs actifs une semaine et revenus la suivante, pour les semaines de la période dont la suivante est connue. */
function retour(agregats, debut, fin) {
    let base = 0;
    let revenus = 0;
    for (const s of Object.values(agregats.semaines)) {
        if (s.fin < debut || s.debut > fin || !s.actifs) continue;
        const suivante = semaine(decalerJours(s.debut, 7));
        if (!agregats.traiteJusqua || suivante.fin > agregats.traiteJusqua) continue; // semaine suivante pas terminée
        base += s.actifs;
        revenus += (agregats.semaines[suivante.cle] || {}).retenus || 0;
    }
    return base ? { taux: Math.round(revenus / base * 100), revenus, base } : null;
}

/**
 * Statistiques d'une période [debut, fin] (bornes facultatives) à partir des agrégats.
 * `options.precedente` : compare les tuiles à la période précédente de même durée.
 */
function construireStatistiques(agregats, debut, fin, options = {}) {
    const dates = Object.keys(agregats.jours).sort();
    const d0 = debut || dates[0] || '0000-01-01';
    const d1 = fin || dates[dates.length - 1] || '9999-12-31';
    const dansPeriode = d => d >= d0 && d <= d1;
    const recouvre = p => p.fin >= d0 && p.debut <= d1;
    const r = {
        periode: {
            debut: debut || null,
            fin: fin || null,
            precedente: null,
            premiereDonnee: dates[0] || null,
            derniereDonnee: dates[dates.length - 1] || null,
            debutNavigateurs: dates.find(d => agregats.jours[d].actifs > 0) || null,
            traiteJusqua: agregats.traiteJusqua || null,
        },
        tuiles: tuiles(agregats, d0, d1),
        precedente: null,
        totaux: { pagesVues: 0, nouveaux: 0, visites: 0, suggestions: 0, contributions: 0, actifsMoyenJour: 0, actifsMoyenSemaine: 0, actifsMoyenMois: 0, joursActifs: 0 },
        jours: [], semaines: [], mois: [], cohortes: [],
        pages: {}, heures: Array(24).fill(0), carteChaleur: Array.from({ length: 7 }, () => Array(24).fill(0)),
        navigateurs: {}, evenements: {}, joursConsultes: {}, consultations: {}, fonctionnalites: {},
        entonnoir: { visites: 0, fiche: 0, ficheClic: 0, clicSansFiche: 0 }, recherchesVides: [],
        technique: { requetes: 0, erreurs: 0, dureeMoyenneMs: 0 },
        versions: (agregats.versions || []).slice(),
    };
    if (debut && fin && options.precedente !== false) {
        const n = ecartJours(debut, fin) + 1;
        const p = { debut: decalerJours(debut, -n), fin: decalerJours(debut, -1) };
        r.periode.precedente = p;
        r.precedente = tuiles(agregats, p.debut, p.fin);
    }
    let dureeTotale = 0;
    const recherches = {};
    const contributionsParSemaine = {};
    for (const d of dates.filter(dansPeriode)) {
        const j = agregats.jours[d];
        const contributions = TYPES_CONTRIBUTION.reduce((s, type) => s + (j.evenements[type] || 0), 0);
        r.jours.push({ date: d, actifs: j.actifs, actifs7j: j.actifs7j || 0, nouveaux: j.nouveaux, visites: j.visites || 0,
            pagesVues: j.pagesVues, actifsIp: j.actifsIp, contributions });
        r.totaux.pagesVues += j.pagesVues;
        r.totaux.nouveaux += j.nouveaux;
        r.totaux.visites += j.visites || 0;
        if (j.actifs > 0) r.totaux.joursActifs++;
        for (const [k, n] of Object.entries(j.pages)) incrementer(r.pages, k, n);
        const js = jourSemaine(d);
        j.heures.forEach((n, h) => { r.heures[h] += n; r.carteChaleur[js][h] += n; });
        for (const [k, n] of Object.entries(j.navigateurs)) incrementer(r.navigateurs, k, n);
        for (const [k, n] of Object.entries(j.evenements)) incrementer(r.evenements, k, n);
        for (const [k, n] of Object.entries(j.joursConsultes)) incrementer(r.joursConsultes, k, n);
        for (const [k, n] of Object.entries(j.fonctionnalites || {})) incrementer(r.fonctionnalites, k, n);
        for (const [k, n] of Object.entries(j.recherchesVides || {})) incrementer(recherches, k, n);
        for (const [k, c] of Object.entries(j.consultations)) {
            const t = r.consultations[k] || (r.consultations[k] = { fiche: 0, site: 0, maps: 0, autres: 0 });
            t.fiche += c.fiche || 0; t.site += c.site; t.maps += c.maps; t.autres += c.autres;
        }
        if (j.entonnoir) for (const k of ['fiche', 'ficheClic', 'clicSansFiche']) r.entonnoir[k] += j.entonnoir[k];
        const cle = semaine(d).cle;
        const cs = contributionsParSemaine[cle] || (contributionsParSemaine[cle] = {});
        for (const type of TYPES_CONTRIBUTION) if (j.evenements[type]) incrementer(cs, type, j.evenements[type]);
        r.technique.requetes += j.technique.requetes;
        r.technique.erreurs += j.technique.erreurs;
        dureeTotale += j.technique.dureeTotaleMs;
    }
    r.entonnoir.visites = r.totaux.visites;
    r.recherchesVides = Object.entries(recherches).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 30)
        .map(([texte, n]) => ({ texte, n }));
    r.totaux.suggestions = (r.evenements.suggestion || 0) + (r.evenements.ajout || 0);
    r.totaux.contributions = TYPES_CONTRIBUTION.reduce((s, type) => s + (r.evenements[type] || 0), 0);
    r.totaux.actifsMoyenJour = r.tuiles.actifsJour;
    r.technique.dureeMoyenneMs = r.technique.requetes ? Math.round(dureeTotale / r.technique.requetes) : 0;

    const termine = p => Boolean(agregats.traiteJusqua) && p.fin <= agregats.traiteJusqua;
    r.semaines = Object.keys(agregats.semaines).sort().map(cle => ({ semaine: cle, ...agregats.semaines[cle] })).filter(recouvre)
        .map(s => {
            const suivante = agregats.semaines[semaine(decalerJours(s.debut, 7)).cle];
            const suivanteTerminee = termine(semaine(decalerJours(s.debut, 7)));
            return {
                ...s, recurrents: s.actifs - s.nouveaux, complete: termine(s),
                retourS1: suivanteTerminee && s.actifs ? Math.round(((suivante || {}).retenus || 0) / s.actifs * 100) : null,
                contributions: contributionsParSemaine[s.semaine] || {},
            };
        });
    r.mois = Object.keys(agregats.mois).sort().map(cle => ({ mois: cle, ...agregats.mois[cle] })).filter(recouvre)
        .map(m => {
            const suivant = mois(decalerJours(m.fin, 1));
            return { ...m, recurrents: m.actifs - m.nouveaux, complete: termine(m),
                retourM1: termine(suivant) && m.actifs ? Math.round(((agregats.mois[suivant.cle] || {}).retenus || 0) / m.actifs * 100) : null };
        });
    // Cohortes : semaines de première visite comprises dans la période (les 12 plus récentes)
    r.cohortes = Object.keys(agregats.cohortes).sort()
        .map(cle => ({ semaine: cle, ...agregats.cohortes[cle] }))
        .filter(c => c.debut >= semaine(d0).debut && c.debut <= d1 && c.taille > 0)
        .slice(-12)
        .map(c => ({ ...c, semaines: c.semaines.slice(0, 9), observees: Math.max(0, Math.min(9,
            agregats.traiteJusqua ? Math.floor((ecartJours(c.debut, agregats.traiteJusqua) + 1) / 7) : 0)) }));
    const moyenne = l => {
        const avec = l.filter(p => p.actifs > 0);
        return avec.length ? arrondi(avec.reduce((s, p) => s + p.actifs, 0) / avec.length) : 0;
    };
    r.totaux.actifsMoyenSemaine = moyenne(r.semaines);
    r.totaux.actifsMoyenMois = moyenne(r.mois);
    return r;
}

/**
 * Contributeurs (à partir des fichiers de contributions, jeton d'auteur, jamais renvoyé) sur [debut, fin] :
 * { contributeurs, nouveaux, revenus14, mesures14, enObservation, parSemaine: {cle: n} }.
 * `activites` : [{date, auteur}] ; `aujourdhui` : pour savoir si la fenêtre de 14 jours est écoulée.
 */
function statistiquesContributeurs(activites, debut, fin, aujourdhui) {
    const d0 = debut || '0000-01-01';
    const d1 = fin || '9999-12-31';
    const parAuteur = new Map();
    for (const a of activites) {
        if (!a || !a.date || !a.auteur) continue;
        if (!parAuteur.has(a.auteur)) parAuteur.set(a.auteur, new Set());
        parAuteur.get(a.auteur).add(a.date);
    }
    const r = { contributeurs: 0, nouveaux: 0, revenus14: 0, mesures14: 0, enObservation: 0, parSemaine: {} };
    const parSemaine = {};
    for (const dates of parAuteur.values()) {
        const triees = [...dates].sort();
        const dansPeriode = triees.filter(d => d >= d0 && d <= d1);
        if (dansPeriode.length) r.contributeurs++;
        for (const cle of new Set(dansPeriode.map(d => semaine(d).cle))) incrementer(parSemaine, cle);
        const premiere = triees[0];
        if (premiere < d0 || premiere > d1) continue;
        r.nouveaux++;
        const limite = decalerJours(premiere, 14);
        if (limite >= aujourdhui) { r.enObservation++; continue; }
        r.mesures14++;
        if (triees.some(d => d > premiere && d <= limite)) r.revenus14++;
    }
    r.parSemaine = parSemaine;
    r.tauxRetour14 = r.mesures14 ? Math.round(r.revenus14 / r.mesures14 * 100) : null;
    return r;
}

// --- Fichiers

/** Journaux bruts présents dans le dossier de données. */
async function listerJournaux(config) {
    let noms = [];
    try { noms = await fs.readdir(config.dossierDonnees); } catch { /* dossier absent */ }
    const mensuels = (prefixe, ext) => noms
        .filter(n => new RegExp(`^${prefixe}-\\d{4}-\\d{2}\\.${ext}$`).test(n)).sort()
        .map(n => ({ fichier: path.join(config.dossierDonnees, n), mois: n.slice(prefixe.length + 1, prefixe.length + 8) }));
    return {
        usage: mensuels('usage', 'jsonl'),
        acces: mensuels('acces', 'log'),
        ancienUsage: noms.includes(path.basename(config.fichierUsage)) ? config.fichierUsage : null,
        ancienAcces: noms.includes(path.basename(config.fichierAcces)) ? config.fichierAcces : null,
    };
}

class Statistiques {
    constructor(stockage, options = {}) {
        this.stockage = stockage;
        this.config = stockage.config;
        this.journal = options.journal || console;
        this.fichierEtat = path.join(this.config.dossierDonnees, 'stats-etat.json');
    }

    /**
     * Lit les journaux bruts et les ramène à des faits et des mesures techniques.
     * `depuis` (AAAA-MM-JJ, facultatif) : seuls les fichiers mensuels qui peuvent contenir des jours >= `depuis`
     * sont lus, et pas les anciens journaux uniques (antérieurs à la 3.1.0) ; sans `depuis`, tout est lu.
     */
    async lireFaits(depuis = null) {
        const j = await listerJournaux(this.config);
        const lire = f => this.stockage.lireJournal(f);
        const faits = [];
        const techniques = [];
        const moisMin = depuis ? depuis.slice(0, 7) : '';
        if (!depuis && j.ancienUsage) for (const e of await lire(j.ancienUsage)) { const f = faitDepuisAncienUsage(e); if (f) faits.push(f); }
        if (!depuis && j.ancienAcces) {
            for (const e of await lire(j.ancienAcces)) {
                const f = faitDepuisAncienAcces(e);
                if (f) faits.push(f);
                const t = techniqueDepuisAcces(e);
                if (t) techniques.push(t);
            }
        }
        for (const { fichier, mois: m } of j.usage) {
            if (m < moisMin) continue;
            for (const e of await lire(fichier)) { const f = faitDepuisUsage(e); if (f) faits.push(f); }
        }
        for (const { fichier, mois: m } of j.acces) {
            if (m < moisMin) continue;
            for (const e of await lire(fichier)) { const t = techniqueDepuisAcces(e); if (t) techniques.push(t); }
        }
        const garder = x => !depuis || x.date >= depuis;
        return { faits: faits.filter(garder), techniques: techniques.filter(garder) };
    }

    async lireAgregats() {
        const a = await this.stockage.lireJSON(this.config.fichierAgregats, null);
        if (!a) return agregatsVides();
        return { ...agregatsVides(), ...a, versions: Array.isArray(a.versions) ? a.versions : [] };
    }

    async lireEtat() {
        const e = await this.stockage.lireJSON(this.fichierEtat, null).catch(() => null);
        return e ? { ...etatVide(), ...e } : etatVide();
    }

    /**
     * Calcul complet (reprise depuis les journaux bruts) : à la première exécution, après la mise à jour depuis le
     * format 3.1/3.2, ou si l'état interne ne correspond plus aux agrégats. Les agrégats des périodes dont les
     * journaux bruts ont été purgés sont conservés tels quels.
     */
    async reconstruire(anciens, jusqua) {
        const { faits, techniques } = await this.lireFaits();
        const agregats = agregatsVides();
        const etat = etatVide();
        avancer(agregats, etat, faits, techniques, jusqua);
        const premiereBrute = [...faits.map(f => f.date), ...techniques.map(t => t.date)].sort()[0] || '9999-12-31';
        for (const nom of ['jours', 'semaines', 'mois', 'cohortes']) {
            for (const [cle, valeur] of Object.entries(anciens[nom] || {})) {
                const debut = nom === 'jours' ? cle : valeur.debut;
                if (debut < premiereBrute && !agregats[nom][cle]) agregats[nom][cle] = { ...(nom === 'jours' ? jourVide() : {}), ...valeur };
            }
        }
        agregats.versions = anciens.versions || [];
        if (!agregats.traiteJusqua && jusqua) { agregats.traiteJusqua = jusqua; etat.traiteJusqua = jusqua; }
        return { agregats, etat };
    }

    /**
     * Traite les jours terminés (avant `aujourdhui`) pas encore traités et enregistre agrégats et état.
     * Retourne { agregats, etat, faitsDuJour, techniquesDuJour } (les faits du jour servent à la journée en cours).
     */
    async mettreAJourAgregats(aujourdhui = dateLocale(new Date())) {
        return this.stockage.enSerie(async () => {
            const hier = decalerJours(aujourdhui, -1);
            let agregats = await this.lireAgregats();
            let etat = await this.lireEtat();
            let modifie = false;
            if (agregats.version !== VERSION_AGREGATS || etat.traiteJusqua !== agregats.traiteJusqua) {
                ({ agregats, etat } = await this.reconstruire(agregats, hier));
                modifie = true;
            }
            const depuis = etat.traiteJusqua ? decalerJours(etat.traiteJusqua, 1) : null;
            const { faits, techniques } = await this.lireFaits(depuis);
            if (!etat.traiteJusqua || etat.traiteJusqua < hier) {
                avancer(agregats, etat, faits.filter(f => f.date <= hier), techniques.filter(t => t.date <= hier), hier);
                if (!etat.traiteJusqua) { etat.traiteJusqua = hier; agregats.traiteJusqua = hier; }
                modifie = true;
            }
            if (modifie) {
                // L'état d'abord : si l'écriture des agrégats échoue, les dates ne correspondent plus et tout est
                // recalculé à la prochaine exécution.
                await this.stockage.ecrireJSON(this.fichierEtat, { ...etat, version: VERSION_AGREGATS });
                await this.stockage.ecrireJSON(this.config.fichierAgregats, { ...agregats, version: VERSION_AGREGATS, maj: new Date().toISOString() });
            }
            return {
                agregats, etat,
                faitsDuJour: faits.filter(f => f.date === aujourdhui),
                techniquesDuJour: techniques.filter(t => t.date === aujourdhui),
            };
        });
    }

    /** Agrégats enregistrés + journée en cours (calculée sur une copie, non enregistrée). */
    async agregatsAJour(aujourdhui = dateLocale(new Date())) {
        const { agregats, etat, faitsDuJour, techniquesDuJour } = await this.mettreAJourAgregats(aujourdhui);
        return avecJourneeEnCours(agregats, etat, aujourdhui, faitsDuJour, techniquesDuJour);
    }

    /** Statistiques de la période : agrégats enregistrés + journée en cours. */
    async calculer(debut, fin, aujourdhui = dateLocale(new Date()), options = {}) {
        return construireStatistiques(await this.agregatsAJour(aujourdhui), debut, fin, options);
    }

    /**
     * Marqueur de version : chaque démarrage sur une nouvelle version enregistre {version, date} dans les agrégats.
     * La première fois, les versions déjà présentes dans les journaux d'usage (champ `version`) sont reprises.
     */
    async noterVersion(version, date = dateLocale(new Date())) {
        let connues = null;
        const actuelles = (await this.lireAgregats()).versions;
        if (!actuelles.length) {
            connues = [];
            const j = await listerJournaux(this.config);
            for (const { fichier } of j.usage) {
                for (const e of await this.stockage.lireJournal(fichier)) {
                    const d = e && e.version && dateLocale(e.ts);
                    if (!d) continue;
                    const v = connues.find(x => x.version === e.version);
                    if (!v) connues.push({ version: e.version, date: d });
                    else if (d < v.date) v.date = d;
                }
            }
            connues.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
        }
        return this.stockage.enSerie(async () => {
            const agregats = await this.lireAgregats();
            const versions = agregats.versions.length ? agregats.versions : (connues || []);
            const derniere = versions[versions.length - 1];
            const ajoute = !derniere || derniere.version !== version;
            if (ajoute) versions.push({ version, date });
            if (ajoute || !agregats.versions.length) {
                await this.stockage.ecrireJSON(this.config.fichierAgregats, { ...agregats, versions });
            }
            return versions;
        });
    }

    /**
     * Purge les journaux bruts antérieurs à 13 mois. Ne supprime RIEN si les agrégats des jours concernés
     * ne sont pas écrits et relus avec succès. Avant la toute première purge, copie les journaux touchés
     * dans <sauvegardes>/journaux-avant-premiere-purge/.
     * Retourne { limite, supprimes: [fichiers], reecrits: [fichiers], raison? }.
     */
    async purger(aujourdhui = dateLocale(new Date())) {
        const limite = moinsMois(aujourdhui, this.config.moisConservationJournaux);
        const resultat = { limite, supprimes: [], reecrits: [] };
        const j = await listerJournaux(this.config);
        const moisLimite = limite.slice(0, 7);
        const aSupprimer = [...j.usage, ...j.acces].filter(f => f.mois < moisLimite).map(f => f.fichier);
        const anciensAReecrire = [];
        // Jours dont des données vont disparaître : leur agrégat (et celui de leur semaine et de leur mois
        // s'ils comptent des visiteurs) doit exister avant toute suppression.
        const joursConcernes = new Set();
        const periodesConcernees = new Set();
        const noter = (fait, technique) => {
            if (fait) {
                joursConcernes.add(fait.date);
                if (fait.id && !estAdmin(fait.type)) periodesConcernees.add(fait.date);
            }
            if (technique) joursConcernes.add(technique.date);
        };
        const sources = [
            [j.ancienUsage, e => [faitDepuisAncienUsage(e), null]],
            [j.ancienAcces, e => [faitDepuisAncienAcces(e), techniqueDepuisAcces(e)]],
        ];
        for (const [fichier, convertir] of sources) {
            if (!fichier) continue;
            const avant = (await this.stockage.lireJournal(fichier))
                .filter(e => { const d = dateLocale(e.timestamp); return d && d < limite; });
            if (!avant.length) continue;
            anciensAReecrire.push(fichier);
            avant.forEach(e => noter(...convertir(e)));
        }
        for (const { fichier, mois: m } of [...j.usage, ...j.acces]) {
            if (m >= moisLimite) continue;
            const usage = fichier.endsWith('.jsonl');
            for (const e of await this.stockage.lireJournal(fichier)) {
                noter(usage ? faitDepuisUsage(e) : null, usage ? null : techniqueDepuisAcces(e));
            }
        }
        if (!aSupprimer.length && !anciensAReecrire.length) return resultat;

        // 1. Agrégats écrits puis relus depuis le disque
        let relus;
        try {
            await this.mettreAJourAgregats(aujourdhui);
            relus = JSON.parse(await fs.readFile(this.config.fichierAgregats, 'utf8'));
        } catch (err) {
            return { ...resultat, raison: `Agrégats illisibles : ${err.message}` };
        }
        const manquants = [...joursConcernes].filter(d => !relus.jours || !relus.jours[d]
            || (periodesConcernees.has(d) && (!relus.semaines || !relus.semaines[semaine(d).cle] || !relus.mois || !relus.mois[mois(d).cle])));
        if (manquants.length) {
            return { ...resultat, raison: `Agrégats absents pour ${manquants.length} jour(s) (ex. ${manquants.sort()[0]}) : rien n'est supprimé.` };
        }

        // 2. Copie des journaux avant la première purge
        const dossierCopie = path.join(this.config.dossierSauvegardes, 'journaux-avant-premiere-purge');
        if (!(await fs.stat(dossierCopie).catch(() => null))) {
            await fs.mkdir(`${dossierCopie}.tmp`, { recursive: true });
            for (const f of [...anciensAReecrire, ...aSupprimer]) await fs.copyFile(f, path.join(`${dossierCopie}.tmp`, path.basename(f)));
            await fs.rename(`${dossierCopie}.tmp`, dossierCopie);
            resultat.copie = dossierCopie;
        }

        // 3. Purge
        await this.stockage.enSerie(async () => {
            for (const fichier of anciensAReecrire) {
                const texte = await this.stockage.lireTexte(fichier);
                const garde = texte.split('\n').filter(ligne => {
                    if (!ligne.trim()) return false;
                    try {
                        const d = dateLocale(JSON.parse(ligne).timestamp);
                        return !d || d >= limite;
                    } catch { return true; }
                });
                await this.stockage.ecrireTexte(fichier, garde.length ? `${garde.join('\n')}\n` : '');
                resultat.reecrits.push(fichier);
            }
            for (const fichier of aSupprimer) {
                await fs.rm(fichier, { force: true });
                resultat.supprimes.push(fichier);
            }
        });
        return resultat;
    }
}

module.exports = {
    Statistiques, calculerAgregats, construireStatistiques, statistiquesContributeurs, traiterJour, avancer,
    agregatsVides, etatVide, dateLocale, semaine, mois, moinsMois, decalerJours, ecartJours, jourSemaine,
    faitDepuisUsage, faitDepuisAncienUsage, faitDepuisAncienAcces, listerJournaux,
    FONCTIONNALITES, TYPES_CONTRIBUTION, PAUSE_VISITE_MS,
};
