'use strict';

// Tests de bout en bout de l'API sur un dossier de données temporaire.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { charger } = require('../src/config');
const { creerApplication } = require('../src/app');

const dossier = fs.mkdtempSync(path.join(os.tmpdir(), 'foodtruck-test-'));
fs.writeFileSync(path.join(dossier, 'foodtrucks.csv'),
    'Nom,Cuisine,Jours,Emplacement,Prix,Site\nNeki Neko,Japonais,Mardi,https://maps.app.goo.gl/a,10-15,https://neko.example'); // pas de saut final
fs.writeFileSync(path.join(dossier, 'foodtruckAValider.csv'), 'Saveur de Corée,Coréen,Jeudi,https://maps.app.goo.gl/b,7-13,');

const mails = [];
const config = charger({ DATA_DIR: dossier, ADMIN_PASSWORD: 'secret-test', CONTACT_EMAIL: 'contact@example.test', SMTP_HOST: 'x' });
const app = creerApplication(config, {
    journal: { log() {}, error() {} },
    transporteur: { sendMail: m => { mails.push(m); return Promise.resolve({ response: 'ok' }); } },
});
let serveur;
let base;
const AUTH = { Authorization: `Basic ${Buffer.from('admin:secret-test').toString('base64')}` };

async function appel(methode, url, corps, entetes = {}) {
    const r = await fetch(base + url, {
        method: methode,
        headers: { 'Content-Type': 'application/json', ...entetes },
        body: corps === undefined ? undefined : JSON.stringify(corps),
        redirect: 'manual',
    });
    const texte = await r.text();
    let json = null;
    try { json = JSON.parse(texte); } catch { /* pas du JSON */ }
    return { statut: r.status, json, texte, entetes: r.headers };
}

test.before(async () => {
    await app.locals.stockage.initialiser();
    await new Promise(resolve => { serveur = app.listen(0, resolve); });
    base = `http://127.0.0.1:${serveur.address().port}`;
});
test.after(() => {
    serveur.close();
    fs.rmSync(dossier, { recursive: true, force: true });
});

test('GET /api/foodtrucks renvoie la liste', async () => {
    const r = await appel('GET', '/api/foodtrucks');
    assert.equal(r.statut, 200);
    assert.equal(r.json.length, 1);
    assert.equal(r.json[0].nom, 'Neki Neko');
});

test("Le dossier data n'est plus exposé (journaux, suggestions)", async () => {
    for (const url of ['/data/acces.log', '/data/usage.log', '/data/foodtruckAValider.csv']) {
        assert.equal((await appel('GET', url)).statut, 404, url);
    }
    const csv = await appel('GET', '/data/foodtrucks.csv'); // ancienne adresse publique conservée
    assert.equal(csv.statut, 200);
});

test("L'espace administrateur exige un mot de passe", async () => {
    assert.equal((await appel('GET', '/admin/')).statut, 401);
    assert.equal((await appel('GET', '/api/admin/suggestions')).statut, 401);
    assert.equal((await appel('GET', '/api/admin/suggestions', undefined, { Authorization: 'Basic ' + Buffer.from('admin:faux').toString('base64') })).statut, 401);
    assert.equal((await appel('GET', '/admin/', undefined, AUTH)).statut, 200);
    assert.equal((await appel('GET', '/statistiques.html')).entetes.get('location'), '/admin/statistiques.html');
});

test('Suggestion invalide refusée avec le détail des erreurs', async () => {
    const r = await appel('POST', '/api/suggestions', { nom: 'X', jours: 'samedi' });
    assert.equal(r.statut, 400);
    assert.ok(r.json.details.length >= 2);
    const vide = await appel('POST', '/api/suggest-foodtruck', {});
    assert.equal(vide.statut, 400); // l'ancien serveur plantait (jours undefined)
});

