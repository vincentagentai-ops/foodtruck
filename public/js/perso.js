// Données personnelles gardées dans ce navigateur uniquement (localStorage), jamais envoyées au serveur :
// marques « Déjà essayé » / « À tester », carnet « J'y ai mangé », préférences alimentaires.
// Les favoris (ft_favoris), les filtres (ft_filtres) et le nom déclaré (ft_pseudo) sont gérés ailleurs.

const Perso = (() => {
    const CLE_MARQUES = 'ft_marques';
    const CLE_CARNET = 'ft_carnet';
    const CLE_PREFERENCES = 'ft_preferences';
    /** Toutes les clés que le site écrit dans le navigateur (page « Données et confidentialité »). */
    const TOUTES_LES_CLES = ['ft_favoris', 'ft_filtres', 'ft_pseudo', CLE_MARQUES, CLE_CARNET, CLE_PREFERENCES,
        'ft_hasard_non_essaye', 'ft_plan_ouvert', 'ft_recherche_ouverte'];

    const ecouteurs = [];
    const prevenir = () => ecouteurs.forEach(fn => fn());

    function marques() {
        const m = Commun.lireLocal(CLE_MARQUES, {});
        return m && typeof m === 'object' && !Array.isArray(m) ? m : {};
    }
    const carnet = () => Logique.nettoyerCarnet(Commun.lireLocal(CLE_CARNET, []));
    const preferences = () => Logique.nettoyerPreferences(Commun.lireLocal(CLE_PREFERENCES, null));
    const aDesPreferences = () => Commun.lireLocal(CLE_PREFERENCES, null) !== null;

    /** Pose ou retire (même marque) « essaye » ou « a_tester ». Retourne la nouvelle marque ('' si retirée). */
    function basculerMarque(id, marque) {
        const nouvelles = Logique.basculerMarque(marques(), id, marque);
        Commun.ecrireLocal(CLE_MARQUES, nouvelles);
        Commun.evenement(nouvelles[id] ? `marque_${nouvelles[id]}` : 'marque_retiree', id);
        prevenir();
        return nouvelles[id] || '';
    }

    /** « J'y ai mangé aujourd'hui » : ajoute au carnet (ou retire si déjà noté aujourd'hui) et marque « essayé ». */
    function basculerRepas(ft) {
        const date = Commun.dateISO();
        const actuel = carnet();
        if (actuel.some(e => e.id === ft.id && e.date === date)) {
            Commun.ecrireLocal(CLE_CARNET, Logique.retirerDuCarnet(actuel, ft.id, date));
            Commun.evenement('carnet_retrait', ft.id);
            prevenir();
            return false;
        }
        Commun.ecrireLocal(CLE_CARNET, Logique.ajouterAuCarnet(actuel, { id: ft.id, nom: ft.nom, date }));
        const m = marques();
        if (m[ft.id] !== 'essaye') Commun.ecrireLocal(CLE_MARQUES, { ...m, [ft.id]: 'essaye' });
        Commun.evenement('carnet_ajout', ft.id);
        prevenir();
        return true;
    }

    function retirerRepas(id, date) {
        Commun.ecrireLocal(CLE_CARNET, Logique.retirerDuCarnet(carnet(), id, date));
        Commun.evenement('carnet_retrait', id);
        prevenir();
    }

    const mangeAujourdhui = id => carnet().some(e => e.id === id && e.date === Commun.dateISO());

    /** Efface le carnet et les marques « Déjà essayé » / « À tester ». */
    function effacerCarnet() {
        try { localStorage.removeItem(CLE_CARNET); localStorage.removeItem(CLE_MARQUES); } catch { /* stockage indisponible */ }
        Commun.evenement('carnet_efface');
        prevenir();
    }

    function enregistrerPreferences(prefs) {
        Commun.ecrireLocal(CLE_PREFERENCES, Logique.nettoyerPreferences(prefs));
        prevenir();
    }
    function effacerPreferences() {
        try { localStorage.removeItem(CLE_PREFERENCES); } catch { /* stockage indisponible */ }
        prevenir();
    }

    /** Après un rechargement de la liste : fiches fusionnées suivies, marques d'établissements disparus oubliées. */
    function suivreAlias(alias, idsExistants) {
        const { marques: m, carnet: c } = Logique.suivreAlias({ marques: marques(), carnet: carnet() }, alias, idsExistants);
        Commun.ecrireLocal(CLE_MARQUES, m);
        if (c.length) Commun.ecrireLocal(CLE_CARNET, c);
    }

    /** Efface tout ce que le site garde dans ce navigateur. */
    function toutEffacer() {
        for (const cle of TOUTES_LES_CLES) {
            try { localStorage.removeItem(cle); } catch { /* stockage indisponible */ }
        }
        prevenir();
    }

    const surChangement = fn => ecouteurs.push(fn);

    return {
        TOUTES_LES_CLES, marques, carnet, preferences, aDesPreferences, basculerMarque, basculerRepas, retirerRepas,
        mangeAujourdhui, effacerCarnet, enregistrerPreferences, effacerPreferences, suivreAlias, toutEffacer, surChangement,
    };
})();
