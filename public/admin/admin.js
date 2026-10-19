// Espace administrateur : suggestions, ajout manuel, foodtrucks publiés.

(() => {
    const COLONNES = ['nom', 'cuisine', 'jours', 'emplacement', 'prix', 'site'];
    let publies = [];

    function message(texte, type) { Commun.notifier(texte, type); }

    function erreurVersTexte(err) {
        return err.details && err.details.length ? `${err.message} ${err.details.join(' ')}` : err.message;
    }

    /** Ligne de tableau avec un champ par colonne ; `index` = position dans le fichier. */
    function ligneEditable(ft, index, boutons) {
        const tr = document.createElement('tr');
        tr.dataset.index = index;
        tr.innerHTML = COLONNES.map(c => {
            const type = c === 'emplacement' || c === 'site' ? 'url' : 'text';
            return `<td><input type="${type}" data-colonne="${c}" value="${Commun.html(ft[c])}" aria-label="${c}"></td>`;
        }).join('') + `<td class="actions">${boutons}</td>`;
        tr._original = ft;
        return tr;
    }

    function lireLigne(tr) {
        const ft = {};
        tr.querySelectorAll('input[data-colonne]').forEach(i => { ft[i.dataset.colonne] = i.value; });
        return ft;
    }

    function ligneVide(tbody, texte) {
        tbody.innerHTML = `<tr><td colspan="7" class="vide">${Commun.html(texte)}</td></tr>`;
    }

    // --- Suggestions
    async function chargerSuggestions() {
        const tbody = document.querySelector('#tableSuggestions tbody');
        let suggestions;
        try {
            suggestions = await Commun.api('/api/admin/suggestions');
        } catch (err) {
            ligneVide(tbody, `Chargement impossible : ${err.message}`);
            return;
        }
        document.getElementById('nbSuggestions').textContent = suggestions.length ? `(${suggestions.length})` : '';
        if (!suggestions.length) return ligneVide(tbody, 'Aucune suggestion en attente.');
        tbody.innerHTML = '';
        suggestions.forEach((ft, i) => tbody.appendChild(ligneEditable(ft, i,
            '<button type="button" class="bouton succes petit" data-action="valider">Valider</button>'
            + '<button type="button" class="bouton danger petit" data-action="rejeter">Rejeter</button>')));
    }

    async function actionSuggestion(e) {
        const bouton = e.target.closest('button[data-action]');
        if (!bouton) return;
        const tr = bouton.closest('tr');
        const index = tr.dataset.index;
        try {
            let reponse;
            if (bouton.dataset.action === 'valider') {
                reponse = await Commun.api(`/api/admin/suggestions/${index}/valider`, {
                    method: 'POST', body: { original: tr._original, foodtruck: lireLigne(tr) },
                });
            } else {
                if (!confirm(`Rejeter définitivement la suggestion « ${tr._original.nom} » ?`)) return;
                reponse = await Commun.api(`/api/admin/suggestions/${index}`, { method: 'DELETE', body: { original: tr._original } });
            }
            message(reponse.message);
            await Promise.all([chargerSuggestions(), chargerPublies()]);
        } catch (err) {
            message(erreurVersTexte(err), 'erreur');
        }
    }

    // --- Ajout manuel
    const CORRESPONDANCES = [
        [/^nom/i, 'nom'],
        [/cuisine/i, 'cuisine'],
        [/^jours?/i, 'jours'],
        [/emplacement|maps|adresse|lieu/i, 'emplacement'],
        [/prix|tarif/i, 'prix'],
        [/site/i, 'site'],
    ];

    function preRemplir() {
        const texte = document.getElementById('texteImport').value;
        let trouves = 0;
        for (const ligne of texte.split('\n')) {
            const m = ligne.match(/^\s*([^:]+?)\s*:\s*(.+)$/); // « Clé : valeur » (les « : » des URL restent dans la valeur)
            if (!m) continue;
            const correspondance = CORRESPONDANCES.find(([motif]) => motif.test(m[1].trim()));
            if (!correspondance) continue;
            document.getElementById(`a-${correspondance[1]}`).value = m[2].trim();
            trouves++;
        }
        message(trouves ? `${trouves} champ(s) pré-rempli(s). Vérifiez puis cliquez sur « Ajouter et publier ».` : 'Aucune information reconnue dans le texte.', trouves ? 'succes' : 'erreur');
    }

    async function ajouter(e) {
        e.preventDefault();
        const form = e.target;
        const ft = Object.fromEntries(COLONNES.map(c => [c, form.elements[c].value]));
        const erreurs = document.getElementById('erreursAjout');
        try {
            const reponse = await Commun.api('/api/admin/foodtrucks', { method: 'POST', body: ft });
            erreurs.hidden = true;
            form.reset();
            document.getElementById('texteImport').value = '';
            message(reponse.message);
            chargerPublies();
        } catch (err) {
            const liste = err.details && err.details.length ? err.details : [err.message];
            erreurs.innerHTML = liste.map(t => `<li>${Commun.html(t)}</li>`).join('');
            erreurs.hidden = false;
        }
    }

    // --- Foodtrucks publiés
    async function chargerPublies() {
        const tbody = document.querySelector('#tablePublies tbody');
        try {
            publies = await Commun.api('/api/admin/foodtrucks');
        } catch (err) {
            ligneVide(tbody, `Chargement impossible : ${err.message}`);
            return;
        }
        document.getElementById('nbPublies').textContent = `(${publies.length})`;
        afficherPublies();
    }

    function afficherPublies() {
        const tbody = document.querySelector('#tablePublies tbody');
        const filtre = document.getElementById('filtre').value.trim().toLowerCase();
        const lignes = publies
            .map((ft, i) => ({ ft, i }))
            .filter(({ ft }) => !filtre || COLONNES.some(c => (ft[c] || '').toLowerCase().includes(filtre)));
        if (!lignes.length) return ligneVide(tbody, filtre ? 'Aucun résultat.' : 'Aucun foodtruck publié.');
        tbody.innerHTML = '';
        lignes.forEach(({ ft, i }) => tbody.appendChild(ligneEditable(ft, i,
            '<button type="button" class="bouton petit" data-action="enregistrer">Enregistrer</button>'
            + '<button type="button" class="bouton danger petit" data-action="supprimer">Supprimer</button>')));
    }

    async function actionPublie(e) {
        const bouton = e.target.closest('button[data-action]');
        if (!bouton) return;
        const tr = bouton.closest('tr');
        const index = tr.dataset.index;
        try {
            let reponse;
            if (bouton.dataset.action === 'enregistrer') {
                reponse = await Commun.api(`/api/admin/foodtrucks/${index}`, {
                    method: 'PUT', body: { original: tr._original, foodtruck: lireLigne(tr) },
                });
            } else {
                if (!confirm(`Retirer « ${tr._original.nom} » de la liste publiée ?`)) return;
                reponse = await Commun.api(`/api/admin/foodtrucks/${index}`, { method: 'DELETE', body: { original: tr._original } });
            }
            message(reponse.message);
            chargerPublies();
        } catch (err) {
            message(erreurVersTexte(err), 'erreur');
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        document.querySelector('#tableSuggestions tbody').addEventListener('click', actionSuggestion);
        document.querySelector('#tablePublies tbody').addEventListener('click', actionPublie);
        document.getElementById('formAjout').addEventListener('submit', ajouter);
        document.getElementById('boutonImport').addEventListener('click', preRemplir);
        document.getElementById('filtre').addEventListener('input', afficherPublies);
        chargerSuggestions();
        chargerPublies();
    });
})();
