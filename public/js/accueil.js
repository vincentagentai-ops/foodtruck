// Page d'accueil : foodtrucks du jour, tri, suggestion.

(() => {
    const JOURS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi'];
    const NOMS_COLONNES = { nom: 'Nom', cuisine: 'Cuisine', emplacement: 'Emplacement', prix: 'Prix' };
    let foodtrucks = [];
    let jourCourant = null;
    let tri = { colonne: null, ordre: 'asc' };

    /** Jour à afficher par défaut : aujourd'hui, ou lundi le week-end. */
    function jourParDefaut() {
        const index = new Date().getDay(); // 0 = dimanche
        if (index >= 1 && index <= 5) return { jour: JOURS[index - 1], weekEnd: false };
        return { jour: 'Lundi', weekEnd: true };
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
            if (!aujourdhui.weekEnd && jour === aujourdhui.jour) bouton.classList.add('aujourdhui');
            bouton.addEventListener('click', () => choisirJour(jour, true));
            nav.appendChild(bouton);
        }
        if (aujourdhui.weekEnd) {
            const info = document.getElementById('infoJour');
            info.textContent = "C'est le week-end : voici les foodtrucks de lundi.";
            info.hidden = false;
        }
    }

    function choisirJour(jour, parUtilisateur) {
        jourCourant = jour;
        document.querySelectorAll('.jour').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.jour === jour)));
        if (parUtilisateur) document.getElementById('infoJour').hidden = true;
        Commun.journaliser(`Jour sélectionné : ${jour}`);
        afficher();
    }

    function valeurTri(ft, colonne) {
        if (colonne === 'prix') return Commun.prixMin(ft.prix);
        if (colonne === 'emplacement') return ft.emplacement;
        return (ft[colonne] || '').toLocaleLowerCase('fr');
    }

    function afficher() {
        const titre = document.getElementById('titreResultat');
        const table = document.getElementById('tableFoodtrucks');
        const corps = table.querySelector('tbody');
        let liste = foodtrucks.filter(ft => ft.jours.split(';').map(j => j.trim()).includes(jourCourant));

        if (liste.length === 0) {
            titre.textContent = `Pas de foodtruck connu le ${jourCourant.toLowerCase()}.`;
            table.hidden = true;
            return;
        }

        if (tri.colonne) {
            const sens = tri.ordre === 'asc' ? 1 : -1;
            liste = [...liste].sort((a, b) => {
                const va = valeurTri(a, tri.colonne);
                const vb = valeurTri(b, tri.colonne);
                if (typeof va === 'number') {
                    if (va === vb) return 0;
                    if (va === Infinity) return 1; // prix inconnu toujours en fin de liste
                    if (vb === Infinity) return -1;
                    return (va - vb) * sens;
                }
                return va.localeCompare(vb, 'fr') * sens;
            });
        }

        titre.textContent = `${liste.length} foodtruck${liste.length > 1 ? 's' : ''} le ${jourCourant.toLowerCase()}`;
        corps.innerHTML = liste.map(ft => {
            const site = Commun.urlSure(ft.site);
            const carte = Commun.urlSure(ft.emplacement);
            const nom = site
                ? `<a href="${Commun.html(site)}" target="_blank" rel="noopener" data-consultation="${Commun.html(ft.nom)}">${Commun.html(ft.nom)}</a>`
                : Commun.html(ft.nom);
            const lienCarte = carte
                ? `<a href="${Commun.html(carte)}" target="_blank" rel="noopener" data-consultation="${Commun.html(ft.nom)}">Voir sur Google Maps</a>`
                : '';
            return `<tr>
                <td data-label="Nom">${nom}</td>
                <td data-label="Cuisine">${Commun.html(ft.cuisine)}</td>
                <td data-label="Emplacement">${lienCarte}</td>
                <td data-label="Prix">${Commun.html(Commun.formaterPrix(ft.prix))}</td>
            </tr>`;
        }).join('');
        table.hidden = false;

        document.querySelectorAll('.tri').forEach(b => {
            const th = b.parentElement;
            const actif = b.dataset.colonne === tri.colonne;
            th.setAttribute('aria-sort', actif ? (tri.ordre === 'asc' ? 'ascending' : 'descending') : 'none');
        });
    }

    function trier(colonne) {
        tri = { colonne, ordre: tri.colonne === colonne && tri.ordre === 'asc' ? 'desc' : 'asc' };
        Commun.journaliser(`Tri sur la colonne : ${NOMS_COLONNES[colonne]}`);
        afficher();
    }

    async function charger() {
        try {
            foodtrucks = await Commun.api('/api/foodtrucks');
        } catch (err) {
            document.getElementById('titreResultat').textContent = 'Impossible de charger la liste des foodtrucks. Réessayez plus tard.';
            return;
        }
        choisirJour(jourCourant || jourParDefaut().jour, false);
    }

    // --- Suggestion
    const modale = document.getElementById('modaleSuggestion');
    const formulaire = document.getElementById('formSuggestion');

    function creerCasesJours() {
        const zone = document.getElementById('casesJours');
        zone.innerHTML = JOURS.map(j => `<label class="case"><input type="checkbox" name="jours" value="${j}"> ${j}</label>`).join('');
    }

    function afficherErreurs(erreurs) {
        const liste = document.getElementById('erreursSuggestion');
        liste.innerHTML = erreurs.map(e => `<li>${Commun.html(e)}</li>`).join('');
        liste.hidden = erreurs.length === 0;
    }

    function ouvrirSuggestion() {
        Commun.journaliser('Clic sur suggérer foodtruck');
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
            cuisine: donnees.get('cuisine'),
            jours: donnees.getAll('jours').join(';'),
            emplacement: donnees.get('emplacement'),
            prix: donnees.get('prix'),
            site: donnees.get('site'),
        };
        const erreurs = [];
        if (!suggestion.nom.trim()) erreurs.push('Le nom est obligatoire.');
        if (!suggestion.cuisine.trim()) erreurs.push('Le type de cuisine est obligatoire.');
        if (!suggestion.jours) erreurs.push('Cochez au moins un jour.');
        if (!Commun.urlSure(suggestion.emplacement.trim())) erreurs.push("L'emplacement doit être un lien Google Maps (https://…).");
        if (suggestion.site.trim() && !Commun.urlSure(suggestion.site.trim())) erreurs.push('Le site doit être une adresse web (https://…).');
        if (erreurs.length) {
            afficherErreurs(erreurs);
            return;
        }
        const bouton = formulaire.querySelector('[type=submit]');
        bouton.disabled = true;
        try {
            const reponse = await Commun.api('/api/suggestions', { method: 'POST', body: suggestion });
            Commun.journaliser('Clic sur envoyer foodtruck : succès');
            formulaire.reset();
            fermerSuggestion();
            Commun.notifier(reponse.message);
        } catch (err) {
            Commun.journaliser('Clic sur envoyer foodtruck : erreur');
            afficherErreurs(err.details && err.details.length ? err.details : [err.message]);
        } finally {
            bouton.disabled = false;
        }
    }

    async function configurerContact() {
        const config = await Commun.config();
        if (config.titre) document.title = config.titre;
        if (!config.contactEmail) return;
        const sujet = encodeURIComponent('[FoodTrucks] Suggestion');
        const corps = encodeURIComponent("Bonjour,\n\nVoici ma remarque ou le foodtruck que je veux ajouter :\n\nNom : \nType de cuisine : \nJours : \nEmplacement Google Maps : \nFourchette de prix : \nSite (optionnel) : \n\n");
        const lien = document.getElementById('lienMail');
        lien.href = `mailto:${config.contactEmail}?subject=${sujet}&body=${corps}`;
        lien.addEventListener('click', () => Commun.journaliser("Clic sur l'envoi de mail"));
        document.getElementById('contact').hidden = false;
    }

    document.addEventListener('DOMContentLoaded', () => {
        creerBoutonsJours();
        creerCasesJours();
        document.querySelectorAll('.tri').forEach(b => b.addEventListener('click', () => trier(b.dataset.colonne)));
        document.querySelector('#tableFoodtrucks tbody').addEventListener('click', e => {
            const lien = e.target.closest('a[data-consultation]');
            if (lien) Commun.journaliser(`Consultation : ${lien.dataset.consultation}`);
        });
        document.getElementById('boutonSuggerer').addEventListener('click', ouvrirSuggestion);
        document.getElementById('annulerSuggestion').addEventListener('click', fermerSuggestion);
        formulaire.addEventListener('submit', envoyerSuggestion);
        configurerContact();
        charger();
    });
})();
