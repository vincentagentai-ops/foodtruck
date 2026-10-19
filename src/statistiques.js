'use strict';

// Statistiques d'audience : lecture des journaux bruts, agrégats quotidiens / hebdomadaires / mensuels
// (stats-jours.json, conservés sans limite) et purge des journaux bruts de plus de 13 mois.
//
// Sources lues :
// - usage-AAAA-MM.jsonl (3.1.0) : {ts, v, type, cible, page, version[, nav]} — v = HMAC du cookie ft_v ;
// - acces-AAAA-MM.log (3.1.0)   : journal technique (IP, URL, statut, durée) — ne sert plus à l'audience ;
// - usage.log et acces.log (avant la 3.1.0) : anciens libellés, visiteurs comptés par adresse IP.
//
// Tout est ramené à des « faits » {date, heure, source: 'navigateur'|'ip', id, type, cible, page, nav},
// puis agrégé par jour. Les périodes terminées sont enregistrées une fois pour toutes dans stats-jours.json.

const fs = require('fs/promises');
const path = require('path');
const {
    normaliserChemin, estPageVue, famille, convertirAncienLibelle,
} = require('./audience');
const { JOURS } = require('./validation');

const VERSION_AGREGATS = 1;

/** Date et heure locales d'un horodatage ISO. */
function dateEtHeure(horodatage) {
    const d = new Date(horodatage);
    if (Number.isNaN(d.getTime())) return null;
    const p = n => String(n).padStart(2, '0');
    return { date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, heure: d.getHours() };
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

function incrementer(objet, cle, n = 1) {
    objet[cle] = (objet[cle] || 0) + n;
}

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

// --- Agrégation

function jourVide() {
    return {
        pagesVues: 0, pages: {}, actifs: 0, actifsIp: 0, nouveaux: 0, heures: Array(24).fill(0),
        navigateurs: {}, evenements: {}, joursConsultes: {}, consultations: {},
        technique: { requetes: 0, erreurs: 0, dureeTotaleMs: 0 },
    };
}

/** Première date de chaque identifiant de navigateur (pour « nouveau » / « récurrent »). */
function premieresVues(faits) {
    const premieres = new Map();
    for (const f of faits) {
        if (f.source !== 'navigateur' || !f.id || estAdmin(f.type)) continue;
        const p = premieres.get(f.id);
        if (!p || f.date < p) premieres.set(f.id, f.date);
    }
    return premieres;
}

/**
 * Calcule tous les agrégats à partir des faits bruts : { jours, semaines, mois }.
 * C'est le « calcul brut » ; les agrégats enregistrés n'en sont qu'une copie des périodes terminées.
 */
function calculerAgregats(faits, techniques = []) {
    const premieres = premieresVues(faits);
    const jours = {};
    const ensembles = {}; // date -> { nav, ip, heures[], navigateurs{} }
    const jour = d => {
        if (!jours[d]) {
            jours[d] = jourVide();
            ensembles[d] = { nav: new Set(), ip: new Set(), heures: Array.from({ length: 24 }, () => new Set()), navigateurs: {} };
        }
        return jours[d];
    };

    for (const f of faits) {
        const j = jour(f.date);
        const e = ensembles[f.date];
        if (f.type === 'page_vue') {
            j.pagesVues++;
            incrementer(j.pages, f.page || '?');
        } else {
            incrementer(j.evenements, f.type);
        }
        if (f.type === 'jour_clic' && JOURS.includes(f.cible)) incrementer(j.joursConsultes, f.cible);
        if (['clic_site', 'clic_maps', 'consultation_ancien'].includes(f.type) && f.cible) {
            const cle = f.type === 'consultation_ancien' ? `nom:${f.cible}` : f.cible;
            const c = j.consultations[cle] || (j.consultations[cle] = { site: 0, maps: 0, autres: 0 });
            if (f.type === 'clic_site') c.site++; else if (f.type === 'clic_maps') c.maps++; else c.autres++;
        }
        if (!f.id || estAdmin(f.type)) continue;
        (f.source === 'navigateur' ? e.nav : e.ip).add(f.id);
        e.heures[f.heure].add(`${f.source}:${f.id}`);
        if (f.type === 'page_vue' && f.nav) {
            (e.navigateurs[f.nav] = e.navigateurs[f.nav] || new Set()).add(`${f.source}:${f.id}`);
        }
    }
    for (const t of techniques) {
        const j = jour(t.date);
        j.technique.requetes++;
        if (t.statut >= 400) j.technique.erreurs++;
        j.technique.dureeTotaleMs += t.duree;
    }
    for (const [d, e] of Object.entries(ensembles)) {
        const j = jours[d];
        j.actifs = e.nav.size;
        j.actifsIp = e.ip.size;
        j.nouveaux = [...e.nav].filter(id => premieres.get(id) === d).length;
        j.heures = e.heures.map(s => s.size);
        for (const [nav, ids] of Object.entries(e.navigateurs)) j.navigateurs[nav] = ids.size;
    }

    // Semaines et mois : navigateurs distincts (non additifs, d'où un calcul à part)
    const periodes = (decoupe) => {
        const groupes = {};
        for (const f of faits) {
            if (!f.id || estAdmin(f.type)) continue;
            const p = decoupe(f.date);
            const g = groupes[p.cle] || (groupes[p.cle] = { debut: p.debut, fin: p.fin, nav: new Set(), ip: new Set() });
            (f.source === 'navigateur' ? g.nav : g.ip).add(f.id);
        }
        const resultat = {};
        for (const [cle, g] of Object.entries(groupes)) {
            const nouveaux = [...g.nav].filter(id => premieres.get(id) >= g.debut).length;
            resultat[cle] = { debut: g.debut, fin: g.fin, actifs: g.nav.size, actifsIp: g.ip.size, nouveaux, recurrents: g.nav.size - nouveaux };
        }
        return resultat;
    };
    return { jours, semaines: periodes(semaine), mois: periodes(mois) };
}

/** Additionne les jours [debut, fin] (bornes facultatives) et assemble la réponse de l'API. */
function construireStatistiques(agregats, debut, fin) {
    const dansPeriode = d => (!debut || d >= debut) && (!fin || d <= fin);
    const recouvre = p => (!debut || p.fin >= debut) && (!fin || p.debut <= fin);
    const dates = Object.keys(agregats.jours).sort();
    const r = {
        periode: {
            debut: debut || null,
            fin: fin || null,
            premiereDonnee: dates[0] || null,
            derniereDonnee: dates[dates.length - 1] || null,
            debutNavigateurs: dates.find(d => agregats.jours[d].actifs > 0) || null,
        },
        totaux: { pagesVues: 0, nouveaux: 0, suggestions: 0, actifsMoyenJour: 0, actifsMoyenSemaine: 0, actifsMoyenMois: 0, joursActifs: 0 },
        jours: [], semaines: [], mois: [],
        pages: {}, heures: Array(24).fill(0), navigateurs: {}, evenements: {}, joursConsultes: {}, consultations: {},
        technique: { requetes: 0, erreurs: 0, dureeMoyenneMs: 0 },
    };
    let dureeTotale = 0;
    let sommeActifs = 0;
    for (const d of dates.filter(dansPeriode)) {
        const j = agregats.jours[d];
        r.jours.push({ date: d, pagesVues: j.pagesVues, actifs: j.actifs, actifsIp: j.actifsIp, nouveaux: j.nouveaux });
        r.totaux.pagesVues += j.pagesVues;
        r.totaux.nouveaux += j.nouveaux;
        if (j.actifs > 0) { r.totaux.joursActifs++; sommeActifs += j.actifs; }
        for (const [k, n] of Object.entries(j.pages)) incrementer(r.pages, k, n);
        j.heures.forEach((n, h) => { r.heures[h] += n; });
        for (const [k, n] of Object.entries(j.navigateurs)) incrementer(r.navigateurs, k, n);
        for (const [k, n] of Object.entries(j.evenements)) incrementer(r.evenements, k, n);
        for (const [k, n] of Object.entries(j.joursConsultes)) incrementer(r.joursConsultes, k, n);
        for (const [k, c] of Object.entries(j.consultations)) {
            const t = r.consultations[k] || (r.consultations[k] = { site: 0, maps: 0, autres: 0 });
            t.site += c.site; t.maps += c.maps; t.autres += c.autres;
        }
        r.technique.requetes += j.technique.requetes;
        r.technique.erreurs += j.technique.erreurs;
        dureeTotale += j.technique.dureeTotaleMs;
    }
    // Ajouts d'établissements : suggestions (avant la 3.2.0) et publications directes (3.2.0)
    r.totaux.suggestions = (r.evenements.suggestion || 0) + (r.evenements.ajout || 0);
    r.totaux.contributions = ['ajout', 'modification', 'restauration', 'avis', 'avis_modifie', 'presence', 'signalement']
        .reduce((s, type) => s + (r.evenements[type] || 0), 0);
    r.totaux.actifsMoyenJour = r.totaux.joursActifs ? Math.round(sommeActifs / r.totaux.joursActifs * 10) / 10 : 0;
    r.technique.dureeMoyenneMs = r.technique.requetes ? Math.round(dureeTotale / r.technique.requetes) : 0;
    const liste = (objet, nom) => Object.keys(objet).sort().map(cle => ({ [nom]: cle, ...objet[cle] })).filter(recouvre);
    r.semaines = liste(agregats.semaines, 'semaine');
    r.mois = liste(agregats.mois, 'mois');
    const moyenne = l => {
        const avec = l.filter(p => p.actifs > 0);
        return avec.length ? Math.round(avec.reduce((s, p) => s + p.actifs, 0) / avec.length * 10) / 10 : 0;
    };
    r.totaux.actifsMoyenSemaine = moyenne(r.semaines);
    r.totaux.actifsMoyenMois = moyenne(r.mois);
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

/** Moins `n` mois (date AAAA-MM-JJ ; le jour est ramené à la fin du mois si besoin). */
function moinsMois(date, n) {
    const [a, m, j] = date.split('-').map(Number);
    const total = a * 12 + (m - 1) - n;
    const annee = Math.floor(total / 12);
    const moisCible = total % 12;
    const dernier = new Date(Date.UTC(annee, moisCible + 1, 0)).getUTCDate();
    return `${annee}-${String(moisCible + 1).padStart(2, '0')}-${String(Math.min(j, dernier)).padStart(2, '0')}`;
}

class Statistiques {
    constructor(stockage, options = {}) {
        this.stockage = stockage;
        this.config = stockage.config;
        this.journal = options.journal || console;
    }

    /** Lit tous les journaux bruts et les ramène à des faits et des mesures techniques. */
    async lireFaits() {
        const j = await listerJournaux(this.config);
        const lire = f => this.stockage.lireJournal(f);
        const faits = [];
        const techniques = [];
        if (j.ancienUsage) for (const e of await lire(j.ancienUsage)) { const f = faitDepuisAncienUsage(e); if (f) faits.push(f); }
        if (j.ancienAcces) {
            for (const e of await lire(j.ancienAcces)) {
                const f = faitDepuisAncienAcces(e);
                if (f) faits.push(f);
                const t = techniqueDepuisAcces(e);
                if (t) techniques.push(t);
            }
        }
        for (const { fichier } of j.usage) for (const e of await lire(fichier)) { const f = faitDepuisUsage(e); if (f) faits.push(f); }
        for (const { fichier } of j.acces) for (const e of await lire(fichier)) { const t = techniqueDepuisAcces(e); if (t) techniques.push(t); }
        return { faits, techniques };
    }

    async lireAgregats() {
        const a = await this.stockage.lireJSON(this.config.fichierAgregats, null);
        if (!a) return { version: VERSION_AGREGATS, jours: {}, semaines: {}, mois: {} };
        return { version: a.version, jours: a.jours || {}, semaines: a.semaines || {}, mois: a.mois || {} };
    }

    /**
     * Enregistre les agrégats des périodes terminées (avant `aujourdhui`) qui ne le sont pas encore.
     * Les périodes déjà enregistrées ne sont jamais recalculées (leurs journaux bruts ont pu être purgés).
     * Retourne { enregistres, calcules } (calculés = tout ce que les journaux bruts permettent, période en cours comprise).
     */
    async mettreAJourAgregats(aujourdhui = dateLocale(new Date())) {
        const { faits, techniques } = await this.lireFaits();
        const calcules = calculerAgregats(faits, techniques);
        return this.stockage.enSerie(async () => {
            const enregistres = await this.lireAgregats();
            let modifie = false;
            for (const [nom, termine] of [['jours', d => d < aujourdhui], ['semaines', p => p.fin < aujourdhui], ['mois', p => p.fin < aujourdhui]]) {
                for (const [cle, valeur] of Object.entries(calcules[nom])) {
                    if (enregistres[nom][cle] || !termine(nom === 'jours' ? cle : valeur)) continue;
                    enregistres[nom][cle] = valeur;
                    modifie = true;
                }
            }
            if (modifie) {
                await this.stockage.ecrireJSON(this.config.fichierAgregats, { ...enregistres, version: VERSION_AGREGATS, maj: new Date().toISOString() });
            }
            return { enregistres, calcules };
        });
    }

    /** Statistiques de la période : agrégats enregistrés + calcul brut des périodes en cours. */
    async calculer(debut, fin, aujourdhui) {
        const { enregistres, calcules } = await this.mettreAJourAgregats(aujourdhui);
        const fusion = nom => ({ ...calcules[nom], ...enregistres[nom] });
        return construireStatistiques({ jours: fusion('jours'), semaines: fusion('semaines'), mois: fusion('mois') }, debut, fin);
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
    Statistiques, calculerAgregats, construireStatistiques, dateLocale, semaine, mois, moinsMois, decalerJours,
    faitDepuisUsage, faitDepuisAncienUsage, faitDepuisAncienAcces, listerJournaux,
};