test('Suggestion -> validation (avec correction) -> publiée, sans ligne collée', async () => {
    const emplacement = 'https://www.google.fr/maps/place/12+Rue,+31100+Toulouse/@43.5,1.38,19z';
    const s = await appel('POST', '/api/suggestions', {
        nom: 'Moya', cuisine: 'Mexicain', jours: 'mercredi;vendredi', emplacement, prix: '10 à 15 €', site: '',
    });
    assert.equal(s.statut, 201);
    assert.equal(mails.length, 1);
    assert.equal(mails[0].to, 'contact@example.test');

    const attente = (await appel('GET', '/api/admin/suggestions', undefined, AUTH)).json;
    assert.equal(attente.length, 2);
    const i = attente.findIndex(ft => ft.nom === 'Moya');
    assert.equal(attente[i].emplacement, emplacement); // virgules de l'URL préservées

    const v = await appel('POST', `/api/admin/suggestions/${i}/valider`,
        { original: attente[i], foodtruck: { ...attente[i], nom: 'Moya Street Food' } }, AUTH);
    assert.equal(v.statut, 200, v.texte);

    const publies = (await appel('GET', '/api/foodtrucks')).json;
    assert.deepEqual(publies.map(f => f.nom), ['Neki Neko', 'Moya Street Food']);
    assert.equal(publies[1].emplacement, emplacement);
    assert.equal(publies[1].jours, 'Mercredi;Vendredi');

    const texte = fs.readFileSync(path.join(dossier, 'foodtrucks.csv'), 'utf8');
    assert.equal(texte.split('\n').filter(Boolean).length, 3); // en-tête + 2 lignes, aucune ligne fusionnée
    assert.ok(texte.endsWith('\n') && !texte.endsWith('\n\n'));
    assert.equal((await appel('GET', '/api/admin/suggestions', undefined, AUTH)).json.length, 1);
});

test('Rejet d\'une suggestion et conflit si la ligne a changé', async () => {
    const attente = (await appel('GET', '/api/admin/suggestions', undefined, AUTH)).json;
    const conflit = await appel('DELETE', '/api/admin/suggestions/0', { original: { ...attente[0], nom: 'Autre' } }, AUTH);
    assert.equal(conflit.statut, 409);
    const r = await appel('DELETE', '/api/admin/suggestions/0', { original: attente[0] }, AUTH);
    assert.equal(r.statut, 200);
    assert.equal((await appel('GET', '/api/admin/suggestions', undefined, AUTH)).json.length, 0);
});

test('Ajout, modification et suppression par un administrateur', async () => {
    const ajout = await appel('POST', '/api/admin/foodtrucks',
        { nom: 'Ban Thai', cuisine: 'Thaïlandais', jours: 'Lundi', emplacement: 'https://maps.app.goo.gl/c', prix: '', site: '' }, AUTH);
    assert.equal(ajout.statut, 201);
    let liste = (await appel('GET', '/api/admin/foodtrucks', undefined, AUTH)).json;
    const i = liste.findIndex(f => f.nom === 'Ban Thai');
    const modif = await appel('PUT', `/api/admin/foodtrucks/${i}`, { original: liste[i], foodtruck: { ...liste[i], prix: '12' } }, AUTH);
    assert.equal(modif.statut, 200);
    liste = (await appel('GET', '/api/foodtrucks')).json;
    assert.equal(liste[i].prix, '12');
    const suppr = await appel('DELETE', `/api/admin/foodtrucks/${i}`, { original: liste[i] }, AUTH);
    assert.equal(suppr.statut, 200);
    assert.ok(!(await appel('GET', '/api/foodtrucks')).json.some(f => f.nom === 'Ban Thai'));
});

test('Journal d\'usage et statistiques filtrées par date', async () => {
    assert.equal((await appel('POST', '/api/log', { event: 'Jour sélectionné : Jeudi' })).statut, 204);
    assert.equal((await appel('POST', '/api/log', {})).statut, 400);
    fs.appendFileSync(config.fichierUsage, 'ligne corrompue\n'); // ne doit pas faire planter /stats
    await new Promise(r => setTimeout(r, 50));
    const r = await appel('GET', '/api/admin/statistiques', undefined, AUTH);
    assert.equal(r.statut, 200);
    assert.equal(r.json.usage.jours.Jeudi, 1);
    assert.ok(r.json.acces.pagesVues >= 1);
    const passe = await appel('GET', '/api/admin/statistiques?debut=2000-01-01&fin=2000-01-02', undefined, AUTH);
    assert.equal(passe.json.usage.total, 0);
});

test('Chart.js est servi localement', async () => {
    const r = await fetch(`${base}/vendor/chart.umd.min.js`);
    assert.equal(r.status, 200);
});

test('Corps JSON invalide -> 400 (et non 500)', async () => {
    const r = await fetch(`${base}/api/suggestions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{pas du json' });
    assert.equal(r.status, 400);
});
