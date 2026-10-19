'use strict';

// Tests de bout en bout de l'API sur un dossier de données temporaire.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { demarrer, patienter, AUTH } = require('./outils');
const { fichierMensuel, NOM_COOKIE } = require('../src/audience');

const ANCIEN_CSV = 'Nom,Cuisine,Jours,Emplacement,Prix,Site\nNeki Neko,Japonais,Mardi,https://maps.app.goo.gl/a,10-15,https://neko.example'; // pas de saut final

let t;
const mails = [];
test.before(async () => {
    t = await demarrer({
        fichiers: {
            'foodtrucks.csv': ANCIEN_CSV,
            'foodtruckAValider.csv': 'Saveur de Corée,Coréen,Jeudi,https://maps.app.goo.gl/b,7-13,',
        },
        env: { CONTACT_EMAIL: 'contact@example.test', SMTP_HOST: 'x' },
        options: { transporteur: { sendMail: m => { mails.push(m); return Promise.resolve({ response: 'ok' }); } } },
    });
});
test.after(() => t.fermer());

const lireUsage = () => {
    const f = fichierMensuel(t.dossier, 'usage', 'jsonl');
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
};

test('GET /api/foodtrucks renvoie la liste migrée (identifiant, catégorie, statut)', async () => {
    const r = await t.appel('GET', '/api/foodtrucks');
    assert.equal(r.statut, 200);
    assert.equal(r.json.length, 1);
    assert.equal(r.json[0].nom, 'Neki Neko');
    assert.match(r.json[0].id, /^[a-z0-9]{6}$/);
    assert.equal(r.json[0].categorie, 'Asiatique');
    assert.equal(r.json[0].statut, 'actif');
    assert.deepEqual((await t.appel('GET', '/api/lieux')).json, []);
});

