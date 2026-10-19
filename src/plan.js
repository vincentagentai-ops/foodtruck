'use strict';

// Plan local des emplacements (U15), sans Internet : une image du quartier déposée par l'administrateur et la
// position de chaque lieu sur cette image (en pourcentage de la largeur et de la hauteur).
// Fichiers dans data/ : plan.json (description + positions) et plan-image.png|jpg|webp (l'image).
// Sécurité : seuls PNG, JPEG et WebP sont acceptés, reconnus à leurs premiers octets (jamais SVG ni HTML,
// qui peuvent contenir du script) ; l'image est servie avec son type exact, « nosniff » et une CSP « sandbox ».

const fs = require('fs/promises');
const path = require('path');
const { ErreurHttp } = require('./stockage');

const TAILLE_MAX = 3 * 1024 * 1024; // 3 Mo
const TYPES = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/webp': 'webp',
};

/** Type réel d'une image d'après ses premiers octets (PNG, JPEG, WebP), ou null. */
function detecterType(octets) {
    if (!Buffer.isBuffer(octets) || octets.length < 12) return null;
    if (octets.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
    if (octets[0] === 0xff && octets[1] === 0xd8 && octets[2] === 0xff) return 'image/jpeg';
    if (octets.toString('latin1', 0, 4) === 'RIFF' && octets.toString('latin1', 8, 12) === 'WEBP') return 'image/webp';
    return null;
}

/**
 * Contrôle une image envoyée en JSON { type, donnees (base64) }. Retourne { octets, type } ou lève une ErreurHttp
 * (400 type ou contenu refusé, 413 trop volumineuse).
 */
function validerImage(corps) {
    const c = corps && typeof corps === 'object' ? corps : {};
    if (typeof c.donnees !== 'string' || !c.donnees) throw new ErreurHttp(400, 'Image manquante.');
    const base64 = c.donnees.replace(/^data:[^;,]*;base64,/, '');
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new ErreurHttp(400, "L'image n'est pas correctement encodée.");
    const octets = Buffer.from(base64, 'base64');
    if (octets.length > TAILLE_MAX) throw new ErreurHttp(413, `Image trop volumineuse (${Math.ceil(octets.length / 1024)} Ko) : 3 Mo au maximum.`);
    const type = detecterType(octets);
    if (!type) throw new ErreurHttp(400, 'Format refusé : seules les images PNG, JPEG et WebP sont acceptées.');
    if (c.type && c.type !== type) throw new ErreurHttp(400, `Le contenu du fichier (${type}) ne correspond pas à son type déclaré (${String(c.type).slice(0, 40)}).`);
    return { octets, type };
}

/** Position { x, y } en pourcentage (0 à 100, une décimale), ou une ErreurHttp. */
function validerPosition(corps) {
    const nombre = v => (typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100 ? Math.round(v * 10) / 10 : null);
    const x = nombre(corps && corps.x);
    const y = nombre(corps && corps.y);
    if (x === null || y === null) throw new ErreurHttp(400, 'Position invalide : x et y sont des pourcentages de 0 à 100.');
    return { x, y };
}

class Plan {
    constructor(stockage) {
        this.stockage = stockage;
        this.dossier = stockage.config.dossierDonnees;
        this.fichier = path.join(this.dossier, 'plan.json');
    }

    async lire() {
        const plan = await this.stockage.lireJSON(this.fichier, null).catch(() => null);
        const positions = plan && plan.positions && typeof plan.positions === 'object' ? plan.positions : {};
        const image = plan && plan.image && TYPES[plan.image.type] && plan.image.fichier === `plan-image.${TYPES[plan.image.type]}` ? plan.image : null;
        return { image, positions };
    }

    /** Fichier image actuel { chemin, type } ou null (type vérifié à nouveau sur les octets). */
    async fichierImage() {
        const { image } = await this.lire();
        if (!image) return null;
        const chemin = path.join(this.dossier, image.fichier);
        const debut = await fs.readFile(chemin).catch(() => null);
        if (!debut || detecterType(debut) !== image.type) return null;
        return { chemin, type: image.type, octets: debut };
    }

    /** Version publique : adresse de l'image (avec la date pour le cache) et positions. */
    async public() {
        const { image, positions } = await this.lire();
        return { image: image ? `/plan/image?v=${encodeURIComponent(image.maj)}` : null, positions };
    }

    /** Remplace l'image (les positions sont gardées : à vérifier si le cadrage change). */
    enregistrerImage({ octets, type }) {
        return this.stockage.enSerie(async () => {
            const plan = await this.lire();
            const fichier = `plan-image.${TYPES[type]}`;
            await this.stockage.ecrireOctets(path.join(this.dossier, fichier), octets);
            // Ancienne image d'un autre format : supprimée
            for (const ext of Object.values(TYPES)) {
                if (`plan-image.${ext}` !== fichier) await fs.rm(path.join(this.dossier, `plan-image.${ext}`), { force: true });
            }
            const image = { fichier, type, taille: octets.length, maj: new Date().toISOString() };
            await this.stockage.ecrireJSON(this.fichier, { image, positions: plan.positions });
            return image;
        });
    }

    supprimerImage() {
        return this.stockage.enSerie(async () => {
            const plan = await this.lire();
            for (const ext of Object.values(TYPES)) await fs.rm(path.join(this.dossier, `plan-image.${ext}`), { force: true });
            await this.stockage.ecrireJSON(this.fichier, { image: null, positions: plan.positions });
        });
    }

    /** Place un lieu (position) ou le retire du plan (position null). */
    placer(lieu, position) {
        return this.stockage.enSerie(async () => {
            const plan = await this.lire();
            const positions = { ...plan.positions };
            if (position) positions[lieu] = position; else delete positions[lieu];
            await this.stockage.ecrireJSON(this.fichier, { image: plan.image, positions });
            return positions;
        });
    }
}

module.exports = { Plan, detecterType, validerImage, validerPosition, TAILLE_MAX, TYPES };
