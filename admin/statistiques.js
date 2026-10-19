// Page de statistiques (agrégats calculés par le serveur), filtrable par période.

(() => {
    const COULEUR = '#4f46e5';
    const COULEUR_2 = '#0ea5e9';
    const COULEUR_3 = '#94a3b8';
    const graphiques = {};

    const LIBELLES = {
        chargement: 'Affichage de la liste (chargement)',
        jour_clic: 'Clic sur un jour',
        recherche: 'Recherche',
        filtre: 'Changement de filtre',
        filtres_effaces: 'Filtres effacés',
        tri: 'Changement de classement / tri',
        hasard: '« Au hasard »',
        clic_site: 'Clic vers le site',
        clic_maps: 'Clic vers Google Maps',
        favori_ajout: 'Favori ajouté',
        favori_retrait: 'Favori retiré',
        nouveau_clic: 'Clic dans « Nouveaux cette semaine »',
        suggestion_ouverte: 'Formulaire de suggestion ouvert',
        suggestion_erreur: 'Suggestion refusée (erreur de saisie)',
        suggestion: 'Suggestion reçue',
        clic_mail: 'Clic sur « Envoyez-moi un mail »',
        admin_ajout: 'Admin : ajout',
        admin_modification: 'Admin : modification',
        admin_suppression: 'Admin : suppression',
        admin_validation: 'Admin : suggestion (héritée) publiée',
        admin_rejet: 'Admin : suggestion (héritée) écartée',
        admin_lieu: 'Admin : lieu ajouté / modifié',
        jour_ancien: 'Jour sélectionné (ancien calcul : chargements + clics)',
        consultation_ancien: 'Clic sur un établissement (ancien calcul)',
        ancien: 'Autres anciens libellés',
        // Collaboration (3.2.0) : contributions comptées par le serveur, sans identifiant de navigateur
        ajout: 'Établissement ajouté par un collègue',
        modification: 'Infos modifiées par un collègue',
        restauration: "Version restaurée depuis l'historique",
        retrait: 'Ajout retiré par son auteur',
        avis: 'Avis publié',
        avis_modifie: 'Avis modifié',
        avis_supprime: 'Avis supprimé par son auteur',
        presence: 'Présence du jour déclarée',
        signalement: 'Signalement',
        avis_masque_auto: 'Avis masqué automatiquement',
        statut_auto: 'Statut changé automatiquement (seuils)',
        fiche_ouverte: "Fiche d'un établissement ouverte",
        historique_ouvert: 'Historique consulté',
        ajout_ouvert: "Formulaire d'ajout ouvert",
        ajout_erreur: 'Ajout refusé (erreur de saisie)',
        modification_ouverte: 'Formulaire de modification ouvert',
        doublon_vu: 'Avertissement de doublon affiché',
        quoi_de_neuf_clic: 'Clic dans « Quoi de neuf »',
        admin_fusion: 'Admin : fiches fusionnées',
        admin_moderation: 'Admin : modération (avis, signalements)',
        admin_restauration: 'Admin : version restaurée',
        admin_blocage: 'Admin : blocage / déblocage',
        admin_seuils: 'Admin : seuils modifiés',
        admin_purge: 'Admin : suppression définitive d\'un avis',
    };

    function dateIso(d) {
        const p = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    }

    function formaterDate(iso) {
        if (!iso) return '–';
        const [a, m, j] = iso.slice(0, 10).split('-');
        return `${j}/${m}/${a}`;
    }

    function remplirLignes(id, lignes, colonnes) {
        const tbody = document.querySelector(`#${id} tbody`);
        tbody.innerHTML = lignes.length
            ? lignes.map(l => `<tr>${l.map(v => `<td>${Commun.html(v)}</td>`).join('')}</tr>`).join('')
            : `<tr><td colspan="${colonnes}" class="vide">Aucune donnée sur la période.</td></tr>`;
    }

    function remplirTable(id, objet, libelles = {}) {
        const lignes = Object.entries(objet || {}).sort((a, b) => b[1] - a[1]).map(([cle, n]) => [libelles[cle] || cle, n]);
        remplirLignes(id, lignes, 2);
    }

    /** Crée ou met à jour un graphique Chart.js. */
    function graphique(id, type, libelles, jeux, options = {}) {
        if (typeof Chart === 'undefined') return; // Chart.js indisponible : les tableaux restent affichés
        const data = { labels: libelles, datasets: jeux };
        if (graphiques[id]) {
            graphiques[id].data = data;
            graphiques[id].update();
            return;
        }
        graphiques[id] = new Chart(document.getElementById(id), {
            type,
            data,
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: jeux.length > 1 } },
                scales: {
                    x: { stacked: Boolean(options.empile) },
                    y: { beginAtZero: true, ticks: { precision: 0 }, stacked: Boolean(options.empile) },
                },
            },
        });
    }

    function afficher(stats) {
        const { totaux, periode } = stats;
        document.getElementById('cJour').textContent = totaux.actifsMoyenJour;
        document.getElementById('cSemaine').textContent = totaux.actifsMoyenSemaine;
        document.getElementById('cMois').textContent = totaux.actifsMoyenMois;
        document.getElementById('cNouveaux').textContent = totaux.nouveaux;
        document.getElementById('cPages').textContent = totaux.pagesVues;
        document.getElementById('cSuggestions').textContent = totaux.suggestions;
        document.getElementById('infoPeriode').textContent =
            `Période affichée : ${periode.debut ? formaterDate(periode.debut) : 'début'} → ${periode.fin ? formaterDate(periode.fin) : "aujourd'hui"}. `
            + `Données disponibles du ${formaterDate(periode.premiereDonnee)} au ${formaterDate(periode.derniereDonnee)}.`;

        const ancien = stats.jours.some(j => j.actifsIp > 0);
        const rupture = document.getElementById('rupture');
        rupture.hidden = !ancien && !periode.debutNavigateurs;
        rupture.textContent = periode.debutNavigateurs
            ? `Rupture de série : depuis le ${formaterDate(periode.debutNavigateurs)} (version 3.1.0), les visiteurs sont comptés par navigateur (cookie anonyme) ; avant, par adresse IP (« ancien calcul »). Les deux séries ne sont pas comparables.`
            : 'Ces données datent d\'avant la version 3.1.0 : visiteurs comptés par adresse IP (« ancien calcul »), non comparables aux navigateurs.';

        const jours = stats.jours;
        const jeux = [
            { label: 'Navigateurs actifs', data: jours.map(j => j.actifs), borderColor: COULEUR, backgroundColor: COULEUR, tension: 0.2 },
            { label: 'Pages vues', data: jours.map(j => j.pagesVues), borderColor: COULEUR_2, backgroundColor: COULEUR_2, tension: 0.2 },
        ];
        if (ancien) {
            jeux.push({ label: 'Adresses IP (ancien calcul)', data: jours.map(j => j.actifsIp), borderColor: COULEUR_3, backgroundColor: COULEUR_3, borderDash: [5, 4], tension: 0.2 });
        }
        graphique('gDates', 'line', jours.map(j => formaterDate(j.date)), jeux);

        const semaines = stats.semaines.filter(s => s.actifs > 0);
        graphique('gSemaines', 'bar', semaines.map(s => `${s.semaine} (${formaterDate(s.debut).slice(0, 5)})`), [
            { label: 'Nouveaux', data: semaines.map(s => s.nouveaux), backgroundColor: COULEUR_2 },
            { label: 'Récurrents', data: semaines.map(s => s.recurrents), backgroundColor: COULEUR },
        ], { empile: true });
        const nomsJours = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi'];
        graphique('gJours', 'bar', nomsJours, [
            { label: 'Clics', data: nomsJours.map(j => stats.joursConsultes[j] || 0), backgroundColor: COULEUR, borderRadius: 4 },
        ]);
        graphique('gHeures', 'bar', stats.heures.map((_, h) => `${h}h`), [
            { label: 'Navigateurs', data: stats.heures, backgroundColor: COULEUR, borderRadius: 4 },
        ]);

        remplirTable('tEvenements', stats.evenements, LIBELLES);
        const consultes = Object.entries(stats.consultations)
            .map(([cle, c]) => [cle.startsWith('nom:') ? cle.slice(4) : (stats.noms[cle] || `(supprimé : ${cle})`), c.site, c.maps, c.autres])
            .sort((a, b) => (b[1] + b[2] + b[3]) - (a[1] + a[2] + a[3]));
        remplirLignes('tConsultes', consultes, 4);
        remplirTable('tPages', stats.pages);
        remplirTable('tNavigateurs', stats.navigateurs);
        remplirLignes('tMois', stats.mois.map(m => [m.mois, m.actifs, m.nouveaux, m.recurrents, m.actifsIp]), 5);
        remplirLignes('tTechnique', [
            ['Requêtes (pages et API)', stats.technique.requetes],
            ['Réponses en erreur (≥ 400)', stats.technique.erreurs],
            ['Temps de réponse moyen', `${stats.technique.dureeMoyenneMs} ms`],
        ], 2);
    }

    async function charger() {
        const params = new URLSearchParams();
        const debut = document.getElementById('debut').value;
        const fin = document.getElementById('fin').value;
        if (debut) params.set('debut', debut);
        if (fin) params.set('fin', fin);
        try {
            afficher(await Commun.api(`/api/admin/statistiques?${params}`));
        } catch (err) {
            Commun.notifier(`Statistiques indisponibles : ${err.message}`, 'erreur');
        }
    }

    function periode(valeur) {
        const fin = new Date();
        if (valeur === 'tout') {
            document.getElementById('debut').value = '';
            document.getElementById('fin').value = '';
        } else {
            const debut = new Date();
            debut.setDate(fin.getDate() - Number(valeur) + 1);
            document.getElementById('debut').value = dateIso(debut);
            document.getElementById('fin').value = dateIso(fin);
        }
        charger();
    }

    document.addEventListener('DOMContentLoaded', () => {
        document.getElementById('formPeriode').addEventListener('submit', e => {
            e.preventDefault();
            const debut = document.getElementById('debut').value;
            const fin = document.getElementById('fin').value;
            if (debut && fin && debut > fin) {
                Commun.notifier('La date de début doit précéder la date de fin.', 'erreur');
                return;
            }
            charger();
        });
        document.querySelectorAll('[data-periode]').forEach(b => b.addEventListener('click', () => periode(b.dataset.periode)));
        periode('30');
    });
})();
