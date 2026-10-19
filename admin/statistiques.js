// Tableau de bord des statistiques (agrégats calculés par le serveur) : période, tuiles comparées à la période
// précédente, courbes avec marqueurs de version, carte de chaleur, entonnoir, établissements, contributions, cohortes.

(() => {
    const COULEUR = '#4f46e5';
    const COULEUR_2 = '#0ea5e9';
    const COULEUR_3 = '#94a3b8';
    const COULEUR_MARQUEUR = '#d97706';
    const COULEURS_CONTRIBUTIONS = {
        ajout: '#4f46e5', suggestion: '#818cf8', modification: '#0ea5e9', restauration: '#67e8f9',
        avis: '#059669', avis_modifie: '#6ee7b7', presence: '#d97706', signalement: '#dc2626',
    };
    const graphiques = {};
    const JOURS_SEMAINE = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

    const LIBELLES_CONTRIBUTIONS = {
        suggestion: 'Suggestions (avant 3.2.0)', ajout: 'Ajouts', modification: 'Modifications', restauration: 'Restaurations',
        avis: 'Avis', avis_modifie: 'Avis modifiés', presence: 'Présences', signalement: 'Signalements',
    };
    const FONCTIONNALITES = {
        fiche: "Ouvrir la fiche d'un établissement",
        maps: 'Clic vers Google Maps',
        site: 'Clic vers le site',
        jour: 'Changer de jour',
        recherche: 'Recherche',
        filtres: 'Filtres',
        tri: 'Classement',
        hasard: '« Au hasard »',
        favoris: 'Favoris (ajout / retrait)',
        nouveautes: '« Nouveaux » et « Quoi de neuf »',
        historique: 'Historique d\'une fiche',
        ajout: "Formulaire d'ajout",
        modification: 'Formulaire de modification',
        semaine: 'Vue semaine',
        essais: '« Déjà essayé » / « À tester »',
        teams: '« Copier pour Teams »',
        lien: 'Arrivée par un lien partagé',
        preferences: 'Préférences alimentaires',
        carnet: 'Carnet « J\'y ai mangé »',
        plan: 'Plan des emplacements',
    };
    const LIBELLES = {
        page_vue: 'Page vue',
        chargement: 'Affichage de la liste (chargement)',
        jour_clic: 'Clic sur un jour',
        recherche: 'Recherche',
        recherche_vide: 'Recherche sans résultat',
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
        jour_ancien: 'Jour sélectionné (ancien calcul : chargements + clics)',
        consultation_ancien: 'Clic sur un établissement (ancien calcul)',
        ancien: 'Autres anciens libellés',
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
        admin_vu: 'Admin : connexion (navigateur exclu)',
        admin_ajout: 'Admin : ajout',
        admin_modification: 'Admin : modification',
        admin_suppression: 'Admin : suppression',
        admin_validation: 'Admin : suggestion (héritée) publiée',
        admin_rejet: 'Admin : suggestion (héritée) écartée',
        admin_lieu: 'Admin : lieu ajouté / modifié',
        admin_fusion: 'Admin : fiches fusionnées',
        admin_moderation: 'Admin : modération (avis, signalements)',
        admin_restauration: 'Admin : version restaurée',
        admin_blocage: 'Admin : blocage / déblocage',
        admin_seuils: 'Admin : seuils modifiés',
        admin_purge: 'Admin : suppression définitive d\'un avis',
        admin_plan: 'Admin : plan des emplacements modifié',
        vue_semaine: 'Vue semaine affichée',
        marque_essaye: 'Marqué « Déjà essayé »',
        marque_a_tester: 'Marqué « À tester »',
        marque_retiree: 'Marque « essayé / à tester » retirée',
        hasard_non_essaye: '« Au hasard » (que je n\'ai pas essayé)',
        copie_teams: '« Copier pour Teams »',
        lien_ouvert: 'Arrivée par un lien partagé',
        preferences: 'Préférences alimentaires modifiées',
        carnet_ajout: '« J\'y ai mangé aujourd\'hui »',
        carnet_retrait: 'Repas retiré du carnet',
        carnet_ouvert: 'Carnet consulté',
        carnet_efface: 'Carnet effacé',
        plan_ouvert: 'Plan des emplacements déplié',
        plan_lieu_clic: 'Clic sur un lieu du plan',
        donnees_locales_effacees: 'Données du navigateur effacées',
    };

    // --- Outils

    function dateIso(d) {
        const p = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    }

    function decaler(iso, n) {
        const [a, m, j] = iso.split('-').map(Number);
        return dateIso(new Date(a, m - 1, j + n));
    }

    function formaterDate(iso, court = false) {
        if (!iso) return '–';
        const [a, m, j] = iso.slice(0, 10).split('-');
        return court ? `${j}/${m}` : `${j}/${m}/${a}`;
    }

    const nombre = n => (n == null ? '–' : String(n).replace('.', ','));
    const pourcent = (n, total) => (total ? Math.round(n / total * 100) : 0);

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

    /** Écart avec la période précédente : « ▲ +4 », « ▼ −2 », « = ». */
    function delta(id, actuel, precedent, unite = '', unitePrecedent = unite) {
        const el = document.getElementById(id);
        el.className = 'delta';
        if (actuel == null || precedent == null) { el.textContent = ''; return; }
        const d = Math.round((actuel - precedent) * 10) / 10;
        el.classList.add(d > 0 ? 'hausse' : d < 0 ? 'baisse' : 'stable');
        el.textContent = d === 0 ? '= période précédente'
            : `${d > 0 ? '▲ +' : '▼ −'}${nombre(Math.abs(d))}${unite} (période précédente : ${nombre(precedent)}${unitePrecedent})`;
    }

    // --- Graphiques (Chart.js servi localement ; sans lui, les tableaux restent affichés)

    /** Traits verticaux (versions, rupture de série) dessinés sur une courbe. */
    const pluginMarqueurs = {
        id: 'marqueurs',
        afterDatasetsDraw(chart, args, options) {
            const { ctx, chartArea, scales } = chart;
            for (const m of (options && options.liste) || []) {
                const x = scales.x.getPixelForValue(m.index);
                if (!Number.isFinite(x) || x < chartArea.left || x > chartArea.right) continue;
                ctx.save();
                ctx.strokeStyle = m.couleur;
                ctx.fillStyle = m.couleur;
                ctx.setLineDash([4, 4]);
                ctx.beginPath();
                ctx.moveTo(x, chartArea.top);
                ctx.lineTo(x, chartArea.bottom);
                ctx.stroke();
                ctx.setLineDash([]);
                ctx.font = '12px system-ui, sans-serif';
                ctx.fillText(m.texte, Math.min(x + 4, chartArea.right - ctx.measureText(m.texte).width), chartArea.top + 12 + (m.rang || 0) * 14);
                ctx.restore();
            }
        },
    };

    function graphique(id, type, libelles, jeux, options = {}) {
        if (typeof Chart === 'undefined') return;
        const data = { labels: libelles, datasets: jeux };
        if (graphiques[id]) {
            graphiques[id].data = data;
            graphiques[id].options.plugins.marqueurs = { liste: options.marqueurs || [] };
            graphiques[id].update();
            return;
        }
        graphiques[id] = new Chart(document.getElementById(id), {
            type,
            data,
            plugins: [pluginMarqueurs],
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: { legend: { display: jeux.length > 1 }, marqueurs: { liste: options.marqueurs || [] } },
                scales: {
                    x: { stacked: Boolean(options.empile) },
                    y: { beginAtZero: true, ticks: { precision: 0 }, stacked: Boolean(options.empile) },
                },
            },
        });
    }

    // --- Sections

    function afficherTuiles(stats) {
        const t = stats.tuiles;
        // Pas de comparaison avec une période antérieure au comptage par navigateur (3.1.0) : séries différentes
        const { precedente, debutNavigateurs } = stats.periode;
        const p = precedente && debutNavigateurs && precedente.fin < debutNavigateurs ? null : stats.precedente;
        document.getElementById('tJour').textContent = nombre(t.actifsJour);
        document.getElementById('tSemaine').textContent = nombre(t.actifsSemaine);
        document.getElementById('tNouveaux').textContent = t.nouveaux;
        document.getElementById('tRetour').textContent = t.retourS1 ? `${t.retourS1.taux} %` : '–';
        document.getElementById('tRetourDetail').textContent = t.retourS1
            ? `${t.retourS1.revenus} navigateurs sur ${t.retourS1.base} revenus la semaine suivante`
            : "part des navigateurs d'une semaine revenus la suivante (pas encore mesurable)";
        document.getElementById('tContrib').textContent = t.contributions;
        document.getElementById('tContribDetail').textContent = `par ${t.contributeurs} contributeur${t.contributeurs > 1 ? 's' : ''} distinct${t.contributeurs > 1 ? 's' : ''} (navigateurs)`;
        delta('dJour', t.actifsJour, p && p.actifsJour);
        delta('dSemaine', t.actifsSemaine, p && p.actifsSemaine);
        delta('dNouveaux', t.nouveaux, p && p.nouveaux);
        delta('dRetour', t.retourS1 && t.retourS1.taux, p && p.retourS1 && p.retourS1.taux, ' pts', ' %');
        delta('dContrib', t.contributions, p && p.contributions);
    }

    /** Jours continus de la période (y compris les jours sans données) avec les valeurs connues. */
    function joursContinus(stats) {
        if (!stats.jours.length) return [];
        const parDate = Object.fromEntries(stats.jours.map(j => [j.date, j]));
        const debut = stats.periode.debut && stats.periode.debut > stats.jours[0].date ? stats.periode.debut : stats.jours[0].date;
        const finDonnees = stats.jours[stats.jours.length - 1].date;
        const fin = stats.periode.fin && stats.periode.fin < finDonnees ? stats.periode.fin : finDonnees;
        const liste = [];
        for (let d = debut; d <= fin; d = decaler(d, 1)) liste.push(parDate[d] || { date: d, actifs: 0, actifs7j: 0, nouveaux: 0, visites: 0, pagesVues: 0, actifsIp: 0 });
        return liste;
    }

    function afficherFrequentation(stats) {
        const jours = joursContinus(stats);
        const ancien = jours.some(j => j.actifsIp > 0);
        const jeux = [
            { type: 'bar', label: 'Actifs du jour', data: jours.map(j => j.actifs), backgroundColor: 'rgba(79, 70, 229, 0.35)', borderRadius: 3, order: 2 },
            { type: 'line', label: 'Actifs sur 7 jours glissants', data: jours.map(j => j.actifs7j), borderColor: COULEUR, backgroundColor: COULEUR, tension: 0.25, pointRadius: 0, order: 1 },
        ];
        if (ancien) {
            jeux.push({ type: 'line', label: 'Adresses IP par jour (ancien calcul)', data: jours.map(j => j.actifsIp), borderColor: COULEUR_3, backgroundColor: COULEUR_3, borderDash: [5, 4], pointRadius: 0, order: 0 });
        }
        // Marqueurs : versions et rupture de série (3.1.0 : comptage par navigateur au lieu de l'adresse IP)
        const index = date => jours.findIndex(j => j.date >= date);
        const marqueurs = [];
        const debutNav = stats.periode.debutNavigateurs;
        if (debutNav && ancien && index(debutNav) > 0) marqueurs.push({ index: index(debutNav), texte: 'Rupture de série', couleur: COULEUR_3, rang: 1 });
        for (const v of stats.versions) {
            const i = index(v.date);
            if (i >= 0 && (i > 0 || v.date === jours[0].date)) marqueurs.push({ index: i, texte: `v${v.version}`, couleur: COULEUR_MARQUEUR });
        }
        graphique('gFrequentation', 'bar', jours.map(j => formaterDate(j.date, true)), jeux, { marqueurs });
    }

    function afficherSemaines(stats) {
        const semaines = stats.semaines.filter(s => s.actifs > 0);
        graphique('gSemaines', 'bar', semaines.map(s => `${formaterDate(s.debut, true)}${s.complete ? '' : ' (en cours)'}`), [
            { label: 'Nouveaux', data: semaines.map(s => s.nouveaux), backgroundColor: COULEUR_2 },
            { label: 'Récurrents', data: semaines.map(s => s.recurrents), backgroundColor: COULEUR },
        ], { empile: true });
    }

    function afficherChaleur(stats) {
        const table = document.getElementById('tChaleur');
        table.replaceChildren();
        const carte = stats.carteChaleur;
        const max = Math.max(0, ...carte.flat());
        // Heures affichées : 7 h – 19 h au minimum, élargies aux heures qui ont des visites
        let h0 = 7;
        let h1 = 19;
        carte.forEach(ligne => ligne.forEach((n, h) => { if (n) { h0 = Math.min(h0, h); h1 = Math.max(h1, h); } }));
        const entete = table.createTHead().insertRow();
        entete.appendChild(document.createElement('th'));
        for (let h = h0; h <= h1; h++) {
            const th = document.createElement('th');
            th.textContent = `${h}h`;
            th.scope = 'col';
            entete.appendChild(th);
        }
        const corps = table.createTBody();
        carte.forEach((ligne, js) => {
            if (js >= 5 && !ligne.some(Boolean)) return; // week-end masqué s'il est vide
            const tr = corps.insertRow();
            const th = document.createElement('th');
            th.scope = 'row';
            th.textContent = JOURS_SEMAINE[js];
            tr.appendChild(th);
            for (let h = h0; h <= h1; h++) {
                const td = tr.insertCell();
                const n = ligne[h];
                td.textContent = n || '';
                td.title = `${JOURS_SEMAINE[js]} ${h}h : ${n} navigateur(s) actif(s), cumulés sur la période`;
                if (n && max) {
                    const intensite = 0.12 + 0.88 * (n / max);
                    td.style.backgroundColor = `rgba(79, 70, 229, ${intensite.toFixed(2)})`; // CSSOM : autorisé par la CSP
                    if (intensite > 0.55) td.style.color = '#fff';
                }
            }
        });
    }

    /** Barres horizontales en HTML : [{libelle, valeur, total, detail}]. */
    function barres(id, lignes) {
        const zone = document.getElementById(id);
        zone.replaceChildren();
        if (!lignes.length || !lignes[0].total) {
            zone.innerHTML = '<p class="vide">Aucune visite mesurée sur la période (mesure disponible depuis la 3.3.0).</p>';
            return;
        }
        for (const l of lignes) {
            const p = pourcent(l.valeur, l.total);
            const ligne = document.createElement('div');
            ligne.className = 'barre-ligne';
            ligne.innerHTML = `<div class="barre-libelle"><span>${Commun.html(l.libelle)}</span><span class="barre-valeur">${p} % <small>(${l.valeur})</small></span></div>
                <div class="barre-fond"><div class="barre-plein"></div></div>${l.detail ? `<div class="aide-petite">${Commun.html(l.detail)}</div>` : ''}`;
            ligne.querySelector('.barre-plein').style.width = `${p}%`;
            zone.appendChild(ligne);
        }
    }

    function afficherEntonnoir(stats) {
        const e = stats.entonnoir;
        barres('entonnoir', [
            { libelle: 'Visites', valeur: e.visites, total: e.visites },
            { libelle: 'Visites qui ouvrent au moins une fiche', valeur: e.fiche, total: e.visites,
                detail: `dont ${e.fiche - e.ficheClic} sans clic vers Maps ni le site ensuite (${pourcent(e.fiche - e.ficheClic, e.fiche)} % des visites avec fiche)` },
            { libelle: '… puis cliquent vers Maps ou le site', valeur: e.ficheClic, total: e.visites },
            { libelle: 'Clic vers Maps ou le site directement depuis la liste (sans fiche)', valeur: e.clicSansFiche, total: e.visites },
        ]);
        const lignes = Object.keys(FONCTIONNALITES)
            .map(cle => ({ libelle: FONCTIONNALITES[cle], valeur: stats.fonctionnalites[cle] || 0, total: e.visites }))
            .sort((a, b) => b.valeur - a.valeur);
        barres('fonctionnalites', lignes);
    }

    function afficherEtablissements(stats) {
        remplirLignes('tEtablissements', stats.etablissements.map(e => [
            e.nom, e.fiche, e.site, e.maps, e.confirmations, e.avis, e.note == null ? '–' : nombre(e.note),
        ]), 7);
    }

    function afficherContributions(stats) {
        const semaines = stats.semaines;
        const types = Object.keys(LIBELLES_CONTRIBUTIONS).filter(t => semaines.some(s => s.contributions[t]));
        const jeux = types.map(t => ({ type: 'bar', label: LIBELLES_CONTRIBUTIONS[t], data: semaines.map(s => s.contributions[t] || 0),
            backgroundColor: COULEURS_CONTRIBUTIONS[t], stack: 'types' }));
        jeux.push({ type: 'line', label: 'Contributeurs distincts', data: semaines.map(s => stats.contributeurs.parSemaine[s.semaine] || 0),
            borderColor: '#1e293b', backgroundColor: '#1e293b', tension: 0.2, stack: 'contributeurs' });
        graphique('gContributions', 'bar', semaines.map(s => formaterDate(s.debut, true)), jeux, { empile: true });

        const c = stats.contributeurs;
        document.getElementById('retourContributeurs').textContent = c.nouveaux
            ? `Nouveaux contributeurs sur la période : ${c.nouveaux}. Retour dans les 14 jours (nouvelle contribution un autre jour) : `
                + (c.mesures14 ? `${c.tauxRetour14} % (${c.revenus14} sur ${c.mesures14})` : 'pas encore mesurable')
                + (c.enObservation ? ` ; ${c.enObservation} encore dans leur délai de 14 jours.` : '.')
            : 'Aucun nouveau contributeur sur la période. Contributeur = navigateur qui a ajouté, modifié, donné un avis, confirmé une présence ou signalé.';
    }

    function afficherCohortes(stats) {
        const table = document.getElementById('tCohortes');
        const n = Math.max(1, ...stats.cohortes.map(c => c.observees)); // semaines terminées (S0 comprise), 9 au plus
        table.tHead.innerHTML = `<tr><th>Arrivés la semaine du</th><th>Nombre</th>${Array.from({ length: n - 1 }, (_, k) => `<th>S+${k + 1}</th>`).join('')}</tr>`;
        remplirLignes('tCohortes', stats.cohortes.map(c => [
            formaterDate(c.debut), c.taille,
            ...Array.from({ length: n - 1 }, (_, k) => (k + 1 < c.observees ? `${pourcent(c.semaines[k + 1] || 0, c.taille)} %` : '')),
        ]), n + 1);
    }

    function afficherTechnique(stats) {
        remplirTable('tEvenements', { ...stats.evenements, page_vue: stats.totaux.pagesVues }, LIBELLES);
        remplirTable('tPages', stats.pages);
        remplirTable('tNavigateurs', stats.navigateurs);
        remplirLignes('tJours', ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi'].map(j => [j, stats.joursConsultes[j] || 0]), 2);
        remplirLignes('tMois', stats.mois.map(m => [m.mois + (m.complete ? '' : ' (en cours)'), m.actifs, m.nouveaux,
            m.retourM1 == null ? '–' : `${m.retourM1} %`, m.actifsIp]), 5);
        remplirLignes('tTechnique', [
            ['Requêtes (pages et API)', stats.technique.requetes],
            ['Réponses en erreur (≥ 400)', stats.technique.erreurs],
            ['Temps de réponse moyen', `${stats.technique.dureeMoyenneMs} ms`],
            ['Visites', stats.totaux.visites],
            ['Pages vues', stats.totaux.pagesVues],
            ['Dernier jour enregistré dans les agrégats', formaterDate(stats.periode.traiteJusqua)],
        ], 2);
    }

    function afficher(stats) {
        const { periode } = stats;
        document.getElementById('infoPeriode').textContent =
            `Période : ${periode.debut ? formaterDate(periode.debut) : 'début'} → ${periode.fin ? formaterDate(periode.fin) : "aujourd'hui"}`
            + (periode.precedente ? `, comparée au ${formaterDate(periode.precedente.debut)} → ${formaterDate(periode.precedente.fin)}` : '')
            + `. Données disponibles du ${formaterDate(periode.premiereDonnee)} au ${formaterDate(periode.derniereDonnee)} ; aujourd'hui est provisoire.`;

        const ancien = stats.jours.some(j => j.actifsIp > 0);
        const rupture = document.getElementById('rupture');
        rupture.hidden = !ancien;
        rupture.textContent = periode.debutNavigateurs
            ? `Rupture de série : depuis le ${formaterDate(periode.debutNavigateurs)} (version 3.1.0), les visiteurs sont comptés par navigateur (cookie anonyme) ; avant, par adresse IP (« ancien calcul », courbe grise). Les deux séries ne sont pas comparables.`
            : 'Ces données datent d\'avant la version 3.1.0 : visiteurs comptés par adresse IP (« ancien calcul »), non comparables aux navigateurs.';

        afficherTuiles(stats);
        afficherFrequentation(stats);
        afficherSemaines(stats);
        afficherChaleur(stats);
        afficherEntonnoir(stats);
        afficherEtablissements(stats);
        afficherContributions(stats);
        afficherCohortes(stats);
        remplirLignes('tRecherches', stats.recherchesVides.map(r => [r.texte, r.n]), 2);
        afficherTechnique(stats);
    }

    // --- Période

    let periodeCourante = { debut: '', fin: '' };

    async function charger() {
        const params = new URLSearchParams();
        if (periodeCourante.debut) params.set('debut', periodeCourante.debut);
        if (periodeCourante.fin) params.set('fin', periodeCourante.fin);
        for (const niveau of ['Jours', 'Semaines', 'Etablissements']) {
            const p = new URLSearchParams(params);
            p.set('niveau', niveau.toLowerCase());
            document.getElementById(`export${niveau}`).href = `/api/admin/export/statistiques.csv?${p}`;
        }
        try {
            afficher(await Commun.api(`/api/admin/statistiques?${params}`));
        } catch (err) {
            Commun.notifier(`Statistiques indisponibles : ${err.message}`, 'erreur');
        }
    }

    function choisir(valeur) {
        document.querySelectorAll('[data-periode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.periode === valeur)));
        const form = document.getElementById('formPeriode');
        form.hidden = valeur !== 'perso';
        if (valeur === 'perso') {
            document.getElementById('debut').value = document.getElementById('debut').value || periodeCourante.debut;
            document.getElementById('fin').value = document.getElementById('fin').value || periodeCourante.fin || dateIso(new Date());
            document.getElementById('debut').focus();
            return;
        }
        const fin = dateIso(new Date());
        periodeCourante = valeur === 'tout' ? { debut: '', fin: '' } : { debut: decaler(fin, 1 - Number(valeur)), fin };
        charger();
    }

    document.addEventListener('DOMContentLoaded', () => {
        document.querySelectorAll('[data-periode]').forEach(b => b.addEventListener('click', () => choisir(b.dataset.periode)));
        document.getElementById('formPeriode').addEventListener('submit', e => {
            e.preventDefault();
            const debut = document.getElementById('debut').value;
            const fin = document.getElementById('fin').value;
            if (debut > fin) {
                Commun.notifier('La date de début doit précéder la date de fin.', 'erreur');
                return;
            }
            periodeCourante = { debut, fin };
            charger();
        });
        choisir('30');
    });
})();
