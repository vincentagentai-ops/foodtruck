'use strict';

// Plan local des emplacements (3.4.0) : dépôt de l'image (types et taille limités, accès protégé, image non
// exécutable), positions des lieux, nouveaux évènements d'usage.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { demarrer, patienter, AUTH } = require('./outils');
const { detecterType, validerImage, TAILLE_MAX } = require('../src/plan');
const { fichierMensuel, validerEvenement } = require('../src/audience');
const { FONCTIONNALITES } = require('../src/statistiques');

// Image PNG de 1 × 1 pixel
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(60, 1)]).toString('base64');
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.from([40, 0, 0, 0]), Buffer.from('WEBPVP8 '), Buffer.alloc(40, 2)]).toString('base64');
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64');
const HTML = Buffer.from('<!DOCTYPE html><html><body><script>alert(1)</script></body></html>').toString('base64');
const GIF = Buffer.from('GIF89a\x01\x00\x01\x00\x00\x00\x00;', 'latin1').toString('base64');

let t;
test.before(async () => {
    t = await demarrer({
        fichiers: {
            'lieux.csv': 'id,nom,description,minutes_a_pied,maps\nparking-nord,Parking Nord,,3,\nplace-marche,Place du marché,,6,\n',
        },
    });
});
test.after(() => t.fermer());

const admin = (methode, url, corps) => t.appel(methode, url, corps, AUTH);

test('Plan : détection du type sur les premiers octets (PNG, JPEG, WebP ; jamais SVG, HTML ni GIF)', () => {
    assert.equal(detecterType(Buffer.from(PNG, 'base64')), 'image/png');
    assert.equal(detecterType(Buffer.from(JPEG, 'base64')), 'image/jpeg');
    assert.equal(detecterType(Buffer.from(WEBP, 'base64')), 'image/webp');
    for (const autre of [SVG, HTML, GIF]) assert.equal(detecterType(Buffer.from(autre, 'base64')), null);
    assert.equal(detecterType(Buffer.alloc(4)), null);
    // Le préfixe « data:…;base64, » d'un FileReader est accepté
    assert.equal(validerImage({ type: 'image/png', donnees: `data:image/png;base64,${PNG}` }).type, 'image/png');
    assert.throws(() => validerImage({ donnees: 'pas du base64 !' }), /correctement encodée/);
    assert.throws(() => validerImage({ type: 'image/jpeg', donnees: PNG }), /ne correspond pas/);
});

test('Plan : routes administrateur protégées par le mot de passe', async () => {
    const corps = { type: 'image/png', donnees: PNG };
    assert.equal((await t.appel('PUT', '/api/admin/plan/image', corps)).statut, 401);
    assert.equal((await t.appel('DELETE', '/api/admin/plan/image', {})).statut, 401);
    assert.equal((await t.appel('PUT', '/api/admin/plan/positions/parking-nord', { x: 1, y: 1 })).statut, 401);
    assert.equal((await t.appel('DELETE', '/api/admin/plan/positions/parking-nord', {})).statut, 401);
    // Variantes de casse et d'encodage : jamais d'écriture sans mot de passe
    assert.equal((await t.appel('PUT', '/api/admin/Plan/image', corps)).statut, 401);
    assert.equal((await t.appel('PUT', '/api/%61dmin/plan/image', corps)).statut, 404);
    assert.equal((await t.appel('GET', '/api/plan')).json.image, null);
    assert.ok(!fs.existsSync(path.join(t.dossier, 'plan-image.png')));
    // Gros corps sans mot de passe : refusé avant d'être lu
    const gros = { type: 'image/png', donnees: 'A'.repeat(500 * 1024) };
    assert.equal((await t.appel('PUT', '/api/admin/plan/image', gros)).statut, 401);
});

test('Plan : seuls PNG, JPEG et WebP sont acceptés, 3 Mo au plus', async () => {
    for (const [donnees, type] of [[SVG, 'image/svg+xml'], [HTML, 'image/png'], [GIF, 'image/gif'], [SVG, undefined]]) {
        const r = await admin('PUT', '/api/admin/plan/image', { type, donnees });
        assert.equal(r.statut, 400, type);
        assert.match(r.json.error, /PNG, JPEG et WebP|ne correspond pas/);
    }
    // Trop gros : refusé (par le contrôle de taille, ou par la limite du corps)
    const trop = Buffer.concat([Buffer.from(PNG, 'base64'), Buffer.alloc(TAILLE_MAX)]).toString('base64');
    const r = await admin('PUT', '/api/admin/plan/image', { type: 'image/png', donnees: trop });
    assert.equal(r.statut, 413);
    // Ailleurs dans l'API, la limite reste de 20 ko
    assert.equal((await admin('PUT', '/api/admin/plan/positions/parking-nord', { x: 1, y: 1, bourrage: 'x'.repeat(30 * 1024) })).statut, 413);
    assert.equal((await t.appel('PUT', '/api/admin/plan/image', 'pas du json', { ...AUTH, 'Content-Type': 'text/plain' })).statut, 415);
    assert.equal((await admin('PUT', '/api/admin/plan/image', '{pas du json')).statut, 400);
    // Écriture depuis une autre origine : refusée même avec le mot de passe
    assert.equal((await t.appel('PUT', '/api/admin/plan/image', { donnees: PNG }, { ...AUTH, Origin: 'http://ailleurs.example' })).statut, 403);
    assert.ok(!fs.readdirSync(t.dossier).some(f => f.startsWith('plan-image')));
});

