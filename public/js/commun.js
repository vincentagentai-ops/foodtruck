// Fonctions partagées par toutes les pages.

const Commun = (() => {
    /** Échappe un texte pour l'insérer dans du HTML. */
    function html(texte) {
        return String(texte == null ? '' : texte)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    /** N'accepte que les liens http(s) (évite les liens « javascript: »). */
    function urlSure(url) {
        try {
            const u = new URL(url);
            return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
        } catch {
            return null;
        }
    }

    /** "10-15" -> "10 à 15 €" ; "12" -> "12 €" ; "7 à 12" -> "7 à 12 €". */
    function formaterPrix(prix) {
        const p = String(prix || '').replace(/€/g, '').trim();
        if (!p) return '';
        const [min, max] = p.split(/\s*(?:-|à)\s*/);
        return max ? `${min} à ${max} €` : `${min} €`;
    }

    /** Premier nombre du prix (pour le tri), Infinity si inconnu. */
    function prixMin(prix) {
        const n = parseFloat(String(prix || '').replace(',', '.'));
        return Number.isNaN(n) ? Infinity : n;
    }

    /** Texte sans accents ni majuscules (recherche). */
    function simplifier(texte) {
        return String(texte || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    }

    /**
     * Envoie un évènement d'usage typé au serveur (statistiques anonymes) : voir la liste des types
     * acceptés dans src/audience.js. `cible` : identifiant d'établissement, jour, filtre…
     */
    function evenement(type, cible = '') {
        // keepalive : la requête aboutit même si la page change juste après (clic sur un lien)
        fetch('/api/evenements', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type, cible: String(cible).slice(0, 80), page: location.pathname }),
            keepalive: true,
        }).catch(() => {});
    }

    /** Lecture / écriture dans le stockage du navigateur (sans erreur si indisponible). */
    function lireLocal(cle, defaut) {
        try {
            const v = localStorage.getItem(cle);
            return v === null ? defaut : JSON.parse(v);
        } catch {
            return defaut;
        }
    }
    function ecrireLocal(cle, valeur) {
        try { localStorage.setItem(cle, JSON.stringify(valeur)); } catch { /* stockage plein ou désactivé */ }
    }

    /** Appel JSON ; lève une Error avec `details` si le serveur répond une erreur. */
    async function api(url, options = {}) {
        const reponse = await fetch(url, {
            ...options,
            headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
            body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        });
        const donnees = reponse.status === 204 ? null : await reponse.json().catch(() => null);
        if (!reponse.ok) {
            const erreur = new Error((donnees && donnees.error) || `Erreur ${reponse.status}`);
            erreur.details = (donnees && donnees.details) || [];
            erreur.statut = reponse.status;
            erreur.donnees = donnees || {}; // 409 : { actuelle, differences }
            throw erreur;
        }
        return donnees;
    }

    // --- Nom déclaré (facultatif), gardé dans ce navigateur et envoyé avec les contributions
    const CLE_PSEUDO = 'ft_pseudo';
    const pseudo = () => String(lireLocal(CLE_PSEUDO, '') || '');
    const memoriserPseudo = valeur => ecrireLocal(CLE_PSEUDO, String(valeur || '').trim().slice(0, 30));
    /** « Camille (nom déclaré) » ou « Un collègue ». */
    const signature = nom => (nom ? `${nom} (nom déclaré)` : 'Un collègue');

    /** Date locale AAAA-MM-JJ. */
    function dateISO(d = new Date()) {
        const p = n => String(n).padStart(2, '0');
        return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    }

    /** « 2026-10-24 » -> « jeudi 24/10 ». */
    function dateCourte(iso) {
        const [a, m, j] = String(iso).split('-').map(Number);
        if (!a) return '';
        const d = new Date(a, m - 1, j);
        return `${d.toLocaleDateString('fr-FR', { weekday: 'long' })} ${String(j).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
    }

    /** « à l'instant », « il y a 3 h », « il y a 2 jours », puis la date. */
    function tempsRelatif(ts) {
        const d = new Date(ts);
        if (Number.isNaN(d.getTime())) return '';
        const minutes = Math.round((Date.now() - d.getTime()) / 60000);
        if (minutes < 2) return "à l'instant";
        if (minutes < 60) return `il y a ${minutes} min`;
        if (minutes < 24 * 60) return `il y a ${Math.round(minutes / 60)} h`;
        const jours = Math.round(minutes / 1440);
        if (jours < 30) return `il y a ${jours} jour${jours > 1 ? 's' : ''}`;
        return `le ${d.toLocaleDateString('fr-FR')}`;
    }

    /** « ★★★★☆ » */
    const etoiles = note => '★★★★★'.slice(0, Math.round(note)) + '☆☆☆☆☆'.slice(0, 5 - Math.round(note));
    /** 4.3 -> « 4,3 » */
    const nombre = n => String(n).replace('.', ',');

    function ouvrirModale(modale) {
        if (typeof modale.showModal === 'function') { if (!modale.open) modale.showModal(); } else modale.setAttribute('open', '');
    }
    function fermerModale(modale) {
        if (typeof modale.close === 'function') modale.close(); else modale.removeAttribute('open');
    }

    let configPromesse;
    function config() {
        configPromesse = configPromesse || api('/api/config').catch(() => ({}));
        return configPromesse;
    }

    /** Bandeau « Environnement de test » et version en pied de page. */
    async function decorerPage() {
        const c = await config();
        if (c.environnement === 'test') {
            const bandeau = document.createElement('div');
            bandeau.className = 'bandeau-test';
            bandeau.textContent = 'Environnement de test';
            document.body.prepend(bandeau);
        }
        const version = document.getElementById('version');
        if (version && c.version) version.textContent = `v${c.version}`;
    }

    /** Petit message temporaire en bas de l'écran. */
    function notifier(message, type = 'succes') {
        const zone = document.getElementById('notifications') || (() => {
            const z = document.createElement('div');
            z.id = 'notifications';
            z.setAttribute('role', 'status');
            document.body.appendChild(z);
            return z;
        })();
        const n = document.createElement('div');
        n.className = `notification ${type}`;
        n.textContent = message;
        zone.appendChild(n);
        setTimeout(() => n.remove(), 4500);
    }

    document.addEventListener('DOMContentLoaded', decorerPage);

    return {
        html, urlSure, formaterPrix, prixMin, simplifier, evenement, lireLocal, ecrireLocal, api, config, notifier,
        pseudo, memoriserPseudo, signature, dateISO, dateCourte, tempsRelatif, etoiles, nombre, ouvrirModale, fermerModale,
    };
})();
