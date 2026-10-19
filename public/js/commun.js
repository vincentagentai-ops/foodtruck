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

    /** Envoie un évènement d'usage au serveur (statistiques). */
    function journaliser(event) {
        // keepalive : la requête aboutit même si la page change juste après (clic sur un lien)
        fetch('/api/log', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ event }),
            keepalive: true,
        }).catch(() => {});
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

    return { html, urlSure, formaterPrix, prixMin, journaliser, api, config, notifier };
})();
