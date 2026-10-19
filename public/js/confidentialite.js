// Page « Données et confidentialité » : adresse de contact (CONTACT_EMAIL) si elle est configurée.

document.addEventListener('DOMContentLoaded', async () => {
    const config = await Commun.config();
    if (!config.contactEmail) return;
    const zone = document.getElementById('contactConfidentialite');
    const lien = document.createElement('a');
    lien.href = `mailto:${config.contactEmail}?subject=${encodeURIComponent('[FoodTrucks] Données personnelles')}`;
    lien.textContent = config.contactEmail;
    zone.textContent = 'écrivez à ';
    zone.appendChild(lien);
});
