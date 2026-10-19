// Espace administrateur : plan local des emplacements (image du quartier et position de chaque lieu).
// L'image est envoyée en JSON (base64) : le serveur n'accepte que du JSON en écriture.

(() => {
    const TAILLE_MAX = 3 * 1024 * 1024;
    const TYPES = ['image/png', 'image/jpeg', 'image/webp'];
    let plan = { image: null, positions: {} };
    let lieux = [];
    let brouillon = null; // position en cours de réglage au clavier { x, y }

    const h = Commun.html;
    const erreurVersTexte = err => (err.details && err.details.length ? `${err.message} ${err.details.join(' ')}` : err.message);

    async function charger() {
        try {
            plan = await Commun.api('/api/plan');
        } catch (err) {
            Commun.notifier(`Plan : ${erreurVersTexte(err)}`, 'erreur');
        }
        afficher();
    }

    /** Lieux placés, dans l'ordre alphabétique : leur rang sert de numéro sur cet aperçu. */
    const places = () => [...lieux].filter(l => Logique.positionValide(plan.positions[l.id])).sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));

    function afficher() {
        const avecImage = Boolean(plan.image);
        document.getElementById('retirerPlan').hidden = !avecImage;
        document.getElementById('zonePlacement').hidden = !avecImage;
        if (!avecImage) return;
        const image = document.getElementById('imagePlanAdmin');
        if (image.getAttribute('src') !== plan.image) image.src = plan.image;

        const select = document.getElementById('lieuAPlacer');
        const valeur = select.value;
        select.innerHTML = lieux.length
            ? [...lieux].sort((a, b) => a.nom.localeCompare(b.nom, 'fr'))
                .map(l => `<option value="${h(l.id)}">${Logique.positionValide(plan.positions[l.id]) ? '✓ ' : ''}${h(l.nom)}</option>`).join('')
            : '<option value="">(créez d\'abord des lieux ci-dessus)</option>';
        if ([...select.options].some(o => o.value === valeur)) select.value = valeur;

        const cadre = document.getElementById('planAdmin');
        cadre.querySelectorAll('.repere').forEach(r => r.remove());
        const liste = places();
        liste.forEach((l, i) => ajouterRepere(cadre, plan.positions[l.id], String(i + 1), `${i + 1} : ${l.nom}`));
        if (brouillon) ajouterRepere(cadre, brouillon, '?', 'Position en cours de réglage', true);
        document.getElementById('listePlacements').innerHTML = liste.map(l => `<li>${h(l.nom)}
            <button type="button" class="lien discret" data-retirer="${h(l.id)}">retirer du plan</button></li>`).join('')
            || '<li class="vide">Aucun lieu placé pour l\'instant.</li>';
    }

    function ajouterRepere(cadre, position, texte, titre, brouillonEnCours = false) {
        const repere = document.createElement('span');
        repere.className = `repere${brouillonEnCours ? ' brouillon' : ''}`;
        repere.textContent = texte;
        repere.title = titre;
        repere.style.left = `${position.x}%`; // CSSOM : autorisé par la politique de sécurité
        repere.style.top = `${position.y}%`;
        cadre.appendChild(repere);
    }

    async function placer(position) {
        const id = document.getElementById('lieuAPlacer').value;
        if (!id) return;
        try {
            const r = await Commun.api(`/api/admin/plan/positions/${encodeURIComponent(id)}`, { method: 'PUT', body: position });
            plan = r.plan;
            brouillon = null;
            Commun.notifier(`${(lieux.find(l => l.id === id) || {}).nom || 'Lieu'} placé sur le plan.`);
            afficher();
            // Lieu suivant pas encore placé
            const suivant = [...document.getElementById('lieuAPlacer').options].find(o => o.value && !o.textContent.startsWith('✓'));
            if (suivant) document.getElementById('lieuAPlacer').value = suivant.value;
        } catch (err) {
            Commun.notifier(erreurVersTexte(err), 'erreur');
        }
    }

    function surClicPlan(e) {
        const image = document.getElementById('imagePlanAdmin');
        const cadre = image.getBoundingClientRect();
        if (!cadre.width || !cadre.height) return;
        const x = Math.round(((e.clientX - cadre.left) / cadre.width) * 1000) / 10;
        const y = Math.round(((e.clientY - cadre.top) / cadre.height) * 1000) / 10;
        if (x < 0 || x > 100 || y < 0 || y > 100) return;
        placer({ x, y });
    }

    /** Placement au clavier : flèches (Maj : pas de 5 %), Entrée pour enregistrer, Échap pour annuler. */
    function surClavierPlan(e) {
        const pas = e.shiftKey ? 5 : 1;
        const depart = () => brouillon || { ...(plan.positions[document.getElementById('lieuAPlacer').value] || { x: 50, y: 50 }) };
        const deplacements = { ArrowLeft: [-pas, 0], ArrowRight: [pas, 0], ArrowUp: [0, -pas], ArrowDown: [0, pas] };
        if (deplacements[e.key]) {
            e.preventDefault();
            const p = depart();
            const [dx, dy] = deplacements[e.key];
            brouillon = { x: Math.min(100, Math.max(0, p.x + dx)), y: Math.min(100, Math.max(0, p.y + dy)) };
            afficher();
        } else if (e.key === 'Enter' && brouillon) {
            e.preventDefault();
            placer(brouillon);
        } else if (e.key === 'Escape' && brouillon) {
            brouillon = null;
            afficher();
        }
    }

    function lireFichier(fichier) {
        return new Promise((resolve, reject) => {
            const lecteur = new FileReader();
            lecteur.onload = () => resolve(lecteur.result);
            lecteur.onerror = () => reject(new Error('Lecture du fichier impossible.'));
            lecteur.readAsDataURL(fichier);
        });
    }

    async function envoyer() {
        const fichier = document.getElementById('fichierPlan').files[0];
        if (!fichier) return;
        if (!TYPES.includes(fichier.type)) return Commun.notifier('Format refusé : choisissez une image PNG, JPEG ou WebP.', 'erreur');
        if (fichier.size > TAILLE_MAX) return Commun.notifier(`Image trop volumineuse (${Math.ceil(fichier.size / 1024)} Ko) : 3 Mo au maximum.`, 'erreur');
        const bouton = document.getElementById('envoyerPlan');
        bouton.disabled = true;
        try {
            const r = await Commun.api('/api/admin/plan/image', { method: 'PUT', body: { type: fichier.type, donnees: await lireFichier(fichier) } });
            plan = r.plan;
            Commun.notifier(r.message);
            document.getElementById('fichierPlan').value = '';
            afficher();
        } catch (err) {
            Commun.notifier(erreurVersTexte(err), 'erreur');
            bouton.disabled = false;
        }
    }

    async function retirer() {
        if (!confirm('Retirer le plan de la page d\'accueil ? (Les positions des lieux sont gardées pour une prochaine image.)')) return;
        try {
            const r = await Commun.api('/api/admin/plan/image', { method: 'DELETE', body: {} });
            plan = r.plan;
            Commun.notifier(r.message);
            afficher();
        } catch (err) {
            Commun.notifier(erreurVersTexte(err), 'erreur');
        }
    }

    async function retirerLieu(id) {
        try {
            const r = await Commun.api(`/api/admin/plan/positions/${encodeURIComponent(id)}`, { method: 'DELETE', body: {} });
            plan = r.plan;
            afficher();
        } catch (err) {
            Commun.notifier(erreurVersTexte(err), 'erreur');
        }
    }

    document.addEventListener('lieux-charges', e => { lieux = e.detail; afficher(); });
    document.addEventListener('DOMContentLoaded', () => {
        document.getElementById('fichierPlan').addEventListener('change', e => {
            document.getElementById('envoyerPlan').disabled = !e.target.files.length;
        });
        document.getElementById('envoyerPlan').addEventListener('click', envoyer);
        document.getElementById('retirerPlan').addEventListener('click', retirer);
        const cadre = document.getElementById('planAdmin');
        cadre.addEventListener('click', surClicPlan);
        cadre.addEventListener('keydown', surClavierPlan);
        document.getElementById('lieuAPlacer').addEventListener('change', () => { brouillon = null; afficher(); });
        document.getElementById('listePlacements').addEventListener('click', e => {
            const bouton = e.target.closest('[data-retirer]');
            if (bouton) retirerLieu(bouton.dataset.retirer);
        });
        charger();
    });
})();
