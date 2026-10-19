'use strict';

// Contributions des collègues, publiées immédiatement, en fichiers JSONL en ajout seul :
// - avis.jsonl          {ts, id, cible, auteur, pseudo, note, texte, criteres, plat, action: creer|modifier|supprimer|masquer|retablir}
// - presences.jsonl     {ts, date, cible, auteur, etat: present|absent|aucun}   (la dernière ligne d'un navigateur compte)
// - signalements.jsonl  {ts, id, cible, type, date?, texte?, avis?, auteur, action: signaler}  et  {ts, id, action: traiter, par}
// - config-moderation.json : seuils réglables par l'administrateur et blocages temporaires de navigateurs.
// L'état courant est reconstruit en mémoire depuis ces fichiers (relus s'ils ont été modifiés à la main),
// puis tenu à jour à chaque écriture. `auteur` est toujours le jeton HMAC du navigateur (identite.js).

const fs = require('fs/promises');
const path = require('path');
const { ErreurHttp, aujourdhui, nouvelId } = require('./stockage');
const { texteSurUneLigne } = require('./identite');
const { CHAMPS_SENSIBLES, LIBELLES_CHAMPS, champsModifies } = require('./etablissements');
const { moinsMois, decalerJours } = require('./statistiques');

const SEUILS_DEFAUT = {
    signalementsMasquage: 3, // avis masqué après N signalements « contenu inapproprié » de navigateurs distincts
    signalementsPlusPresent: 2, // « n'est plus présent » : N navigateurs distincts…
    joursIncertain: 14, // …et aucune confirmation depuis N jours -> statut incertain
    joursArchive: 30, // …N jours sans confirmation -> archivé (masqué, restaurable)
    delaiGraceMinutes: 30, // l'auteur d'un ajout garde la main pendant N minutes
    joursBlocage: 7, // durée proposée pour un blocage temporaire
};
const LIMITES_SEUILS = {
    signalementsMasquage: [1, 50], signalementsPlusPresent: [1, 50], joursIncertain: [1, 365], joursArchive: [1, 730],
    delaiGraceMinutes: [0, 1440], joursBlocage: [1, 365],
};

const CRITERES = {
    qualite_prix: { bon: 'Bon rapport qualité-prix', correct: 'Qualité-prix correcte', cher: 'Cher pour ce que c\'est' },
    portions: { copieuses: 'Portions copieuses', normales: 'Portions normales', petites: 'Portions petites' },
    attente: { moins5: 'Attente < 5 min', '5a15': 'Attente 5–15 min', plus15: 'Attente > 15 min' },
};
const TYPES_SIGNALEMENT = {
    plus_present: "N'est plus présent",
    ferme: 'Fermé exceptionnellement',
    erreur: 'Info erronée',
    inapproprie: 'Contenu inapproprié',
    doublon: 'Doublon',
};
const LONGUEUR_AVIS = 280;
const LONGUEUR_PLAT = 60;
const LONGUEUR_SIGNALEMENT = 200;
const JOURS_FERMETURE_MAX = 60; // une fermeture exceptionnelle se signale au plus 60 jours à l'avance

/** Nombre de jours de `a` à `b` (dates AAAA-MM-JJ). */
function joursEntre(a, b) {
    const t = d => { const [y, m, j] = d.split('-').map(Number); return Date.UTC(y, m - 1, j); };
    return Math.round((t(b) - t(a)) / 86400000);
}

/** Avis saisi -> { avis } ou { erreurs }. */
function validerAvis(d) {
    const donnees = d && typeof d === 'object' ? d : {};
    const erreurs = [];
    const note = Number(donnees.note);
    if (!Number.isInteger(note) || note < 1 || note > 5) erreurs.push('Choisissez une note de 1 à 5 étoiles.');
    const texte = typeof donnees.texte === 'string' || donnees.texte == null ? texteSurUneLigne(donnees.texte) : null;
    const plat = typeof donnees.plat === 'string' || donnees.plat == null ? texteSurUneLigne(donnees.plat) : null;
    if (texte === null || plat === null) erreurs.push('Commentaire et plat conseillé : texte attendu.');
    else {
        if (texte.length > LONGUEUR_AVIS) erreurs.push(`Le commentaire dépasse ${LONGUEUR_AVIS} caractères.`);
        if (plat.length > LONGUEUR_PLAT) erreurs.push(`Le plat conseillé dépasse ${LONGUEUR_PLAT} caractères.`);
    }
    const criteres = {};
    const saisis = donnees.criteres && typeof donnees.criteres === 'object' ? donnees.criteres : {};
    for (const [nom, valeur] of Object.entries(saisis)) {
        if (valeur === '' || valeur == null) continue;
        if (!CRITERES[nom] || !CRITERES[nom][valeur]) erreurs.push(`Critère inconnu : ${String(nom).slice(0, 20)}.`);
        else criteres[nom] = valeur;
    }
    if (erreurs.length) return { erreurs };
    return { avis: { note, texte, criteres, plat } };
}

