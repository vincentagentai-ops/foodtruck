'use strict';

// Identité des contributeurs, sans compte :
// - jeton d'auteur = HMAC du cookie ft_v avec une clé PROPRE aux contributions (dérivée du secret serveur).
//   Il est différent de l'empreinte des journaux d'audience (audience.hacher) : on ne peut pas relier une
//   contribution aux pages vues d'un navigateur, et le cookie n'est jamais écrit en clair ;
// - pseudonyme facultatif (≤ 30 caractères) déclaré par le contributeur, affiché avec la mention « nom déclaré ».

const crypto = require('crypto');

const LONGUEUR_PSEUDO = 30;
const CONTEXTE = 'food-trucks:auteur-contributions:v1';

/** Clé des jetons d'auteur, dérivée du secret des statistiques (aucun fichier de plus à sauvegarder). */
function cleAuteur(secret) {
    return crypto.createHmac('sha256', String(secret)).update(CONTEXTE).digest();
}

/** Jeton d'auteur (24 caractères hexadécimaux) de l'identifiant de navigateur `id`, ou null. */
function jetonAuteur(cle, id) {
    if (!id || !cle) return null;
    return crypto.createHmac('sha256', cle).update(String(id)).digest('hex').slice(0, 24);
}

/** Texte saisi sur une ligne : caractères de contrôle remplacés par des espaces, espaces multiples réduits. */
function texteSurUneLigne(valeur) {
    return String(valeur == null ? '' : valeur).replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
}

/** Pseudonyme facultatif -> { pseudo } ou { erreur }. */
function validerPseudo(valeur) {
    if (valeur != null && typeof valeur !== 'string') return { erreur: 'Le nom déclaré doit être un texte.' };
    const pseudo = texteSurUneLigne(valeur);
    if (pseudo.length > LONGUEUR_PSEUDO) return { erreur: `Le nom déclaré dépasse ${LONGUEUR_PSEUDO} caractères.` };
    return { pseudo };
}

module.exports = { LONGUEUR_PSEUDO, cleAuteur, jetonAuteur, texteSurUneLigne, validerPseudo };
