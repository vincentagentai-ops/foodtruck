'use strict';

// Limites de fréquence en mémoire (fenêtre fixe), par IP et par identifiant de navigateur.
// Les compteurs disparaissent au redémarrage : c'est voulu (protection contre les abus involontaires,
// double clic, script qui boucle…), pas une sécurité forte.

class Limiteur {
    /** `max` requêtes par `fenetreMs` et par clé ; max = 0 désactive la limite. */
    constructor({ max, fenetreMs = 60 * 60 * 1000, maintenant = () => Date.now() }) {
        this.max = max;
        this.fenetreMs = fenetreMs;
        this.maintenant = maintenant;
        this.compteurs = new Map();
    }

    /** Compte une requête pour chaque clé ; false si l'une d'elles dépasse sa limite (`max * facteur`). */
    autoriser(cles) {
        if (!this.max) return true;
        const t = this.maintenant();
        if (this.compteurs.size > 10000) this.nettoyer(t);
        let autorise = true;
        for (const { cle, facteur = 1 } of cles) {
            if (!cle) continue;
            let c = this.compteurs.get(cle);
            if (!c || t - c.debut >= this.fenetreMs) {
                c = { debut: t, n: 0 };
                this.compteurs.set(cle, c);
            }
            c.n++;
            if (c.n > this.max * facteur) autorise = false;
        }
        return autorise;
    }

    /** Secondes avant la fin de la fenêtre la plus ancienne (en-tête Retry-After). */
    attente(cles) {
        const t = this.maintenant();
        const fins = cles.map(({ cle }) => this.compteurs.get(cle)).filter(Boolean).map(c => c.debut + this.fenetreMs - t);
        return Math.max(1, Math.ceil(Math.max(0, ...fins) / 1000));
    }

    nettoyer(t = this.maintenant()) {
        for (const [cle, c] of this.compteurs) {
            if (t - c.debut >= this.fenetreMs) this.compteurs.delete(cle);
        }
    }
}

/**
 * Middleware Express : refuse (429) au-delà de la limite. `cles(req)` -> [{cle, facteur}].
 */
function limiter(limiteur, cles) {
    return (req, res, next) => {
        const liste = cles(req);
        if (limiteur.autoriser(liste)) return next();
        res.set('Retry-After', String(limiteur.attente(liste)));
        res.status(429).json({ error: 'Trop de requêtes en peu de temps. Réessayez un peu plus tard.' });
    };
}

module.exports = { Limiteur, limiter };
