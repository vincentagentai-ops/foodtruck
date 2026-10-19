// Fiche d'un établissement (fenêtre) : « Pour moi » (marques, carnet, « Copier pour Teams »), infos factuelles
// « modifiables par tous », présence du jour, avis des collègues « opinions signées », historique avec restauration,
// signalements.
// Tous les textes saisis par les collègues sont affichés échappés (Commun.html) : jamais de HTML interprété.

const Fiche = (() => {
    const h = Commun.html;
    let modale;
    let zone;
    let config = {};
    let lieux = {};
    let donnees = null; // réponse de /api/etablissements/:id
    let apresChangement = () => {};
    let surOuverture = () => {};
    let surFermeture = () => {};

    const liste = valeur => String(valeur || '').split(';').map(v => v.trim()).filter(Boolean);

    /** Lieu du jour : nom du lieu (+ minutes) ou lien Maps particulier. */
    function texteLieu(valeur) {
        const lieu = lieux[valeur];
        if (lieu) return lieu.minutes_a_pied ? `${lieu.nom} · ${lieu.minutes_a_pied} min à pied` : lieu.nom;
        return valeur ? 'emplacement sur Google Maps' : 'lieu à préciser';
    }

    function resumeAvis(r) {
        if (!r.nbAvis) return 'Aucun avis pour l\'instant.';
        if (r.nbAvis < (config.avisMinimum || 3)) return `Pas encore assez d'avis pour une moyenne (${r.nbAvis} avis).`;
        return `${Commun.etoiles(r.note)} ${Commun.nombre(r.note)} / 5 · ${r.nbAvis} avis`;
    }

    function textePresence(p) {
        const morceaux = [];
        if (p.presents) morceaux.push(`✔ Confirmé par ${p.presents} collègue${p.presents > 1 ? 's' : ''} (dernière à ${p.derniere})`);
        if (p.absents) morceaux.push(`⚠ Signalé absent par ${p.absents} collègue${p.absents > 1 ? 's' : ''}`);
        return morceaux.length ? morceaux.join(' · ') : "Personne n'a encore confirmé sa présence aujourd'hui.";
    }

    function blocInfos(ft, r) {
        const parJour = Formulaires.lireLieuxJours(ft.lieux_jours);
        const jours = liste(ft.jours);
        const lignesJours = jours.map(j => `<li><strong>${h(j)}</strong> : ${h(texteLieu(parJour[j] || ft.lieu))}</li>`).join('');
        const site = Commun.urlSure(ft.site);
        const maps = Commun.urlSure(ft.emplacement) || (lieux[ft.lieu] && Commun.urlSure(lieux[ft.lieu].maps));
        const lignes = [
            ['Cuisine', [ft.categorie, ft.cuisine !== ft.categorie ? ft.cuisine : ''].filter(Boolean).join(' · ')],
            ['Type', ft.type === 'restaurant' ? 'Restaurant' : 'Foodtruck'],
            ['Horaires', ft.horaires], ['Prix', Commun.formaterPrix(ft.prix)],
            ['Paiements', liste(ft.paiements).join(', ')], ['Particularités', liste(ft.etiquettes).join(', ')],
            ['Carte de fidélité', ft.fidelite === 'oui' ? 'Oui' : ''],
        ].filter(([, v]) => v).map(([k, v]) => `<dt>${h(k)}</dt><dd>${h(v)}</dd>`).join('');
        const liensParJour = Object.entries(parJour).filter(([, v]) => Commun.urlSure(v))
            .map(([j, v]) => `<a href="${h(Commun.urlSure(v))}" target="_blank" rel="noopener" data-clic="clic_maps">Plan du ${h(j.toLowerCase())}</a>`).join('');
        const liens = [
            site ? `<a href="${h(site)}" target="_blank" rel="noopener" data-clic="clic_site">Site / menu</a>` : '',
            maps ? `<a href="${h(maps)}" target="_blank" rel="noopener" data-clic="clic_maps">Plan Google Maps</a>` : '',
            liensParJour,
        ].filter(Boolean).join('');
        const erreurs = r.erreurs.map(e => `<p class="note-erreur">⚠ Un collègue signale une information erronée : « ${h(e.texte)} »
            (${h(Commun.tempsRelatif(e.ts))}). Si vous savez, corrigez-la avec « Modifier les infos ».</p>`).join('');
        const fermetures = r.fermetures.map(d => `<p class="bandeau-ferme">Fermé exceptionnellement le ${h(Commun.dateCourte(d))}</p>`).join('');
        const plusPresent = r.plusPresent
            ? `<p class="note-erreur">Signalé « n'est plus présent » par ${r.plusPresent} collègue${r.plusPresent > 1 ? 's' : ''} : présence à confirmer.</p>` : '';
        return `<section class="bloc-fiche bloc-infos" aria-labelledby="titreInfos">
            <h3 id="titreInfos">Infos <small>modifiables par tous</small></h3>
            ${fermetures}${plusPresent}${erreurs}
            <dl class="infos-fiche">${lignes}</dl>
            ${lignesJours ? `<p class="sous-titre">Jours et lieux</p><ul class="jours-fiche">${lignesJours}</ul>` : ''}
            ${liens ? `<p class="liens">${liens}</p>` : ''}
            <p class="ligne-boutons">
                <button type="button" class="bouton petit" data-action="modifier">Modifier les infos</button>
                <button type="button" class="bouton secondaire petit" data-action="historique" aria-expanded="false">Historique</button>
                <button type="button" class="bouton secondaire petit" data-action="signaler" aria-expanded="false">Signaler…</button>
                ${donnees.grace ? '<button type="button" class="bouton danger petit" data-action="retirer">Retirer mon ajout</button>' : ''}
            </p>
            <div id="zoneHistorique" class="sous-bloc" hidden></div>
            <form id="formSignalement" class="sous-bloc formulaire" hidden novalidate>
                <fieldset class="champ"><legend>Que voulez-vous signaler ?</legend>
                    <label class="case"><input type="radio" name="type" value="ferme" checked> Fermé exceptionnellement le
                        <input type="date" name="date" aria-label="Date de fermeture"></label><br>
                    <label class="case"><input type="radio" name="type" value="plus_present"> N'est plus présent (plus jamais là)</label><br>
                    <label class="case"><input type="radio" name="type" value="erreur"> Une information est erronée</label><br>
                    <label class="case"><input type="radio" name="type" value="doublon"> C'est un doublon d'une autre fiche</label>
                </fieldset>
                <div class="champ"><label for="texteSignalement">Précision <small>(obligatoire pour une info erronée)</small></label>
                    <input type="text" id="texteSignalement" name="texte" maxlength="200" placeholder="Ex : plus là le lundi depuis septembre"></div>
                <p class="aide-petite">Une info simplement fausse ? Le plus efficace est de la corriger avec « Modifier les infos ».</p>
                <p><button type="submit" class="bouton petit">Envoyer le signalement</button></p>
            </form>
        </section>`;
    }

    /** Marques et carnet (gardés dans ce navigateur) et partage vers Teams. */
    function blocPerso(ft) {
        const marque = Perso.marques()[ft.id] || '';
        const mange = Perso.mangeAujourdhui(ft.id);
        const bouton = (attributs, presse, texte) => `<button type="button" class="bouton secondaire petit bascule" ${attributs} aria-pressed="${presse}">${texte}</button>`;
        return `<section class="bloc-fiche bloc-perso" aria-labelledby="titrePerso">
            <h3 id="titrePerso">Pour moi <small>gardé dans ce navigateur</small></h3>
            <p class="ligne-boutons ligne-serree">
                ${bouton('data-marque="essaye"', marque === 'essaye', '✓ Déjà essayé')}
                ${bouton('data-marque="a_tester"', marque === 'a_tester', '☆ À tester')}
                ${bouton('data-action="mange"', mange, "🍽 J'y ai mangé aujourd'hui")}
                <button type="button" class="bouton petit" data-action="teams">Copier pour Teams</button>
            </p>
            <div class="sous-bloc" id="zoneTeams" hidden>
                <label for="texteTeams">Texte à coller dans Teams</label>
                <textarea id="texteTeams" rows="3" readonly></textarea>
                <p class="aide-petite" id="aideTeams" role="status"></p>
            </div>
        </section>`;
    }

    async function copierPourTeams() {
        const ft = donnees.etablissement;
        const jour = Logique.jourDeLaSemaine(new Date());
        const valeurLieu = jour && Logique.joursDe(ft).includes(jour) ? Logique.lieuDuJour(ft, jour) : ft.lieu;
        const texte = Logique.texteTeams(ft, {
            lieu: lieux[valeurLieu] ? lieux[valeurLieu].nom : '',
            presence: donnees.resume.presence,
            lien: `${location.origin}/${Logique.construireLien({ fiche: ft.id })}`,
        });
        const zone = document.getElementById('zoneTeams');
        zone.hidden = false;
        const ok = await Commun.copierTexte(texte, document.getElementById('texteTeams'));
        document.getElementById('aideTeams').textContent = ok
            ? 'Copié ! Collez-le dans Teams (Ctrl+V).'
            : 'Le texte est sélectionné : appuyez sur Ctrl+C pour le copier, puis collez-le dans Teams.';
        Commun.evenement('copie_teams', ft.id);
    }

    function blocPresence(r) {
        const p = r.presence;
        const bouton = (etat, texte) => `<button type="button" class="bouton petit ${etat === 'present' ? 'succes' : 'danger'}" data-presence="${etat}"
            aria-pressed="${p.monEtat === etat}">${texte}</button>`;
        return `<section class="bloc-fiche bloc-presence" aria-labelledby="titrePresence">
            <h3 id="titrePresence">Aujourd'hui</h3>
            <p>${h(textePresence(p))}</p>
            <p class="ligne-boutons">${bouton('present', '✔ Il est là')}${bouton('absent', "✖ Pas là aujourd'hui")}
                ${p.monEtat ? '<span class="aide-petite">Cliquez à nouveau sur votre choix pour le retirer.</span>' : ''}</p>
        </section>`;
    }

    function criteresTexte(criteres) {
        return Object.entries(criteres || {}).map(([nom, v]) => ((config.criteres || {})[nom] || {})[v]).filter(Boolean);
    }

    function blocAvis(r) {
        const avis = donnees.avis.map(a => `<li class="avis">
            <p class="tete-avis"><span class="etoiles" aria-label="${a.note} sur 5">${Commun.etoiles(a.note)}</span>
                <span class="signature">${h(Commun.signature(a.pseudo))} · ${h(Commun.tempsRelatif(a.maj))}${a.modifie ? ' · modifié' : ''}</span></p>
            ${a.texte ? `<p class="texte-avis">${h(a.texte)}</p>` : ''}
            ${a.plat ? `<p class="plat">Plat conseillé : ${h(a.plat)}</p>` : ''}
            ${criteresTexte(a.criteres).length ? `<p class="criteres">${h(criteresTexte(a.criteres).join(' · '))}</p>` : ''}
            <p class="actions-avis">${a.mien
                ? '<button type="button" class="lien" data-action="modifier-avis">Modifier</button> <button type="button" class="lien" data-action="supprimer-avis">Supprimer</button>'
                : `<button type="button" class="lien discret" data-signaler-avis="${h(a.id)}">Signaler un contenu inapproprié</button>`}</p>
        </li>`).join('');
        const mien = donnees.monAvis;
        const options = (nom, libelle) => `<div class="champ"><label for="critere-${nom}">${h(libelle)}</label>
            <select id="critere-${nom}" name="${nom}"><option value="">—</option>${Object.entries((config.criteres || {})[nom] || {})
        .map(([v, t]) => `<option value="${h(v)}"${mien && mien.criteres[nom] === v ? ' selected' : ''}>${h(t)}</option>`).join('')}</select></div>`;
        const notes = [5, 4, 3, 2, 1].map(n => `<input type="radio" id="note-${n}" name="note" value="${n}"${mien && mien.note === n ? ' checked' : ''}>
            <label for="note-${n}" title="${n} sur 5">★</label>`).join('');
        return `<section class="bloc-fiche bloc-avis" aria-labelledby="titreAvis">
            <h3 id="titreAvis">Avis des collègues <small>opinions personnelles, signées</small></h3>
            <p class="moyenne">${h(resumeAvis(r))}</p>
            ${avis ? `<ul class="liste-avis">${avis}</ul>` : ''}
            ${mien && mien.masque ? '<p class="note-erreur">Votre avis est masqué après des signalements : l\'administrateur va l\'examiner.</p>' : ''}
            <details class="sous-bloc" id="detailsAvis"${mien ? '' : ''}>
                <summary>${mien ? 'Modifier mon avis' : 'Donner mon avis'}</summary>
                <form id="formAvis" class="formulaire" novalidate>
                    <fieldset class="champ"><legend>Note <span class="requis">*</span></legend><div class="notation">${notes}</div></fieldset>
                    <div class="champ"><label for="texteAvis">Votre avis en une phrase</label>
                        <textarea id="texteAvis" name="texte" maxlength="280" rows="2">${h(mien ? mien.texte : '')}</textarea>
                        <small id="compteurAvis">${mien ? mien.texte.length : 0} / 280</small></div>
                    <div class="grille-3">${options('qualite_prix', 'Qualité-prix')}${options('portions', 'Portions')}${options('attente', 'Attente')}</div>
                    <div class="champ"><label for="platAvis">Plat conseillé</label>
                        <input type="text" id="platAvis" name="plat" maxlength="60" value="${h(mien ? mien.plat : '')}"></div>
                    <div class="champ"><label for="pseudoAvis">Votre nom (facultatif)</label>
                        <input type="text" id="pseudoAvis" name="pseudo" maxlength="30" value="${h(mien && mien.pseudo ? mien.pseudo : Commun.pseudo())}"
                            placeholder="Sinon : « Un collègue »" autocomplete="nickname">
                        <small>Affiché avec la mention « nom déclaré ».</small></div>
                    <ul class="erreurs" id="erreursAvis" hidden></ul>
                    <ul class="charte">
                        <li>Restez factuel et bienveillant.</li>
                        <li>Parlez des plats et du service, pas des personnes.</li>
                        <li>Pas de publicité ni d'informations personnelles.</li>
                        <li>Un seul avis par navigateur : vous pourrez le modifier ou le supprimer.</li>
                        <li>Un avis déplacé peut être signalé par les collègues et masqué.</li>
                    </ul>
                    <p><button type="submit" class="bouton petit">${mien ? 'Enregistrer mon avis' : 'Publier mon avis'}</button></p>
                </form>
            </details>
        </section>`;
    }

    function afficher() {
        const ft = donnees.etablissement;
        const r = donnees.resume;
        const badges = [
            ft.type === 'restaurant' ? '<span class="badge">Restaurant</span>' : '',
            ft.statut === 'incertain' ? '<span class="badge attention">Présence à confirmer</span>' : '',
        ].join('');
        zone.innerHTML = `<div class="tete-fiche">
                <h2 id="titreFiche">${h(ft.nom)} ${badges}</h2>
                <button type="button" class="fermer" data-action="fermer" aria-label="Fermer la fiche">×</button>
            </div>
            ${Commun.adressePhoto(ft.photo) ? `<img class="photo-detail" src="${h(ft.photo)}" alt="Photo de ${h(ft.nom)}">` : ''}
            ${blocPerso(ft)}${blocPresence(r)}${blocInfos(ft, r)}${blocAvis(r)}`;
    }

    async function charger(id) {
        donnees = await Commun.api(`/api/etablissements/${encodeURIComponent(id)}`);
        afficher();
    }

    async function ouvrir(id) {
        Commun.evenement('fiche_ouverte', id);
        try {
            await charger(id);
        } catch (err) {
            Commun.notifier(err.message, 'erreur');
            return;
        }
        Commun.ouvrirModale(modale);
        zone.querySelector('.fermer').focus();
        surOuverture(donnees.etablissement.id);
    }

    /** Recharge la fiche et la liste après une contribution. */
    async function rafraichir() {
        await charger(donnees.etablissement.id).catch(() => Commun.fermerModale(modale));
        apresChangement();
    }

    async function action(fn, succes) {
        try {
            const reponse = await fn();
            Commun.notifier(succes || reponse.message);
            await rafraichir();
            return true;
        } catch (err) {
            Commun.notifier(err.details && err.details.length ? `${err.message} ${err.details.join(' ')}` : err.message, 'erreur');
            return false;
        }
    }

    const url = suffixe => `/api/etablissements/${encodeURIComponent(donnees.etablissement.id)}${suffixe}`;

    async function afficherHistorique(bouton) {
        const cadre = document.getElementById('zoneHistorique');
        if (!cadre.hidden) { cadre.hidden = true; bouton.setAttribute('aria-expanded', 'false'); return; }
        Commun.evenement('historique_ouvert', donnees.etablissement.id);
        let historique;
        try { historique = await Commun.api(url('/historique')); } catch (err) { Commun.notifier(err.message, 'erreur'); return; }
        const actions = { creer: 'Ajout', modifier: 'Modification', restaurer: 'Restauration', fusion: 'Fusion de fiches', statut_auto: 'Statut automatique', retirer: 'Retrait par son auteur' };
        const valeur = v => (v ? h(String(v).replace(/;/g, ', ')) : '<span class="vide">(vide)</span>');
        const photoHistorique = v => (Commun.adressePhoto(v) ? `<img class="photo-historique" src="${h(v)}" alt="" loading="lazy">` : '<span class="vide">(aucune)</span>');
        const qui = e => (e.parAdmin ? "l'administrateur" : e.automatique ? 'le site (seuil automatique)' : Commun.signature(e.pseudo));
        cadre.innerHTML = historique.entrees.length ? `<ol class="historique">${historique.entrees.map(e => `<li>
            <p><strong>${h(actions[e.action] || e.action)}</strong>${e.version ? ` — version ${h(e.version)}` : ''} · ${h(qui(e))} ·
                ${h(new Date(e.ts).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' }))}
                ${e.ancienneFiche ? ` · ancienne fiche « ${h(e.ancienneFiche)} »` : ''}</p>
            ${e.raison ? `<p class="aide-petite">${h(e.raison)}</p>` : ''}
            ${e.champs.length ? `<ul class="changements">${e.champs.map(c => `<li>${h(c.libelle)} : ${c.champ === 'photo' ? `${photoHistorique(c.avant)} → ${photoHistorique(c.apres)}` : `${valeur(c.avant)} → ${valeur(c.apres)}`}</li>`).join('')}</ul>` : ''}
            ${e.restaurable ? `<button type="button" class="bouton secondaire petit" data-restaurer="${h(e.version)}">Restaurer cette version</button>` : ''}
            ${e.versionAvant ? `<button type="button" class="bouton secondaire petit" data-restaurer="${h(e.versionAvant)}">Restaurer la version d'avant (${h(e.versionAvant)})</button>` : ''}
        </li>`).join('')}</ol>` : '<p class="vide">Aucune modification enregistrée depuis la mise en place de l\'historique.</p>';
        cadre.hidden = false;
        bouton.setAttribute('aria-expanded', 'true');
    }

    async function surClic(e) {
        const cible = e.target.closest('button');
        if (!cible) return;
        const ft = donnees.etablissement;
        const nom = cible.dataset.action;
        if (nom === 'fermer') return Commun.fermerModale(modale);
        if (nom === 'modifier') {
            Commun.fermerModale(modale);
            return Formulaires.ouvrirModification(ft, () => { apresChangement(); ouvrir(ft.id); });
        }
        if (nom === 'historique') return afficherHistorique(cible);
        if (nom === 'teams') return copierPourTeams();
        if (nom === 'mange') {
            const ajoute = Perso.basculerRepas(ft);
            Commun.notifier(ajoute ? `Noté dans votre carnet : ${ft.nom}, aujourd'hui.` : 'Retiré de votre carnet.');
            return rafraichirPerso();
        }
        if (cible.dataset.marque) {
            Perso.basculerMarque(ft.id, cible.dataset.marque);
            return rafraichirPerso();
        }
        if (nom === 'signaler') {
            const form = document.getElementById('formSignalement');
            form.hidden = !form.hidden;
            cible.setAttribute('aria-expanded', String(!form.hidden));
            if (!form.hidden) form.elements.date.value = Commun.dateISO();
            return;
        }
        if (nom === 'retirer') {
            if (!confirm(`Retirer « ${ft.nom} » ? (Possible seulement juste après l'avoir ajouté.)`)) return;
            const ok = await action(() => Commun.api(url(''), { method: 'DELETE', body: { version: ft.version } }));
            if (ok) Commun.fermerModale(modale);
            return;
        }
        if (cible.dataset.presence) {
            const etat = donnees.resume.presence.monEtat === cible.dataset.presence ? 'aucun' : cible.dataset.presence;
            return action(() => Commun.api(url('/presence'), { method: 'POST', body: { etat } }));
        }
        if (cible.dataset.restaurer) {
            if (!confirm(`Restaurer la version ${cible.dataset.restaurer} de cette fiche ? (Ce sera enregistré comme une nouvelle modification.)`)) return;
            return action(() => Commun.api(url(`/restaurer/${encodeURIComponent(cible.dataset.restaurer)}`), {
                method: 'POST', body: { versionActuelle: ft.version, pseudo: Commun.pseudo() },
            }));
        }
        if (cible.dataset.signalerAvis) {
            if (!confirm('Signaler cet avis comme inapproprié ? Il sera masqué s\'il est signalé par plusieurs collègues.')) return;
            return action(() => Commun.api('/api/signalements', { method: 'POST', body: { cible: ft.id, type: 'inapproprie', avis: cible.dataset.signalerAvis } }));
        }
        if (nom === 'modifier-avis') {
            const details = document.getElementById('detailsAvis');
            details.open = true;
            details.scrollIntoView({ block: 'nearest' });
            return;
        }
        if (nom === 'supprimer-avis') {
            if (!confirm('Supprimer votre avis ?')) return;
            return action(() => Commun.api(url('/avis'), { method: 'DELETE', body: {} }));
        }
        return undefined;
    }

    /** Nouvel affichage du bloc « Pour moi » seulement (le reste de la fiche ne change pas). */
    function rafraichirPerso() {
        const bloc = zone.querySelector('.bloc-perso');
        const focus = document.activeElement;
        const cle = focus && (focus.dataset.marque || focus.dataset.action);
        bloc.outerHTML = blocPerso(donnees.etablissement);
        const nouveau = cle && zone.querySelector(`.bloc-perso [data-marque="${cle}"], .bloc-perso [data-action="${cle}"]`);
        if (nouveau) nouveau.focus();
    }

    async function surEnvoi(e) {
        e.preventDefault();
        const form = e.target;
        const ft = donnees.etablissement;
        if (form.id === 'formAvis') {
            const d = new FormData(form);
            const erreurs = document.getElementById('erreursAvis');
            if (!d.get('note')) {
                erreurs.innerHTML = '<li>Choisissez une note de 1 à 5 étoiles.</li>';
                erreurs.hidden = false;
                return;
            }
            Commun.memoriserPseudo(d.get('pseudo'));
            const corps = {
                note: Number(d.get('note')), texte: d.get('texte'), plat: d.get('plat'), pseudo: d.get('pseudo'),
                criteres: { qualite_prix: d.get('qualite_prix'), portions: d.get('portions'), attente: d.get('attente') },
            };
            try {
                const r = await Commun.api(url('/avis'), { method: 'POST', body: corps });
                Commun.notifier(r.message);
                await rafraichir();
            } catch (err) {
                erreurs.innerHTML = (err.details && err.details.length ? err.details : [err.message]).map(t => `<li>${h(t)}</li>`).join('');
                erreurs.hidden = false;
            }
        }
        if (form.id === 'formSignalement') {
            const d = new FormData(form);
            const corps = { cible: ft.id, type: d.get('type'), texte: d.get('texte') };
            if (corps.type === 'ferme') corps.date = d.get('date');
            if (corps.type === 'plus_present' && !confirm(`Signaler que « ${ft.nom} » n'est plus présent du tout ? (Pour une absence ponctuelle, utilisez « Pas là aujourd'hui ».)`)) return;
            await action(() => Commun.api('/api/signalements', { method: 'POST', body: corps }));
        }
    }

    function initialiser(options) {
        modale = document.getElementById('modaleFiche');
        zone = document.getElementById('contenuFiche');
        apresChangement = options.apresChangement || (() => {});
        surOuverture = options.surOuverture || (() => {});
        surFermeture = options.surFermeture || (() => {});
        modale.addEventListener('close', () => surFermeture());
        Commun.config().then(c => { config = c; });
        zone.addEventListener('click', surClic);
        zone.addEventListener('submit', surEnvoi);
        zone.addEventListener('input', e => {
            if (e.target.id === 'texteAvis') document.getElementById('compteurAvis').textContent = `${e.target.value.length} / 280`;
        });
        // Clics sur les liens Site / Plan de la fiche (statistiques)
        const surLien = e => {
            if (e.type === 'auxclick' && e.button !== 1) return;
            const lien = e.target.closest('a[data-clic]');
            if (lien && donnees) Commun.evenement(lien.dataset.clic, donnees.etablissement.id);
        };
        zone.addEventListener('click', surLien);
        zone.addEventListener('auxclick', surLien);
    }

    /** Lieux connus ({id: lieu}). */
    function definirLieux(objet) { lieux = objet; }

    return { initialiser, ouvrir, definirLieux, resumeAvis, textePresence };
})();
