// Page d'accueil : établissements du jour, recherche et filtres, regroupement par lieu, favoris,
// nouveautés, « Au hasard », suggestion.

(() => {
    const JOURS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi'];
    const CLE_FAVORIS = 'ft_favoris';
    const CLE_FILTRES = 'ft_filtres';
    const FILTRES_VIDES = { categorie: '', prixMax: '', type: '', etiquette: '', paiement: '' };
    const JOURS_NOUVEAU = 15; // badge « Nouveau »
    const JOURS_NOUVEAUTES = 7; // encadré « Nouveaux cette semaine »

    let etablissements = [];
    let lieux = {};
    let jourCourant = null;
    let filtres = { ...FILTRES_VIDES, ...Commun.lireLocal(CLE_FILTRES, {}) };
    let tri = Commun.lireLocal(CLE_FILTRES, {}).tri || 'lieu';
    let recherche = '';
    let favoris = new Set(Commun.lireLocal(CLE_FAVORIS, []));
    let resultats = [];

    /** Jour à afficher par défaut : aujourd'hui, ou lundi le week-end. */
    function jourParDefaut() {
        const index = new Date().getDay(); // 0 = dimanche
        if (index >= 1 && index <= 5) return { jour: JOURS[index - 1], weekEnd: false };
        return { jour: 'Lundi', weekEnd: true };
    }

    const estAujourdhui = jour => !jourParDefaut().weekEnd && jourParDefaut().jour === jour;
    const joursDe = ft => ft.jours.split(';').map(j => j.trim()).filter(Boolean);
    const listeDe = valeur => String(valeur || '').split(';').map(v => v.trim()).filter(Boolean);

    /** Nombre de jours écoulés depuis une date AAAA-MM-JJ (Infinity si vide). */
    function anciennete(date) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return Infinity;
        const [a, m, j] = date.split('-').map(Number);
        const debut = new Date(a, m - 1, j);
        const maintenant = new Date();
        const aujourdhui = new Date(maintenant.getFullYear(), maintenant.getMonth(), maintenant.getDate());
        return Math.round((aujourdhui - debut) / 86400000);
    }

    function creerBoutonsJours() {
        const nav = document.getElementById('jours');
        const aujourdhui = jourParDefaut();
        for (const jour of JOURS) {
            const bouton = document.createElement('button');
            bouton.type = 'button';
            bouton.className = 'jour';
            bouton.dataset.jour = jour;
            bouton.textContent = jour;
            if (!aujourdhui.weekEnd && jour === aujourdhui.jour) {
                bouton.classList.add('aujourdhui');
                bouton.title = "Aujourd'hui";
            }
            bouton.addEventListener('click', () => choisirJour(jour, true));
            nav.appendChild(bouton);
        }
        if (aujourdhui.weekEnd) {
            const info = document.getElementById('infoJour');
            info.textContent = "C'est le week-end : voici les établissements de lundi.";
            info.hidden = false;
        }
    }

    function choisirJour(jour, parUtilisateur) {
        jourCourant = jour;
        document.querySelectorAll('.jour').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.jour === jour)));
        if (parUtilisateur) {
            document.getElementById('infoJour').hidden = true;
            Commun.evenement('jour_clic', jour);
        } else {
            Commun.evenement('chargement', jour);
        }
        afficher();
    }

    // --- Filtres

    function correspond(ft) {
        if (filtres.categorie && ft.categorie !== filtres.categorie) return false;
        if (filtres.type && ft.type !== filtres.type) return false;
        if (filtres.prixMax && !(Commun.prixMin(ft.prix) <= Number(filtres.prixMax))) return false;
        if (filtres.etiquette && !listeDe(ft.etiquettes).includes(filtres.etiquette)) return false;
        if (filtres.paiement && !listeDe(ft.paiements).includes(filtres.paiement)) return false;
        if (recherche) {
            const lieu = lieux[ft.lieu];
            const texte = Commun.simplifier([ft.nom, ft.cuisine, ft.categorie, ft.etiquettes, ft.paiements,
                ft.type, lieu ? lieu.nom : ''].join(' '));
            if (!Commun.simplifier(recherche).split(/\s+/).filter(Boolean).every(mot => texte.includes(mot))) return false;
        }
        return true;
    }

    const filtresActifs = () => Object.values(filtres).some(Boolean) || Boolean(recherche);

    function memoriserFiltres() {
        Commun.ecrireLocal(CLE_FILTRES, { ...filtres, tri });
    }

    function remplirSelect(id, valeurs) {
        const select = document.getElementById(id);
        for (const v of valeurs) select.add(new Option(v, v));
    }

    function synchroniserChamps() {
        document.querySelectorAll('[data-filtre]').forEach(s => { s.value = filtres[s.dataset.filtre] || ''; });
        document.getElementById('tri').value = tri;
        if (filtres.etiquette || filtres.paiement || tri !== 'lieu') document.getElementById('plusFiltres').open = true;
    }

    // --- Affichage

    function comparer(a, b) {
        if ((a.statut === 'incertain') !== (b.statut === 'incertain')) return a.statut === 'incertain' ? 1 : -1;
        if (tri === 'prix') {
            const pa = Commun.prixMin(a.prix);
            const pb = Commun.prixMin(b.prix);
            if (pa !== pb) return pa === Infinity ? 1 : pb === Infinity ? -1 : pa - pb;
        }
        return a.nom.localeCompare(b.nom, 'fr', { sensitivity: 'base' });
    }

    function texteLieu(lieu) {
        if (!lieu) return 'Lieu à préciser';
        return lieu.minutes_a_pied ? `${lieu.nom} · ${lieu.minutes_a_pied} min à pied` : lieu.nom;
    }

    function fiche(ft, avecLieu) {
        const h = Commun.html;
        const site = Commun.urlSure(ft.site);
        const lieu = lieux[ft.lieu];
        const maps = Commun.urlSure(ft.emplacement) || (lieu && Commun.urlSure(lieu.maps));
        const favori = favoris.has(ft.id);
        const badges = [
            anciennete(ft.cree_le) < JOURS_NOUVEAU ? '<span class="badge nouveau">Nouveau</span>' : '',
            ft.type === 'restaurant' ? '<span class="badge">Restaurant</span>' : '',
            ft.statut === 'incertain' ? '<span class="badge attention">Présence à confirmer</span>' : '',
        ].join('');
        const infos = [Commun.formaterPrix(ft.prix), ft.horaires].filter(Boolean).map(t => `<span>${h(t)}</span>`).join('');
        const etiquettes = listeDe(ft.etiquettes).map(e => `<li>${h(e)}</li>`).join('');
        const paiements = listeDe(ft.paiements);
        const liens = [
            site ? `<a href="${h(site)}" target="_blank" rel="noopener" data-clic="clic_site" data-id="${h(ft.id)}">Site / menu</a>` : '',
            maps ? `<a href="${h(maps)}" target="_blank" rel="noopener" class="secondaire" data-clic="clic_maps" data-id="${h(ft.id)}">Plan Google Maps</a>` : '',
        ].filter(Boolean).join('');
        return `<article class="fiche${favori ? ' favori' : ''}${ft.statut === 'incertain' ? ' incertain' : ''}" id="ft-${h(ft.id)}" tabindex="-1">
            <div class="fiche-tete">
                <h3>${h(ft.nom)} ${badges}</h3>
                <button type="button" class="etoile" data-favori="${h(ft.id)}" aria-pressed="${favori}"
                    aria-label="${favori ? 'Retirer' : 'Ajouter'} ${h(ft.nom)} ${favori ? 'des' : 'aux'} favoris"
                    title="${favori ? 'Retirer des favoris' : 'Ajouter aux favoris'}">${favori ? '★' : '☆'}</button>
            </div>
            <p class="cuisine">${h(ft.categorie)}${ft.cuisine && ft.cuisine !== ft.categorie ? ` · ${h(ft.cuisine)}` : ''}</p>
            ${avecLieu ? `<p class="lieu${lieu ? '' : ' a-preciser'}">📍 ${h(texteLieu(lieu))}</p>` : ''}
            ${infos ? `<p class="infos">${infos}</p>` : ''}
            ${etiquettes ? `<ul class="etiquettes">${etiquettes}</ul>` : ''}
            ${paiements.length ? `<p class="paiements">Paiement : ${h(paiements.join(', '))}</p>` : ''}
            ${liens ? `<p class="liens">${liens}</p>` : ''}
        </article>`;
    }

    function afficherListe(liste) {
        const zone = document.getElementById('liste');
        if (tri !== 'lieu') {
            zone.innerHTML = `<div class="fiches">${[...liste].sort(comparer).map(ft => fiche(ft, true)).join('')}</div>`;
            return;
        }
        // Regroupement par lieu : lieux connus du plus proche au plus loin, « Lieu à préciser » en dernier
        const groupes = new Map();
        for (const ft of liste) {
            const cle = lieux[ft.lieu] ? ft.lieu : '';
            if (!groupes.has(cle)) groupes.set(cle, []);
            groupes.get(cle).push(ft);
        }
        const minutes = cle => (cle && lieux[cle].minutes_a_pied !== '' ? Number(lieux[cle].minutes_a_pied) : 999);
        const cles = [...groupes.keys()].sort((a, b) => {
            if (!a || !b) return a ? -1 : 1;
            return minutes(a) - minutes(b) || lieux[a].nom.localeCompare(lieux[b].nom, 'fr');
        });
        zone.innerHTML = cles.map(cle => {
            const lieu = lieux[cle];
            const fiches = groupes.get(cle).sort(comparer).map(ft => fiche(ft, false)).join('');
            const description = lieu && lieu.description ? `<p class="description-lieu">${Commun.html(lieu.description)}</p>` : '';
            const aide = lieu ? '' : '<p class="description-lieu">Emplacement non encore renseigné : utilisez le lien Google Maps de chaque fiche.</p>';
            return `<section class="groupe-lieu"><h3 class="titre-lieu">📍 ${Commun.html(texteLieu(lieu))}</h3>${description}${aide}<div class="fiches">${fiches}</div></section>`;
        }).join('');
    }

    function afficherFavoris(duJour) {
        const bandeau = document.getElementById('bandeauFavoris');
        if (!favoris.size) { bandeau.hidden = true; return; }
        const presents = duJour.filter(ft => favoris.has(ft.id)).sort(comparer);
        const quand = estAujourdhui(jourCourant) ? "aujourd'hui" : `le ${jourCourant.toLowerCase()}`;
        bandeau.innerHTML = presents.length
            ? `★ Vos favoris présents ${quand} : ${presents.map(ft => `<a href="#ft-${Commun.html(ft.id)}" data-aller="${Commun.html(ft.id)}">${Commun.html(ft.nom)}</a>`).join(', ')}`
            : `☆ Aucun de vos favoris n'est présent ${quand}.`;
        bandeau.hidden = false;
    }

    function afficherNouveautes() {
        const nouveaux = etablissements.filter(ft => anciennete(ft.cree_le) < JOURS_NOUVEAUTES)
            .sort((a, b) => b.cree_le.localeCompare(a.cree_le));
        const zone = document.getElementById('nouveautes');
        zone.hidden = nouveaux.length === 0;
        document.getElementById('listeNouveautes').innerHTML = nouveaux.map(ft => {
            const jours = joursDe(ft);
            return `<li><button type="button" class="lien" data-nouveau="${Commun.html(ft.id)}">${Commun.html(ft.nom)}</button>
                — ${Commun.html(ft.categorie)}, ${Commun.html(jours.length === 5 ? 'toute la semaine' : jours.join(', ').toLowerCase())}</li>`;
        }).join('');
    }

    function afficher() {
        const titre = document.getElementById('titreResultat');
        const duJour = etablissements.filter(ft => joursDe(ft).includes(jourCourant));
        resultats = duJour.filter(correspond);
        afficherFavoris(duJour);
        document.getElementById('effacerFiltres').hidden = !filtresActifs();
        document.getElementById('boutonHasard').disabled = resultats.length === 0;
        const etat = document.getElementById('etatFiltres');
        etat.textContent = filtresActifs() ? `${resultats.length} sur ${duJour.length} correspondent aux filtres.` : '';

        const jour = jourCourant.toLowerCase();
        if (duJour.length === 0) {
            titre.textContent = `Aucun établissement connu le ${jour}.`;
            document.getElementById('liste').innerHTML = '';
            return;
        }
        if (resultats.length === 0) {
            titre.textContent = `Aucun résultat le ${jour} avec ces critères.`;
            document.getElementById('liste').innerHTML = '<p class="vide">Modifiez la recherche ou cliquez sur « Effacer les filtres ».</p>';
            return;
        }
        titre.textContent = `${resultats.length} établissement${resultats.length > 1 ? 's' : ''} le ${jour}`;
        afficherListe(resultats);
    }

    function allerA(id) {
        const element = document.getElementById(`ft-${id}`);
        if (!element) return;
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        element.classList.remove('surligne');
        void element.offsetWidth; // relance l'animation
        element.classList.add('surligne');
        element.focus({ preventScroll: true });
    }

    function auHasard() {
        if (!resultats.length) return;
        const tire = resultats[Math.floor(Math.random() * resultats.length)];
        Commun.evenement('hasard', tire.id);
        Commun.notifier(`Au hasard : ${tire.nom} !`);
        allerA(tire.id);
    }

    function basculerFavori(id) {
        if (favoris.has(id)) {
            favoris.delete(id);
            Commun.evenement('favori_retrait', id);
        } else {
            favoris.add(id);
            Commun.evenement('favori_ajout', id);
        }
        Commun.ecrireLocal(CLE_FAVORIS, [...favoris]);
        afficher();
        const bouton = document.querySelector(`[data-favori="${CSS.escape(id)}"]`);
        if (bouton) bouton.focus();
    }

    async function charger() {
        try {
            const [liste, listeLieux] = await Promise.all([Commun.api('/api/foodtrucks'), Commun.api('/api/lieux')]);
            etablissements = liste;
            lieux = Object.fromEntries(listeLieux.map(l => [l.id, l]));
        } catch (err) {
            document.getElementById('titreResultat').textContent = 'Impossible de charger la liste. Réessayez plus tard.';
            return;
        }
        // Favoris d'établissements disparus : oubliés
        const ids = new Set(etablissements.map(ft => ft.id));
        favoris = new Set([...favoris].filter(id => ids.has(id)));
        remplirLieuxSuggestion();
        afficherNouveautes();
        choisirJour(jourCourant || jourParDefaut().jour, false);
    }

    function brancherFiltres() {
        document.querySelectorAll('[data-filtre]').forEach(select => select.addEventListener('change', () => {
            filtres[select.dataset.filtre] = select.value;
            memoriserFiltres();
            Commun.evenement('filtre', `${select.dataset.filtre}=${select.value}`);
            afficher();
        }));
        document.getElementById('tri').addEventListener('change', e => {
            tri = e.target.value;
            memoriserFiltres();
            Commun.evenement('tri', tri);
            afficher();
        });
        let minuterie;
        document.getElementById('recherche').addEventListener('input', e => {
            recherche = e.target.value.trim();
            afficher();
            clearTimeout(minuterie);
            if (recherche) minuterie = setTimeout(() => Commun.evenement('recherche', recherche.slice(0, 30)), 1200);
        });
        document.getElementById('effacerFiltres').addEventListener('click', () => {
            filtres = { ...FILTRES_VIDES };
            recherche = '';
            document.getElementById('recherche').value = '';
            memoriserFiltres();
            synchroniserChamps();
            Commun.evenement('filtres_effaces');
            afficher();
        });
        document.getElementById('boutonHasard').addEventListener('click', auHasard);
    }

    function brancherListe() {
        const liste = document.getElementById('liste');
        liste.addEventListener('click', e => {
            const etoile = e.target.closest('[data-favori]');
            if (etoile) basculerFavori(etoile.dataset.favori);
        });
        // Clic gauche et clic molette (auxclick) sur les liens site / Maps
        const surLien = e => {
            if (e.type === 'auxclick' && e.button !== 1) return;
            const lien = e.target.closest('a[data-clic]');
            if (lien) Commun.evenement(lien.dataset.clic, lien.dataset.id);
        };
        liste.addEventListener('click', surLien);
        liste.addEventListener('auxclick', surLien);
        document.getElementById('bandeauFavoris').addEventListener('click', e => {
            const lien = e.target.closest('[data-aller]');
            if (!lien) return;
            e.preventDefault();
            allerA(lien.dataset.aller);
        });
        document.getElementById('listeNouveautes').addEventListener('click', e => {
            const bouton = e.target.closest('[data-nouveau]');
            if (!bouton) return;
            const ft = etablissements.find(f => f.id === bouton.dataset.nouveau);
            if (!ft) return;
            Commun.evenement('nouveau_clic', ft.id);
            if (!joursDe(ft).includes(jourCourant)) choisirJour(joursDe(ft)[0], true);
            if (!resultats.some(r => r.id === ft.id)) document.getElementById('effacerFiltres').click();
            allerA(ft.id);
        });
    }

    // --- Suggestion
    const modale = document.getElementById('modaleSuggestion');
    const formulaire = document.getElementById('formSuggestion');

    function cases(zoneId, nom, valeurs) {
        document.getElementById(zoneId).innerHTML = valeurs
            .map(v => `<label class="case"><input type="checkbox" name="${nom}" value="${Commun.html(v)}"> ${Commun.html(v)}</label>`).join('');
    }

    function remplirLieuxSuggestion() {
        const select = document.getElementById('lieu');
        const liste = Object.values(lieux).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
        for (const l of liste) select.add(new Option(l.nom, l.id));
        document.getElementById('champLieu').hidden = liste.length === 0;
    }

    function afficherErreurs(erreurs) {
        const liste = document.getElementById('erreursSuggestion');
        liste.innerHTML = erreurs.map(e => `<li>${Commun.html(e)}</li>`).join('');
        liste.hidden = erreurs.length === 0;
    }

    function ouvrirSuggestion() {
        Commun.evenement('suggestion_ouverte');
        afficherErreurs([]);
        if (typeof modale.showModal === 'function') modale.showModal(); else modale.setAttribute('open', '');
        document.getElementById('nom').focus();
    }

    function fermerSuggestion() {
        if (typeof modale.close === 'function') modale.close(); else modale.removeAttribute('open');
    }

    async function envoyerSuggestion(event) {
        event.preventDefault();
        const donnees = new FormData(formulaire);
        const suggestion = {
            nom: donnees.get('nom'),
            type: donnees.get('type'),
            categorie: donnees.get('categorie'),
            cuisine: donnees.get('cuisine'),
            jours: donnees.getAll('jours').join(';'),
            lieu: donnees.get('lieu') || '',
            emplacement: donnees.get('emplacement').trim(),
            prix: donnees.get('prix'),
            horaires: donnees.get('horaires'),
            paiements: donnees.getAll('paiements').join(';'),
            site: donnees.get('site').trim(),
        };
        const erreurs = [];
        if (!suggestion.nom.trim()) erreurs.push('Le nom est obligatoire.');
        if (!suggestion.cuisine.trim()) erreurs.push('Le type de cuisine est obligatoire.');
        if (!suggestion.jours) erreurs.push('Cochez au moins un jour.');
        if (!suggestion.lieu && !Commun.urlSure(suggestion.emplacement)) erreurs.push("Choisissez un lieu ou collez le lien Google Maps (https://…).");
        if (suggestion.emplacement && !Commun.urlSure(suggestion.emplacement)) erreurs.push("L'emplacement doit être un lien (https://…).");
        if (suggestion.site && !Commun.urlSure(suggestion.site)) erreurs.push('Le site doit être une adresse web (https://…).');
        if (erreurs.length) {
            Commun.evenement('suggestion_erreur');
            afficherErreurs(erreurs);
            return;
        }
        const bouton = formulaire.querySelector('[type=submit]');
        bouton.disabled = true;
        try {
            const reponse = await Commun.api('/api/suggestions', { method: 'POST', body: suggestion });
            formulaire.reset();
            fermerSuggestion();
            Commun.notifier(reponse.message);
        } catch (err) {
            Commun.evenement('suggestion_erreur');
            afficherErreurs(err.details && err.details.length ? err.details : [err.message]);
        } finally {
            bouton.disabled = false;
        }
    }

    async function configurer() {
        const config = await Commun.config();
        if (config.titre) document.title = config.titre;
        remplirSelect('filtreCategorie', config.categories || []);
        remplirSelect('filtreEtiquette', config.etiquettes || []);
        remplirSelect('filtrePaiement', config.paiements || []);
        remplirSelect('categorie', config.categories || []);
        cases('casesPaiements', 'paiements', config.paiements || []);
        synchroniserChamps();
        if (!config.contactEmail) return;
        const sujet = encodeURIComponent('[FoodTrucks] Suggestion');
        const corps = encodeURIComponent("Bonjour,\n\nVoici ma remarque ou l'établissement que je veux ajouter :\n\nNom : \nType de cuisine : \nJours : \nLieu : \nEmplacement Google Maps : \nFourchette de prix : \nHoraires : \nPaiements acceptés : \nSite (optionnel) : \n\n");
        const lien = document.getElementById('lienMail');
        lien.href = `mailto:${config.contactEmail}?subject=${sujet}&body=${corps}`;
        lien.addEventListener('click', () => Commun.evenement('clic_mail'));
        document.getElementById('contact').hidden = false;
    }

    document.addEventListener('DOMContentLoaded', async () => {
        creerBoutonsJours();
        cases('casesJours', 'jours', JOURS);
        brancherFiltres();
        brancherListe();
        document.getElementById('boutonSuggerer').addEventListener('click', ouvrirSuggestion);
        document.getElementById('annulerSuggestion').addEventListener('click', fermerSuggestion);
        formulaire.addEventListener('submit', envoyerSuggestion);
        await configurer(); // listes des filtres avant le premier affichage
        charger();
    });
})();
