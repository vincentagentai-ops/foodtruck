// Page de statistiques (usage.log + acces.log), filtrable par période.

(() => {
    const COULEUR = '#4f46e5';
    const COULEUR_2 = '#0ea5e9';
    const graphiques = {};

    function dateIso(d) {
        const p = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    }

    function formaterDate(iso) {
        return iso ? new Date(iso).toLocaleDateString('fr-FR') : '–';
    }

    function remplirTable(id, objet, trier = true) {
        const tbody = document.querySelector(`#${id} tbody`);
        let lignes = Object.entries(objet || {});
        if (trier) lignes = lignes.sort((a, b) => b[1] - a[1]);
        tbody.innerHTML = lignes.length
            ? lignes.map(([cle, valeur]) => `<tr><td>${Commun.html(cle)}</td><td>${Commun.html(valeur)}</td></tr>`).join('')
            : '<tr><td colspan="2" class="vide">Aucune donnée sur la période.</td></tr>';
    }

    /** Crée ou met à jour un graphique Chart.js. */
    function graphique(id, type, libelles, jeux) {
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
                scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
            },
        });
    }

    function afficher(stats) {
        const { usage, acces, periode } = stats;
        document.getElementById('cVisiteurs').textContent = acces.visiteursUniques;
        document.getElementById('cPages').textContent = acces.pagesVues;
        document.getElementById('cSuggestions').textContent = usage.actions['Suggestion envoyée'] || 0;
        document.getElementById('cRequetes').textContent = acces.totalRequetes;
        document.getElementById('infoPeriode').textContent =
            `Période affichée : ${periode.debut ? formaterDate(periode.debut) : 'début'} → ${periode.fin ? formaterDate(periode.fin) : "aujourd'hui"}. `
            + `Données disponibles du ${formaterDate(periode.premiereDonnee)} au ${formaterDate(periode.derniereDonnee)}.`;

        const dates = [...new Set([...Object.keys(acces.visiteursParDate), ...Object.keys(acces.pagesVuesParDate)])].sort();
        graphique('gDates', 'line', dates.map(d => formaterDate(d)), [
            { label: 'Visiteurs uniques', data: dates.map(d => acces.visiteursParDate[d] || 0), borderColor: COULEUR, backgroundColor: COULEUR, tension: 0.2 },
            { label: 'Pages vues', data: dates.map(d => acces.pagesVuesParDate[d] || 0), borderColor: COULEUR_2, backgroundColor: COULEUR_2, tension: 0.2 },
        ]);
        graphique('gJours', 'bar', Object.keys(usage.jours), [
            { label: 'Sélections', data: Object.values(usage.jours), backgroundColor: COULEUR, borderRadius: 4 },
        ]);
        graphique('gHeures', 'bar', acces.activiteParHeure.map((_, h) => `${h}h`), [
            { label: 'Requêtes', data: acces.activiteParHeure, backgroundColor: COULEUR, borderRadius: 4 },
        ]);

        remplirTable('tActions', Object.fromEntries(Object.entries(usage.actions).filter(([, n]) => n > 0)));
        remplirTable('tConsultes', usage.foodtrucksConsultes);
        remplirTable('tTris', usage.tris);
        remplirTable('tPages', acces.pagesVuesParPage);
        remplirTable('tNavigateurs', acces.navigateurs);
        remplirTable('tJoursSemaine', acces.activiteParJourSemaine, false);
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
        charger();
    });
})();
