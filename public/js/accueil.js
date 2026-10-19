// Page d'accueil : établissements du jour (ou vue semaine), recherche et filtres, regroupement par lieu, favoris,
// préférences, marques « essayé / à tester », nouveautés, « Au hasard », note et présence du jour, plan local,
// carnet personnel, fil « Quoi de neuf », liens partageables (jour, filtres et fiche ouverte dans l'adresse).
// La logique sans accès à la page est dans logique.js, le stockage personnel dans perso.js, la fiche dans fiche.js,
// le formulaire d'ajout / de modification dans formulaires.js.

(() => {
    const JOURS = Logique.JOURS;
    const CLE_FAVORIS = 'ft_favoris';
    const CLE_FILTRES = 'ft_filtres';
    const CLE_HASARD = 'ft_hasard_non_essaye';
    const JOURS_NOUVEAU = 15; // badge « Nouveau »
    const JOURS_NOUVEAUTES = 7; // encadré « Nouveaux cette semaine »
    const LIBELLES_ESSAI = { pas_essaye: 'pas encore essayé', a_tester: 'à tester', essaye: 'déjà essayé' };

    let etablissements = [];
    let lieux = {};
    let jourCourant = null;
    let vue = 'jour'; // 'jour' ou 'semaine'
    let filtres = { ...Logique.FILTRES_VIDES };
    let tri = 'lieu';
    let recherche = '';
    let favoris = new Set(Commun.lireLocal(CLE_FAVORIS, []));
    let resultats = [];
    let plan = null; // { image, positions } ou null
    let ficheOuverte = '';
    let dernierTirage = '';

    // --- Jours

    /** Jour à afficher par défaut : aujourd'hui, ou lundi le week-end. */
    function jourParDefaut() {
        const jour = Logique.jourDeLaSemaine(new Date());
        return jour ? { jour, weekEnd: false } : { jour: 'Lundi', weekEnd: true };
    }

    const estAujourdhui = jour => !jourParDefaut().weekEnd && jourParDefaut().jour === jour;

    /** Date (AAAA-MM-JJ) d'un jour affiché : cette semaine, ou la semaine prochaine le week-end. */
    function dateDuJour(jour) {
        const d = new Date();
        const index = d.getDay(); // 0 = dimanche
        const lundi = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((index + 6) % 7) + (index === 0 || index === 6 ? 7 : 0));
        lundi.setDate(lundi.getDate() + JOURS.indexOf(jour));
        return Commun.dateISO(lundi);
    }

    const lieuDuJour = Logique.lieuDuJour;
    const joursDe = Logique.joursDe;
    const listeDe = Logique.listeDe;

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
                bouton.setAttribute('aria-label', `${jour} (aujourd'hui)`);
            }
            bouton.addEventListener('click', () => choisirJour(jour, true));
            nav.appendChild(bouton);
        }
        const semaine = document.createElement('button');
        semaine.type = 'button';
        semaine.className = 'jour vue-semaine';
        semaine.id = 'boutonSemaine';
        semaine.textContent = 'Semaine';
        semaine.addEventListener('click', () => choisirSemaine(true));
        nav.appendChild(semaine);
        if (aujourdhui.weekEnd) {
            const info = document.getElementById('infoJour');
            info.textContent = "C'est le week-end : voici les établissements de lundi.";
            info.hidden = false;
        }
    }

    function marquerBoutonsJours() {
        document.querySelectorAll('.jour[data-jour]').forEach(b => b.setAttribute('aria-pressed', String(vue === 'jour' && b.dataset.jour === jourCourant)));
        document.getElementById('boutonSemaine').setAttribute('aria-pressed', String(vue === 'semaine'));
    }

    function choisirJour(jour, parUtilisateur) {
        jourCourant = jour;
        vue = 'jour';
        marquerBoutonsJours();
        if (parUtilisateur) {
            document.getElementById('infoJour').hidden = true;
            Commun.evenement('jour_clic', jour);
        } else {
            Commun.evenement('chargement', jour);
        }
        afficher();
    }

    function choisirSemaine(parUtilisateur) {
        vue = 'semaine';
        marquerBoutonsJours();
        if (parUtilisateur) document.getElementById('infoJour').hidden = true;
        Commun.evenement('vue_semaine', parUtilisateur ? 'clic' : 'lien');
        afficher();
    }

    // --- Adresse de la page (liens partageables)

    function majAdresse() {
        const jour = vue === 'jour' && jourCourant !== jourParDefaut().jour ? jourCourant : '';
        const parametres = Logique.construireLien({ jour, vue, recherche, filtres, tri, fiche: ficheOuverte });
        try {
            history.replaceState(null, '', `${location.pathname}${parametres}`);
        } catch { /* adresse non modifiable (page enregistrée sur le disque…) */ }
    }

    // --- Filtres et préférences

    const contexte = (jour = jourCourant) => ({ filtres, recherche, jour, lieux, marques: Perso.marques(), carnet: Perso.carnet() });
    const filtresActifs = () => Logique.filtresActifs(filtres) || Boolean(recherche);

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
        document.getElementById('recherche').value = recherche;
        if (filtres.etiquette || filtres.paiement || filtres.essai || tri !== 'lieu') document.getElementById('plusFiltres').open = true;
    }

    /** « Végétarien possible, 12 € ou moins, pas encore essayé » */
    function decrireFiltres(f) {
        return Object.entries(f).filter(([, v]) => v).map(([k, v]) => {
            if (k === 'prixMax') return `${v} € ou moins`;
            if (k === 'essai') return LIBELLES_ESSAI[v] || v;
            if (k === 'type') return v === 'restaurant' ? 'restaurants' : 'foodtrucks';
            return v;
        }).join(', ');
    }

    function afficherPreferences() {
        const prefs = Perso.preferences();
        const defaut = Logique.filtresActifs(prefs.filtres);
        document.getElementById('resumePreferences').textContent = defaut
            ? `Filtres appliqués à chaque ouverture du site : ${decrireFiltres(prefs.filtres)}.`
            : 'Aucun filtre par défaut : le site reprend vos derniers filtres. Choisissez des filtres puis « Utiliser les filtres actuels par défaut ».';
        document.getElementById('oublierPreferences').hidden = !defaut;
        document.getElementById('enregistrerPreferences').disabled = !Logique.filtresActifs(filtres) || Logique.memesFiltres(filtres, prefs.filtres);
        document.getElementById('appliquerPreferences').hidden = !defaut || Logique.memesFiltres(filtres, prefs.filtres);
        document.querySelectorAll('#casesPrivilegier input').forEach(c => { c.checked = prefs.privilegier.includes(c.value); });
    }

    function enregistrerPreferences(modification, cible) {
        const prefs = { ...Perso.preferences(), ...modification };
        if (!Logique.filtresActifs(prefs.filtres) && !prefs.privilegier.length) Perso.effacerPreferences();
        else Perso.enregistrerPreferences(prefs);
        Commun.evenement('preferences', cible);
    }

    // --- Affichage

    function comparer(a, b) {
        if ((a.statut === 'incertain') !== (b.statut === 'incertain')) return a.statut === 'incertain' ? 1 : -1;
        const privilegier = Perso.preferences().privilegier;
        const ecart = Logique.scorePreference(b, privilegier) - Logique.scorePreference(a, privilegier);
        if (ecart) return ecart;
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

    /** Lieux connus des établissements de `liste` pour le jour affiché, du plus proche au plus loin. */
    function lieuxOrdonnes(liste) {
        const minutes = cle => (lieux[cle].minutes_a_pied !== '' ? Number(lieux[cle].minutes_a_pied) : 999);
        const cles = [...new Set(liste.map(ft => lieuDuJour(ft, jourCourant)).filter(v => lieux[v]))];
        return cles.sort((a, b) => minutes(a) - minutes(b) || lieux[a].nom.localeCompare(lieux[b].nom, 'fr'));
    }

    /** Numéros des lieux sur le plan (seulement si un plan est affiché). */
    function numerosPlan(liste) {
        if (!plan || !plan.image || vue !== 'jour') return {};
        return Logique.numeroterLieux(lieuxOrdonnes(liste));
    }

    /** Note et présence du jour (résumé calculé par le serveur). */
    function resumeCollegues(ft) {
        const r = ft.resume;
        if (!r) return '';
        const h = Commun.html;
        const note = r.nbAvis >= 3
            ? `<span class="note" title="Moyenne des avis des collègues">★ ${h(Commun.nombre(r.note))} <small>(${r.nbAvis} avis)</small></span>`
            : `<span class="note vide">${r.nbAvis ? `Pas encore assez d'avis (${r.nbAvis})` : 'Pas encore d\'avis'}</span>`;
        let presence = '';
        if (estAujourdhui(jourCourant)) {
            const p = r.presence;
            if (p.presents) presence = `<span class="presence ok">✔ Confirmé par ${p.presents} collègue${p.presents > 1 ? 's' : ''} (dernière à ${h(p.derniere)})</span>`;
            if (p.absents) presence += `<span class="presence ko">⚠ Signalé absent par ${p.absents}</span>`;
            if (!presence) presence = '<span class="presence vide">Pas encore confirmé aujourd\'hui</span>';
        }
        return `<p class="resume-collegues">${note}${presence}</p>`;
    }

    function badgeEssai(ft, marques, carnet) {
        if (marques[ft.id] === 'a_tester') return '<span class="badge a-tester">À tester</span>';
        if (Logique.estEssaye(ft.id, marques, carnet)) return '<span class="badge essaye">✓ Déjà essayé</span>';
        return '';
    }

    /** Photo de l'établissement (adresse locale uniquement) ; clic = ouvrir la fiche. */
    function imageFiche(ft) {
        if (!Commun.adressePhoto(ft.photo)) return '';
        return `<button type="button" class="photo-fiche" data-fiche="${Commun.html(ft.id)}" tabindex="-1" aria-hidden="true">
                <img src="${Commun.html(ft.photo)}" alt="" loading="lazy" width="640" height="400"></button>`;
    }

    const badgeFidelite = ft => (ft.fidelite === 'oui' ? '<span class="badge fidelite" title="Propose une carte de fidélité">🎟 Carte de fidélité</span>' : '');

    function fiche(ft, avecLieu, perso) {
        const h = Commun.html;
        const site = Commun.urlSure(ft.site);
        const valeurLieu = lieuDuJour(ft, jourCourant);
        const lieu = lieux[valeurLieu];
        const maps = Commun.urlSure(valeurLieu) || Commun.urlSure(ft.emplacement) || (lieu && Commun.urlSure(lieu.maps));
        const ferme = ft.resume && ft.resume.fermetures.includes(dateDuJour(jourCourant));
        const favori = favoris.has(ft.id);
        const badges = [
            anciennete(ft.cree_le) < JOURS_NOUVEAU ? '<span class="badge nouveau">Nouveau</span>' : '',
            ft.type === 'restaurant' ? '<span class="badge">Restaurant</span>' : '',
            ft.statut === 'incertain' || (ft.resume && ft.resume.plusPresent) ? '<span class="badge attention">Présence à confirmer</span>' : '',
            badgeEssai(ft, perso.marques, perso.carnet),
            badgeFidelite(ft),
        ].join('');
        const infos = [Commun.formaterPrix(ft.prix), ft.horaires].filter(Boolean).map(t => `<span>${h(t)}</span>`).join('');
        const etiquettes = listeDe(ft.etiquettes)
            .map(e => (perso.privilegier.includes(e) ? `<li class="privilegiee" title="Particularité que vous privilégiez">★ ${h(e)}</li>` : `<li>${h(e)}</li>`)).join('');
        const paiements = listeDe(ft.paiements);
        const liens = [
            site ? `<a href="${h(site)}" target="_blank" rel="noopener" data-clic="clic_site" data-id="${h(ft.id)}">Site / menu</a>` : '',
            maps ? `<a href="${h(maps)}" target="_blank" rel="noopener" class="secondaire" data-clic="clic_maps" data-id="${h(ft.id)}">Plan Google Maps</a>` : '',
        ].filter(Boolean).join('');
        return `<article class="fiche${favori ? ' favori' : ''}${ft.statut === 'incertain' ? ' incertain' : ''}${ferme ? ' fermee' : ''}" id="ft-${h(ft.id)}" tabindex="-1">
            ${ferme ? `<p class="bandeau-ferme">Fermé exceptionnellement ce ${h(Commun.dateCourte(dateDuJour(jourCourant)))}</p>` : ''}
            ${imageFiche(ft)}
            <div class="fiche-tete">
                <h3><button type="button" class="lien nom-fiche" data-fiche="${h(ft.id)}">${h(ft.nom)}</button> ${badges}</h3>
                <button type="button" class="etoile" data-favori="${h(ft.id)}" aria-pressed="${favori}"
                    aria-label="${favori ? 'Retirer' : 'Ajouter'} ${h(ft.nom)} ${favori ? 'des' : 'aux'} favoris"
                    title="${favori ? 'Retirer des favoris' : 'Ajouter aux favoris'}">${favori ? '★' : '☆'}</button>
            </div>
            <p class="cuisine">${h(ft.categorie)}${ft.cuisine && ft.cuisine !== ft.categorie ? ` · ${h(ft.cuisine)}` : ''}</p>
            ${avecLieu ? `<p class="lieu${lieu ? '' : ' a-preciser'}">📍 ${h(texteLieu(lieu))}</p>` : ''}
            ${infos ? `<p class="infos">${infos}</p>` : ''}
            ${etiquettes ? `<ul class="etiquettes">${etiquettes}</ul>` : ''}
            ${paiements.length ? `<p class="paiements">Paiement : ${h(paiements.join(', '))}</p>` : ''}
            ${resumeCollegues(ft)}
            <p class="liens"><button type="button" class="lien" data-fiche="${h(ft.id)}">Fiche, avis, présence</button>${liens}</p>
        </article>`;
    }

    function afficherListe(liste, numeros) {
        const zone = document.getElementById('liste');
        const perso = { marques: Perso.marques(), carnet: Perso.carnet(), privilegier: Perso.preferences().privilegier };
        if (tri !== 'lieu') {
            zone.innerHTML = `<div class="fiches">${[...liste].sort(comparer).map(ft => fiche(ft, true, perso)).join('')}</div>`;
            return;
        }
        // Regroupement par lieu : lieux connus du plus proche au plus loin, « Lieu à préciser » en dernier
        const groupes = new Map();
        for (const ft of liste) {
            const valeur = lieuDuJour(ft, jourCourant);
            const cle = lieux[valeur] ? valeur : '';
            if (!groupes.has(cle)) groupes.set(cle, []);
            groupes.get(cle).push(ft);
        }
        const cles = [...lieuxOrdonnes(liste), ...(groupes.has('') ? [''] : [])];
        zone.innerHTML = cles.map(cle => {
            const lieu = lieux[cle];
            const fiches = groupes.get(cle).sort(comparer).map(ft => fiche(ft, false, perso)).join('');
            const description = lieu && lieu.description ? `<p class="description-lieu">${Commun.html(lieu.description)}</p>` : '';
            const aide = lieu ? '' : '<p class="description-lieu">Emplacement non encore renseigné : utilisez le lien Google Maps de chaque fiche.</p>';
            const numero = numeros[cle] ? `<span class="numero-lieu" title="Numéro sur le plan">${numeros[cle]}</span> ` : '📍 ';
            return `<section class="groupe-lieu" id="lieu-${Commun.html(cle || 'a-preciser')}" tabindex="-1">
                <h3 class="titre-lieu">${numero}${Commun.html(texteLieu(lieu))}</h3>${description}${aide}<div class="fiches">${fiches}</div></section>`;
        }).join('');
    }

    function afficherFavoris(duJour) {
        const bandeau = document.getElementById('bandeauFavoris');
        if (!favoris.size || vue !== 'jour') { bandeau.hidden = true; return; }
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

    // --- Plan local des emplacements

    function afficherPlan(liste, numeros) {
        const zone = document.getElementById('plan');
        const disposition = document.getElementById('disposition');
        if (!plan || !plan.image || vue !== 'jour') { zone.hidden = true; disposition.classList.remove('avec-plan'); agrandirPlan(false); return; }
        zone.hidden = false;
        disposition.classList.add('avec-plan');
        const h = Commun.html;
        const image = document.getElementById('planImage');
        if (image.getAttribute('src') !== plan.image) image.src = plan.image;
        const cadre = document.getElementById('planCadre');
        cadre.querySelectorAll('.repere').forEach(r => r.remove());
        const parLieu = {};
        for (const ft of liste) {
            const cle = lieuDuJour(ft, jourCourant);
            if (numeros[cle]) (parLieu[cle] = parLieu[cle] || []).push(ft.nom);
        }
        const ids = Object.keys(numeros).sort((a, b) => numeros[a] - numeros[b]);
        for (const id of ids) {
            const position = plan.positions[id];
            if (!Logique.positionValide(position)) continue;
            const repere = document.createElement('button');
            repere.type = 'button';
            repere.className = 'repere';
            repere.dataset.lieu = id;
            repere.textContent = numeros[id];
            repere.title = lieux[id].nom;
            repere.setAttribute('aria-label', `${numeros[id]} : ${lieux[id].nom} (${parLieu[id].length} établissement${parLieu[id].length > 1 ? 's' : ''})`);
            repere.style.left = `${position.x}%`; // CSSOM : autorisé par la politique de sécurité (pas d'attribut style)
            repere.style.top = `${position.y}%`;
            cadre.appendChild(repere);
        }
        document.getElementById('legendePlan').innerHTML = ids.map(id => `<li>
            <button type="button" class="lien" data-lieu="${h(id)}"><span class="numero-lieu">${numeros[id]}</span> ${h(lieux[id].nom)}</button>
            <span class="aide-petite">${h(parLieu[id].join(', '))}${Logique.positionValide(plan.positions[id]) ? '' : ' — pas encore placé sur le plan'}</span></li>`).join('')
            || '<li class="vide">Aucun lieu connu pour les établissements affichés.</li>';
        const quand = estAujourdhui(jourCourant) ? "aujourd'hui" : `le ${jourCourant.toLowerCase()}`;
        document.getElementById('resumePlan').textContent = ids.length ? `· ${ids.length} lieu${ids.length > 1 ? 'x' : ''} ${quand}` : '';
    }

    /** Plan agrandi par-dessus la liste (clic sur le plan ou bouton), réduit au clic suivant ou avec Échap. */
    function agrandirPlan(agrandi) {
        const disposition = document.getElementById('disposition');
        disposition.classList.toggle('plan-agrandi', agrandi);
        const bouton = document.getElementById('agrandirPlan');
        bouton.setAttribute('aria-pressed', String(agrandi));
        bouton.textContent = agrandi ? '⤡ Réduire' : '⤢ Agrandir';
        document.getElementById('planCadre').title = agrandi ? 'Cliquer pour réduire le plan' : 'Cliquer pour agrandir le plan';
        if (agrandi) Commun.evenement('plan_ouvert', jourCourant);
    }
    const planAgrandi = () => document.getElementById('disposition').classList.contains('plan-agrandi');

    function allerAuLieu(id) {
        agrandirPlan(false);
        Commun.evenement('plan_lieu_clic', id);
        const groupe = document.getElementById(`lieu-${id}`);
        if (!groupe) return;
        groupe.scrollIntoView({ behavior: 'smooth', block: 'start' });
        groupe.focus({ preventScroll: true });
    }

    // --- Vue semaine

    function afficherSemaine() {
        const h = Commun.html;
        const titre = document.getElementById('titreResultat');
        const liste = etablissements.filter(ft => Logique.correspond(ft, contexte(''))).sort((a, b) => {
            if (favoris.has(a.id) !== favoris.has(b.id)) return favoris.has(a.id) ? -1 : 1;
            return comparer(a, b);
        });
        resultats = [];
        document.getElementById('boutonHasard').disabled = true;
        const etat = document.getElementById('etatFiltres');
        etat.textContent = filtresActifs() ? `${liste.length} sur ${etablissements.length} correspondent aux filtres.` : '';
        if (!liste.length) {
            titre.textContent = etablissements.length ? 'Aucun établissement avec ces critères cette semaine.' : 'Aucun établissement connu.';
            document.getElementById('liste').innerHTML = '';
            return;
        }
        titre.textContent = `Semaine : ${liste.length} établissement${liste.length > 1 ? 's' : ''}`;
        const parJour = Object.fromEntries(JOURS.map(j => [j, liste.filter(ft => joursDe(ft).includes(j)).length]));
        const entetes = JOURS.map(j => `<th scope="col"${estAujourdhui(j) ? ' class="aujourdhui"' : ''}>
            <button type="button" class="lien entete-jour" data-jour-semaine="${j}" title="Voir le détail du ${j.toLowerCase()}">${j}</button>
            <small>${parJour[j]} établ.</small></th>`).join('');
        const lignes = liste.map(ft => {
            const favori = favoris.has(ft.id);
            const cellules = JOURS.map(j => {
                const classe = estAujourdhui(j) ? ' aujourdhui' : '';
                if (!joursDe(ft).includes(j)) return `<td class="absent${classe}"><span class="visuellement-cache">absent</span></td>`;
                if (ft.resume && ft.resume.fermetures.includes(dateDuJour(j))) return `<td class="ferme${classe}">Fermé</td>`;
                const valeur = lieuDuJour(ft, j);
                const lieu = lieux[valeur] ? lieux[valeur].nom : (Commun.urlSure(valeur) ? 'voir Maps' : '');
                return `<td class="present${classe}"><span aria-hidden="true">●</span> ${lieu ? h(lieu) : '<span class="visuellement-cache">présent</span>'}</td>`;
            }).join('');
            return `<tr${favori ? ' class="favori"' : ''}><th scope="row">
                <button type="button" class="lien nom-fiche" data-fiche="${h(ft.id)}">${favori ? '<span aria-label="favori">★</span> ' : ''}${h(ft.nom)}</button>
                <small>${h(ft.categorie)}</small> ${badgeEssai(ft, Perso.marques(), Perso.carnet())}</th>${cellules}</tr>`;
        }).join('');
        document.getElementById('liste').innerHTML = `<div class="tableau-conteneur"><table class="tableau semaine">
            <caption class="visuellement-cache">Présence des établissements du lundi au vendredi, avec le lieu de chaque jour</caption>
            <thead><tr><th scope="col">Établissement</th>${entetes}</tr></thead><tbody>${lignes}</tbody></table></div>
            <p class="aide-tableau">★ vos favoris, en tête de liste. Cliquez sur un jour pour en voir le détail, sur un nom pour ouvrir sa fiche.</p>`;
    }

    function afficher() {
        document.getElementById('effacerFiltres').hidden = !filtresActifs();
        afficherPreferences();
        majAdresse();
        if (vue === 'semaine') {
            afficherFavoris([]);
            afficherPlan([], {});
            afficherSemaine();
            return;
        }
        const titre = document.getElementById('titreResultat');
        const duJour = etablissements.filter(ft => joursDe(ft).includes(jourCourant));
        resultats = duJour.filter(ft => Logique.correspond(ft, contexte()));
        afficherFavoris(duJour);
        document.getElementById('boutonHasard').disabled = resultats.length === 0;
        const etat = document.getElementById('etatFiltres');
        etat.textContent = filtresActifs() ? `${resultats.length} sur ${duJour.length} correspondent aux filtres.` : '';
        const numeros = numerosPlan(resultats);
        afficherPlan(resultats, numeros);

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
        afficherListe(resultats, numeros);
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
        const nonEssaye = document.getElementById('hasardNonEssaye').checked;
        const tire = Logique.tirerAuHasard(resultats, {
            nonEssaye, marques: Perso.marques(), carnet: Perso.carnet(), exclure: dernierTirage ? [dernierTirage] : [],
        });
        if (!tire) {
            Commun.notifier('Vous avez déjà essayé tous les établissements affichés : décochez « que je n\'ai pas essayé ».', 'erreur');
            return;
        }
        dernierTirage = tire.id;
        Commun.evenement(nonEssaye ? 'hasard_non_essaye' : 'hasard', tire.id);
        Commun.notifier(`Au hasard : ${tire.nom} !`);
        allerA(tire.id);
        Fiche.ouvrir(tire.id);
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

    // --- Carnet personnel

    function afficherCarnet() {
        const h = Commun.html;
        const carnet = Perso.carnet();
        const { repas, adresses } = Logique.resumeCarnet(carnet, Perso.marques());
        document.getElementById('resumeCarnet').textContent = repas || adresses
            ? `· ${adresses} adresse${adresses > 1 ? 's' : ''} testée${adresses > 1 ? 's' : ''}, ${repas} repas noté${repas > 1 ? 's' : ''}`
            : '· vide';
        const existe = new Set(etablissements.map(ft => ft.id));
        document.getElementById('listeCarnet').innerHTML = carnet.length ? carnet.map(e => `<li>
            <span class="quand">${h(Commun.dateCourte(e.date))}</span> —
            ${existe.has(e.id) ? `<button type="button" class="lien" data-fiche="${h(e.id)}">${h(e.nom)}</button>` : h(e.nom)}
            <button type="button" class="lien discret" data-retirer-repas="${h(e.id)}" data-date="${h(e.date)}" aria-label="Retirer ${h(e.nom)} du ${h(Commun.dateCourte(e.date))}">retirer</button></li>`).join('')
            : '<li class="vide">Rien pour l\'instant.</li>';
        document.getElementById('effacerCarnet').disabled = !repas && !Object.keys(Perso.marques()).length;
    }

    // --- Chargement

    async function charger(rechargement = false) {
        try {
            const [reponse, listeLieux, lePlan] = await Promise.all([Commun.api('/api/etablissements'), Commun.api('/api/lieux'),
                Commun.api('/api/plan').catch(() => null)]);
            etablissements = reponse.etablissements;
            lieux = Object.fromEntries(listeLieux.map(l => [l.id, l]));
            plan = lePlan;
            // Fiches fusionnées : favoris, marques et carnet suivent la fiche conservée
            favoris = new Set([...favoris].map(id => reponse.alias[id] || id));
            Perso.suivreAlias(reponse.alias, new Set(etablissements.map(ft => ft.id)));
        } catch (err) {
            document.getElementById('titreResultat').textContent = 'Impossible de charger la liste. Réessayez plus tard.';
            return;
        }
        // Favoris d'établissements disparus : oubliés
        const ids = new Set(etablissements.map(ft => ft.id));
        favoris = new Set([...favoris].filter(id => ids.has(id)));
        Commun.ecrireLocal(CLE_FAVORIS, [...favoris]);
        Formulaires.definirLieux(Object.values(lieux));
        Fiche.definirLieux(lieux);
        afficherNouveautes();
        afficherCarnet();
        if (rechargement) afficher();
        else if (vue === 'semaine') { jourCourant = jourCourant || jourParDefaut().jour; choisirSemaine(false); } else choisirJour(jourCourant || jourParDefaut().jour, false);
        chargerQuoiDeNeuf();
    }

    // --- Fil « Quoi de neuf »
    async function chargerQuoiDeNeuf() {
        const zone = document.getElementById('listeQuoiDeNeuf');
        let elements;
        try { elements = await Commun.api('/api/quoi-de-neuf'); } catch { zone.innerHTML = '<li class="vide">Indisponible pour le moment.</li>'; return; }
        const h = Commun.html;
        const texte = e => {
            const qui = e.pseudo ? Commun.signature(e.pseudo) : 'un collègue';
            if (e.type === 'ajout') return `ajouté par ${qui}`;
            if (e.type === 'modification') return `infos modifiées par ${qui}${e.detail ? ` (${e.detail.toLowerCase()})` : ''}`;
            if (e.type === 'restauration') return `version précédente restaurée par ${qui}`;
            if (e.type === 'avis') return `${e.pseudo ? `avis de ${qui}` : "avis d'un collègue"} : ${Commun.etoiles(e.note)}`;
            if (e.type === 'fermeture') return `fermé exceptionnellement le ${Commun.dateCourte(e.date)}`;
            return '';
        };
        zone.innerHTML = elements.length ? elements.slice(0, 12).map(e => `<li>
            <button type="button" class="lien" data-fiche="${h(e.cible)}" data-quoi="1">${h(e.nom)}</button>
            ${h(texte(e))} <span class="quand">· ${h(Commun.tempsRelatif(e.ts))}</span></li>`).join('')
            : '<li class="vide">Rien de nouveau pour l\'instant : ajoutez un établissement ou donnez votre avis !</li>';
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
            // Recherche sans résultat (parmi les établissements du jour affiché) : texte tronqué, pour repérer des manques
            if (recherche) {
                minuterie = setTimeout(() => Commun.evenement(resultats.length || vue === 'semaine' ? 'recherche' : 'recherche_vide', recherche.slice(0, 30)), 1200);
            }
        });
        document.getElementById('effacerFiltres').addEventListener('click', () => {
            filtres = { ...Logique.FILTRES_VIDES };
            recherche = '';
            memoriserFiltres();
            synchroniserChamps();
            Commun.evenement('filtres_effaces');
            afficher();
        });
        document.getElementById('appliquerPreferences').addEventListener('click', () => {
            filtres = { ...Perso.preferences().filtres };
            memoriserFiltres();
            synchroniserChamps();
            Commun.evenement('preferences', 'appliquees');
            afficher();
        });
        document.getElementById('enregistrerPreferences').addEventListener('click', () => {
            enregistrerPreferences({ filtres: { ...filtres } }, 'enregistrees');
            Commun.notifier('Ces filtres seront appliqués à chaque ouverture du site, dans ce navigateur.');
        });
        document.getElementById('oublierPreferences').addEventListener('click', () => {
            enregistrerPreferences({ filtres: { ...Logique.FILTRES_VIDES } }, 'effacees');
            Commun.notifier('Plus de filtres par défaut.');
        });
        document.getElementById('casesPrivilegier').addEventListener('change', () => {
            const privilegier = [...document.querySelectorAll('#casesPrivilegier input:checked')].map(c => c.value);
            enregistrerPreferences({ privilegier }, 'privilegier');
        });
        document.getElementById('boutonHasard').addEventListener('click', auHasard);
        const caseHasard = document.getElementById('hasardNonEssaye');
        caseHasard.checked = Commun.lireLocal(CLE_HASARD, false) === true;
        caseHasard.addEventListener('change', () => Commun.ecrireLocal(CLE_HASARD, caseHasard.checked));
    }

    function brancherListe() {
        const liste = document.getElementById('liste');
        liste.addEventListener('click', e => {
            const etoile = e.target.closest('[data-favori]');
            if (etoile) basculerFavori(etoile.dataset.favori);
            const ouvrir = e.target.closest('[data-fiche]');
            if (ouvrir) Fiche.ouvrir(ouvrir.dataset.fiche);
            const jour = e.target.closest('[data-jour-semaine]');
            if (jour) {
                choisirJour(jour.dataset.jourSemaine, true);
                document.getElementById('titreResultat').focus();
            }
        });
        document.getElementById('listeQuoiDeNeuf').addEventListener('click', e => {
            const ouvrir = e.target.closest('[data-fiche]');
            if (!ouvrir) return;
            Commun.evenement('quoi_de_neuf_clic', ouvrir.dataset.fiche);
            Fiche.ouvrir(ouvrir.dataset.fiche);
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
            if (vue !== 'jour' || !joursDe(ft).includes(jourCourant)) choisirJour(joursDe(ft)[0], true);
            if (!resultats.some(r => r.id === ft.id)) document.getElementById('effacerFiltres').click();
            allerA(ft.id);
        });
        // Plan : repères et légende
        const surPlan = e => {
            const lieu = e.target.closest('[data-lieu]');
            if (lieu) allerAuLieu(lieu.dataset.lieu);
            else if (e.currentTarget.id === 'planCadre') agrandirPlan(!planAgrandi());
        };
        document.getElementById('planCadre').addEventListener('click', surPlan);
        document.getElementById('legendePlan').addEventListener('click', surPlan);
        document.getElementById('agrandirPlan').addEventListener('click', () => agrandirPlan(!planAgrandi()));
        document.addEventListener('keydown', e => {
            if (e.key === 'Escape' && planAgrandi() && !document.querySelector('dialog[open]')) agrandirPlan(false);
        });
        // Recherche et filtres : repliés à chaque ouverture de la page
        const outils = document.getElementById('outilsRecherche');
        outils.addEventListener('toggle', () => { if (outils.open) document.getElementById('recherche').focus(); });
        // Carnet
        const carnet = document.getElementById('carnet');
        carnet.addEventListener('toggle', () => { if (carnet.open) Commun.evenement('carnet_ouvert'); });
        document.getElementById('listeCarnet').addEventListener('click', e => {
            const ouvrir = e.target.closest('[data-fiche]');
            if (ouvrir) Fiche.ouvrir(ouvrir.dataset.fiche);
            const retirer = e.target.closest('[data-retirer-repas]');
            if (retirer) Perso.retirerRepas(retirer.dataset.retirerRepas, retirer.dataset.date);
        });
        document.getElementById('effacerCarnet').addEventListener('click', () => {
            if (!confirm('Effacer votre carnet et vos marques « Déjà essayé » / « À tester » ? (Dans ce navigateur ; irréversible.)')) return;
            Perso.effacerCarnet();
            Commun.notifier('Carnet effacé.');
        });
        // Toute modification des données personnelles (depuis la fiche, le carnet…) : nouvel affichage
        Perso.surChangement(() => { afficherCarnet(); if (jourCourant) afficher(); });
    }

    async function configurer() {
        const config = await Commun.config();
        if (config.titre) document.title = config.titre;
        remplirSelect('filtreCategorie', config.categories || []);
        remplirSelect('filtreEtiquette', config.etiquettes || []);
        remplirSelect('filtrePaiement', config.paiements || []);
        document.getElementById('casesPrivilegier').innerHTML = (config.etiquettes || []).map((e, i) => `<label class="case">
            <input type="checkbox" value="${Commun.html(e)}" id="privilegier-${i}"> ${Commun.html(e)}</label>`).join('');
        synchroniserChamps();
        if (!config.contactEmail) return;
        const sujet = encodeURIComponent('[FoodTrucks] Question');
        const lien = document.getElementById('lienMail');
        lien.href = `mailto:${config.contactEmail}?subject=${sujet}`;
        lien.addEventListener('click', () => Commun.evenement('clic_mail'));
        document.getElementById('contact').hidden = false;
    }

    /**
     * État initial : un lien partagé (paramètres de l'adresse) l'emporte, sans écraser les filtres mémorisés ;
     * sinon les préférences (filtres par défaut) si elles existent ; sinon les derniers filtres utilisés.
     */
    function etatInitial() {
        const memorises = Commun.lireLocal(CLE_FILTRES, {}) || {};
        const lien = Logique.lireLien(location.search);
        if (lien.present) {
            filtres = { ...Logique.FILTRES_VIDES, ...lien.filtres };
            recherche = lien.recherche;
            tri = lien.tri || 'lieu';
            if (lien.jour) jourCourant = lien.jour;
            if (lien.vue) vue = lien.vue;
            Commun.evenement('lien_ouvert', lien.fiche ? 'fiche' : Object.keys(lien.filtres).length || lien.recherche ? 'filtres' : 'jour');
            return lien.fiche;
        }
        tri = Logique.TRIS.includes(memorises.tri) ? memorises.tri : 'lieu';
        filtres = Perso.aDesPreferences() && Logique.filtresActifs(Perso.preferences().filtres)
            ? { ...Perso.preferences().filtres }
            : Logique.nettoyerFiltres(memorises);
        return '';
    }

    document.addEventListener('DOMContentLoaded', async () => {
        const ficheDuLien = etatInitial();
        creerBoutonsJours();
        brancherFiltres();
        brancherListe();
        Fiche.initialiser({
            apresChangement: () => charger(true),
            surOuverture: id => { ficheOuverte = id; majAdresse(); },
            surFermeture: () => { ficheOuverte = ''; majAdresse(); },
        });
        await Formulaires.initialiser({ ouvrirFiche: id => Fiche.ouvrir(id) });
        document.getElementById('boutonAjouter').addEventListener('click', () => Formulaires.ouvrirAjout(async ft => {
            await charger(true);
            if (ft) Fiche.ouvrir(ft.id);
        }));
        await configurer(); // listes des filtres avant le premier affichage
        await charger();
        if (ficheDuLien) Fiche.ouvrir(ficheDuLien);
    });
})();
