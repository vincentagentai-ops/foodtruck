// Espace administrateur : page « À surveiller » (filet de sécurité de la publication immédiate).
// Signalements ouverts, avis masqués, ajouts et modifications sensibles, fiches incertaines ou archivées,
// fusion de fiches, blocage temporaire d'un navigateur, réglage des seuils.

(() => {
    const h = Commun.html;
    let donnees = null;
    let fiches = [];

    const date = ts => new Date(ts).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
    const vide = (tbody, texte, colonnes) => { tbody.innerHTML = `<tr><td colspan="${colonnes}" class="vide">${h(texte)}</td></tr>`; };
    const code = (auteur, court) => (auteur ? `<span class="code-auteur" title="Identifiant anonyme du navigateur">${h(court)}</span>` : h(court || ''));
    const boutonBloquer = auteur => (auteur ? `<button type="button" class="bouton secondaire petit" data-bloquer="${h(auteur)}">Bloquer</button>` : '');

    function erreur(err) {
        Commun.notifier(err.details && err.details.length ? `${err.message} ${err.details.join(' ')}` : err.message, 'erreur');
    }

    async function executer(fn) {
        try {
            const r = await fn();
            Commun.notifier(r.message);
            await charger();
            if (window.Admin) window.Admin.recharger();
        } catch (err) {
            erreur(err);
        }
    }

    function afficherSignalements() {
        const tbody = document.querySelector('#tableSignalements tbody');
        if (!donnees.signalements.length) return vide(tbody, 'Aucun signalement ouvert.', 6);
        tbody.innerHTML = donnees.signalements.map(s => `<tr>
            <td>${h(date(s.ts))}</td><td>${h(s.nom)}</td><td>${h(s.libelle)}</td>
            <td>${s.texte ? `« ${h(s.texte)} »` : ''}${s.avis ? `<br><small>Avis ${h(Commun.etoiles(s.avis.note))} : « ${h(s.avis.texte)} »${s.avis.masque ? ' (masqué)' : ''}</small>` : ''}</td>
            <td>${code(s.auteur, s.auteurCourt)}</td>
            <td class="actions"><button type="button" class="bouton petit" data-clore="${h(s.id)}">Clore</button>${
    s.avis && !s.avis.masque ? `<button type="button" class="bouton danger petit" data-masquer="${h(s.avis.id)}">Masquer l'avis</button>` : ''}${boutonBloquer(s.auteur)}</td>
        </tr>`).join('');
    }

    function afficherMasques() {
        const tbody = document.querySelector('#tableMasques tbody');
        if (!donnees.masques.length) return vide(tbody, 'Aucun avis masqué.', 7);
        tbody.innerHTML = donnees.masques.map(a => `<tr>
            <td>${h(date(a.maj))}</td><td>${h(a.nom)}</td><td>${h(Commun.etoiles(a.note))}</td>
            <td>« ${h(a.texte)} »${a.plat ? `<br><small>Plat : ${h(a.plat)}</small>` : ''}<br><small>${h(Commun.signature(a.pseudo))}</small></td>
            <td>${a.signalements}</td><td>${code(a.auteur, a.auteurCourt)}</td>
            <td class="actions"><button type="button" class="bouton succes petit" data-retablir="${h(a.id)}">Rétablir</button><button type="button" class="bouton danger petit" data-purger="${h(a.id)}">Supprimer définitivement</button>${boutonBloquer(a.auteur)}</td>
        </tr>`).join('');
    }

    function afficherModifications() {
        const tbody = document.querySelector('#tableModifications tbody');
        if (!donnees.modifications.length) return vide(tbody, 'Rien sur les 30 derniers jours.', 6);
        const actions = { creer: 'Ajout', modifier: 'Modification', restaurer: 'Restauration', statut_auto: 'Statut automatique', fusion: 'Fusion', retirer: 'Retrait' };
        const valeur = v => (v ? h(v) : '<span class="vide">(vide)</span>');
        tbody.innerHTML = donnees.modifications.map(m => {
            const precedente = Number(m.version) - 1;
            const restaurer = m.existe && m.action !== 'creer' && precedente >= 1
                ? `<button type="button" class="bouton petit" data-restaurer="${h(m.cible)}" data-version="${precedente}">Restaurer la version ${precedente}</button>` : '';
            const archiver = m.existe && m.action === 'creer'
                ? `<button type="button" class="bouton secondaire petit" data-archiver="${h(m.cible)}">Archiver</button>` : '';
            return `<tr>
                <td>${h(date(m.ts))}</td><td>${h(m.nom)}${m.existe ? '' : ' <small>(supprimée)</small>'}</td><td>${h(actions[m.action] || m.action)}</td>
                <td>${m.champs.map(c => `${h(c.libelle)} : ${valeur(c.avant)} → ${valeur(c.apres)}`).join('<br>')}${m.raison ? `<br><small>${h(m.raison)}</small>` : ''}</td>
                <td>${h(m.pseudo ? Commun.signature(m.pseudo) : '')} ${code(m.auteur, m.auteurCourt)}</td>
                <td class="actions">${restaurer}${archiver}${boutonBloquer(m.auteur)}</td>
            </tr>`;
        }).join('');
    }

    function afficherHorsLigne() {
        const tbody = document.querySelector('#tableHorsLigne tbody');
        if (!donnees.horsLigne.length) return vide(tbody, 'Aucun.', 4);
        tbody.innerHTML = donnees.horsLigne.map(ft => `<tr>
            <td>${h(ft.nom)}</td><td>${h(ft.statut === 'archive' ? 'archivé (masqué)' : 'incertain (présence à confirmer)')}</td><td>${h(ft.maj_le)}</td>
            <td class="actions"><button type="button" class="bouton succes petit" data-reactiver="${h(ft.id)}">Remettre actif</button><button type="button" class="bouton petit" data-modifier="${h(ft.id)}">Modifier</button></td>
        </tr>`).join('');
    }

    function afficherFusion() {
        const options = fiches.slice().sort((a, b) => a.nom.localeCompare(b.nom, 'fr'))
            .map(ft => `<option value="${h(ft.id)}">${h(ft.nom)} — ${h(ft.jours.replace(/;/g, ', '))}${ft.statut === 'archive' ? ' (archivé)' : ''}</option>`).join('');
        for (const id of ['fusionGarder', 'fusionAbsorber']) {
            const select = document.getElementById(id);
            const valeur = select.value;
            select.innerHTML = `<option value="">(choisir)</option>${options}`;
            select.value = valeur;
        }
    }

    function afficherBlocages() {
        const zone = document.getElementById('listeBlocages');
        zone.innerHTML = donnees.blocages.length
            ? donnees.blocages.map(b => `<li>${code(b.auteur, b.auteurCourt)} jusqu'au ${h(date(b.jusqua))}
                <button type="button" class="bouton secondaire petit" data-debloquer="${h(b.auteur)}">Débloquer</button></li>`).join('')
            : '<li class="vide">Aucun.</li>';
    }

    function afficherSeuils() {
        const form = document.getElementById('formSeuils');
        for (const [nom, valeur] of Object.entries(donnees.seuils)) if (form.elements[nom]) form.elements[nom].value = valeur;
    }

    async function charger() {
        try {
            [donnees, fiches] = await Promise.all([Commun.api('/api/admin/surveillance'), Commun.api('/api/admin/foodtrucks')]);
        } catch (err) {
            erreur(err);
            return;
        }
        const n = donnees.signalements.length + donnees.masques.length + donnees.heritees.length;
        document.getElementById('resumeSurveillance').textContent = n ? `(${n} à examiner)` : '— rien à examiner';
        afficherSignalements();
        afficherMasques();
        afficherModifications();
        afficherHorsLigne();
        afficherFusion();
        afficherBlocages();
        afficherSeuils();
    }

    async function surClic(e) {
        const b = e.target.closest('button');
        if (!b) return;
        const d = b.dataset;
        const fiche = id => fiches.find(f => f.id === id);
        if (d.clore) return executer(() => Commun.api('/api/admin/signalements/traiter', { method: 'POST', body: { ids: [d.clore], decision: 'clos' } }));
        if (d.masquer) return executer(() => Commun.api(`/api/admin/avis/${encodeURIComponent(d.masquer)}/masquer`, { method: 'POST', body: {} }));
        if (d.retablir) return executer(() => Commun.api(`/api/admin/avis/${encodeURIComponent(d.retablir)}/retablir`, { method: 'POST', body: {} }));
        if (d.purger) {
            if (!confirm('Supprimer définitivement cet avis (et ses signalements) ? Cette action ne peut pas être annulée.')) return undefined;
            return executer(() => Commun.api(`/api/admin/avis/${encodeURIComponent(d.purger)}`, { method: 'DELETE', body: {} }));
        }
        if (d.bloquer) {
            const jours = donnees.seuils.joursBlocage;
            if (!confirm(`Bloquer les contributions de ce navigateur pendant ${jours} jour(s) ? (Ses contributions passées restent visibles.)`)) return undefined;
            return executer(() => Commun.api('/api/admin/blocages', { method: 'POST', body: { auteur: d.bloquer, jours } }));
        }
        if (d.debloquer) return executer(() => Commun.api('/api/admin/blocages', { method: 'POST', body: { auteur: d.debloquer, jours: 0 } }));
        if (d.restaurer) {
            const ft = fiche(d.restaurer);
            if (!ft || !confirm(`Restaurer la version ${d.version} de « ${ft.nom} » ?`)) return undefined;
            return executer(() => Commun.api(`/api/admin/etablissements/${encodeURIComponent(ft.id)}/restaurer/${d.version}`,
                { method: 'POST', body: { versionActuelle: ft.version } }));
        }
        if (d.archiver || d.reactiver) {
            const ft = fiche(d.archiver || d.reactiver);
            if (!ft) return undefined;
            const statut = d.archiver ? 'archive' : 'actif';
            return executer(() => Commun.api(`/api/admin/foodtrucks/${encodeURIComponent(ft.id)}`,
                { method: 'PUT', body: { version: ft.version, foodtruck: { ...ft, statut } } }));
        }
        if (d.modifier) {
            const ft = fiche(d.modifier);
            if (ft && window.Admin) window.Admin.modifier(ft);
        }
        return undefined;
    }

    async function fusionner() {
        const garder = document.getElementById('fusionGarder').value;
        const absorber = document.getElementById('fusionAbsorber').value;
        if (!garder || !absorber) return Commun.notifier('Choisissez les deux fiches.', 'erreur');
        const nom = id => (fiches.find(f => f.id === id) || {}).nom;
        if (!confirm(`Fusionner « ${nom(absorber)} » dans « ${nom(garder)} » ? La fiche « ${nom(absorber)} » disparaîtra.`)) return undefined;
        return executer(() => Commun.api('/api/admin/fusion', { method: 'POST', body: { garder, absorber } }));
    }

    async function enregistrerSeuils(e) {
        e.preventDefault();
        const seuils = Object.fromEntries([...e.target.querySelectorAll('input')].map(i => [i.name, Number(i.value)]));
        await executer(() => Commun.api('/api/admin/moderation', { method: 'PUT', body: { seuils } }));
    }

    window.Surveillance = { charger };

    document.addEventListener('DOMContentLoaded', () => {
        document.getElementById('surveillance').addEventListener('click', surClic);
        document.getElementById('boutonFusion').addEventListener('click', fusionner);
        document.getElementById('formSeuils').addEventListener('submit', enregistrerSeuils);
        charger();
    });
})();
