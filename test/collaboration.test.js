'use strict';

// Fonctionnement collaboratif (3.2.0) : publication immédiate, doublons, versions et conflits, historique et
// restauration, avis, présences, signalements et seuils, fusion, origine des requêtes, reconstruction de l'état.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { demarrer, patienter, AUTH } = require('./outils');
const { charger } = require('../src/config');
const { creerApplication } = require('../src/app');
const { nomsProches, normaliserNom, chercherDoublons, fusionnerFiches } = require('../src/etablissements');
const { validerAvis } = require('../src/contributions');
const { fichierMensuel } = require('../src/audience');

const MAPS = 'https://maps.app.goo.gl/abc';
const fiche = (nom, extra = {}) => ({ nom, cuisine: 'Bagel', jours: 'Lundi;Mardi', emplacement: `${MAPS}-${nom.length}`, ...extra });

// Horloge simulée, partagée par l'application de test
let maintenant = new Date('2026-03-02T11:00:00');
const horloge = () => new Date(maintenant);
const avancer = jours => { maintenant = new Date(maintenant.getTime() + jours * 86400000); };

let t;
test.before(async () => { t = await demarrer({ options: { horloge } }); });
test.after(() => t.fermer());

const lignes = nom => {
    const f = path.join(t.dossier, nom);
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
};

test('Doublons : nom normalisé (accents, mots vides), distance ≤ 2 ou inclusion, même lien Maps', () => {
    assert.equal(normaliserNom("L'Épicurieux Food Truck"), 'epicurieux');
    assert.ok(nomsProches("L'épicurieux", 'Le Epicurieu'));
    assert.ok(nomsProches('Moya', 'Moya Street Food'));
    assert.ok(nomsProches('Ô Tuk Tuk', 'O Tuk-Tuk'));
    assert.ok(!nomsProches('Moya', 'Neki Neko'));
    assert.ok(!nomsProches('Bao', 'Bio')); // noms très courts : égalité exigée
    const liste = [
        { id: 'a', nom: "L'épicurieux", lieu: 'nord', emplacement: 'https://maps.app.goo.gl/X/', statut: 'actif' },
        { id: 'b', nom: 'Spice Box', lieu: '', emplacement: 'https://maps.app.goo.gl/Y', statut: 'actif' },
        { id: 'c', nom: 'Epicurieux', lieu: '', emplacement: '', statut: 'archive' },
    ];
    const r = chercherDoublons(liste, { nom: 'Epicurieux', lieu: 'nord', emplacement: '' });
    assert.deepEqual(r.map(d => d.id), ['a']); // archivé ignoré
    assert.deepEqual(r[0].raisons, ['nom proche', 'même lieu']);
    assert.deepEqual(chercherDoublons(liste, { nom: 'Autre', emplacement: 'https://maps.app.goo.gl/y' }).map(d => d.id), ['b']);
});

test('C1 : ajout publié immédiatement, doublon signalé sans blocage, historique créé', async () => {
    const a = await t.navigateur();
    const r1 = await a('POST', '/api/etablissements', { ...fiche("L'épicurieux"), pseudo: '  Camille  ' });
    assert.equal(r1.statut, 201, r1.texte);
    assert.deepEqual(r1.json.doublons, []);
    assert.ok((await t.appel('GET', '/api/etablissements')).json.etablissements.some(f => f.id === r1.json.etablissement.id));

    const d = await t.appel('GET', `/api/doublons?nom=${encodeURIComponent('Le Epicurieux')}`);
    assert.deepEqual(d.json.map(x => x.id), [r1.json.etablissement.id]);
    const r2 = await a('POST', '/api/etablissements', fiche('Epicurieux', { jours: 'Jeudi' }));
    assert.equal(r2.statut, 201); // pas de blocage
    assert.equal(r2.json.doublons[0].id, r1.json.etablissement.id);

    const h = lignes('historique.jsonl').find(e => e.cible === r1.json.etablissement.id);
    assert.equal(h.action, 'creer');
    assert.equal(h.pseudo, 'Camille');
    assert.match(h.auteur, /^[0-9a-f]{24}$/);
    assert.ok(!fs.readFileSync(path.join(t.dossier, 'historique.jsonl'), 'utf8').includes(a.cookie.split('=')[1])); // jamais le cookie
    // Pseudo trop long refusé
    assert.equal((await a('POST', '/api/etablissements', { ...fiche('Zeta'), pseudo: 'x'.repeat(31) })).statut, 400);
});