class Contributions {
    /** `etablissements` : instance d'Etablissements ; `options.horloge` : () => Date. */
    constructor(stockage, etablissements, options = {}) {
        this.stockage = stockage;
        this.etablissements = etablissements;
        this.config = stockage.config;
        this.horloge = options.horloge || (() => new Date());
        const d = this.config.dossierDonnees;
        this.fichiers = {
            avis: path.join(d, 'avis.jsonl'),
            presences: path.join(d, 'presences.jsonl'),
            signalements: path.join(d, 'signalements.jsonl'),
            moderation: path.join(d, 'config-moderation.json'),
            agregatsPresences: path.join(d, 'stats-presences.json'),
        };
        this.memo = null;
    }

    maintenant() { return this.horloge(); }
    aujourdhui() { return aujourdhui(this.horloge()); }

    // --- Seuils et blocages (config-moderation.json)

    async moderation() {
        const brut = await this.stockage.lireJSON(this.fichiers.moderation, {}).catch(() => ({}));
        const seuils = { ...SEUILS_DEFAUT };
        for (const [nom, [min, max]] of Object.entries(LIMITES_SEUILS)) {
            const v = Number((brut.seuils || {})[nom]);
            if (Number.isInteger(v) && v >= min && v <= max) seuils[nom] = v;
        }
        return { seuils, blocages: brut.blocages && typeof brut.blocages === 'object' ? brut.blocages : {} };
    }

    async seuils() { return (await this.moderation()).seuils; }

    /** Modifie les seuils (administrateur). Retourne les seuils enregistrés ; 400 si une valeur est hors bornes. */
    async reglerSeuils(nouveaux) {
        const erreurs = [];
        for (const [nom, valeur] of Object.entries(nouveaux || {})) {
            if (!LIMITES_SEUILS[nom]) { erreurs.push(`Seuil inconnu : ${nom}.`); continue; }
            const [min, max] = LIMITES_SEUILS[nom];
            const v = Number(valeur);
            if (!Number.isInteger(v) || v < min || v > max) erreurs.push(`${nom} : nombre entier de ${min} à ${max} attendu.`);
        }
        if (erreurs.length) throw new ErreurHttp(400, 'Seuils invalides.', erreurs);
        return this.stockage.enSerie(async () => {
            const actuel = await this.moderation();
            const seuils = { ...actuel.seuils };
            for (const [nom, valeur] of Object.entries(nouveaux)) seuils[nom] = Number(valeur);
            await this.stockage.ecrireJSON(this.fichiers.moderation, { seuils, blocages: actuel.blocages });
            return seuils;
        });
    }

    /** Bloque un jeton d'auteur pendant `jours` jours (0 = débloquer). */
    async bloquer(auteur, jours) {
        if (typeof auteur !== 'string' || !/^[0-9a-f]{24}$/.test(auteur)) throw new ErreurHttp(400, 'Identifiant de navigateur invalide.');
        return this.stockage.enSerie(async () => {
            const actuel = await this.moderation();
            const blocages = { ...actuel.blocages };
            if (jours > 0) blocages[auteur] = new Date(this.horloge().getTime() + jours * 86400000).toISOString();
            else delete blocages[auteur];
            await this.stockage.ecrireJSON(this.fichiers.moderation, { seuils: actuel.seuils, blocages });
            return blocages;
        });
    }

    async estBloque(auteur) {
        const jusqua = (await this.moderation()).blocages[auteur];
        return Boolean(jusqua && new Date(jusqua).getTime() > this.horloge().getTime());
    }

    // --- État courant reconstruit depuis les fichiers

