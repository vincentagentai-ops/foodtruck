// Page « Données et confidentialité » : adresse de contact (CONTACT_EMAIL) si elle est configurée,
// effacement de tout ce que le site garde dans ce navigateur.

document.addEventListener('DOMContentLoaded', async () => {
    document.getElementById('effacerDonneesLocales').addEventListener('click', () => {
        if (!confirm('Effacer vos favoris, filtres, préférences, marques, carnet et nom déclaré dans ce navigateur ? (Irréversible.)')) return;
        Perso.toutEffacer();
        Commun.evenement('donnees_locales_effacees');
        document.getElementById('etatEffacement').textContent = 'C\'est fait : plus rien n\'est gardé par le site dans ce navigateur.';
    });

    const config = await Commun.config();
    if (!config.contactEmail) return;
    const zone = document.getElementById('contactConfidentialite');
    const lien = document.createElement('a');
    lien.href = `mailto:${config.contactEmail}?subject=${encodeURIComponent('[FoodTrucks] Données personnelles')}`;
    lien.textContent = config.contactEmail;
    zone.textContent = 'écrivez à ';
    zone.appendChild(lien);
});