test("Délai de grâce : l'auteur garde la main 30 min, peut retirer son ajout ; ensuite tout le monde peut modifier", async () => {
    const auteur = await t.navigateur();
    const autre = await t.navigateur();
    const { etablissement: ft } = (await auteur('POST', '/api/etablissements', fiche('Grace Kitchen'))).json;
    const modif = { version: ft.version, etablissement: { ...ft, prix: '12' } };
    assert.equal((await autre('PUT', `/api/etablissements/${ft.id}`, modif)).statut, 403);
    assert.equal((await t.appel('GET', `/api/etablissements/${ft.id}`, undefined, { Cookie: auteur.cookie })).json.grace, true);
    assert.equal((await t.appel('GET', `/api/etablissements/${ft.id}`, undefined, { Cookie: autre.cookie })).json.grace, false);
    const r = await auteur('PUT', `/api/etablissements/${ft.id}`, modif);
    assert.equal(r.statut, 200, r.texte);
    assert.equal(r.json.etablissement.version, '2');
    assert.equal((await autre('DELETE', `/api/etablissements/${ft.id}`, { version: '2' })).statut, 403);

    avancer(1 / 48); // 30 min plus tard
    const r2 = await autre('PUT', `/api/etablissements/${ft.id}`, { version: '2', etablissement: { ...ft, prix: '13' } });
    assert.equal(r2.statut, 200, r2.texte);
    assert.equal((await auteur('DELETE', `/api/etablissements/${ft.id}`, { version: '3' })).statut, 403); // délai passé

    // Retrait pendant le délai : archivé (restaurable par l'administrateur)
    const { etablissement: ft2 } = (await auteur('POST', '/api/etablissements', fiche('Erreur de saisie'))).json;
    assert.equal((await auteur('DELETE', `/api/etablissements/${ft2.id}`, { version: '1' })).statut, 200);
    assert.equal((await t.appel('GET', `/api/etablissements/${ft2.id}`)).statut, 404);
    assert.equal((await t.appel('GET', '/api/admin/foodtrucks', undefined, AUTH)).json.find(f => f.id === ft2.id).statut, 'archive');
});

test('C2 : modification par tous avec version attendue ; 409 avec les différences', async () => {
    const a = await t.navigateur();
    const b = await t.navigateur();
    const { foodtruck: ft } = (await t.appel('POST', '/api/admin/foodtrucks', fiche('Spice Box', { prix: '10' }), AUTH)).json;
    const ra = await a('PUT', `/api/etablissements/${ft.id}`, { version: '1', etablissement: { ...ft, prix: '11', horaires: '11h-14h' }, pseudo: 'Alex' });
    assert.equal(ra.statut, 200, ra.texte);
    // b avait ouvert la version 1 : conflit
    const rb = await b('PUT', `/api/etablissements/${ft.id}`, { version: '1', etablissement: { ...ft, prix: '9' } });
    assert.equal(rb.statut, 409);
    assert.equal(rb.json.actuelle.version, '2');
    const prix = rb.json.differences.find(d => d.champ === 'prix');
    assert.deepEqual([prix.base, prix.actuelle, prix.vous], ['10', '11', '9']);
    assert.ok(rb.json.differences.some(d => d.champ === 'horaires'));
    // Un visiteur ne change pas le statut
    const rs = await b('PUT', `/api/etablissements/${ft.id}`, { version: '2', etablissement: { ...ra.json.etablissement, statut: 'archive' } });
    assert.equal(rs.statut, 200);
    assert.equal(rs.json.etablissement.statut, 'actif');
    assert.equal(rs.json.message, 'Aucun changement.');
});

test("C3 : historique de la fiche et « Restaurer cette version »", async () => {
    const a = await t.navigateur();
    const { foodtruck: ft } = (await t.appel('POST', '/api/admin/foodtrucks', fiche('Ban Thai', { prix: '10' }), AUTH)).json;
    await a('PUT', `/api/etablissements/${ft.id}`, { version: '1', etablissement: { ...ft, nom: 'Vandale', prix: '99' } });
    const h = (await t.appel('GET', `/api/etablissements/${ft.id}/historique`)).json;
    assert.equal(h.version, '2');
    assert.deepEqual(h.entrees.map(e => e.action), ['modifier', 'creer']);
    assert.deepEqual(h.entrees[0].champs.map(c => c.champ).sort(), ['nom', 'prix']);
    assert.equal(h.entrees[1].restaurable, true);
    assert.ok(!JSON.stringify(h).match(/[0-9a-f]{24}/)); // aucun jeton d'auteur publié

    const r = await a('POST', `/api/etablissements/${ft.id}/restaurer/1`, { versionActuelle: '2' });
    assert.equal(r.statut, 200, r.texte);
    assert.equal(r.json.etablissement.nom, 'Ban Thai');
    assert.equal(r.json.etablissement.prix, '10');
    assert.equal(r.json.etablissement.version, '3');
    assert.equal((await a('POST', `/api/etablissements/${ft.id}/restaurer/1`, { versionActuelle: '2' })).statut, 409);
    assert.equal((await a('POST', `/api/etablissements/${ft.id}/restaurer/42`, { versionActuelle: '3' })).statut, 404);
    assert.equal((await t.appel('GET', `/api/etablissements/${ft.id}/historique`)).json.entrees[0].action, 'restaurer');

    // Fiche antérieure à l'historique (données migrées) : la version d'avant la 1re modification est restaurable
    const stockage = t.app.locals.stockage;
    const ancienne = { ...ft, id: 'ancien', nom: 'Ancien Truck', version: '1' };
    await stockage.ecrireFichier(t.config.fichierFoodtrucks, [...await stockage.lireFoodtrucks(), ancienne]);
    await a('PUT', '/api/etablissements/ancien', { version: '1', etablissement: { ...ancienne, prix: '50' } });
    const h2 = (await t.appel('GET', '/api/etablissements/ancien/historique')).json;
    assert.equal(h2.entrees[0].versionAvant, '1');
    assert.equal((await a('POST', '/api/etablissements/ancien/restaurer/1', { versionActuelle: '2' })).json.etablissement.prix, '10');
});

