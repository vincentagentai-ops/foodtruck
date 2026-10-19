'use strict';

// Tâches quotidiennes, lancées au démarrage puis toutes les heures (chacune ne fait rien si c'est déjà fait) :
// sauvegarde de data/, rotation des sauvegardes, agrégats statistiques, purge des journaux bruts de plus de 13 mois.

const { sauvegarderSiNecessaire, rotation } = require('./sauvegarde');
const { dateLocale } = require('./statistiques');

async function maintenanceQuotidienne({ config, statistiques, journal = console }, jour = dateLocale(new Date())) {
    const bilan = {};
    const etape = async (nom, tache) => {
        try {
            bilan[nom] = await tache();
        } catch (err) {
            bilan[nom] = { erreur: err.message };
            journal.error(`Maintenance (${nom}) impossible :`, err.message);
        }
    };
    await etape('sauvegarde', () => sauvegarderSiNecessaire(config, jour));
    await etape('rotation', () => rotation(config, jour));
    await etape('agregats', async () => { await statistiques.mettreAJourAgregats(jour); return true; });
    await etape('purge', () => statistiques.purger(jour));

    if (bilan.sauvegarde) journal.log(`Sauvegarde du jour : ${bilan.sauvegarde}`);
    if (bilan.rotation && bilan.rotation.length) journal.log(`Anciennes sauvegardes supprimées : ${bilan.rotation.join(', ')}`);
    const purge = bilan.purge || {};
    if (purge.raison) journal.error(`Purge des journaux reportée : ${purge.raison}`);
    if (purge.copie) journal.log(`Copie des journaux avant la première purge : ${purge.copie}`);
    if ((purge.supprimes || []).length || (purge.reecrits || []).length) {
        journal.log(`Journaux antérieurs au ${purge.limite} purgés (${[...purge.supprimes, ...purge.reecrits].length} fichier(s)).`);
    }
    return bilan;
}

/** Lance la maintenance maintenant puis toutes les heures. Retourne une fonction d'arrêt. */
function demarrerMaintenance(contexte, intervalleMs = 60 * 60 * 1000) {
    let enCours = false;
    const lancer = async () => {
        if (enCours) return;
        enCours = true;
        try { await maintenanceQuotidienne(contexte); } finally { enCours = false; }
    };
    lancer();
    const minuterie = setInterval(lancer, intervalleMs);
    minuterie.unref();
    return () => clearInterval(minuterie);
}

module.exports = { maintenanceQuotidienne, demarrerMaintenance };
