'use strict';

// Catalogue collaboratif : création, modification avec version attendue (409 + différences), historique en ajout
// seul (historique.jsonl), restauration d'une version, délai de grâce de l'auteur, doublons, fusion de fiches.
//
// Le catalogue reste dans foodtrucks.csv (relu à chaque requête). Chaque changement ajoute une ligne à
// historique.jsonl : {ts, cible, version, auteur, pseudo, action, avant, apres[, vers, absorbe, raison]}.
// `avant` et `apres` sont des copies complètes de la fiche : toute version connue peut être restaurée.

const path = require('path');
const { ErreurHttp, aujourdhui, nouvelId } = require('./stockage');
const { cle, lireLieuxJours, ecrireLieuxJours, lieuDuJour, JOURS } = require('./validation');

// Informations factuelles modifiables par tous (le statut est géré par les seuils et l'administrateur)
const CHAMPS_FACTUELS = ['nom', 'type', 'cuisine', 'categorie', 'etiquettes', 'jours', 'lieu', 'lieux_jours', 'horaires',
    'prix', 'paiements', 'site', 'emplacement', 'photo', 'fidelite'];
// Champs dont la modification est signalée à l'administrateur (« À surveiller »)
const CHAMPS_SENSIBLES = ['nom', 'lieu', 'lieux_jours', 'emplacement', 'photo'];
const LIBELLES_CHAMPS = {
    nom: 'Nom', type: 'Type', cuisine: 'Cuisine', categorie: 'Catégorie', etiquettes: 'Étiquettes', jours: 'Jours',
    lieu: 'Lieu', lieux_jours: 'Lieu selon le jour', horaires: 'Horaires', prix: 'Prix', paiements: 'Paiements',
    site: 'Site', emplacement: 'Lien Google Maps', photo: 'Photo', fidelite: 'Carte de fidélité', statut: 'Statut',
};

// Mots ignorés pour comparer les noms (« Le Food Truck de Moya » ≈ « Moya »)
const MOTS_VIDES = new Set(['le', 'la', 'les', 'l', 'de', 'du', 'des', 'd', 'un', 'une', 'et', 'a', 'au', 'aux', 'chez',
    'the', 'food', 'foods', 'truck', 'trucks', 'foodtruck', 'foodtrucks', 'restaurant', 'resto']);

/** Nom normalisé : sans accents, ponctuation, majuscules ni mots vides. */
function normaliserNom(nom) {
    return cle(nom).split(' ').filter(m => m && !MOTS_VIDES.has(m)).join(' ');
}