test('C6/C7 : un avis par navigateur, modifiable et supprimable par son seul auteur ; moyenne', async () => {
    const [a, b, c] = [await t.navigateur(), await t.navigateur(), await t.navigateur()];
    const { foodtruck: ft } = (await t.appel('POST', '/api/admin/foodtrucks', fiche('Moya Avis'), AUTH)).json;
    const url = `/api/etablissements/${ft.id}/avis`;
    assert.equal((await a('POST', url, { note: 6 })).statut, 400);
    assert.equal((await a('POST', url, { note: 4, texte: 'x'.repeat(281) })).statut, 400);
    assert.equal((await a('POST', url, { note: 4, criteres: { attente: 'jamais' } })).statut, 400);
    const r1 = await a('POST', url, { note: 4, texte: 'Très bon', criteres: { attente: 'moins5', portions: 'copieuses' }, plat: 'Burrito', pseudo: 'Camille' });
    assert.equal(r1.statut, 201, r1.texte);
    const r2 = await a('POST', url, { note: 2, texte: 'Finalement moyen' });
    assert.equal(r2.statut, 200); // modification du même avis
    assert.equal(r2.json.id, r1.json.id);

    let vue = (await t.appel('GET', `/api/etablissements/${ft.id}`, undefined, { Cookie: a.cookie })).json;
    assert.equal(vue.avis.length, 1);
    assert.equal(vue.avis[0].note, 2);
    assert.equal(vue.avis[0].modifie, true);
    assert.equal(vue.avis[0].mien, true);
    assert.equal(vue.monAvis.texte, 'Finalement moyen');
    assert.equal(vue.resume.nbAvis, 1);
    assert.ok(!('auteur' in vue.avis[0]));
    assert.equal((await t.appel('GET', `/api/etablissements/${ft.id}`, undefined, { Cookie: b.cookie })).json.avis[0].mien, false);

    // Suppression réservée à l'auteur (b n'a pas d'avis : 404, celui de a reste)
    assert.equal((await b('DELETE', url, {})).statut, 404);
    await b('POST', url, { note: 5 });
    await c('POST', url, { note: 5 });
    vue = (await t.appel('GET', `/api/etablissements/${ft.id}`)).json;
    assert.equal(vue.resume.nbAvis, 3);
    assert.equal(vue.resume.note, 4);
    assert.equal((await a('DELETE', url, {})).statut, 200);
    vue = (await t.appel('GET', `/api/etablissements/${ft.id}`)).json;
    assert.equal(vue.resume.nbAvis, 2);
    assert.equal(vue.resume.note, 5);
    assert.equal(lignes('avis.jsonl').filter(l => l.id === r1.json.id).length, 3); // suppression logique, rien d'effacé
    // Après suppression, a peut publier un nouvel avis
    assert.equal((await a('POST', url, { note: 3 })).statut, 201);
});

test('C13 : avis masqué au 3e signalement de navigateurs distincts (pas au 3e du même navigateur)', async () => {
    const auteur = await t.navigateur();
    const { foodtruck: ft } = (await t.appel('POST', '/api/admin/foodtrucks', fiche('Signalé Truck'), AUTH)).json;
    const { id } = (await auteur('POST', `/api/etablissements/${ft.id}/avis`, { note: 1, texte: 'Contenu déplacé' })).json;
    const signaler = nav => nav('POST', '/api/signalements', { cible: ft.id, type: 'inapproprie', avis: id });
    assert.equal((await signaler(auteur)).statut, 400); // pas son propre avis
    const s1 = await t.navigateur();
    assert.equal((await signaler(s1)).statut, 201);
    assert.equal((await signaler(s1)).statut, 200); // déjà fait : ne compte pas deux fois
    assert.equal((await signaler(s1)).statut, 200);
    const visibles = async () => (await t.appel('GET', `/api/etablissements/${ft.id}`)).json.avis.length;
    assert.equal(await visibles(), 1);
    await signaler(await t.navigateur());
    assert.equal(await visibles(), 1);
    await signaler(await t.navigateur());
    assert.equal(await visibles(), 0); // masqué automatiquement

    // L'administrateur le voit dans « À surveiller », le rétablit (signalements clos), puis le purge
    const surv = (await t.appel('GET', '/api/admin/surveillance', undefined, AUTH)).json;
    const masque = surv.masques.find(m => m.id === id);
    assert.equal(masque.signalements, 3);
    assert.ok(surv.signalements.some(s => s.avis && s.avis.id === id));
    assert.equal((await t.appel('POST', `/api/admin/avis/${id}/retablir`, {}, AUTH)).statut, 200);
    assert.equal(await visibles(), 1);
    assert.ok(!(await t.appel('GET', '/api/admin/surveillance', undefined, AUTH)).json.signalements.some(s => s.avis && s.avis.id === id));
    assert.equal((await t.appel('DELETE', `/api/admin/avis/${id}`, {}, AUTH)).statut, 200);
    assert.equal(await visibles(), 0);
    assert.ok(!lignes('avis.jsonl').some(l => l.id === id)); // purge : effacé du fichier
});