    async etat() {
        const [avis, presences, signalements] = await Promise.all([
            this.stockage.lireLignes(this.fichiers.avis),
            this.stockage.lireLignes(this.fichiers.presences),
            this.stockage.lireLignes(this.fichiers.signalements),
        ]);
        await this.stockage.lireLignes(this.etablissements.fichierHistorique);
        if (this.memo && this.memo.generation === this.stockage.generation && this.memo.etat.jour === this.aujourdhui()) return this.memo.etat;
        const alias = await this.etablissements.alias();
        const cibleDe = id => alias[id] || id;

        // Avis
        const parId = new Map();
        for (const l of avis.lignes) {
            if (!l || !l.id) continue;
            const a = parId.get(l.id);
            if (l.action === 'creer' && !a) {
                parId.set(l.id, { id: l.id, cible: l.cible, auteur: l.auteur, pseudo: l.pseudo || '', note: l.note, texte: l.texte || '',
                    criteres: l.criteres || {}, plat: l.plat || '', cree: l.ts, maj: l.ts, modifie: false, supprime: false, masque: false });
            } else if (a && l.action === 'modifier') {
                Object.assign(a, { pseudo: l.pseudo || '', note: l.note, texte: l.texte || '', criteres: l.criteres || {}, plat: l.plat || '',
                    maj: l.ts, modifie: true, supprime: false });
            } else if (a && l.action === 'supprimer') a.supprime = true;
            else if (a && l.action === 'masquer') a.masque = true;
            else if (a && l.action === 'retablir') a.masque = false;
        }
        const listeAvis = [...parId.values()].map(a => ({ ...a, cible: cibleDe(a.cible) }));
        // Après une fusion, un navigateur peut avoir deux avis sur la même fiche : seul le plus récent compte
        const dernierParAuteur = new Map();
        for (const a of listeAvis.filter(x => !x.supprime)) {
            const k = `${a.cible}|${a.auteur}`;
            const autre = dernierParAuteur.get(k);
            if (!autre || a.maj >= autre.maj) dernierParAuteur.set(k, a); // à égalité : le dernier écrit
        }
        for (const a of listeAvis) a.remplace = !a.supprime && dernierParAuteur.get(`${a.cible}|${a.auteur}`) !== a;

        // Présences : dernière déclaration de chaque navigateur, par jour et par fiche
        const pres = new Map(); // "date|cible" -> Map(auteur -> {etat, ts})
        for (const l of presences.lignes) {
            if (!l || !l.date || !l.cible || !l.auteur) continue;
            const k = `${l.date}|${cibleDe(l.cible)}`;
            if (!pres.has(k)) pres.set(k, new Map());
            if (l.etat === 'present' || l.etat === 'absent') pres.get(k).set(l.auteur, { etat: l.etat, ts: l.ts });
            else pres.get(k).delete(l.auteur);
        }
        const derniereConfirmation = new Map(); // cible -> ts de la dernière confirmation « Il est là »
        for (const [k, m] of pres) {
            const cible = k.split('|')[1];
            for (const { etat, ts } of m.values()) {
                if (etat === 'present' && (!derniereConfirmation.has(cible) || ts > derniereConfirmation.get(cible))) derniereConfirmation.set(cible, ts);
            }
        }

        // Signalements
        const sig = new Map();
        for (const l of signalements.lignes) {
            if (!l || !l.id) continue;
            if (l.action === 'signaler' && !sig.has(l.id)) {
                sig.set(l.id, { id: l.id, ts: l.ts, cible: cibleDe(l.cible), type: l.type, date: l.date || '', texte: l.texte || '',
                    avis: l.avis || '', auteur: l.auteur, etat: 'ouvert', traite: null });
            } else if (l.action === 'traiter' && sig.has(l.id)) {
                Object.assign(sig.get(l.id), { etat: 'traite', traite: { ts: l.ts, par: l.par || 'admin', decision: l.decision || '' } });
            }
        }
        // Signalements devenus sans objet : « n'est plus présent » contredit par une confirmation ultérieure,
        // « info erronée » suivi d'une modification de la fiche, fermeture passée.
        const derniereModification = new Map();
        for (const e of await this.etablissements.historique()) {
            if (['modifier', 'restaurer', 'fusion'].includes(e.action) && e.apres) derniereModification.set(cibleDe(e.cible), e.ts);
        }
        const jour = this.aujourdhui();
        for (const s of sig.values()) {
            if (s.etat !== 'ouvert') continue;
            if (s.type === 'plus_present' && derniereConfirmation.get(s.cible) > s.ts) s.etat = 'resolu';
            if (s.type === 'erreur' && derniereModification.get(s.cible) > s.ts) s.etat = 'resolu';
            if (s.type === 'ferme' && s.date < jour) s.etat = 'resolu';
            if (s.type === 'inapproprie' && s.avis && parId.has(s.avis) && parId.get(s.avis).supprime) s.etat = 'resolu';
        }

        const etat = { avis: listeAvis, avisParId: new Map(listeAvis.map(a => [a.id, a])), presences: pres, derniereConfirmation,
            signalements: [...sig.values()], alias, jour };
        this.memo = { generation: this.stockage.generation, etat };
        return etat;
    }

