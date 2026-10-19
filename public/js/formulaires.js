// Formulaire « Ajouter un établissement » / « Modifier les infos » : publication immédiate, avertissement de
// doublon (sans blocage), lieu différent selon le jour, conflit de version (409) avec les différences.

const Formulaires = (() => {
    const JOURS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi'];
    const h = Commun.html;
    let modale;
    let formulaire;
    let lieux = []; // [{id, nom}]
    let config = {};
    // Mode : { type: 'ajout' } ou { type: 'modification', fiche, version }
    let mode = { type: 'ajout' };
    let apresEnvoi = () => {};
    let minuterieDoublons;

    function cases(zoneId, nom, valeurs) {
        document.getElementById(zoneId).innerHTML = valeurs
            .map(v => `<label class="case"><input type="checkbox" name="${nom}" value="${h(v)}"> ${h(v)}</label>`).join('');
    }

    const liste = valeur => String(valeur || '').split(';').map(v => v.trim()).filter(Boolean);

    /** « Jeudi=parking-nord;Vendredi=https://… » -> { Jeudi: 'parking-nord', … } */
    function lireLieuxJours(texte) {
        const resultat = {};
        for (const morceau of String(texte || '').split(/;(?=\s*(?:Lundi|Mardi|Mercredi|Jeudi|Vendredi)\s*=)/)) {
            const i = morceau.indexOf('=');
            if (i > 0) resultat[morceau.slice(0, i).trim()] = morceau.slice(i + 1).trim();
        }
        return resultat;
    }

    /** Une ligne « Jeudi : [lieu] » par jour coché (le lieu habituel par défaut). */
    function afficherLieuxJours(valeurs) {
        const zone = document.getElementById('lieuxJours');
        const actuels = valeurs || Object.fromEntries([...zone.querySelectorAll('select')].map(s => [s.dataset.jour, s.value]));
        const jours = [...formulaire.querySelectorAll('input[name=jours]:checked')].map(c => c.value);
        if (!jours.length) { zone.innerHTML = '<p class="aide-petite">Cochez d\'abord les jours de présence.</p>'; return; }
        zone.innerHTML = jours.map(jour => {
            const valeur = actuels[jour] || '';
            const options = lieux.map(l => `<option value="${h(l.id)}"${l.id === valeur ? ' selected' : ''}>${h(l.nom)}</option>`).join('');
            // Lien Maps propre à ce jour (issu d'une fusion de fiches) : conservé tel quel
            const lien = valeur && !lieux.some(l => l.id === valeur)
                ? `<option value="${h(valeur)}" selected>Lien Google Maps particulier</option>` : '';
            return `<div class="ligne-lieu-jour"><label for="lieuJour-${h(jour)}">${h(jour)}</label>
                <select id="lieuJour-${h(jour)}" data-jour="${h(jour)}"><option value="">(lieu habituel)</option>${lien}${options}</select></div>`;
        }).join('');
    }

    // --- Photo : réduite dans le navigateur (1280 px au plus, JPEG), envoyée, puis publiée avec la fiche
    const ADRESSE_PHOTO = /^\/(?:img\/etablissements\/[a-z0-9-]+|photos\/[0-9a-f]{20})\.(?:jpg|png|webp)$/;
    const COTE_MAX = 1280;

    function afficherPhoto(adresse) {
        formulaire.elements.photo.value = adresse || '';
        const apercu = document.getElementById('apercuPhoto');
        apercu.innerHTML = ADRESSE_PHOTO.test(adresse || '')
            ? `<img src="${h(adresse)}" alt="Photo actuelle">` : '<span class="aide-petite">Aucune photo</span>';
        document.getElementById('retirerPhoto').hidden = !adresse;
    }

    async function chargerImage(fichier) {
        if (window.createImageBitmap) return createImageBitmap(fichier);
        const url = await new Promise((ok, ko) => {
            const lecteur = new FileReader();
            lecteur.onload = () => ok(lecteur.result);
            lecteur.onerror = ko;
            lecteur.readAsDataURL(fichier);
        });
        const image = new Image();
        image.src = url;
        await image.decode();
        return image;
    }

    async function reduire(fichier) {
        const image = await chargerImage(fichier);
        const echelle = Math.min(1, COTE_MAX / Math.max(image.width, image.height));
        const toile = document.createElement('canvas');
        toile.width = Math.round(image.width * echelle);
        toile.height = Math.round(image.height * echelle);
        const ctx = toile.getContext('2d');
        ctx.fillStyle = '#ffffff'; // fond blanc pour les PNG transparents
        ctx.fillRect(0, 0, toile.width, toile.height);
        ctx.drawImage(image, 0, 0, toile.width, toile.height);
        return toile.toDataURL('image/jpeg', 0.85);
    }

    async function envoyerPhoto(fichier) {
        const etat = document.getElementById('etatPhoto');
        if (!fichier) return;
        if (!['image/jpeg', 'image/png', 'image/webp'].includes(fichier.type)) {
            etat.textContent = 'Format refusé : choisissez une photo JPEG, PNG ou WebP.';
            return;
        }
        etat.textContent = 'Préparation de la photo…';
        const bouton = document.getElementById('envoyerFormulaire');
        bouton.disabled = true;
        try {
            const donnees = await reduire(fichier);
            etat.textContent = 'Envoi de la photo…';
            const reponse = await Commun.api('/api/photos', { method: 'POST', body: { type: 'image/jpeg', donnees } });
            afficherPhoto(reponse.photo);
            etat.textContent = mode.type === 'ajout' ? 'Photo prête : elle sera publiée avec l\'établissement.' : 'Photo prête : cliquez sur « Enregistrer » pour la publier.';
        } catch (err) {
            etat.textContent = err.message && err.statut ? err.message : 'Cette image ne peut pas être lue. Essayez une autre photo (JPEG ou PNG).';
        } finally {
            bouton.disabled = false;
        }
    }

    function remplir(ft) {
        afficherPhoto(ft.photo);
        document.getElementById('etatPhoto').textContent = "JPEG, PNG ou WebP : la photo est réduite avant l'envoi. De préférence le camion ou un plat.";
        for (const champ of ['nom', 'type', 'categorie', 'cuisine', 'lieu', 'emplacement', 'prix', 'horaires', 'site']) {
            formulaire.elements[champ].value = ft[champ] || '';
        }
        if (!formulaire.elements.type.value) formulaire.elements.type.value = 'foodtruck';
        formulaire.elements.fidelite.checked = ft.fidelite === 'oui';
        const coches = { jours: liste(ft.jours), paiements: liste(ft.paiements), etiquettes: liste(ft.etiquettes) };
        for (const [nom, valeurs] of Object.entries(coches)) {
            formulaire.querySelectorAll(`input[name=${nom}]`).forEach(c => { c.checked = valeurs.includes(c.value); });
        }
        const parJour = lireLieuxJours(ft.lieux_jours);
        afficherLieuxJours(parJour);
        document.getElementById('detailsLieuxJours').open = Object.keys(parJour).length > 0;
    }

    function lire() {
        const d = new FormData(formulaire);
        const parJour = [...document.querySelectorAll('#lieuxJours select')].filter(s => s.value).map(s => `${s.dataset.jour}=${s.value}`);
        return {
            nom: d.get('nom'), type: d.get('type'), categorie: d.get('categorie'), cuisine: d.get('cuisine'),
            jours: d.getAll('jours').join(';'), lieu: d.get('lieu') || '', lieux_jours: parJour.join(';'),
            emplacement: d.get('emplacement').trim(), prix: d.get('prix'), horaires: d.get('horaires'),
            paiements: d.getAll('paiements').join(';'), etiquettes: d.getAll('etiquettes').join(';'), site: d.get('site').trim(),
            photo: d.get('photo') || '', fidelite: d.get('fidelite') ? 'oui' : '',
        };
    }

    function afficherErreurs(erreurs) {
        const zone = document.getElementById('erreursFormulaire');
        zone.innerHTML = erreurs.map(e => `<li>${h(e)}</li>`).join('');
        zone.hidden = erreurs.length === 0;
        if (erreurs.length) zone.scrollIntoView({ block: 'nearest' });
    }

    // --- Doublons : avertissement avec lien vers la fiche existante, jamais bloquant
    async function verifierDoublons() {
        const zone = document.getElementById('doublons');
        const valeurs = lire();
        if (valeurs.nom.trim().length < 3) { zone.hidden = true; return; }
        const params = new URLSearchParams({ nom: valeurs.nom, lieu: valeurs.lieu, emplacement: valeurs.emplacement });
        if (mode.type === 'modification') params.set('sauf', mode.fiche.id);
        let doublons = [];
        try { doublons = await Commun.api(`/api/doublons?${params}`); } catch { return; }
        if (zone.dataset.ignore === valeurs.nom || !doublons.length) { zone.hidden = true; return; }
        const nomLieu = id => (lieux.find(l => l.id === id) || {}).nom;
        zone.innerHTML = `<p><strong>Un établissement ressemble à celui-ci :</strong></p><ul>${doublons.map(d => `<li>
            <button type="button" class="lien" data-ouvrir="${h(d.id)}">${h(d.nom)}</button>
            (${h([d.categorie, liste(d.jours).join(', ').toLowerCase(), nomLieu(d.lieu)].filter(Boolean).join(', '))}) — ${h(d.raisons.join(', '))}</li>`).join('')}</ul>
            <p>C'est le même ? Ouvrez sa fiche pour la compléter. Sinon : <button type="button" class="lien" data-ignorer>non, c'est un autre</button>.</p>`;
        zone.hidden = false;
        doublons.forEach(d => Commun.evenement('doublon_vu', d.id));
    }

    // --- Conflit de version : affichage des différences
    function afficherConflit(err) {
        const { actuelle, differences } = err.donnees;
        const zone = document.getElementById('conflit');
        const libelles = (config.champs || {});
        const valeur = v => (v ? h(String(v).replace(/;/g, ', ')) : '<span class="vide">(vide)</span>');
        zone.innerHTML = `<p><strong>${h(err.message)}</strong></p>
            <div class="tableau-conteneur"><table class="tableau compact"><thead><tr><th>Champ</th><th>Version actuelle</th><th>Votre saisie</th></tr></thead>
            <tbody>${(differences || []).map(d => `<tr><td>${h(d.libelle || libelles[d.champ] || d.champ)}</td><td>${valeur(d.actuelle)}</td><td>${valeur(d.vous)}</td></tr>`).join('')}</tbody></table></div>
            <p><button type="button" class="bouton petit" data-recharger>Repartir de la version actuelle</button>
            <span class="aide-petite">Votre saisie sera remplacée : notez ce que vous voulez garder.</span></p>`;
        zone.hidden = false;
        zone.querySelector('[data-recharger]').addEventListener('click', () => {
            mode = { type: 'modification', fiche: actuelle, version: actuelle.version };
            remplir(actuelle);
            zone.hidden = true;
        });
        zone.scrollIntoView({ block: 'nearest' });
    }

    async function envoyer(event) {
        event.preventDefault();
        const valeurs = lire();
        const erreurs = [];
        if (!valeurs.nom.trim()) erreurs.push('Le nom est obligatoire.');
        if (!valeurs.cuisine.trim()) erreurs.push('Le type de cuisine est obligatoire.');
        if (!valeurs.jours) erreurs.push('Cochez au moins un jour.');
        if (!valeurs.lieu && !Commun.urlSure(valeurs.emplacement)) erreurs.push('Choisissez un lieu ou collez le lien Google Maps (https://…).');
        if (valeurs.emplacement && !Commun.urlSure(valeurs.emplacement)) erreurs.push("L'emplacement doit être un lien (https://…).");
        if (valeurs.site && !Commun.urlSure(valeurs.site)) erreurs.push('Le site doit être une adresse web (https://…).');
        if (erreurs.length) {
            if (mode.type === 'ajout') Commun.evenement('ajout_erreur');
            afficherErreurs(erreurs);
            return;
        }
        const pseudo = document.getElementById('pseudoFormulaire').value.trim();
        Commun.memoriserPseudo(pseudo);
        const bouton = document.getElementById('envoyerFormulaire');
        bouton.disabled = true;
        try {
            let reponse;
            if (mode.type === 'modification') {
                reponse = await Commun.api(`/api/etablissements/${encodeURIComponent(mode.fiche.id)}`, {
                    method: 'PUT', body: { version: mode.version, etablissement: valeurs, pseudo },
                });
            } else {
                reponse = await Commun.api('/api/etablissements', { method: 'POST', body: { ...valeurs, pseudo } });
            }
            Commun.fermerModale(modale);
            Commun.notifier(reponse.message);
            apresEnvoi(reponse.etablissement);
        } catch (err) {
            if (err.statut === 409 && err.donnees && err.donnees.actuelle) {
                afficherErreurs([]);
                afficherConflit(err);
            } else {
                if (mode.type === 'ajout') Commun.evenement('ajout_erreur');
                afficherErreurs(err.details && err.details.length ? err.details : [err.message]);
            }
        } finally {
            bouton.disabled = false;
        }
    }

    function ouvrir(nouveauMode, ft) {
        mode = nouveauMode;
        formulaire.reset();
        document.getElementById('doublons').hidden = true;
        document.getElementById('doublons').dataset.ignore = '';
        document.getElementById('conflit').hidden = true;
        afficherErreurs([]);
        const ajout = mode.type === 'ajout';
        document.getElementById('titreFormulaire').textContent = ajout ? 'Ajouter un établissement' : `Modifier les infos de « ${ft.nom} »`;
        document.getElementById('aideFormulaire').textContent = ajout
            ? `Publié immédiatement et visible par tous. Vous pourrez le corriger pendant ${config.delaiGraceMinutes || 30} min depuis ce navigateur ; ensuite tout le monde peut l'améliorer.`
            : 'Votre modification est publiée immédiatement et enregistrée dans l\'historique de la fiche (elle peut être annulée).';
        document.getElementById('envoyerFormulaire').textContent = ajout ? 'Publier' : 'Enregistrer';
        remplir(ft || { type: 'foodtruck' });
        document.getElementById('pseudoFormulaire').value = Commun.pseudo();
        Commun.ouvrirModale(modale);
        document.getElementById('nom').focus();
    }

    /** Ouvre le formulaire d'ajout. `rappel(etablissement)` après publication. */
    function ouvrirAjout(rappel) {
        apresEnvoi = rappel || (() => {});
        Commun.evenement('ajout_ouvert');
        ouvrir({ type: 'ajout' });
    }

    /** Ouvre le formulaire de modification de la fiche `ft` (version courante). */
    function ouvrirModification(ft, rappel) {
        apresEnvoi = rappel || (() => {});
        Commun.evenement('modification_ouverte', ft.id);
        ouvrir({ type: 'modification', fiche: ft, version: ft.version }, ft);
    }

    /** Liste des lieux (sélecteurs du formulaire). */
    function definirLieux(liste) {
        lieux = [...liste].sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
        const select = document.getElementById('lieu');
        select.length = 1;
        for (const l of lieux) select.add(new Option(l.nom, l.id));
    }

    async function initialiser({ ouvrirFiche }) {
        modale = document.getElementById('modaleFormulaire');
        formulaire = document.getElementById('formEtablissement');
        config = await Commun.config();
        cases('casesJours', 'jours', JOURS);
        cases('casesPaiements', 'paiements', config.paiements || []);
        cases('casesEtiquettes', 'etiquettes', config.etiquettes || []);
        const categories = document.getElementById('categorie');
        for (const c of config.categories || []) categories.add(new Option(c, c));
        formulaire.addEventListener('submit', envoyer);
        document.getElementById('fichierPhoto').addEventListener('change', e => { envoyerPhoto(e.target.files[0]); e.target.value = ''; });
        document.getElementById('retirerPhoto').addEventListener('click', () => {
            afficherPhoto('');
            document.getElementById('etatPhoto').textContent = 'Photo retirée : enregistrez pour publier ce changement.';
        });
        document.getElementById('annulerFormulaire').addEventListener('click', () => Commun.fermerModale(modale));
        document.getElementById('casesJours').addEventListener('change', () => afficherLieuxJours());
        const planifier = () => { clearTimeout(minuterieDoublons); minuterieDoublons = setTimeout(verifierDoublons, 400); };
        ['nom', 'emplacement'].forEach(id => document.getElementById(id).addEventListener('input', planifier));
        document.getElementById('lieu').addEventListener('change', planifier);
        document.getElementById('doublons').addEventListener('click', e => {
            const ouvrirBouton = e.target.closest('[data-ouvrir]');
            if (ouvrirBouton) {
                Commun.fermerModale(modale);
                ouvrirFiche(ouvrirBouton.dataset.ouvrir);
            }
            if (e.target.closest('[data-ignorer]')) {
                const zone = document.getElementById('doublons');
                zone.dataset.ignore = document.getElementById('nom').value;
                zone.hidden = true;
            }
        });
    }

    return { initialiser, ouvrirAjout, ouvrirModification, definirLieux, lireLieuxJours };
})();
