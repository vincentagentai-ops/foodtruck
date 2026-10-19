// Logique de la page d'accueil sans accès à la page ni au stockage : filtres, « Au hasard » avec exclusions,
// liens partageables, texte « Copier pour Teams », carnet personnel, préférences, numérotation du plan.
// Chargé tel quel par le navigateur (objet global Logique) et par les tests (require).

const Logique = (() => {
    const JOURS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi'];
    const FILTRES_VIDES = { categorie: '', prixMax: '', type: '', etiquette: '', paiement: '', essai: '' };
    const TRIS = ['lieu', 'nom', 'prix'];
    const ESSAIS = ['pas_essaye', 'a_tester', 'essaye']; // filtre « Essayé ? »
    const MARQUES = ['essaye', 'a_tester']; // marques posées sur un établissement
    const CARNET_MAX = 500; // entrées gardées au plus (les plus anciennes sont oubliées)

    const listeDe = valeur => String(valeur || '').split(';').map(v => v.trim()).filter(Boolean);
    const simplifier = texte => String(texte || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    const texteCourt = (v, max = 80) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max) : '');

    /** Premier nombre du prix (pour le tri et le filtre), Infinity si inconnu. */
    function prixMin(prix) {
        const n = parseFloat(String(prix || '').replace(',', '.'));
        return Number.isNaN(n) ? Infinity : n;
    }

    /** « Jeudi=parking-nord;Vendredi=https://… » -> { Jeudi: 'parking-nord', Vendredi: 'https://…' } */
    function lireLieuxJours(texte) {
        const resultat = {};
        for (const morceau of String(texte || '').split(/;(?=\s*(?:Lundi|Mardi|Mercredi|Jeudi|Vendredi)\s*=)/)) {
            const i = morceau.indexOf('=');
            if (i > 0) resultat[morceau.slice(0, i).trim()] = morceau.slice(i + 1).trim();
        }
        return resultat;
    }

    /** Lieu (identifiant ou lien Maps) d'un établissement pour un jour donné. */
    const lieuDuJour = (ft, jour) => lireLieuxJours(ft.lieux_jours)[jour] || ft.lieu || '';
    const joursDe = ft => listeDe(ft.jours);

    /** Jour ouvré d'une date (« Jeudi »), ou null le week-end. */
    function jourDeLaSemaine(date = new Date()) {
        const i = date.getDay();
        return i >= 1 && i <= 5 ? JOURS[i - 1] : null;
    }

    // --- Marques « Déjà essayé » / « À tester » et carnet

    /** Un établissement est « essayé » s'il est marqué ainsi ou s'il figure dans le carnet. */
    function estEssaye(id, marques = {}, carnet = []) {
        return marques[id] === 'essaye' || carnet.some(e => e.id === id);
    }

    /** Marque d'un établissement après un clic : le même bouton retire la marque. */
    function basculerMarque(marques, id, marque) {
        const nouvelles = { ...marques };
        if (!MARQUES.includes(marque) || nouvelles[id] === marque) delete nouvelles[id];
        else nouvelles[id] = marque;
        return nouvelles;
    }

    /** Ajoute « j'y ai mangé » (une entrée par établissement et par jour), plus récentes d'abord. */
    function ajouterAuCarnet(carnet, { id, nom, date }) {
        const autres = carnet.filter(e => !(e.id === id && e.date === date));
        return [{ id, nom: texteCourt(nom), date }, ...autres]
            .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0))
            .slice(0, CARNET_MAX);
    }

    const retirerDuCarnet = (carnet, id, date) => carnet.filter(e => !(e.id === id && e.date === date));

    /** Entrées valides seulement (le stockage du navigateur peut avoir été modifié à la main). */
    function nettoyerCarnet(carnet) {
        if (!Array.isArray(carnet)) return [];
        return carnet.filter(e => e && typeof e.id === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.date))
            .map(e => ({ id: e.id, nom: texteCourt(e.nom), date: e.date }));
    }

    /** { repas, adresses } : nombre d'entrées du carnet, nombre d'adresses testées (carnet + « Déjà essayé »). */
    function resumeCarnet(carnet = [], marques = {}) {
        const adresses = new Set(carnet.map(e => e.id));
        for (const [id, m] of Object.entries(marques)) if (m === 'essaye') adresses.add(id);
        return { repas: carnet.length, adresses: adresses.size };
    }

    /** Fiches fusionnées : marques et carnet suivent la fiche conservée ; établissements disparus oubliés. */
    function suivreAlias({ marques = {}, carnet = [] }, alias = {}, idsExistants = null) {
        const garde = id => !idsExistants || idsExistants.has(id);
        const nouvellesMarques = {};
        for (const [id, m] of Object.entries(marques)) {
            const cible = alias[id] || id;
            if (garde(cible) && MARQUES.includes(m) && !(nouvellesMarques[cible] === 'essaye')) nouvellesMarques[cible] = m;
        }
        // Le carnet est un historique : une adresse disparue y reste (avec son nom)
        const nouveauCarnet = carnet.map(e => ({ ...e, id: alias[e.id] || e.id }));
        return { marques: nouvellesMarques, carnet: nouveauCarnet };
    }

    // --- Filtres

    /**
     * L'établissement correspond-il aux filtres et à la recherche ?
     * contexte : { filtres, recherche, jour, lieux ({id: lieu}), marques, carnet }
     */
    function correspond(ft, { filtres = {}, recherche = '', jour = '', lieux = {}, marques = {}, carnet = [] } = {}) {
        const f = { ...FILTRES_VIDES, ...filtres };
        if (f.categorie && ft.categorie !== f.categorie) return false;
        if (f.type && ft.type !== f.type) return false;
        if (f.prixMax && !(prixMin(ft.prix) <= Number(f.prixMax))) return false;
        if (f.etiquette && !listeDe(ft.etiquettes).includes(f.etiquette)) return false;
        if (f.paiement && !listeDe(ft.paiements).includes(f.paiement)) return false;
        if (f.essai) {
            const essaye = estEssaye(ft.id, marques, carnet);
            if (f.essai === 'pas_essaye' && essaye) return false;
            if (f.essai === 'essaye' && !essaye) return false;
            if (f.essai === 'a_tester' && marques[ft.id] !== 'a_tester') return false;
        }
        if (recherche) {
            const lieu = lieux[lieuDuJour(ft, jour)];
            const texte = simplifier([ft.nom, ft.cuisine, ft.categorie, ft.etiquettes, ft.paiements,
                ft.type, lieu ? lieu.nom : ''].join(' '));
            if (!simplifier(recherche).split(/\s+/).filter(Boolean).every(mot => texte.includes(mot))) return false;
        }
        return true;
    }

    const filtresActifs = filtres => Object.keys(FILTRES_VIDES).some(k => Boolean(filtres && filtres[k]));
    const memesFiltres = (a, b) => Object.keys(FILTRES_VIDES).every(k => String((a || {})[k] || '') === String((b || {})[k] || ''));

    /** Garde uniquement les filtres connus, en texte. */
    function nettoyerFiltres(filtres) {
        const propres = { ...FILTRES_VIDES };
        for (const k of Object.keys(FILTRES_VIDES)) {
            const v = filtres && filtres[k];
            if (typeof v === 'string' || typeof v === 'number') propres[k] = texteCourt(String(v));
        }
        if (propres.essai && !ESSAIS.includes(propres.essai)) propres.essai = '';
        if (propres.prixMax && !/^\d{1,3}$/.test(propres.prixMax)) propres.prixMax = '';
        return propres;
    }

    /**
     * « Au hasard » parmi `liste` : `nonEssaye` écarte ce qui est déjà essayé ; `exclure` (ids) évite de retomber
     * sur le tirage précédent quand c'est possible. Retourne l'établissement tiré, ou null s'il n'y a aucun candidat.
     */
    function tirerAuHasard(liste, { nonEssaye = false, marques = {}, carnet = [], exclure = [], aleatoire = Math.random } = {}) {
        let candidats = nonEssaye ? liste.filter(ft => !estEssaye(ft.id, marques, carnet)) : [...liste];
        if (!candidats.length) return null;
        const sansExclus = candidats.filter(ft => !exclure.includes(ft.id));
        if (sansExclus.length) candidats = sansExclus;
        const i = Math.min(candidats.length - 1, Math.floor(aleatoire() * candidats.length));
        return candidats[i];
    }

    // --- Préférences alimentaires (navigateur)

    /** Préférences valides : { filtres (filtres par défaut), privilegier (étiquettes affichées en premier) }. */
    function nettoyerPreferences(p) {
        const prefs = p && typeof p === 'object' ? p : {};
        return {
            filtres: nettoyerFiltres(prefs.filtres || {}),
            privilegier: Array.isArray(prefs.privilegier) ? prefs.privilegier.filter(e => typeof e === 'string').map(e => texteCourt(e)).slice(0, 20) : [],
        };
    }

    /** Nombre d'étiquettes privilégiées présentes sur l'établissement (pour le classer en premier). */
    function scorePreference(ft, privilegier = []) {
        if (!privilegier.length) return 0;
        const etiquettes = listeDe(ft.etiquettes);
        return privilegier.filter(e => etiquettes.includes(e)).length;
    }

    // --- Liens partageables : /?jour=jeudi&q=thai&categorie=Asiatique&prix=12&fiche=ab12cd&vue=semaine

    // paramètre d'adresse -> clé de filtre
    const PARAMS_FILTRES = { categorie: 'categorie', prix: 'prixMax', type: 'type', etiquette: 'etiquette', paiement: 'paiement', essai: 'essai' };

    /** État de la page -> chaîne de paramètres (« ?… », vide si rien à partager). Ordre stable. */
    function construireLien({ jour = '', vue = '', recherche = '', filtres = {}, tri = '', fiche = '' } = {}) {
        const p = new URLSearchParams();
        if (jour && JOURS.includes(jour)) p.set('jour', jour.toLowerCase());
        if (vue === 'semaine') p.set('vue', 'semaine');
        if (recherche) p.set('q', recherche);
        for (const [param, cle] of Object.entries(PARAMS_FILTRES)) if (filtres[cle]) p.set(param, filtres[cle]);
        if (tri && tri !== 'lieu' && TRIS.includes(tri)) p.set('tri', tri);
        if (fiche) p.set('fiche', fiche);
        const texte = p.toString();
        return texte ? `?${texte}` : '';
    }

    /**
     * Paramètres de l'adresse -> { jour, vue, recherche, filtres (seulement ceux présents), tri, fiche, present }.
     * Les valeurs inconnues sont ignorées ; `present` indique si l'adresse contenait au moins un paramètre reconnu.
     */
    function lireLien(recherche) {
        const p = new URLSearchParams(String(recherche || '').replace(/^\?/, ''));
        const resultat = { jour: '', vue: '', recherche: '', filtres: {}, tri: '', fiche: '', present: false };
        const jour = JOURS.find(j => simplifier(j) === simplifier(p.get('jour') || ''));
        if (jour) resultat.jour = jour;
        if (p.get('vue') === 'semaine') resultat.vue = 'semaine';
        if (p.has('q')) resultat.recherche = texteCourt(p.get('q'));
        for (const [param, cle] of Object.entries(PARAMS_FILTRES)) {
            if (p.has(param)) resultat.filtres[cle] = texteCourt(p.get(param));
        }
        if (resultat.filtres.essai !== undefined && !ESSAIS.includes(resultat.filtres.essai)) delete resultat.filtres.essai;
        if (resultat.filtres.prixMax !== undefined && !/^\d{1,3}$/.test(resultat.filtres.prixMax)) delete resultat.filtres.prixMax;
        if (TRIS.includes(p.get('tri'))) resultat.tri = p.get('tri');
        const fiche = p.get('fiche') || '';
        if (/^[A-Za-z0-9_-]{1,40}$/.test(fiche)) resultat.fiche = fiche;
        resultat.present = Boolean(resultat.jour || resultat.vue || resultat.recherche || resultat.tri || resultat.fiche
            || Object.keys(resultat.filtres).length);
        return resultat;
    }

    // --- « Copier pour Teams »

    /** "10-15" -> « 10–15 € » ; "12" -> « 12 € ». */
    function prixCourt(prix) {
        const p = String(prix || '').replace(/€/g, '').trim();
        if (!p) return '';
        const [min, max] = p.split(/\s*(?:-|–|à)\s*/);
        return max ? `${min}–${max} €` : `${min} €`;
    }

    /**
     * « Midi : Ô Tuk Tuk (asiatique, 10–15 €), Parking Nord, confirmé à 11h40 — on y va ? » puis le lien sur une
     * seconde ligne. `lieu` : nom du lieu (facultatif) ; `presence` : présence du jour ({presents, derniere}).
     */
    function texteTeams(ft, { lieu = '', presence = null, lien = '' } = {}) {
        const cuisine = String(ft.categorie && ft.categorie !== 'Autre' ? ft.categorie : ft.cuisine || '').toLowerCase();
        const details = [cuisine, prixCourt(ft.prix)].filter(Boolean).join(', ');
        let texte = `Midi : ${ft.nom}${details ? ` (${details})` : ''}`;
        if (lieu) texte += `, ${lieu}`;
        if (presence && presence.presents > 0 && presence.derniere) texte += `, confirmé à ${presence.derniere}`;
        texte += ' — on y va ?';
        if (lien) texte += `\n${lien}`;
        return texte;
    }

    // --- Plan local : numéros des lieux du jour (dans l'ordre de la liste)

    /**
     * Lieux du jour numérotés à partir de 1 : `ordre` = identifiants de lieux dans l'ordre d'affichage (doublons et
     * valeurs vides ignorés). Retourne { id: numéro }.
     */
    function numeroterLieux(ordre) {
        const numeros = {};
        let n = 0;
        for (const id of ordre) if (id && !numeros[id]) numeros[id] = ++n;
        return numeros;
    }

    /** Position valide sur le plan (pourcentages 0 à 100). */
    const positionValide = pos => Boolean(pos) && [pos.x, pos.y].every(v => typeof v === 'number' && v >= 0 && v <= 100);

    return {
        JOURS, FILTRES_VIDES, TRIS, ESSAIS, MARQUES, CARNET_MAX,
        listeDe, simplifier, prixMin, lireLieuxJours, lieuDuJour, joursDe, jourDeLaSemaine,
        estEssaye, basculerMarque, ajouterAuCarnet, retirerDuCarnet, nettoyerCarnet, resumeCarnet, suivreAlias,
        correspond, filtresActifs, memesFiltres, nettoyerFiltres, tirerAuHasard,
        nettoyerPreferences, scorePreference,
        construireLien, lireLien, prixCourt, texteTeams, numeroterLieux, positionValide,
    };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = Logique;