/** Distance d'édition (Levenshtein). */
function distance(a, b) {
    let precedente = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
        const ligne = [i];
        for (let j = 1; j <= b.length; j++) {
            ligne[j] = Math.min(precedente[j] + 1, ligne[j - 1] + 1, precedente[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        }
        precedente = ligne;
    }
    return precedente[b.length];
}

/** Deux noms sont-ils proches ? (distance ≤ 2, ou l'un contient l'autre ; égalité exigée pour les noms très courts) */
function nomsProches(a, b) {
    const x = normaliserNom(a).replace(/ /g, '');
    const y = normaliserNom(b).replace(/ /g, '');
    if (!x || !y) return false;
    if (x === y) return true;
    if (Math.min(x.length, y.length) < 4) return false;
    return x.includes(y) || y.includes(x) || distance(x, y) <= 2;
}

const lienNormalise = url => String(url || '').trim().replace(/\/+$/, '').toLowerCase();

/**
 * Établissements (non archivés) qui ressemblent à `candidat` {nom, lieu, emplacement} : nom proche, ou même lien
 * Google Maps. Retourne [{id, nom, categorie, jours, lieu, raisons[]}]. Avertissement seulement, jamais bloquant.
 */
function chercherDoublons(liste, candidat, sauf = null) {
    const resultat = [];
    for (const ft of liste) {
        if (ft.id === sauf || ft.statut === 'archive') continue;
        const raisons = [];
        if (candidat.nom && nomsProches(candidat.nom, ft.nom)) raisons.push('nom proche');
        if (candidat.emplacement && lienNormalise(candidat.emplacement) === lienNormalise(ft.emplacement)) raisons.push('même lien Google Maps');
        if (!raisons.length) continue;
        if (candidat.lieu && (ft.lieu === candidat.lieu || Object.values(lireLieuxJours(ft.lieux_jours)).includes(candidat.lieu))) {
            raisons.push('même lieu');
        }
        resultat.push({ id: ft.id, nom: ft.nom, categorie: ft.categorie, jours: ft.jours, lieu: ft.lieu, raisons });
    }
    return resultat;
}

/** Champs dont la valeur diffère entre deux fiches. */
function champsModifies(avant, apres, champs = [...CHAMPS_FACTUELS, 'statut']) {
    if (!avant || !apres) return [];
    return champs.filter(c => (avant[c] || '') !== (apres[c] || ''));
}

/**
 * Fusion de deux fiches : `garder` reçoit les jours de `absorber` (avec un lieu particulier pour ces jours si le
 * lieu diffère), les étiquettes et paiements des deux, et les informations qui lui manquent.
 */
function fusionnerFiches(garder, absorber) {
    const g = { ...garder };
    for (const c of ['type', 'cuisine', 'categorie', 'horaires', 'prix', 'site', 'lieu', 'emplacement', 'photo', 'fidelite']) {
        if (!g[c] && absorber[c]) g[c] = absorber[c];
    }
    const union = (a, b) => [...new Set([...String(a || '').split(';'), ...String(b || '').split(';')].filter(Boolean))].join(';');
    g.etiquettes = union(g.etiquettes, absorber.etiquettes);
    g.paiements = union(g.paiements, absorber.paiements);
    const joursG = String(g.jours || '').split(';').filter(Boolean);
    const joursA = String(absorber.jours || '').split(';').filter(Boolean);
    const parJour = lireLieuxJours(g.lieux_jours);
    const habituel = g.lieu || g.emplacement;
    for (const jour of joursA) {
        if (joursG.includes(jour)) continue;
        joursG.push(jour);
        const lieu = lieuDuJour(absorber, jour) || absorber.emplacement;
        if (lieu && lieu !== habituel) parJour[jour] = lieu;
    }
    g.jours = JOURS.filter(j => joursG.includes(j)).join(';');
    g.lieux_jours = ecrireLieuxJours(parJour);
    return g;
}

class Etablissements {
    /**
     * `options.horloge` : () => Date (dates simulées dans les tests) ;
     * `options.moderation` : () => Promise<seuils> (délai de grâce).
     */
    constructor(stockage, options = {}) {
        this.stockage = stockage;
        this.config = stockage.config;
        this.horloge = options.horloge || (() => new Date());
        this.journal = options.journal || console;
        this.moderation = options.moderation || (async () => ({ delaiGraceMinutes: 30 }));
        this.fichierHistorique = path.join(this.config.dossierDonnees, 'historique.jsonl');
    }

    lister() { return this.stockage.lireFoodtrucks(); }

    async historique() { return (await this.stockage.lireLignes(this.fichierHistorique)).lignes; }

    /** Identifiants fusionnés : { ancienId: idConservé } (chaînes de fusions suivies). */
    async alias() {
        const directs = {};
        for (const e of await this.historique()) if (e.action === 'fusion' && e.vers) directs[e.cible] = e.vers;
        const resultat = {};
        for (const id of Object.keys(directs)) {
            let cible = id;
            for (let n = 0; directs[cible] && n < 20; n++) cible = directs[cible];
            resultat[id] = cible;
        }
        return resultat;
    }

    /** Fiche `id` (en suivant les fusions) ou erreur 404. */
    async trouver(id, liste) {
        const fiches = liste || await this.lister();
        const alias = await this.alias();
        const ft = fiches.find(f => f.id === (alias[id] || id));
        if (!ft) throw new ErreurHttp(404, 'Établissement introuvable (supprimé ou fusionné ?). Rechargez la page.');
        return ft;
    }

    /** Entrée d'historique (appelée dans la file d'attente, après l'écriture du CSV). */
    async noter(entree) {
        try {
            await this.stockage.ajouterLigne(this.fichierHistorique, { ts: this.horloge().toISOString(), ...entree });
        } catch (err) {
            // Le catalogue est déjà écrit : l'échec de l'historique ne doit pas faire croire à un échec
            this.journal.error("Écriture de l'historique impossible :", err.message);
        }
    }

    /** Versions connues d'une fiche : { version: copie } (d'après l'historique). */
    async versions(id) {
        const versions = {};
        for (const e of await this.historique()) {
            if (e.cible !== id) continue;
            if (e.avant && e.avant.version) versions[e.avant.version] = e.avant;
            if (e.apres && e.apres.version) versions[e.apres.version] = e.apres;
        }
        return versions;
    }

    /** Délai de grâce : pendant N minutes après l'ajout, seul son auteur (ou l'admin) peut modifier la fiche. */
    async verifierGrace(id, auteur) {
        const { delaiGraceMinutes } = await this.moderation();
        const creation = (await this.historique()).find(e => e.cible === id && e.action === 'creer');
        // Ajout par l'administrateur (ou suggestion héritée publiée) : pas de délai de grâce
        if (!creation || creation.auteur === auteur || !/^[0-9a-f]{24}$/.test(creation.auteur || '')) return;
        const reste = new Date(creation.ts).getTime() + delaiGraceMinutes * 60000 - this.horloge().getTime();
        if (reste > 0) {
            throw new ErreurHttp(403, `Cette fiche vient d'être ajoutée : son auteur peut encore la corriger pendant ${Math.ceil(reste / 60000)} min. Réessayez ensuite.`);
        }
    }

    /** Est-on encore dans le délai de grâce de cet auteur ? (pour afficher « Retirer mon ajout ») */
    async dansGrace(id, auteur) {
        const { delaiGraceMinutes } = await this.moderation();
        const creation = (await this.historique()).find(e => e.cible === id && e.action === 'creer');
        return Boolean(creation && auteur && creation.auteur === auteur
            && new Date(creation.ts).getTime() + delaiGraceMinutes * 60000 > this.horloge().getTime());
    }

    /** Publication immédiate d'un établissement validé. Retourne { fiche, doublons }. */
    async creer(donnees, { auteur, pseudo = '', statut = 'actif', action = 'creer' }) {
        let fiche;
        let doublons;
        await this.stockage.enSerie(async () => {
            const liste = await this.lister();
            doublons = chercherDoublons(liste, donnees);
            const jour = aujourdhui(this.horloge());
            fiche = { ...donnees, statut, id: nouvelId(liste.map(f => f.id)), cree_le: jour, maj_le: jour, version: '1' };
            await this.stockage.ecrireFichier(this.config.fichierFoodtrucks, [...liste, fiche]);
            await this.noter({ cible: fiche.id, version: '1', auteur, pseudo, action, avant: null, apres: fiche });
        });
        return { fiche, doublons };
    }

    /**
     * Modification avec version attendue. Si la fiche a changé entre-temps : 409 avec la fiche actuelle et les
     * différences [{champ, libelle, base, actuelle, vous}]. `admin` : statut modifiable, pas de délai de grâce.
     */
    async modifier(id, versionAttendue, donnees, { auteur, pseudo = '', admin = false, action = 'modifier' }) {
        let resultat;
        await this.stockage.enSerie(async () => {
            const liste = await this.lister();
            const ancien = await this.trouver(id, liste);
            if (!admin) await this.verifierGrace(ancien.id, auteur);
            const champs = admin ? [...CHAMPS_FACTUELS, 'statut'] : CHAMPS_FACTUELS;
            if (String(versionAttendue) !== ancien.version) {
                const base = (await this.versions(ancien.id))[String(versionAttendue)];
                const differences = champs
                    .filter(c => (base ? (base[c] || '') !== (ancien[c] || '') : (donnees[c] || '') !== (ancien[c] || '')))
                    .map(c => ({ champ: c, libelle: LIBELLES_CHAMPS[c], base: base ? base[c] || '' : null, actuelle: ancien[c] || '', vous: donnees[c] || '' }));
                const erreur = new ErreurHttp(409, 'La fiche vient d\'être modifiée par un collègue. Voici les différences : rechargez-la avant de modifier.');
                erreur.donnees = { actuelle: ancien, differences };
                throw erreur;
            }
            const nouveau = { ...ancien };
            for (const c of champs) if (donnees[c] !== undefined) nouveau[c] = donnees[c];
            const modifies = champsModifies(ancien, nouveau);
            if (!modifies.length) { resultat = { fiche: ancien, modifies }; return; }
            nouveau.maj_le = aujourdhui(this.horloge());
            nouveau.version = String(Number(ancien.version) + 1);
            await this.stockage.ecrireFichier(this.config.fichierFoodtrucks, liste.map(f => (f.id === ancien.id ? nouveau : f)));
            await this.noter({ cible: ancien.id, version: nouveau.version, auteur, pseudo, action, avant: ancien, apres: nouveau });
            resultat = { fiche: nouveau, modifies };
        });
        return resultat;
    }

    /** Restaure les informations d'une version antérieure (crée une nouvelle version). */
    async restaurer(id, version, versionActuelle, { auteur, pseudo = '', admin = false }) {
        const ft = await this.trouver(id);
        const copie = (await this.versions(ft.id))[String(version)];
        if (!copie) throw new ErreurHttp(404, `Version ${version} inconnue dans l'historique.`);
        const donnees = Object.fromEntries((admin ? [...CHAMPS_FACTUELS, 'statut'] : CHAMPS_FACTUELS).map(c => [c, copie[c] || '']));
        return this.modifier(ft.id, versionActuelle, donnees, { auteur, pseudo, admin, action: 'restaurer' });
    }

    /** Changement de statut automatique (seuils) ou par l'administrateur. */
    async changerStatut(id, statut, { auteur = 'systeme', action = 'statut_auto', raison = '' } = {}) {
        let fiche = null;
        await this.stockage.enSerie(async () => {
            const liste = await this.lister();
            const ancien = liste.find(f => f.id === id);
            if (!ancien || ancien.statut === statut) return;
            fiche = { ...ancien, statut, maj_le: aujourdhui(this.horloge()), version: String(Number(ancien.version) + 1) };
            await this.stockage.ecrireFichier(this.config.fichierFoodtrucks, liste.map(f => (f.id === id ? fiche : f)));
            await this.noter({ cible: id, version: fiche.version, auteur, pseudo: '', action, raison, avant: ancien, apres: fiche });
        });
        return fiche;
    }

    /** Fusion de `absorberId` dans `garderId` (administrateur). Avis, présences et historique suivent par alias. */
    async fusionner(garderId, absorberId) {
        if (garderId === absorberId) throw new ErreurHttp(400, 'Choisissez deux fiches différentes.');
        let resultat;
        await this.stockage.enSerie(async () => {
            const liste = await this.lister();
            const garder = liste.find(f => f.id === garderId);
            const absorber = liste.find(f => f.id === absorberId);
            if (!garder || !absorber) throw new ErreurHttp(404, 'Fiche introuvable.');
            const fusion = { ...fusionnerFiches(garder, absorber), maj_le: aujourdhui(this.horloge()), version: String(Number(garder.version) + 1) };
            await this.stockage.ecrireFichier(this.config.fichierFoodtrucks,
                liste.filter(f => f.id !== absorberId).map(f => (f.id === garderId ? fusion : f)));
            await this.noter({ cible: garderId, version: fusion.version, auteur: 'admin', pseudo: '', action: 'fusion', absorbe: absorberId, avant: garder, apres: fusion });
            await this.noter({ cible: absorberId, version: absorber.version, auteur: 'admin', pseudo: '', action: 'fusion', vers: garderId, avant: absorber, apres: null });
            resultat = fusion;
        });
        return resultat;
    }

    /** Suppression définitive d'une fiche (administrateur). */
    async supprimer(id, versionAttendue) {
        let ancien;
        await this.stockage.enSerie(async () => {
            const liste = await this.lister();
            ancien = liste.find(f => f.id === id);
            if (!ancien) throw new ErreurHttp(404, 'Établissement introuvable (supprimé entre-temps ?). Rechargez la page.');
            if (String(versionAttendue) !== ancien.version) throw new ErreurHttp(409, 'Cet établissement a été modifié entre-temps. Rechargez la page.');
            await this.stockage.ecrireFichier(this.config.fichierFoodtrucks, liste.filter(f => f.id !== id));
        });
        return ancien;
    }
}

module.exports = {
    Etablissements, CHAMPS_FACTUELS, CHAMPS_SENSIBLES, LIBELLES_CHAMPS,
    normaliserNom, distance, nomsProches, chercherDoublons, champsModifies, fusionnerFiches,
};