    // --- Lecture

    /** Avis visibles d'une fiche (ni supprimés, ni masqués, ni remplacés). */
    avisVisibles(etat, cible) {
        return etat.avis.filter(a => a.cible === cible && !a.supprime && !a.masque && !a.remplace);
    }

    /** Résumé affiché dans la liste et sur la fiche. `auteur` : pour « mon état ». */
    resume(etat, cible, auteur) {
        const visibles = this.avisVisibles(etat, cible);
        const somme = visibles.reduce((s, a) => s + a.note, 0);
        const jour = this.aujourdhui();
        const duJour = etat.presences.get(`${jour}|${cible}`) || new Map();
        const presents = [...duJour.values()].filter(p => p.etat === 'present');
        const absents = [...duJour.values()].filter(p => p.etat === 'absent');
        const heure = ts => { const d = new Date(ts); return `${String(d.getHours()).padStart(2, '0')}h${String(d.getMinutes()).padStart(2, '0')}`; };
        const ouverts = etat.signalements.filter(s => s.cible === cible && s.etat === 'ouvert');
        const derniere = presents.map(p => p.ts).sort().pop();
        return {
            nbAvis: visibles.length,
            note: visibles.length ? Math.round(somme / visibles.length * 10) / 10 : null,
            presence: {
                presents: presents.length,
                absents: absents.length,
                derniere: derniere ? heure(derniere) : '',
                monEtat: auteur && duJour.has(auteur) ? duJour.get(auteur).etat : '',
            },
            fermetures: [...new Set(ouverts.filter(s => s.type === 'ferme').map(s => s.date))].sort(),
            plusPresent: new Set(ouverts.filter(s => s.type === 'plus_present').map(s => s.auteur)).size,
            erreurs: ouverts.filter(s => s.type === 'erreur').map(s => ({ texte: s.texte, ts: s.ts })),
        };
    }

    /** Avis publics d'une fiche (sans jeton d'auteur ; `mien` indique l'avis de ce navigateur). */
    avisPublics(etat, cible, auteur) {
        return this.avisVisibles(etat, cible).sort((a, b) => (b.maj > a.maj ? 1 : -1)).map(a => ({
            id: a.id, note: a.note, texte: a.texte, criteres: a.criteres, plat: a.plat, pseudo: a.pseudo,
            cree: a.cree, maj: a.maj, modifie: a.modifie, mien: Boolean(auteur) && a.auteur === auteur,
        }));
    }

    /** Avis de ce navigateur sur la fiche (même masqué), pour pré-remplir « Modifier mon avis ». */
    monAvis(etat, cible, auteur) {
        const a = auteur && etat.avis.find(x => x.cible === cible && x.auteur === auteur && !x.supprime && !x.remplace);
        return a ? { id: a.id, note: a.note, texte: a.texte, criteres: a.criteres, plat: a.plat, pseudo: a.pseudo, masque: a.masque } : null;
    }

    // --- Écritures (toutes dans la file d'attente de stockage.js)

    async verifierAuteur(auteur) {
        if (!auteur) throw new ErreurHttp(400, 'Cookie du site absent : rechargez la page (les cookies doivent être autorisés pour contribuer).');
        if (await this.estBloque(auteur)) {
            throw new ErreurHttp(403, 'Les contributions depuis ce navigateur sont temporairement suspendues. Contactez l\'administrateur.');
        }
    }

    /** Publie ou modifie l'avis de ce navigateur sur la fiche (un avis par navigateur et par fiche). */
    async publierAvis(cible, auteur, pseudo, donnees) {
        await this.verifierAuteur(auteur);
        const { avis, erreurs } = validerAvis(donnees);
        if (erreurs) throw new ErreurHttp(400, 'Avis incomplet ou invalide.', erreurs);
        return this.stockage.enSerie(async () => {
            const etat = await this.etat();
            const existant = etat.avis.find(a => a.cible === cible && a.auteur === auteur && !a.supprime && !a.remplace);
            const ligne = { ts: this.maintenant().toISOString(), id: existant ? existant.id : nouvelId(etat.avis.map(a => a.id)),
                cible, auteur, pseudo, ...avis, action: existant ? 'modifier' : 'creer' };
            await this.stockage.ajouterLigne(this.fichiers.avis, ligne);
            return { id: ligne.id, action: ligne.action };
        });
    }

