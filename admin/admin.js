// Espace administrateur : suggestions, ajout / modification des établissements, lieux.

(() => {
    const JOURS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi'];
    const CHAMPS_TEXTE = ['nom', 'type', 'cuisine', 'categorie', 'lieu', 'emplacement', 'horaires', 'prix', 'site', 'statut'];
    const LISTES = { jours: 'f-jours', etiquettes: 'f-etiquettes', paiements: 'f-paiements' };
    let publies = [];
    let lieux = [];
    // Mode du formulaire : ajout, modification d'un établissement ou publication d'une suggestion
    let mode = { type: 'ajout' };

    function message(texte, type) { Commun.notifier(texte, type); }

    function erreurVersTexte(err) {
        return err.details && err.details.length ? `${err.message} ${err.details.join(' ')}` : err.message;
    }

    function ligneVide(tbody, texte, colonnes) {
        tbody.innerHTML = `<tr><td colspan="${colonnes}" class="vide">${Commun.html(texte)}</td></tr>`;
    }

    const nomLieu = id => (lieux.find(l => l.id === id) || {}).nom || '';
    const liste = valeur => String(valeur || '').split(';').map(v => v.trim()).filter(Boolean);

    // --- Formulaire établissement

    function cases(zoneId, nom, valeurs) {
        document.getElementById(zoneId).innerHTML = valeurs
            .map(v => `<label class="case"><input type="checkbox" name="${nom}" value="${Commun.html(v)}"> ${Commun.html(v)}</label>`).join('');
    }

    /** Coche les cases dont la valeur figure dans `valeurs` (texte séparé par ; , « et », sans tenir compte des accents). */
    function cocher(zoneId, valeurs) {
        const voulues = String(valeurs || '').split(/[;,/]|\bet\b/i).map(Commun.simplifier).map(v => v.replace(/[^a-z0-9]+/g, ' ').trim()).filter(Boolean);
        document.querySelectorAll(`#${zoneId} input`).forEach(c => {
            const valeur = Commun.simplifier(c.value).replace(/[^a-z0-9]+/g, ' ').trim();
            c.checked = voulues.includes(valeur);
        });
    }

    function remplirFormulaire(ft) {
        const form = document.getElementById('formEtablissement');
        for (const champ of CHAMPS_TEXTE) form.elements[champ].value = ft[champ] || '';
        if (!form.elements.type.value) form.elements.type.value = 'foodtruck';
        if (!form.elements.statut.value) form.elements.statut.value = 'actif';
        for (const [champ, zone] of Object.entries(LISTES)) cocher(zone, ft[champ]);
    }

    function lireFormulaire() {
        const form = document.getElementById('formEtablissement');
        const ft = Object.fromEntries(CHAMPS_TEXTE.map(c => [c, form.elements[c].value]));
        for (const [champ, zone] of Object.entries(LISTES)) {
            ft[champ] = [...document.querySelectorAll(`#${zone} input:checked`)].map(c => c.value).join(';');
        }
        return ft;
    }

    function changerMode(nouveau) {
        mode = nouveau;
        const titres = {
            ajout: ['Ajouter un établissement', 'Ajouter et publier'],
            modification: ['Modifier un établissement', 'Enregistrer les modifications'],
            suggestion: ['Publier une suggestion', 'Publier la suggestion'],
        };
        document.getElementById('titreFormulaire').textContent = titres[mode.type][0];
        document.getElementById('boutonEnregistrer').textContent = titres[mode.type][1];
        document.getElementById('boutonAnnuler').hidden = mode.type === 'ajout';
        const info = document.getElementById('infoMode');
        info.hidden = mode.type === 'ajout';
        if (mode.type === 'modification') info.textContent = `Modification de « ${mode.original.nom} » (version ${mode.original.version}, identifiant ${mode.original.id}).`;
        if (mode.type === 'suggestion') info.textContent = `Suggestion « ${mode.original.nom} » : complétez puis publiez.`;
        afficherErreurs([]);
    }

    function reinitialiser() {
        document.getElementById('formEtablissement').reset();
        document.getElementById('texteImport').value = '';
        changerMode({ type: 'ajout' });
    }

    function editer(nouveauMode, ft) {
        changerMode(nouveauMode);
        remplirFormulaire(ft);
        document.getElementById('carteFormulaire').scrollIntoView({ behavior: 'smooth' });
        document.getElementById('f-nom').focus({ preventScroll: true });
    }

    function afficherErreurs(erreurs) {
        const zone = document.getElementById('erreursFormulaire');
        zone.innerHTML = erreurs.map(t => `<li>${Commun.html(t)}</li>`).join('');
        zone.hidden = erreurs.length === 0;
    }

    async function enregistrer(e) {
        e.preventDefault();
        const ft = lireFormulaire();
        try {
            let reponse;
            if (mode.type === 'modification') {
                reponse = await Commun.api(`/api/admin/foodtrucks/${encodeURIComponent(mode.original.id)}`, {
                    method: 'PUT', body: { version: mode.original.version, foodtruck: ft },
                });
            } else if (mode.type === 'suggestion') {
                reponse = await Commun.api(`/api/admin/suggestions/${mode.index}/valider`, {
                    method: 'POST', body: { original: mode.original, foodtruck: ft },
                });
            } else {
                reponse = await Commun.api('/api/admin/foodtrucks', { method: 'POST', body: ft });
            }
            message(reponse.message);
            reinitialiser();
            await Promise.all([chargerSuggestions(), chargerPublies(), chargerLieux()]);
        } catch (err) {
            afficherErreurs(err.details && err.details.length ? err.details : [err.message]);
        }
    }

    // --- Pré-remplissage depuis un texte
    const CORRESPONDANCES = [
        [/cuisine/i, 'cuisine'],
        [/^cat[ée]gorie/i, 'categorie'],
        [/^nom/i, 'nom'],
        [/^type/i, 'type'],
        [/^jours?/i, 'jours'],
        [/^lieu/i, 'lieu'],
        [/emplacement|maps|adresse/i, 'emplacement'],
        [/prix|tarif/i, 'prix'],
        [/horaire|heure/i, 'horaires'],
        [/paiement|r[èe]glement/i, 'paiements'],
        [/[ée]tiquette|r[ée]gime/i, 'etiquettes'],
        [/site/i, 'site'],
    ];

    function preRemplir() {
        const texte = document.getElementById('texteImport').value;
        const form = document.getElementById('formEtablissement');
        let trouves = 0;
        for (const ligne of texte.split('\n')) {
            const m = ligne.match(/^\s*([^:]+?)\s*:\s*(.+)$/); // « Clé : valeur » (les « : » des URL restent dans la valeur)
            if (!m) continue;
            const correspondance = CORRESPONDANCES.find(([motif]) => motif.test(m[1].trim()));
            if (!correspondance) continue;
            const [, champ] = correspondance;
            const valeur = m[2].trim();
            if (LISTES[champ]) {
                cocher(LISTES[champ], valeur);
            } else if (champ === 'lieu') {
                const lieu = lieux.find(l => Commun.simplifier(l.nom) === Commun.simplifier(valeur));
                if (!lieu) continue;
                form.elements.lieu.value = lieu.id;
            } else if (champ === 'type' || champ === 'categorie') {
                const select = form.elements[champ];
                const option = [...select.options].find(o => Commun.simplifier(o.value) === Commun.simplifier(valeur)
                    || Commun.simplifier(o.text) === Commun.simplifier(valeur));
                if (!option) continue;
                select.value = option.value;
            } else {
                form.elements[champ].value = valeur;
            }
            trouves++;
        }
        message(trouves ? `${trouves} champ(s) pré-rempli(s). Vérifiez puis enregistrez.` : 'Aucune information reconnue dans le texte.', trouves ? 'succes' : 'erreur');
    }

    // --- Suggestions
    let suggestions = [];

    async function chargerSuggestions() {
        const tbody = document.querySelector('#tableSuggestions tbody');
        try {
            suggestions = await Commun.api('/api/admin/suggestions');
        } catch (err) {
            ligneVide(tbody, `Chargement impossible : ${err.message}`, 7);
            return;
        }
        document.getElementById('nbSuggestions').textContent = suggestions.length ? `(${suggestions.length})` : '';
        if (!suggestions.length) return ligneVide(tbody, 'Aucune suggestion en attente.', 7);
        const h = Commun.html;
        tbody.innerHTML = suggestions.map((ft, i) => {
            const emplacement = Commun.urlSure(ft.emplacement);
            const lieu = nomLieu(ft.lieu) || (emplacement ? `<a href="${h(emplacement)}" target="_blank" rel="noopener">lien Maps</a>` : '—');
            return `<tr data-index="${i}">
                <td>${h(ft.nom)}</td><td>${h(ft.type)}</td><td>${h(ft.cuisine)}</td><td>${h(ft.jours.replace(/;/g, ', '))}</td>
                <td>${nomLieu(ft.lieu) ? h(lieu) : lieu}</td><td>${h(Commun.formaterPrix(ft.prix))}</td>
                <td class="actions"><button type="button" class="bouton succes petit" data-action="completer">Compléter et publier</button><button type="button" class="bouton danger petit" data-action="rejeter">Rejeter</button></td>
            </tr>`;
        }).join('');
    }

    async function actionSuggestion(e) {
        const bouton = e.target.closest('button[data-action]');
        if (!bouton) return;
        const index = Number(bouton.closest('tr').dataset.index);
        const original = suggestions[index];
        if (bouton.dataset.action === 'completer') {
            editer({ type: 'suggestion', index, original }, original);
            return;
        }
        if (!confirm(`Rejeter définitivement la suggestion « ${original.nom} » ?`)) return;
        try {
            const reponse = await Commun.api(`/api/admin/suggestions/${index}`, { method: 'DELETE', body: { original } });
            message(reponse.message);
            if (mode.type === 'suggestion') reinitialiser();
            chargerSuggestions();
        } catch (err) {
            message(erreurVersTexte(err), 'erreur');
        }
    }

    // --- Établissements
    async function chargerPublies() {
        const tbody = document.querySelector('#tablePublies tbody');
        try {
            publies = await Commun.api('/api/admin/foodtrucks');
        } catch (err) {
            ligneVide(tbody, `Chargement impossible : ${err.message}`, 10);
            return;
        }
        const actifs = publies.filter(ft => ft.statut !== 'archive').length;
        document.getElementById('nbPublies').textContent = `(${actifs} affichés, ${publies.length - actifs} archivés)`;
        afficherPublies();
    }

    function afficherPublies() {
        const tbody = document.querySelector('#tablePublies tbody');
        const filtre = Commun.simplifier(document.getElementById('filtre').value.trim());
        const statut = document.getElementById('filtreStatut').value;
        const lignes = publies.filter(ft => (!statut || ft.statut === statut)
            && (!filtre || Commun.simplifier([...Object.values(ft), nomLieu(ft.lieu)].join(' ')).includes(filtre)));
        if (!lignes.length) return ligneVide(tbody, filtre || statut ? 'Aucun résultat.' : 'Aucun établissement.', 10);
        const h = Commun.html;
        tbody.innerHTML = lignes.map(ft => `<tr data-id="${h(ft.id)}" class="statut-${h(ft.statut)}">
            <td><strong>${h(ft.nom)}</strong><br><small>${h(ft.cuisine)}</small></td>
            <td>${h(ft.type)}</td><td>${h(ft.categorie)}</td><td>${h(ft.jours.replace(/;/g, ', '))}</td>
            <td>${h(nomLieu(ft.lieu)) || '<span class="vide">à préciser</span>'}</td>
            <td>${h(Commun.formaterPrix(ft.prix))}</td><td>${h(liste(ft.paiements).join(', '))}</td>
            <td>${h(ft.statut)}</td><td>${h(ft.maj_le)}</td>
            <td class="actions"><button type="button" class="bouton petit" data-action="modifier">Modifier</button><button type="button" class="bouton danger petit" data-action="supprimer">Supprimer</button></td>
        </tr>`).join('');
    }

    async function actionPublie(e) {
        const bouton = e.target.closest('button[data-action]');
        if (!bouton) return;
        const ft = publies.find(f => f.id === bouton.closest('tr').dataset.id);
        if (!ft) return;
        if (bouton.dataset.action === 'modifier') {
            editer({ type: 'modification', original: ft }, ft);
            return;
        }
        if (!confirm(`Supprimer définitivement « ${ft.nom} » ?\n\nPour un retrait temporaire, préférez « Modifier » puis le statut « Archivé ».`)) return;
        try {
            const reponse = await Commun.api(`/api/admin/foodtrucks/${encodeURIComponent(ft.id)}`, { method: 'DELETE', body: { version: ft.version } });
            message(reponse.message);
            if (mode.type === 'modification' && mode.original.id === ft.id) reinitialiser();
            chargerPublies();
            chargerLieux();
        } catch (err) {
            message(erreurVersTexte(err), 'erreur');
        }
    }

    // --- Lieux
    async function chargerLieux() {
        const tbody = document.querySelector('#tableLieux tbody');
        try {
            lieux = await Commun.api('/api/admin/lieux');
        } catch (err) {
            ligneVide(tbody, `Chargement impossible : ${err.message}`, 6);
            return;
        }
        document.getElementById('nbLieux').textContent = `(${lieux.length})`;
        const select = document.getElementById('f-lieu');
        const valeur = select.value;
        select.length = 1;
        for (const l of [...lieux].sort((a, b) => a.nom.localeCompare(b.nom, 'fr'))) select.add(new Option(l.nom, l.id));
        select.value = valeur;
        if (!lieux.length) return ligneVide(tbody, "Aucun lieu : ajoutez-en un avec la ligne ci-dessous.", 6);
        const h = Commun.html;
        tbody.innerHTML = lieux.map(l => `<tr data-id="${h(l.id)}">
            <td><input type="text" data-champ="nom" maxlength="60" value="${h(l.nom)}" aria-label="Nom"></td>
            <td><input type="text" data-champ="description" maxlength="200" value="${h(l.description)}" aria-label="Description"></td>
            <td><input type="text" data-champ="minutes_a_pied" maxlength="2" value="${h(l.minutes_a_pied)}" aria-label="Minutes à pied"></td>
            <td><input type="url" data-champ="maps" value="${h(l.maps)}" aria-label="Lien Maps"></td>
            <td>${l.utilisations} établissement(s)</td>
            <td class="actions"><button type="button" class="bouton petit" data-action="enregistrer">Enregistrer</button><button type="button" class="bouton danger petit" data-action="supprimer"${l.utilisations ? ' disabled title="Lieu utilisé"' : ''}>Supprimer</button></td>
        </tr>`).join('');
        if (publies.length) afficherPublies();
    }

    const lireLieu = tr => Object.fromEntries([...tr.querySelectorAll('[data-champ]')].map(i => [i.dataset.champ, i.value]));

    async function actionLieu(e) {
        const bouton = e.target.closest('button[data-action]');
        if (!bouton) return;
        const tr = bouton.closest('tr');
        const id = encodeURIComponent(tr.dataset.id);
        try {
            let reponse;
            if (bouton.dataset.action === 'enregistrer') {
                reponse = await Commun.api(`/api/admin/lieux/${id}`, { method: 'PUT', body: lireLieu(tr) });
            } else {
                if (!confirm('Supprimer ce lieu ?')) return;
                reponse = await Commun.api(`/api/admin/lieux/${id}`, { method: 'DELETE' });
            }
            message(reponse.message);
            chargerLieux();
        } catch (err) {
            message(erreurVersTexte(err), 'erreur');
        }
    }

    async function ajouterLieu() {
        const tr = document.getElementById('ligneNouveauLieu');
        try {
            const reponse = await Commun.api('/api/admin/lieux', { method: 'POST', body: lireLieu(tr) });
            tr.querySelectorAll('input').forEach(i => { i.value = ''; });
            message(reponse.message);
            chargerLieux();
        } catch (err) {
            message(erreurVersTexte(err), 'erreur');
        }
    }

    document.addEventListener('DOMContentLoaded', async () => {
        const config = await Commun.config();
        cases('f-jours', 'jours', JOURS);
        cases('f-etiquettes', 'etiquettes', config.etiquettes || []);
        cases('f-paiements', 'paiements', config.paiements || []);
        const categories = document.getElementById('f-categorie');
        for (const c of config.categories || []) categories.add(new Option(c, c));

        document.querySelector('#tableSuggestions tbody').addEventListener('click', actionSuggestion);
        document.querySelector('#tablePublies tbody').addEventListener('click', actionPublie);
        document.querySelector('#tableLieux tbody').addEventListener('click', actionLieu);
        document.getElementById('boutonAjouterLieu').addEventListener('click', ajouterLieu);
        document.getElementById('formEtablissement').addEventListener('submit', enregistrer);
        document.getElementById('boutonAnnuler').addEventListener('click', reinitialiser);
        document.getElementById('boutonImport').addEventListener('click', preRemplir);
        document.getElementById('filtre').addEventListener('input', afficherPublies);
        document.getElementById('filtreStatut').addEventListener('change', afficherPublies);
        await chargerLieux();
        chargerSuggestions();
        chargerPublies();
    });
})();
