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
            throw erreur;
        }
        return donnees;
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

    return { html, urlSure, formaterPrix, prixMin, simplifier, evenement, lireLocal, ecrireLocal, api, config, notifier };
})();