test('C4 : présence du jour, une par navigateur et par jour, modifiable, remise à zéro le lendemain', async () => {
    const { foodtruck: ft } = (await t.appel('POST', '/api/admin/foodtrucks', fiche('Présence Truck'), AUTH)).json;
    const url = `/api/etablissements/${ft.id}/presence`;
    const [a, b, c] = [await t.navigateur(), await t.navigateur(), await t.navigateur()];
    assert.equal((await a('POST', url, { etat: 'peut-etre' })).statut, 400);
    await a('POST', url, { etat: 'present' });
    await a('POST', url, { etat: 'present' });
    await b('POST', url, { etat: 'present' });
    const r = await c('POST', url, { etat: 'absent' });
    assert.equal(r.statut, 200);
    assert.deepEqual([r.json.resume.presence.presents, r.json.resume.presence.absents], [2, 1]);
    assert.equal(r.json.resume.presence.monEtat, 'absent');
    assert.match(r.json.resume.presence.derniere, /^\d{2}h\d{2}$/);
    await c('POST', url, { etat: 'present' }); // change d'avis
    await b('POST', url, { etat: 'aucun' }); // retire sa déclaration
    let resume = (await t.appel('GET', `/api/etablissements/${ft.id}`)).json.resume;
    assert.deepEqual([resume.presence.presents, resume.presence.absents], [2, 0]);
    avancer(1);
    resume = (await t.appel('GET', `/api/etablissements/${ft.id}`)).json.resume;
    assert.deepEqual([resume.presence.presents, resume.presence.absents], [0, 0]);
});