test('En-têtes de sécurité sur les pages et l\'API', async () => {
    for (const url of ['/', '/api/foodtrucks', '/page-absente']) {
        const r = await t.appel('GET', url);
        const csp = r.entetes.get('content-security-policy');
        assert.match(csp, /script-src 'self'/, url);
        assert.match(csp, /frame-ancestors 'none'/, url);
        assert.doesNotMatch(csp, /unsafe-inline/, url);
        assert.equal(r.entetes.get('x-content-type-options'), 'nosniff');
        assert.equal(r.entetes.get('referrer-policy'), 'same-origin');
    }
    // Aucune page ne contient de style ou de script en ligne (sinon la CSP les bloquerait)
    const pages = ['public/index.html', 'public/404.html', 'public/confidentialite.html', 'admin/index.html', 'admin/statistiques.html'];
    for (const page of pages) {
        const html = fs.readFileSync(path.join(__dirname, '..', page), 'utf8');
        assert.doesNotMatch(html, /style="|<style|<script>|<script(?![^>]*src=)|on(click|load)=/, page);
    }
});

test("Le dossier data n'est pas exposé (journaux, suggestions, agrégats, secret)", async () => {
    for (const url of ['/data/acces.log', '/data/usage.log', '/data/foodtruckAValider.csv', '/data/secret-stats.json', '/data/stats-jours.json', '/data/lieux.csv']) {
        assert.equal((await t.appel('GET', url)).statut, 404, url);
    }
    const csv = await t.appel('GET', '/data/foodtrucks.csv'); // ancienne adresse publique conservée
    assert.equal(csv.statut, 200);
});

test("Pages d'administration inaccessibles sans mot de passe, sous toutes les variantes d'adresse", async () => {
    const variantes = [
        '/admin/', '/admin', '/admin/index.html', '/admin/admin.js', '/admin/statistiques.html', '/admin/statistiques.js',
        '/ADMIN/index.html', '/Admin/admin.js', '/%61dmin/index.html', '/%61dmin/statistiques.js', '/%41DMIN/index.html',
        '/%2561dmin/index.html', '/admin%2Findex.html', '/admin%2fadmin.js', '//admin/index.html', '/./admin/index.html',
        '/public/admin/index.html', '/js/../admin/index.html', '/admin/./index.html', '/admin/%2e%2e/admin/index.html',
        '/api/admin/suggestions', '/API/ADMIN/foodtrucks', '/%61pi/admin/foodtrucks',
    ];
    for (const url of variantes) {
        const r = await t.appel('GET', url);
        assert.ok([401, 404].includes(r.statut), `${url} -> ${r.statut}`);
        assert.doesNotMatch(r.texte, /formEtablissement|chargerSuggestions|Administration —/, url);
    }
    // Même si un ancien public/admin traînait sur le serveur (mise à jour par extraction par-dessus)
    const ancien = path.join(__dirname, '..', 'public', 'admin');
    fs.mkdirSync(ancien);
    try {
        fs.writeFileSync(path.join(ancien, 'index.html'), 'Administration — ancienne page');
        for (const url of ['/%61dmin/index.html', '/%41dmin/index.html', '/admin%2Findex.html']) {
            assert.equal((await t.appel('GET', url)).statut, 404, url);
        }
    } finally {
        fs.rmSync(ancien, { recursive: true, force: true });
    }
    assert.equal((await t.appel('GET', '/api/admin/suggestions', undefined, { Authorization: 'Basic ' + Buffer.from('admin:faux').toString('base64') })).statut, 401);
    assert.equal((await t.appel('GET', '/admin/', undefined, AUTH)).statut, 200);
    assert.equal((await t.appel('GET', '/ADMIN/admin.js', undefined, AUTH)).statut, 200);
    assert.equal((await t.appel('GET', '/statistiques.html')).entetes.get('location'), '/admin/statistiques.html');
});

test('Cookie ft_v posé une seule fois, avec les bons attributs, et jamais prolongé', async () => {
    const premier = await t.appel('GET', '/');
    const cookie = premier.entetes.get('set-cookie');
    assert.match(cookie, new RegExp(`^${NOM_COOKIE}=[A-Za-z0-9_-]{22};`));
    assert.match(cookie, /Max-Age=34128000/); // 395 jours ≈ 13 mois
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.match(cookie, /Path=\//);
    const valeur = cookie.split(';')[0];
    const second = await t.appel('GET', '/', undefined, { Cookie: valeur });
    assert.equal(second.entetes.get('set-cookie'), null);
    const api = await t.appel('GET', '/api/foodtrucks', undefined, { Cookie: valeur });
    assert.equal(api.entetes.get('set-cookie'), null);
    // Valeur invalide : remplacée
    assert.match((await t.appel('GET', '/', undefined, { Cookie: `${NOM_COOKIE}=pas-valide` })).entetes.get('set-cookie'), /ft_v=/);
    // Fichiers statiques : pas de cookie
    assert.equal((await t.appel('GET', '/css/styles.css')).entetes.get('set-cookie'), null);

    // Le journal ne contient que l'empreinte (HMAC), jamais le cookie ni l'IP
    await patienter();
    const brut = valeur.split('=')[1];
    const texte = fs.readFileSync(fichierMensuel(t.dossier, 'usage', 'jsonl'), 'utf8');
    assert.ok(!texte.includes(brut));
    assert.ok(!texte.includes('127.0.0.1'));
    const vues = lireUsage().filter(e => e.type === 'page_vue');
    assert.ok(vues.length >= 2);
    assert.match(vues[0].v, /^[0-9a-f]{32}$/);
    assert.equal(vues[0].page, '/index.html');
    assert.equal(vues[0].nav, 'Chrome');
});

test('Évènements : liste blanche, types réservés au serveur refusés, taille limitée', async () => {
    assert.equal((await t.appel('POST', '/api/evenements', { type: 'clic_maps', cible: 'abc', page: '/' })).statut, 204);
    assert.equal((await t.appel('POST', '/api/evenements', { type: 'inconnu' })).statut, 400);
    assert.equal((await t.appel('POST', '/api/evenements', {})).statut, 400);
    for (const type of ['suggestion', 'admin_ajout', 'admin_validation', 'page_vue']) {
        assert.equal((await t.appel('POST', '/api/evenements', { type })).statut, 403, type);
    }
    assert.equal((await t.appel('POST', '/api/evenements', { type: 'recherche', cible: 'x'.repeat(3000) })).statut, 413);
    // Ancienne adresse : libellés publics acceptés, libellés d'administration refusés
    assert.equal((await t.appel('POST', '/api/log', { event: 'Jour sélectionné : Jeudi' })).statut, 204);
    assert.equal((await t.appel('POST', '/api/log', { event: 'Admin clic sur Valider foodtruck : X' })).statut, 403);
    assert.equal((await t.appel('POST', '/api/log', { event: 'Ajout de : X' })).statut, 403);
    assert.equal((await t.appel('POST', '/api/log', {})).statut, 400);
    await patienter();
    const types = lireUsage().map(e => e.type);
    assert.ok(types.includes('clic_maps'));
    assert.ok(types.includes('jour_ancien'));
    assert.ok(!types.some(ty => ty.startsWith('admin_')));
    const ev = lireUsage().find(e => e.type === 'clic_maps');
    assert.deepEqual(Object.keys(ev).sort(), ['cible', 'page', 'ts', 'type', 'v', 'version']);
});

test('Suggestion invalide refusée avec le détail des erreurs', async () => {
    const r = await t.appel('POST', '/api/suggestions', { nom: 'X', jours: 'samedi' });
    assert.equal(r.statut, 400);
    assert.ok(r.json.details.length >= 2);
    const vide = await t.appel('POST', '/api/suggest-foodtruck', {});
    assert.equal(vide.statut, 400);
});

test('Suggestion -> publication (avec correction) -> identifiant attribué, comptée par le serveur', async () => {
    const emplacement = 'https://www.google.fr/maps/place/12+Rue,+31100+Toulouse/@43.5,1.38,19z';
    const s = await t.appel('POST', '/api/suggestions', {
        nom: 'Moya', cuisine: 'Mexicain', jours: 'mercredi;vendredi', emplacement, prix: '10 à 15 €', site: '',
        paiements: 'CB', statut: 'archive', // un visiteur ne choisit pas le statut
    });
    assert.equal(s.statut, 201);
    assert.equal(mails.length, 1);
    assert.equal(mails[0].to, 'contact@example.test');
    await patienter();
    assert.equal(lireUsage().filter(e => e.type === 'suggestion').length, 1);

    const attente = (await t.appel('GET', '/api/admin/suggestions', undefined, AUTH)).json;
    assert.equal(attente.length, 2);
    const i = attente.findIndex(ft => ft.nom === 'Moya');
    assert.equal(attente[i].emplacement, emplacement); // virgules de l'URL préservées
    assert.equal(attente[i].statut, 'actif');

    const v = await t.appel('POST', `/api/admin/suggestions/${i}/valider`,
        { original: attente[i], foodtruck: { ...attente[i], nom: 'Moya Street Food', type: 'restaurant' } }, AUTH);
    assert.equal(v.statut, 200, v.texte);
    assert.match(v.json.foodtruck.id, /^[a-z0-9]{6}$/);
    assert.equal(v.json.foodtruck.version, '1');
    assert.match(v.json.foodtruck.cree_le, /^\d{4}-\d{2}-\d{2}$/);

    const publies = (await t.appel('GET', '/api/foodtrucks')).json;
    assert.deepEqual(publies.map(f => f.nom), ['Neki Neko', 'Moya Street Food']);
    assert.equal(publies[1].emplacement, emplacement);
    assert.equal(publies[1].jours, 'Mercredi;Vendredi');
    assert.equal(publies[1].type, 'restaurant');
    assert.equal(publies[1].paiements, 'CB');

    const texte = fs.readFileSync(t.config.fichierFoodtrucks, 'utf8');
    assert.equal(texte.split('\n').filter(Boolean).length, 3); // en-tête + 2 lignes, aucune ligne fusionnée
    assert.ok(texte.endsWith('\n') && !texte.endsWith('\n\n'));
    assert.equal((await t.appel('GET', '/api/admin/suggestions', undefined, AUTH)).json.length, 1);
});

test('Rejet d\'une suggestion et conflit si la ligne a changé', async () => {
    const attente = (await t.appel('GET', '/api/admin/suggestions', undefined, AUTH)).json;
    const conflit = await t.appel('DELETE', '/api/admin/suggestions/0', { original: { ...attente[0], nom: 'Autre' } }, AUTH);
    assert.equal(conflit.statut, 409);
    const r = await t.appel('DELETE', '/api/admin/suggestions/0', { original: attente[0] }, AUTH);
    assert.equal(r.statut, 200);
    assert.equal((await t.appel('GET', '/api/admin/suggestions', undefined, AUTH)).json.length, 0);
});

test('Lieux : ajout, rattachement, modification, suppression refusée tant qu\'il est utilisé', async () => {
    const ajout = await t.appel('POST', '/api/admin/lieux', { nom: 'Parking Nord', description: 'Bâtiment B', minutes_a_pied: '3', maps: '' }, AUTH);
    assert.equal(ajout.statut, 201, ajout.texte);
    assert.equal(ajout.json.lieu.id, 'parking-nord');
    assert.equal((await t.appel('POST', '/api/admin/lieux', { nom: 'Parking Nord' }, AUTH)).json.lieu.id, 'parking-nord-2');
    assert.equal((await t.appel('POST', '/api/admin/lieux', { nom: '' }, AUTH)).statut, 400);

    // Établissement avec un lieu et sans lien Maps
    const ft = await t.appel('POST', '/api/admin/foodtrucks', { nom: 'Ban Thai', cuisine: 'Thaïlandais', jours: 'Lundi', lieu: 'parking-nord' }, AUTH);
    assert.equal(ft.statut, 201, ft.texte);
    assert.equal((await t.appel('POST', '/api/admin/foodtrucks', { nom: 'X', cuisine: 'Y', jours: 'Lundi', lieu: 'inexistant' }, AUTH)).statut, 400);

    assert.equal((await t.appel('PUT', '/api/admin/lieux/parking-nord', { nom: 'Parking Nord', minutes_a_pied: '4' }, AUTH)).statut, 200);
    const lieux = (await t.appel('GET', '/api/admin/lieux', undefined, AUTH)).json;
    assert.equal(lieux.find(l => l.id === 'parking-nord').utilisations, 1);
    assert.equal((await t.appel('GET', '/api/lieux')).json.find(l => l.id === 'parking-nord').minutes_a_pied, '4');
    assert.equal((await t.appel('DELETE', '/api/admin/lieux/parking-nord', undefined, AUTH)).statut, 409);
    assert.equal((await t.appel('DELETE', '/api/admin/lieux/parking-nord-2', undefined, AUTH)).statut, 200);
});

test('Ajout, modification (version attendue) et suppression par identifiant', async () => {
    const ajout = await t.appel('POST', '/api/admin/foodtrucks',
        { nom: 'Spice Box', cuisine: 'Indien', jours: 'Lundi', emplacement: 'https://maps.app.goo.gl/c', prix: '' }, AUTH);
    assert.equal(ajout.statut, 201);
    const { id } = ajout.json.foodtruck;
    const ft = ajout.json.foodtruck;
    const modif = await t.appel('PUT', `/api/admin/foodtrucks/${id}`, { version: ft.version, foodtruck: { ...ft, prix: '12', statut: 'incertain' } }, AUTH);
    assert.equal(modif.statut, 200, modif.texte);
    assert.equal(modif.json.foodtruck.id, id); // identifiant stable
    assert.equal(modif.json.foodtruck.version, '2');
    assert.equal(modif.json.foodtruck.cree_le, ft.cree_le);
    // Modification concurrente (ancienne version) -> 409
    const conflit = await t.appel('PUT', `/api/admin/foodtrucks/${id}`, { version: '1', foodtruck: { ...ft, prix: '9' } }, AUTH);
    assert.equal(conflit.statut, 409);
    assert.equal((await t.appel('PUT', '/api/admin/foodtrucks/inconnu', { version: '1', foodtruck: ft }, AUTH)).statut, 404);

    // Archivé : masqué du public, visible par l'admin
    await t.appel('PUT', `/api/admin/foodtrucks/${id}`, { version: '2', foodtruck: { ...ft, statut: 'archive' } }, AUTH);
    assert.ok(!(await t.appel('GET', '/api/foodtrucks')).json.some(f => f.id === id));
    assert.ok((await t.appel('GET', '/api/admin/foodtrucks', undefined, AUTH)).json.some(f => f.id === id));

    assert.equal((await t.appel('DELETE', `/api/admin/foodtrucks/${id}`, { version: '1' }, AUTH)).statut, 409);
    assert.equal((await t.appel('DELETE', `/api/admin/foodtrucks/${id}`, { version: '3' }, AUTH)).statut, 200);
    assert.ok(!(await t.appel('GET', '/api/admin/foodtrucks', undefined, AUTH)).json.some(f => f.id === id));
});

test('Statistiques : navigateurs actifs, pages vues, exclusions, suggestions comptées par le serveur', async () => {
    await t.appel('GET', '/admin/', undefined, AUTH); // administration : exclue
    await t.appel('GET', '/page-absente.html'); // 404 : exclue
    await t.appel('GET', '/', undefined, { 'User-Agent': 'Googlebot/2.1' }); // robot : exclu
    await patienter();
    const r = await t.appel('GET', '/api/admin/statistiques', undefined, AUTH);
    assert.equal(r.statut, 200, r.texte);
    const vues = lireUsage().filter(e => e.type === 'page_vue');
    assert.equal(r.json.totaux.pagesVues, vues.length);
    assert.ok(vues.every(e => e.page === '/index.html'));
    assert.ok(r.json.totaux.actifsMoyenJour >= 1);
    assert.equal(r.json.totaux.suggestions, 1);
    assert.ok(!('/admin/index.html' in r.json.pages));
    assert.equal(r.json.evenements.clic_maps, 1);
    // Aucun identifiant de navigateur dans la réponse
    for (const e of lireUsage()) if (e.v) assert.ok(!r.texte.includes(e.v));
    const passe = await t.appel('GET', '/api/admin/statistiques?debut=2000-01-01&fin=2000-01-02', undefined, AUTH);
    assert.equal(passe.json.totaux.pagesVues, 0);
});

test('Chart.js est servi localement', async () => {
    assert.equal((await t.appel('GET', '/vendor/chart.umd.min.js')).statut, 200);
});

test('Corps JSON invalide -> 400 (et non 500)', async () => {
    const r = await t.appel('POST', '/api/suggestions', '{pas du json');
    assert.equal(r.statut, 400);
});

test('Limites de fréquence sur les suggestions et les évènements (429)', async () => {
    const l = await demarrer({ env: { LIMITE_SUGGESTIONS: '2', LIMITE_EVENEMENTS: '3', LIMITE_FACTEUR_IP: '1' } });
    try {
        const suggestion = { nom: 'A', cuisine: 'B', jours: 'Lundi', emplacement: 'https://maps.app.goo.gl/x' };
        assert.equal((await l.appel('POST', '/api/suggestions', suggestion)).statut, 201);
        assert.equal((await l.appel('POST', '/api/suggestions', suggestion)).statut, 201);
        const refus = await l.appel('POST', '/api/suggestions', suggestion);
        assert.equal(refus.statut, 429);
        assert.ok(Number(refus.entetes.get('retry-after')) > 0);
        for (let i = 0; i < 3; i++) assert.equal((await l.appel('POST', '/api/evenements', { type: 'hasard' })).statut, 204);
        assert.equal((await l.appel('POST', '/api/evenements', { type: 'hasard' })).statut, 429);
        assert.equal((await l.appel('POST', '/api/log', { event: 'Jour sélectionné : Lundi' })).statut, 429);
        assert.equal((await l.appel('GET', '/api/foodtrucks')).statut, 200); // lectures non limitées
    } finally {
        l.fermer();
    }
});

test('TRUST_PROXY : X-Forwarded-For ignoré par défaut, pris en compte avec « loopback »', async () => {
    const ipJournalisee = async (env) => {
        const s = await demarrer({ env });
        try {
            await s.appel('GET', '/api/foodtrucks', undefined, { 'X-Forwarded-For': '203.0.113.7' });
            await patienter();
            const lignes = fs.readFileSync(fichierMensuel(s.dossier, 'acces', 'log'), 'utf8').trim().split('\n');
            return JSON.parse(lignes[lignes.length - 1]).ip;
        } finally {
            s.fermer();
        }
    };
    assert.notEqual(await ipJournalisee({}), '203.0.113.7');
    assert.equal(await ipJournalisee({ TRUST_PROXY: 'loopback' }), '203.0.113.7');
    assert.notEqual(await ipJournalisee({ TRUST_PROXY: '10.0.0.1' }), '203.0.113.7'); // proxy différent : ignoré
});