test('Plan : image enregistrée dans data/ puis servie comme image non exécutable', async () => {
    const r = await admin('PUT', '/api/admin/plan/image', { type: 'image/png', donnees: `data:image/png;base64,${PNG}` });
    assert.equal(r.statut, 201, r.texte);
    assert.match(r.json.plan.image, /^\/plan\/image\?v=/);
    assert.ok(fs.existsSync(path.join(t.dossier, 'plan-image.png')));
    assert.ok(fs.existsSync(path.join(t.dossier, 'plan.json')));

    const publicPlan = (await t.appel('GET', '/api/plan')).json;
    assert.equal(publicPlan.image, r.json.plan.image);
    const image = await t.appel('GET', publicPlan.image);
    assert.equal(image.statut, 200);
    assert.equal(image.entetes.get('content-type'), 'image/png');
    assert.equal(image.entetes.get('x-content-type-options'), 'nosniff');
    assert.match(image.entetes.get('content-security-policy'), /default-src 'none'; sandbox/);
    assert.match(image.entetes.get('content-disposition'), /^inline; filename="plan\.png"/);

    // Remplacement par un JPEG : l'ancien fichier PNG disparaît
    assert.equal((await admin('PUT', '/api/admin/plan/image', { type: 'image/jpeg', donnees: JPEG })).statut, 201);
    assert.ok(!fs.existsSync(path.join(t.dossier, 'plan-image.png')));
    assert.equal((await t.appel('GET', '/plan/image')).entetes.get('content-type'), 'image/jpeg');

    // Fichier remplacé à la main par autre chose qu'une image : plus servi
    fs.writeFileSync(path.join(t.dossier, 'plan-image.jpg'), '<html><script>alert(1)</script></html>');
    assert.equal((await t.appel('GET', '/plan/image')).statut, 404);
    assert.equal((await admin('PUT', '/api/admin/plan/image', { type: 'image/png', donnees: PNG })).statut, 201);
});

test('Plan : positions des lieux (pourcentages), lieu inconnu, retrait, suppression du lieu', async () => {
    let r = await admin('PUT', '/api/admin/plan/positions/parking-nord', { x: 12.345, y: 80 });
    assert.equal(r.statut, 200);
    assert.deepEqual(r.json.plan.positions['parking-nord'], { x: 12.3, y: 80 });
    for (const corps of [{ x: -1, y: 5 }, { x: 5, y: 101 }, { x: '5', y: 5 }, {}]) {
        assert.equal((await admin('PUT', '/api/admin/plan/positions/parking-nord', corps)).statut, 400);
    }
    assert.equal((await admin('PUT', '/api/admin/plan/positions/inconnu', { x: 1, y: 1 })).statut, 404);
    await admin('PUT', '/api/admin/plan/positions/place-marche', { x: 50, y: 50 });
    assert.deepEqual(Object.keys((await t.appel('GET', '/api/plan')).json.positions).sort(), ['parking-nord', 'place-marche']);

    r = await admin('DELETE', '/api/admin/plan/positions/place-marche', {});
    assert.deepEqual(Object.keys(r.json.plan.positions), ['parking-nord']);
    // Un lieu supprimé quitte aussi le plan
    assert.equal((await admin('DELETE', '/api/admin/lieux/parking-nord', {})).statut, 200);
    assert.deepEqual((await t.appel('GET', '/api/plan')).json.positions, {});

    // Retirer l'image garde les positions
    await admin('PUT', '/api/admin/plan/positions/place-marche', { x: 20, y: 30 });
    r = await admin('DELETE', '/api/admin/plan/image', {});
    assert.equal(r.statut, 200);
    assert.equal(r.json.plan.image, null);
    assert.deepEqual(r.json.plan.positions['place-marche'], { x: 20, y: 30 });
    assert.equal((await t.appel('GET', '/plan/image')).statut, 404);
    assert.ok(!fs.readdirSync(t.dossier).some(f => f.startsWith('plan-image')));
});

test('Plan : l\'image fait partie de la sauvegarde quotidienne', async () => {
    await admin('PUT', '/api/admin/plan/image', { type: 'image/png', donnees: PNG });
    const { sauvegarderSiNecessaire } = require('../src/sauvegarde');
    const dossier = await sauvegarderSiNecessaire(t.config, '2099-01-01');
    assert.ok(fs.existsSync(path.join(dossier, 'plan-image.png')));
    assert.ok(fs.existsSync(path.join(dossier, 'plan.json')));
});

test('Évènements 3.4.0 : acceptés depuis les pages et comptés dans « Utilisation des fonctionnalités »', async () => {
    const nouveaux = ['vue_semaine', 'marque_essaye', 'marque_a_tester', 'marque_retiree', 'hasard_non_essaye', 'copie_teams',
        'lien_ouvert', 'preferences', 'carnet_ajout', 'carnet_retrait', 'carnet_ouvert', 'carnet_efface', 'plan_ouvert',
        'plan_lieu_clic', 'donnees_locales_effacees'];
    for (const type of nouveaux) assert.ok(validerEvenement({ type, cible: 'x' }).evenement, type);
    assert.equal(validerEvenement({ type: 'admin_plan' }).statut, 403);
    const comptes = Object.values(FONCTIONNALITES).flat();
    for (const type of nouveaux.filter(n => n !== 'donnees_locales_effacees')) assert.ok(comptes.includes(type), type);

    const nav = await t.navigateur();
    assert.equal((await nav('POST', '/api/evenements', { type: 'copie_teams', cible: 'ab12cd', page: '/' })).statut, 204);
    await patienter();
    const usage = fs.readFileSync(fichierMensuel(t.dossier, 'usage', 'jsonl'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    assert.ok(usage.some(e => e.type === 'copie_teams' && e.cible === 'ab12cd'));
    assert.ok(usage.some(e => e.type === 'admin_plan'));
});