    /** Suppression logique de son propre avis. */
    async supprimerAvis(cible, auteur) {
        await this.verifierAuteur(auteur);
        return this.stockage.enSerie(async () => {
            const etat = await this.etat();
            const existant = etat.avis.find(a => a.cible === cible && a.auteur === auteur && !a.supprime && !a.remplace);
            if (!existant) throw new ErreurHttp(404, "Vous n'avez pas d'avis sur cet établissement (depuis ce navigateur).");
            await this.stockage.ajouterLigne(this.fichiers.avis, { ts: this.maintenant().toISOString(), id: existant.id, cible, auteur, action: 'supprimer' });
            return existant.id;
        });
    }

    /** « Il est là » / « Pas là aujourd'hui » / retrait : une déclaration par navigateur, fiche et jour. */
    async declarerPresence(cible, auteur, etatPresence) {
        await this.verifierAuteur(auteur);
        const etat = ['present', 'absent'].includes(etatPresence) ? etatPresence : (etatPresence === '' || etatPresence === 'aucun' ? 'aucun' : null);
        if (!etat) throw new ErreurHttp(400, 'Présence : « present », « absent » ou « aucun » attendu.');
        await this.stockage.ajouterEvenement(this.fichiers.presences, {
            ts: this.maintenant().toISOString(), date: this.aujourdhui(), cible, auteur, etat,
        });
        return etat;
    }