test('C5 : fermeture exceptionnelle (bandeau du jour), info erronée (note jusqu\'à correction), dates contrôlées', async () => {
    const { foodtruck: ft } = (await t.appel('POST', '/api/admin/foodtrucks', fiche('Fermé Truck'), AUTH)).json;
    const a = await t.navigateur();
    const jour = d => { const x = horloge(); x.setDate(x.getDate() + d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
    assert.equal((await a('POST', '/api/signalements', { cible: ft.id, type: 'ferme', date: jour(-1) })).statut, 400);
    assert.equal((await a('POST', '/api/signalements', { cible: ft.id, type: 'ferme', date: jour(90) })).statut, 400);
    assert.equal((await a('POST', '/api/signalements', { cible: ft.id, type: 'ferme', date: jour(2) })).statut, 201);
    assert.equal((await a('POST', '/api/signalements', { cible: ft.id, type: 'inconnu' })).statut, 400);
    assert.equal((await a('POST', '/api/signalements', { cible: ft.id, type: 'erreur' })).statut, 400); // précision obligatoire
    assert.equal((await a('POST', '/api/signalements', { cible: ft.id, type: 'erreur', texte: 'Plus là le lundi' })).statut, 201);
    let resume = (await t.appel('GET', `/api/etablissements/${ft.id}`)).json.resume;
    assert.deepEqual(resume.fermetures, [jour(2)]);
    assert.equal(resume.erreurs[0].texte, 'Plus là le lundi');
    assert.ok((await t.appel('GET', '/api/quoi-de-neuf')).json.some(e => e.type === 'fermeture' && e.cible === ft.id));
    // Quelqu'un corrige la fiche : la note « info erronée » disparaît
    avancer(1 / 1440);
    await a('PUT', `/api/etablissements/${ft.id}`, { version: '1', etablissement: { ...ft, jours: 'Mardi' } });
    resume = (await t.appel('GET', `/api/etablissements/${ft.id}`)).json.resume;
    assert.deepEqual(resume.erreurs, []);
    avancer(3); // la fermeture est passée
    assert.deepEqual((await t.appel('GET', `/api/etablissements/${ft.id}`)).json.resume.fermetures, []);
});

test('Seuils : « plus présent » ×2 navigateurs + 14 j sans confirmation -> incertain ; 30 j -> archivé ; restaurable', async () => {
    const contributions = t.app.locals.contributions;
    const { foodtruck: ft } = (await t.appel('POST', '/api/admin/foodtrucks', fiche('Disparu Truck'), AUTH)).json;
    const statut = async () => (await t.appel('GET', '/api/admin/foodtrucks', undefined, AUTH)).json.find(f => f.id === ft.id).statut;
    const [a, b, c] = [await t.navigateur(), await t.navigateur(), await t.navigateur()];
    await c('POST', `/api/etablissements/${ft.id}/presence`, { etat: 'present' });
    avancer(20);
    await a('POST', '/api/signalements', { cible: ft.id, type: 'plus_present' });
    await a('POST', '/api/signalements', { cible: ft.id, type: 'plus_present' }); // même navigateur : compte une fois
    assert.equal(await statut(), 'actif');
    assert.equal((await t.appel('GET', `/api/etablissements/${ft.id}`)).json.resume.plusPresent, 1);
    await b('POST', '/api/signalements', { cible: ft.id, type: 'plus_present' });
    assert.equal(await statut(), 'incertain'); // 2 navigateurs, dernière confirmation il y a 20 jours
    avancer(5);
    await contributions.appliquerSeuils();
    assert.equal(await statut(), 'incertain');
    avancer(5); // 30 jours sans confirmation
    await contributions.appliquerSeuils();
    assert.equal(await statut(), 'archive');
    assert.ok(!(await t.appel('GET', '/api/etablissements')).json.etablissements.some(f => f.id === ft.id));
    const h = lignes('historique.jsonl').filter(e => e.cible === ft.id && e.action === 'statut_auto');
    assert.deepEqual(h.map(e => e.apres.statut), ['incertain', 'archive']);

    // Restauration par l'administrateur : signalements clos, la fiche reste active
    const actuelle = (await t.appel('GET', '/api/admin/foodtrucks', undefined, AUTH)).json.find(f => f.id === ft.id);
    const r = await t.appel('PUT', `/api/admin/foodtrucks/${ft.id}`, { version: actuelle.version, foodtruck: { ...actuelle, statut: 'actif' } }, AUTH);
    assert.equal(r.statut, 200, r.texte);
    await contributions.appliquerSeuils();
    assert.equal(await statut(), 'actif');

    // Jamais confirmé : les jours comptent depuis le premier signalement ; une confirmation annule l'effet
    const { foodtruck: ft2 } = (await t.appel('POST', '/api/admin/foodtrucks', fiche('Douteux Truck'), AUTH)).json;
    const statut2 = async () => (await t.appel('GET', '/api/admin/foodtrucks', undefined, AUTH)).json.find(f => f.id === ft2.id).statut;
    await a('POST', '/api/signalements', { cible: ft2.id, type: 'plus_present' });
    await b('POST', '/api/signalements', { cible: ft2.id, type: 'plus_present' });
    assert.equal(await statut2(), 'actif');
    avancer(14);
    await contributions.appliquerSeuils();
    assert.equal(await statut2(), 'incertain');
    await c('POST', `/api/etablissements/${ft2.id}/presence`, { etat: 'present' });
    assert.equal(await statut2(), 'actif');
});

test('C14 : fusion de deux fiches (jours, lieu selon le jour, avis, présences et historique rattachés)', async () => {
    assert.deepEqual(fusionnerFiches(
        { nom: 'X', jours: 'Mercredi', lieu: 'nord', emplacement: '', paiements: 'CB', lieux_jours: '' },
        { nom: 'X', jours: 'Jeudi;Mercredi', lieu: '', emplacement: 'https://maps.app.goo.gl/j', paiements: 'Espèces', horaires: '11h-14h', lieux_jours: '' },
    ), { nom: 'X', jours: 'Mercredi;Jeudi', lieu: 'nord', emplacement: 'https://maps.app.goo.gl/j', paiements: 'CB;Espèces', horaires: '11h-14h',
        etiquettes: '', lieux_jours: 'Jeudi=https://maps.app.goo.gl/j' });

    const ajout = (nom, jours, emplacement) => t.appel('POST', '/api/admin/foodtrucks', { nom, cuisine: 'Bagel', jours, emplacement }, AUTH);
    const g = (await ajout('Bagel Fusion', 'Mercredi', 'https://maps.app.goo.gl/m')).json.foodtruck;
    const x = (await ajout('Bagel Fusion bis', 'Jeudi', 'https://maps.app.goo.gl/j')).json.foodtruck;
    const [a, b] = [await t.navigateur(), await t.navigateur()];
    await a('POST', `/api/etablissements/${g.id}/avis`, { note: 2 });
    await a('POST', `/api/etablissements/${x.id}/avis`, { note: 4 }); // même navigateur sur les deux fiches
    await b('POST', `/api/etablissements/${x.id}/avis`, { note: 5 });
    await b('POST', `/api/etablissements/${x.id}/presence`, { etat: 'present' });

    assert.equal((await t.appel('POST', '/api/admin/fusion', { garder: g.id, absorber: g.id }, AUTH)).statut, 400);
    const r = await t.appel('POST', '/api/admin/fusion', { garder: g.id, absorber: x.id }, AUTH);
    assert.equal(r.statut, 200, r.texte);
    assert.equal(r.json.foodtruck.jours, 'Mercredi;Jeudi');
    assert.equal(r.json.foodtruck.lieux_jours, 'Jeudi=https://maps.app.goo.gl/j');

    const vue = (await t.appel('GET', `/api/etablissements/${g.id}`)).json;
    assert.deepEqual(vue.avis.map(v => v.note).sort(), [4, 5]); // l'avis le plus récent de a remplace l'autre
    assert.equal(vue.resume.presence.presents, 1);
    const ancienne = await t.appel('GET', `/api/etablissements/${x.id}`); // ancien identifiant suivi
    assert.equal(ancienne.json.etablissement.id, g.id);
    assert.equal((await t.appel('GET', '/api/etablissements')).json.alias[x.id], g.id);
    const h = (await t.appel('GET', `/api/etablissements/${g.id}/historique`)).json.entrees;
    assert.ok(h.some(e => e.ancienneFiche === 'Bagel Fusion bis'));
    assert.ok(!(await t.appel('GET', '/api/admin/foodtrucks', undefined, AUTH)).json.some(f => f.id === x.id));
});

test('Textes malveillants : stockés tels quels, échappés à l\'affichage, neutralisés à l\'export CSV', async () => {
    const a = await t.navigateur();
    const { foodtruck: ft } = (await t.appel('POST', '/api/admin/foodtrucks', fiche('Export Truck'), AUTH)).json;
    const texte = '<script>alert(1)</script>';
    await a('POST', `/api/etablissements/${ft.id}/avis`, { note: 3, texte, plat: '=CMD("calc")', pseudo: '@pirate' });
    const vue = await t.appel('GET', `/api/etablissements/${ft.id}`);
    assert.match(vue.entetes.get('content-type'), /application\/json/);
    assert.equal(vue.json.avis[0].texte, texte);
    // Le nom d'un établissement ne peut pas commencer par une formule
    assert.equal((await a('POST', '/api/etablissements', fiche('=CMD()'))).statut, 400);

    const csv = (await t.appel('GET', '/api/admin/export/avis.csv', undefined, AUTH)).texte;
    assert.ok(csv.includes(`'=CMD(""calc"")`));
    assert.ok(csv.includes("'@pirate"));
    assert.ok(!/(^|,)[=+\-@]/m.test(csv.replace(/"/g, '')));

    // Échappement côté navigateur (Commun.html, utilisé pour toutes les données affichées)
    const contexte = { document: { addEventListener() {} }, location: {}, URL };
    vm.runInNewContext(`${fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'commun.js'), 'utf8')}\nthis.Commun = Commun;`, contexte);
    assert.equal(contexte.Commun.html(texte), '&lt;script&gt;alert(1)&lt;/script&gt;');
    assert.equal(contexte.Commun.html('" onmouseover="x'), '&quot; onmouseover=&quot;x');
    // Les scripts publics n'insèrent jamais les textes des avis sans échappement
    for (const f of ['fiche.js', 'accueil.js', 'formulaires.js']) {
        const source = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', f), 'utf8');
        assert.doesNotMatch(source, /\$\{(a|avis|e|element)\.(texte|plat|pseudo)\}/, f);
    }
});

test('T7 : écriture refusée depuis une autre origine ; JSON obligatoire ; hôtes autorisés configurables', async () => {
    const a = await t.navigateur();
    const corps = { type: 'hasard' };
    assert.equal((await a('POST', '/api/evenements', corps, { Origin: 'http://pirate.example' })).statut, 403);
    assert.equal((await a('POST', '/api/evenements', corps, { Origin: 'null' })).statut, 403);
    const hote = new URL(t.base).host;
    assert.equal((await a('POST', '/api/evenements', corps, { Origin: `http://${hote}` })).statut, 204);
    const { foodtruck: ft } = (await t.appel('POST', '/api/admin/foodtrucks', fiche('Origine Truck'), AUTH)).json;
    assert.equal((await a('POST', `/api/etablissements/${ft.id}/avis`, { note: 5 }, { Origin: 'http://pirate.example' })).statut, 403);
    assert.equal((await t.appel('PUT', `/api/admin/moderation`, { seuils: {} }, { ...AUTH, Origin: 'http://pirate.example' })).statut, 403);
    // Formulaire HTML classique (pas de JSON) : refusé
    const r = await fetch(`${t.base}/api/etablissements/${ft.id}/avis`, {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: a.cookie }, body: 'note=5',
    });
    assert.equal(r.status, 415);
    // Lecture depuis n'importe où : autorisée
    assert.equal((await a('GET', '/api/etablissements', undefined, { Origin: 'http://pirate.example' })).statut, 200);

    const autre = await demarrer({ env: { HOTES_AUTORISES: 'foodtrucks.intranet, 10.0.0.5' } });
    try {
        assert.equal((await autre.appel('POST', '/api/evenements', corps, { Origin: 'http://foodtrucks.intranet' })).statut, 204);
        assert.equal((await autre.appel('POST', '/api/evenements', corps, { Origin: 'http://10.0.0.5:8080' })).statut, 204);
        assert.equal((await autre.appel('POST', '/api/evenements', corps, { Origin: 'http://foodtrucks.pirate' })).statut, 403);
    } finally {
        autre.fermer();
    }
});

test('Blocage temporaire d\'un navigateur et réglage des seuils par l\'administrateur', async () => {
    const a = await t.navigateur();
    const { foodtruck: ft } = (await t.appel('POST', '/api/admin/foodtrucks', fiche('Bloqué Truck'), AUTH)).json;
    await a('POST', `/api/etablissements/${ft.id}/avis`, { note: 1, texte: 'spam' });
    const s = await t.navigateur();
    await s('POST', '/api/signalements', { cible: ft.id, type: 'inapproprie', avis: (await t.appel('GET', `/api/etablissements/${ft.id}`)).json.avis[0].id });
    const surv = (await t.appel('GET', '/api/admin/surveillance', undefined, AUTH)).json;
    const auteur = lignes('avis.jsonl').find(l => l.cible === ft.id).auteur;
    assert.equal((await t.appel('POST', '/api/admin/blocages', { auteur, jours: 7 }, AUTH)).statut, 200);
    assert.ok(surv.signalements.length > 0);
    assert.equal((await a('POST', `/api/etablissements/${ft.id}/avis`, { note: 2 })).statut, 403);
    assert.equal((await a('POST', `/api/etablissements/${ft.id}/presence`, { etat: 'present' })).statut, 403);
    assert.equal((await t.appel('GET', '/api/admin/surveillance', undefined, AUTH)).json.blocages[0].auteur, auteur);
    avancer(8);
    assert.equal((await a('POST', `/api/etablissements/${ft.id}/avis`, { note: 2 })).statut, 200); // blocage expiré

    assert.equal((await t.appel('PUT', '/api/admin/moderation', { seuils: { signalementsMasquage: 0 } }, AUTH)).statut, 400);
    assert.equal((await t.appel('PUT', '/api/admin/moderation', { seuils: { inconnu: 3 } }, AUTH)).statut, 400);
    const r = await t.appel('PUT', '/api/admin/moderation', { seuils: { delaiGraceMinutes: 10 } }, AUTH);
    assert.equal(r.json.seuils.delaiGraceMinutes, 10);
    assert.equal((await t.appel('GET', '/api/config')).json.delaiGraceMinutes, 10);
    assert.equal(JSON.parse(fs.readFileSync(path.join(t.dossier, 'config-moderation.json'), 'utf8')).seuils.delaiGraceMinutes, 10);
    await t.appel('PUT', '/api/admin/moderation', { seuils: { delaiGraceMinutes: 30 } }, AUTH);
});

test('Écritures simultanées : un seul avis par navigateur, un seul gagnant sur une même version, aucun ajout perdu', async () => {
    const a = await t.navigateur();
    const { foodtruck: ft } = (await t.appel('POST', '/api/admin/foodtrucks', fiche('Course Truck'), AUTH)).json;
    const avis = await Promise.all([1, 2, 3, 4].map(n => a('POST', `/api/etablissements/${ft.id}/avis`, { note: n })));
    assert.deepEqual(avis.map(r => r.statut).sort(), [200, 200, 200, 201]);
    assert.equal((await t.appel('GET', `/api/etablissements/${ft.id}`)).json.resume.nbAvis, 1);

    const [b, c] = [await t.navigateur(), await t.navigateur()];
    const modifs = await Promise.all([b, c].map((nav, i) => nav('PUT', `/api/etablissements/${ft.id}`, { version: '1', etablissement: { ...ft, prix: String(20 + i) } })));
    assert.deepEqual(modifs.map(r => r.statut).sort(), [200, 409]);

    const avant = (await t.appel('GET', '/api/admin/foodtrucks', undefined, AUTH)).json.length;
    const ajouts = await Promise.all(['Alpha Course', 'Bravo Course', 'Charlie Course'].map(nom => b('POST', '/api/etablissements', fiche(nom))));
    assert.ok(ajouts.every(r => r.statut === 201));
    assert.equal((await t.appel('GET', '/api/admin/foodtrucks', undefined, AUTH)).json.length, avant + 3);
});

test('Fil « Quoi de neuf » : ajouts, modifications, avis, fermetures (sans jeton d\'auteur)', async () => {
    const a = await t.navigateur();
    const { foodtruck: ft } = (await t.appel('POST', '/api/admin/foodtrucks', fiche('Neuf Truck'), AUTH)).json;
    avancer(1 / 1440);
    await a('POST', `/api/etablissements/${ft.id}/avis`, { note: 5, pseudo: 'Dominique' });
    const r = (await t.appel('GET', '/api/quoi-de-neuf')).json;
    assert.deepEqual([r[0].type, r[0].nom, r[0].pseudo, r[0].note], ['avis', 'Neuf Truck', 'Dominique', 5]);
    const types = new Set(r.map(e => e.type));
    for (const type of ['ajout', 'modification', 'avis', 'restauration']) assert.ok(types.has(type), type);
    assert.ok(r.length <= 30);
    assert.ok(r.every((e, i) => i === 0 || r[i - 1].ts >= e.ts));
    assert.ok(!JSON.stringify(r).match(/[0-9a-f]{24}/));
});

test('Contributions comptées par le serveur, sans identifiant de navigateur', async () => {
    await patienter();
    const f = fichierMensuel(t.dossier, 'usage', 'jsonl', new Date());
    const usage = fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
    const contributions = usage.filter(e => ['ajout', 'modification', 'avis', 'presence', 'signalement', 'restauration'].includes(e.type));
    assert.ok(contributions.length > 10);
    assert.ok(contributions.every(e => e.v === null));
    // Le navigateur ne peut pas les envoyer lui-même
    assert.equal((await t.appel('POST', '/api/evenements', { type: 'avis' })).statut, 403);
});

test("Reconstruction de l'état depuis les JSONL après redémarrage, et relecture d'un fichier modifié à la main", async () => {
    const config = charger({ ADMIN_PASSWORD: 'secret-test', STATS_SECRET: 'secret-statistiques-de-test-0123456789', DATA_DIR: t.dossier, BACKUP_DIR: path.join(t.racine, 'sauvegardes') });
    const resumes = async app => {
        const etat = await app.locals.contributions.etat();
        const liste = await app.locals.etablissements.lister();
        return liste.map(ft => ({ id: ft.id, ...app.locals.contributions.resume(etat, ft.id) }));
    };
    const avant = await resumes(t.app);
    const app2 = creerApplication(config, { journal: { log() {}, error() {} }, horloge });
    await app2.locals.stockage.initialiser();
    assert.deepEqual(await resumes(app2), avant);
    assert.deepEqual(await app2.locals.contributions.quoiDeNeuf(), await t.app.locals.contributions.quoiDeNeuf());

    // Ajout d'un avis « à la main » dans le fichier : pris en compte sans redémarrer
    const cible = avant.find(r => r.nbAvis === 0).id;
    await patienter(20); // date de modification différente
    fs.appendFileSync(path.join(t.dossier, 'avis.jsonl'), `${JSON.stringify({ ts: horloge().toISOString(), id: 'mainxx', cible, auteur: 'f'.repeat(24), pseudo: '', note: 5, texte: 'ajouté à la main', criteres: {}, plat: '', action: 'creer' })}\n`
        + 'ligne corrompue\n');
    const vue = (await t.appel('GET', `/api/etablissements/${cible}`)).json;
    assert.equal(vue.resume.nbAvis, 1);
    assert.equal(vue.avis[0].texte, 'ajouté à la main');
});

test('Présences brutes purgées après 13 mois, agrégats conservés ; sauvegarde des nouveaux fichiers', async () => {
    const contributions = t.app.locals.contributions;
    const fichier = path.join(t.dossier, 'presences.jsonl');
    const avant = lignes('presences.jsonl').length;
    fs.appendFileSync(fichier, `${JSON.stringify({ ts: '2024-01-15T11:00:00.000Z', date: '2024-01-15', cible: 'ancien', auteur: 'a'.repeat(24), etat: 'present' })}\n`
        + `${JSON.stringify({ ts: '2024-01-15T11:05:00.000Z', date: '2024-01-15', cible: 'ancien', auteur: 'b'.repeat(24), etat: 'absent' })}\n`);
    const r = await contributions.purgerPresences();
    assert.equal(r.supprimees, 2);
    assert.equal(lignes('presences.jsonl').length, avant);
    const agregats = JSON.parse(fs.readFileSync(path.join(t.dossier, 'stats-presences.json'), 'utf8'));
    assert.deepEqual(agregats.jours['2024-01-15'], { ancien: { present: 1, absent: 1 } });
    assert.equal((await contributions.purgerPresences()).supprimees, 0);

    const { sauvegarderSiNecessaire } = require('../src/sauvegarde');
    const copie = await sauvegarderSiNecessaire(t.config, '2099-01-01');
    for (const nom of ['historique.jsonl', 'avis.jsonl', 'presences.jsonl', 'signalements.jsonl', 'config-moderation.json', 'stats-presences.json']) {
        assert.ok(fs.existsSync(path.join(copie, nom)), nom);
    }
});

test('Validation des avis (unitaire)', () => {
    assert.deepEqual(validerAvis({ note: '4', texte: ' Bon\nplat ', criteres: { qualite_prix: 'bon', portions: '' } }).avis,
        { note: 4, texte: 'Bon plat', criteres: { qualite_prix: 'bon' }, plat: '' });
    assert.ok(validerAvis({ note: 0 }).erreurs);
    assert.ok(validerAvis({ note: 3, texte: 42 }).erreurs);
    assert.ok(validerAvis({ note: 3, plat: 'x'.repeat(61) }).erreurs);
});

test('Migration 3.1.0 -> 3.2.0 : colonne lieux_jours ajoutée, copie du fichier d\'origine, aucune perte', async () => {
    const { dossierTemporaire } = require('./outils');
    const { Stockage } = require('../src/stockage');
    const racine = dossierTemporaire();
    const dossier = path.join(racine, 'data');
    fs.mkdirSync(dossier);
    const csv310 = 'id,nom,type,cuisine,categorie,etiquettes,jours,lieu,horaires,prix,paiements,site,emplacement,statut,cree_le,maj_le,version\n'
        + 'abc234,Moya,foodtruck,Mexicain,Mexicaine,,Mercredi,,11h-14h,10-15,CB,,https://maps.app.goo.gl/m,actif,2026-10-01,2026-10-02,3\n';
    fs.writeFileSync(path.join(dossier, 'foodtrucks.csv'), csv310);
    try {
        const stockage = new Stockage(charger({ DATA_DIR: dossier, BACKUP_DIR: path.join(racine, 's'), STATS_SECRET: 's'.repeat(40) }));
        await stockage.initialiser();
        assert.equal(stockage.migration.migre, true);
        assert.equal(fs.readFileSync(stockage.migration.copies[0], 'utf8'), csv310);
        const [ft] = await stockage.lireFoodtrucks();
        assert.deepEqual([ft.id, ft.nom, ft.version, ft.horaires, ft.cree_le, ft.lieux_jours], ['abc234', 'Moya', '3', '11h-14h', '2026-10-01', '']);
        assert.match(fs.readFileSync(path.join(dossier, 'foodtrucks.csv'), 'utf8').split('\n')[0], /,version,lieux_jours$/);
    } finally {
        fs.rmSync(racine, { recursive: true, force: true });
    }
});
