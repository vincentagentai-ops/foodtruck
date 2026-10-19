'use strict';

// Photos des établissements, modifiables par tous comme les autres informations de la fiche.
// - Photos d'origine (validées par l'administrateur) : public/img/etablissements/, servies comme le reste du site.
// - Photos envoyées par les collègues : data/photo-<empreinte>.<ext>, servies par /photos/<empreinte>.<ext>.
//   Le nom vient de l'empreinte SHA-256 du contenu : un même fichier n'est stocké qu'une fois, et une photo
//   remplacée reste disponible pour restaurer une ancienne version de la fiche. Sauvegardées chaque jour avec data/.
// La colonne « photo » du catalogue contient l'adresse de la photo (« /img/etablissements/x.jpg » ou
// « /photos/<empreinte>.jpg »), ou rien. Sécurité : mêmes contrôles que l'image du plan (PNG, JPEG, WebP reconnus
// à leurs premiers octets, 3 Mo au plus ; servies avec leur type exact, « nosniff » et une CSP « sandbox »).

const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { cle } = require('./validation');
const { detecterType, TYPES } = require('./plan');

const DOSSIER_ORIGINE = path.join(__dirname, '..', 'public', 'img', 'etablissements');
const ADRESSE_PHOTO = /^\/(?:img\/etablissements\/[a-z0-9-]+|photos\/[0-9a-f]{20})\.(?:jpg|png|webp)$/;
const ADRESSE_ENVOYEE = /^\/photos\/([0-9a-f]{20})\.(jpg|png|webp)$/;

/** Photos d'origine retrouvées par le nom de l'établissement (images.json) : Map clé du nom -> adresse. */
function chargerImages(dossier = DOSSIER_ORIGINE) {
    const parNom = new Map();
    try {
        const { images } = JSON.parse(fs.readFileSync(path.join(dossier, 'images.json'), 'utf8'));
        for (const { noms, fichier } of images || []) {
            if (!/^[a-z0-9-]+\.(?:jpg|png|webp)$/.test(fichier || '') || !fs.existsSync(path.join(dossier, fichier))) continue;
            for (const nom of noms || []) parNom.set(cle(nom), `/img/etablissements/${fichier}`);
        }
    } catch {
        // Pas de fichier images.json (ou illisible) : aucune photo d'origine
    }
    return parNom;
}

class Photos {
    constructor(stockage) {
        this.stockage = stockage;
        this.dossier = stockage.config.dossierDonnees;
    }

    /** Chemin dans data/ d'une photo envoyée, d'après son adresse publique (null si l'adresse n'en est pas une). */
    chemin(adresse) {
        const m = ADRESSE_ENVOYEE.exec(adresse || '');
        return m ? path.join(this.dossier, `photo-${m[1]}.${m[2]}`) : null;
    }

    /** Enregistre une photo validée ({ octets, type }) et retourne son adresse publique. */
    async enregistrer({ octets, type }) {
        const empreinte = crypto.createHash('sha256').update(octets).digest('hex').slice(0, 20);
        const adresse = `/photos/${empreinte}.${TYPES[type]}`;
        const chemin = this.chemin(adresse);
        if (!(await fsp.stat(chemin).catch(() => null))) await this.stockage.ecrireOctets(chemin, octets);
        return adresse;
    }

    /** La photo existe-t-elle ? (photo d'origine dans public/, ou photo envoyée dans data/) */
    async existe(adresse) {
        if (!ADRESSE_PHOTO.test(adresse || '')) return false;
        const chemin = this.chemin(adresse) || path.join(DOSSIER_ORIGINE, path.basename(adresse));
        return Boolean(await fsp.stat(chemin).catch(() => null));
    }

    /** Photo envoyée { octets, type } ou null (type vérifié à nouveau sur les octets). */
    async lire(adresse) {
        const chemin = this.chemin(adresse);
        if (!chemin) return null;
        const octets = await fsp.readFile(chemin).catch(() => null);
        const type = octets && detecterType(octets);
        return type && TYPES[type] === path.extname(chemin).slice(1) ? { octets, type } : null;
    }
}

module.exports = { Photos, chargerImages, ADRESSE_PHOTO };