    /**
     * Signalement : plus_present, ferme (date AAAA-MM-JJ), erreur (texte), inapproprie (avis), doublon.
     * Un même navigateur ne compte qu'une fois par signalement identique encore ouvert.
     */
    async signaler(cible, auteur, donnees) {
        await this.verifierAuteur(auteur);
        const d = donnees && typeof donnees === 'object' ? donnees : {};
        const type = d.type;
        if (!TYPES_SIGNALEMENT[type]) throw new ErreurHttp(400, 'Type de signalement inconnu.');
        if (d.texte != null && typeof d.texte !== 'string') throw new ErreurHttp(400, 'Précision : texte attendu.');
        const texte = texteSurUneLigne(d.texte);
        if (texte.length > LONGUEUR_SIGNALEMENT) throw new ErreurHttp(400, `La précision dépasse ${LONGUEUR_SIGNALEMENT} caractères.`);
        let date = '';
        let avis = '';
        const jour = this.aujourdhui();
        if (type === 'ferme') {
            date = typeof d.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d.date) ? d.date : '';
            if (!date || date < jour || date > decalerJours(jour, JOURS_FERMETURE_MAX)) {
                throw new ErreurHttp(400, `Indiquez la date de fermeture (aujourd'hui ou dans les ${JOURS_FERMETURE_MAX} prochains jours).`);
            }
        }
        if (type === 'erreur' && !texte) throw new ErreurHttp(400, "Précisez l'information erronée (ou corrigez-la vous-même avec « Modifier les infos »).");
        return this.stockage.enSerie(async () => {
            const etat = await this.etat();
            if (type === 'inapproprie' && d.avis) {
                const a = etat.avisParId.get(String(d.avis));
                if (!a || a.cible !== cible || a.supprime) throw new ErreurHttp(404, 'Avis introuvable.');
                if (a.auteur === auteur) throw new ErreurHttp(400, 'Vous ne pouvez pas signaler votre propre avis : modifiez-le ou supprimez-le.');
                avis = a.id;
            }
            const doublon = etat.signalements.find(s => s.etat === 'ouvert' && s.auteur === auteur && s.cible === cible
                && s.type === type && s.date === date && s.avis === avis);
            if (doublon) return { id: doublon.id, deja: true, masque: false };
            const ligne = { ts: this.maintenant().toISOString(), id: nouvelId(etat.signalements.map(s => s.id)), cible, type, auteur, action: 'signaler' };
            if (date) ligne.date = date;
            if (texte) ligne.texte = texte;
            if (avis) ligne.avis = avis;
            await this.stockage.ajouterLigne(this.fichiers.signalements, ligne);

            // C13 : avis masqué automatiquement au N-ième signalement de navigateurs distincts
            let masque = false;
            if (avis) {
                const seuil = (await this.seuils()).signalementsMasquage;
                const apres = await this.etat();
                const distincts = new Set(apres.signalements.filter(s => s.avis === avis && s.type === 'inapproprie' && s.etat === 'ouvert').map(s => s.auteur));
                if (distincts.size >= seuil && !apres.avisParId.get(avis).masque) {
                    await this.stockage.ajouterLigne(this.fichiers.avis, { ts: this.maintenant().toISOString(), id: avis, action: 'masquer', par: 'auto' });
                    masque = true;
                }
            }
            return { id: ligne.id, deja: false, masque };
        });
    }

    // --- Administration

    /** Clôt des signalements (décision de l'administrateur ou effet d'une restauration). */
    async traiterSignalements(ids, decision = '', par = 'admin') {
        return this.stockage.enSerie(async () => {
            const etat = await this.etat();
            const ouverts = new Set(etat.signalements.filter(s => s.etat === 'ouvert').map(s => s.id));
            let n = 0;
            for (const id of ids) {
                if (!ouverts.has(id)) continue;
                await this.stockage.ajouterLigne(this.fichiers.signalements, { ts: this.maintenant().toISOString(), id, action: 'traiter', par, decision });
                n++;
            }
            return n;
        });
    }

    /** Rétablit (et clôt ses signalements) ou masque un avis. */
    async moderer(idAvis, action) {
        if (!['masquer', 'retablir'].includes(action)) throw new ErreurHttp(400, 'Action inconnue.');
        const etat = await this.etat();
        const a = etat.avisParId.get(idAvis);
        if (!a) throw new ErreurHttp(404, 'Avis introuvable.');
        await this.stockage.ajouterEvenement(this.fichiers.avis, { ts: this.maintenant().toISOString(), id: idAvis, action, par: 'admin' });
        if (action === 'retablir') {
            await this.traiterSignalements(etat.signalements.filter(s => s.avis === idAvis && s.etat === 'ouvert').map(s => s.id), 'avis rétabli');
        }
        return a;
    }

    /** Suppression définitive (purge) de lignes des fichiers de contributions : `garder(ligne)` -> booléen. */
    async purgerLignes(nom, garder) {
        return this.stockage.enSerie(async () => {
            const { lignes } = await this.stockage.lireLignes(this.fichiers[nom]);
            const restantes = lignes.filter(garder);
            if (restantes.length !== lignes.length) await this.stockage.reecrireLignes(this.fichiers[nom], restantes);
            return lignes.length - restantes.length;
        });
    }

    /** Purge d'un avis (contenu illicite, demande d'effacement) et des signalements qui le visent. */
    async purgerAvis(idAvis) {
        const n = await this.purgerLignes('avis', l => l.id !== idAvis);
        if (!n) throw new ErreurHttp(404, 'Avis introuvable.');
        await this.purgerLignes('signalements', l => !(l.avis === idAvis));
        return n;
    }

    /** Purge de toutes les contributions liées à une fiche supprimée définitivement. */
    async purgerCible(cible) {
        const etat = await this.etat();
        const idsSignalements = new Set(etat.signalements.filter(s => s.cible === cible).map(s => s.id));
        await this.purgerLignes('avis', l => l.cible !== cible && !(l.action !== 'creer' && etat.avisParId.get(l.id) && etat.avisParId.get(l.id).cible === cible));
        await this.purgerLignes('presences', l => l.cible !== cible);
        await this.purgerLignes('signalements', l => !idsSignalements.has(l.id));
        await this.stockage.enSerie(async () => {
            const fichier = this.etablissements.fichierHistorique;
            const { lignes } = await this.stockage.lireLignes(fichier);
            const restantes = lignes.filter(l => l.cible !== cible);
            if (restantes.length !== lignes.length) await this.stockage.reecrireLignes(fichier, restantes);
        });
    }

    /** Signalements, avis masqués, modifications sensibles… pour la page « À surveiller ». */
    async surveillance({ jours = 30 } = {}) {
        const etat = await this.etat();
        const fiches = await this.etablissements.lister();
        const nom = id => (fiches.find(f => f.id === id) || {}).nom || `(fiche ${id} supprimée)`;
        const court = auteur => String(auteur || '').slice(0, 8);
        const limite = new Date(this.horloge().getTime() - jours * 86400000).toISOString();
        const signalements = etat.signalements.filter(s => s.etat === 'ouvert' && s.type !== 'ferme').sort((a, b) => (a.ts < b.ts ? 1 : -1))
            .map(s => {
                const a = s.avis ? etat.avisParId.get(s.avis) : null;
                return { id: s.id, ts: s.ts, cible: s.cible, nom: nom(s.cible), type: s.type, libelle: TYPES_SIGNALEMENT[s.type], texte: s.texte,
                    avis: a ? { id: a.id, texte: a.texte, note: a.note, masque: a.masque } : null, auteur: s.auteur, auteurCourt: court(s.auteur) };
            });
        const masques = etat.avis.filter(a => a.masque && !a.supprime).map(a => ({
            id: a.id, cible: a.cible, nom: nom(a.cible), note: a.note, texte: a.texte, plat: a.plat, pseudo: a.pseudo, maj: a.maj,
            signalements: new Set(etat.signalements.filter(s => s.avis === a.id && s.etat === 'ouvert').map(s => s.auteur)).size,
            auteur: a.auteur, auteurCourt: court(a.auteur),
        }));
        const modifications = (await this.etablissements.historique())
            .filter(e => e.ts >= limite && e.apres && (e.action === 'creer' || e.action === 'statut_auto'
                || champsModifies(e.avant, e.apres, CHAMPS_SENSIBLES).length))
            .sort((a, b) => (a.ts < b.ts ? 1 : -1))
            .map(e => ({
                ts: e.ts, cible: e.cible, nom: e.apres.nom, version: e.version, action: e.action, pseudo: e.pseudo || '',
                auteur: /^[0-9a-f]{24}$/.test(e.auteur || '') ? e.auteur : '', auteurCourt: /^[0-9a-f]{24}$/.test(e.auteur || '') ? court(e.auteur) : e.auteur,
                champs: (e.action === 'creer' ? [] : champsModifies(e.avant, e.apres)).map(c => ({
                    champ: c, libelle: LIBELLES_CHAMPS[c] || c, avant: (e.avant || {})[c] || '', apres: e.apres[c] || '',
                })),
                raison: e.raison || '', existe: fiches.some(f => f.id === e.cible),
            }));
        const { seuils, blocages } = await this.moderation();
        const maintenant = this.horloge().toISOString();
        return {
            signalements, masques, modifications, seuils,
            blocages: Object.entries(blocages).filter(([, jusqua]) => jusqua > maintenant).map(([auteur, jusqua]) => ({ auteur, auteurCourt: court(auteur), jusqua })),
        };
    }

    // --- Seuils d'archivage automatique

    /**
     * « N'est plus présent » signalé par N navigateurs distincts (depuis la dernière confirmation) ET aucune
     * confirmation depuis `joursIncertain` jours -> incertain ; `joursArchive` jours -> archivé. Sans aucune
     * confirmation, les jours se comptent depuis le premier de ces signalements. Si la condition ne tient plus
     * (nouvelle confirmation), une fiche passée « incertain » automatiquement redevient active.
     * Retourne la liste des changements [{id, nom, avant, apres}].
     */
    async appliquerSeuils() {
        const seuils = await this.seuils();
        const etat = await this.etat();
        const jour = this.aujourdhui();
        const historique = await this.etablissements.historique();
        const changements = [];
        for (const ft of await this.etablissements.lister()) {
            if (ft.statut === 'archive') continue;
            const confirmation = etat.derniereConfirmation.get(ft.id) || '';
            const rapports = etat.signalements.filter(s => s.cible === ft.id && s.type === 'plus_present' && s.etat === 'ouvert' && s.ts > confirmation);
            const distincts = new Set(rapports.map(s => s.auteur)).size;
            let cible = ft.statut;
            let raison = '';
            if (distincts >= seuils.signalementsPlusPresent) {
                const reference = confirmation || rapports.map(s => s.ts).sort()[0];
                const sans = joursEntre(aujourdhui(new Date(reference)), jour);
                if (sans >= seuils.joursArchive) cible = 'archive';
                else if (sans >= seuils.joursIncertain && ft.statut === 'actif') cible = 'incertain';
                raison = `Signalé « n'est plus présent » par ${distincts} navigateurs, aucune confirmation depuis ${sans} jour(s).`;
            } else if (ft.statut === 'incertain') {
                const dernier = historique.filter(e => e.cible === ft.id && e.avant && e.apres && e.avant.statut !== e.apres.statut).pop();
                if (dernier && dernier.action === 'statut_auto') { cible = 'actif'; raison = 'Présence confirmée de nouveau.'; }
            }
            if (cible !== ft.statut) {
                await this.etablissements.changerStatut(ft.id, cible, { raison });
                changements.push({ id: ft.id, nom: ft.nom, avant: ft.statut, apres: cible });
            }
        }
        return changements;
    }

    // --- Fil « Quoi de neuf »

    async quoiDeNeuf(limite = 30) {
        const etat = await this.etat();
        const fiches = new Map((await this.etablissements.lister()).filter(f => f.statut !== 'archive').map(f => [f.id, f]));
        const elements = [];
        for (const e of await this.etablissements.historique()) {
            const cible = etat.alias[e.cible] || e.cible;
            if (!fiches.has(cible) || !e.apres) continue;
            if (e.action === 'creer') elements.push({ ts: e.ts, type: 'ajout', cible, nom: fiches.get(cible).nom, pseudo: e.pseudo || '' });
            if (e.action === 'modifier' || e.action === 'restaurer') {
                const champs = champsModifies(e.avant, e.apres).map(c => LIBELLES_CHAMPS[c] || c);
                elements.push({ ts: e.ts, type: e.action === 'modifier' ? 'modification' : 'restauration', cible, nom: fiches.get(cible).nom,
                    pseudo: e.pseudo || '', detail: champs.join(', ') });
            }
        }
        for (const a of etat.avis) {
            if (a.supprime || a.masque || a.remplace || !fiches.has(a.cible)) continue;
            elements.push({ ts: a.maj, type: 'avis', cible: a.cible, nom: fiches.get(a.cible).nom, pseudo: a.pseudo, note: a.note });
        }
        for (const s of etat.signalements) {
            if (s.type !== 'ferme' || s.etat !== 'ouvert' || !fiches.has(s.cible)) continue;
            elements.push({ ts: s.ts, type: 'fermeture', cible: s.cible, nom: fiches.get(s.cible).nom, date: s.date });
        }
        // Une seule fermeture par fiche et par date
        const vues = new Set();
        return elements.sort((a, b) => (a.ts < b.ts ? 1 : -1)).filter(e => {
            if (e.type !== 'fermeture') return true;
            const k = `${e.cible}|${e.date}`;
            if (vues.has(k)) return false;
            vues.add(k);
            return true;
        }).slice(0, limite);
    }

    // --- Purge des présences brutes de plus de 13 mois (agrégats conservés)

    /**
     * Les déclarations de présence sont des données brutes personnelles (jeton de navigateur) : supprimées après
     * 13 mois. Avant, le nombre de « présent » / « absent » par jour et par fiche est ajouté à stats-presences.json,
     * relu depuis le disque et vérifié ; sinon rien n'est supprimé.
     */
    async purgerPresences(jour = this.aujourdhui()) {
        const limite = moinsMois(jour, this.config.moisConservationJournaux);
        return this.stockage.enSerie(async () => {
            const { lignes } = await this.stockage.lireLignes(this.fichiers.presences);
            const anciennes = lignes.filter(l => l && l.date && l.date < limite);
            if (!anciennes.length) return { limite, supprimees: 0 };
            const derniers = new Map();
            for (const l of anciennes) derniers.set(`${l.date}|${l.cible}|${l.auteur}`, l);
            const agregats = await this.stockage.lireJSON(this.fichiers.agregatsPresences, null).catch(() => null) || { version: 1, jours: {} };
            const nouveaux = {};
            for (const l of derniers.values()) {
                if (!['present', 'absent'].includes(l.etat)) continue;
                const j = nouveaux[l.date] || (nouveaux[l.date] = {});
                const c = j[l.cible] || (j[l.cible] = { present: 0, absent: 0 });
                c[l.etat]++;
            }
            for (const [d, valeur] of Object.entries(nouveaux)) if (!agregats.jours[d]) agregats.jours[d] = valeur;
            try {
                await this.stockage.ecrireJSON(this.fichiers.agregatsPresences, { ...agregats, maj: new Date().toISOString() });
                const relus = JSON.parse(await fs.readFile(this.fichiers.agregatsPresences, 'utf8'));
                const manquants = Object.keys(nouveaux).filter(d => !relus.jours || !relus.jours[d]);
                if (manquants.length) return { limite, supprimees: 0, raison: `Agrégats de présence absents pour ${manquants.length} jour(s).` };
            } catch (err) {
                return { limite, supprimees: 0, raison: `Agrégats de présence illisibles : ${err.message}` };
            }
            await this.stockage.reecrireLignes(this.fichiers.presences, lignes.filter(l => !(l && l.date && l.date < limite)));
            return { limite, supprimees: anciennes.length };
        });
    }
}

module.exports = { Contributions, validerAvis, joursEntre, SEUILS_DEFAUT, CRITERES, TYPES_SIGNALEMENT };
