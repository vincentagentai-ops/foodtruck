'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parserCSV, serialiserCSV, versFoodtrucks, depuisFoodtrucks, versLieux, COLONNES } = require('../src/csv');
const {
    normaliserJours, normaliserPrix, normaliserListe, validerFoodtruck, validerLieu, categorieDepuisCuisine, PAIEMENTS, slug,
} = require('../src/validation');
const { lireTrustProxy } = require('../src/config');
const { Limiteur } = require('../src/limites');
const { renommerAvecReessais } = require('../src/stockage');
const audience = require('../src/audience');

const URL_AVEC_VIRGULES = 'https://www.google.fr/maps/place/12+Rue+Michel+Labrousse,+31100+Toulouse/@43.5691689,1.3888636,19.25z';

test('CSV : valeurs avec virgules et guillemets (aller-retour)', () => {
    const lignes = [['Rovès\' Truck', 'Tarn "maison"', 'Jeudi', URL_AVEC_VIRGULES, '10-15', '']];
    const texte = serialiserCSV(lignes);
    assert.match(texte, /"Tarn ""maison"""/);
    assert.deepEqual(parserCSV(texte), lignes);
});

test('CSV : lignes vides, \\r\\n, BOM et absence de saut de ligne final (ancien format)', () => {
    const texte = '﻿Nom,Cuisine,Jours,Emplacement,Prix,Site\r\nA,B,Lundi,https://a,,\r\n\r\n\nC,D,Mardi,https://c,12,https://d';
    const fts = versFoodtrucks(texte);
    assert.equal(fts.length, 2);
    assert.equal(fts[1].site, 'https://d');
    assert.equal(fts[0].prix, '');
    assert.equal(fts[0].id, ''); // colonnes absentes de l'ancien fichier : lues comme vides
    assert.equal(fts[0].paiements, '');
});

test("CSV : fichier sans en-tête (ancien foodtruckAValider.csv)", () => {
    const fts = versFoodtrucks('Saveur de Corée,Coréen,Jeudi,https://x,7-13,');
    assert.equal(fts.length, 1);
    assert.equal(fts[0].nom, 'Saveur de Corée');
    assert.equal(fts[0].emplacement, 'https://x');
});

test("CSV : colonnes retrouvées par leur nom, dans n'importe quel ordre", () => {
    const fts = versFoodtrucks('nom,id,Minutes inconnues,prix\nA,abc,x,12\n');
    assert.equal(fts[0].id, 'abc');
    assert.equal(fts[0].prix, '12');
    assert.equal(versLieux('ID,Nom,Minutes à pied\np,Parking,3\n')[0].minutes_a_pied, '3');
});

test("CSV : l'écriture produit l'en-tête complet et un saut de ligne final unique", () => {
    const texte = depuisFoodtrucks([{ id: 'a1', nom: 'A', cuisine: 'B', jours: 'Lundi' }]);
    const [entete, ligne] = texte.split('\n');
    assert.equal(entete, COLONNES.join(','));
    assert.equal(ligne.split(',').length, COLONNES.length);
    assert.ok(texte.endsWith('\n') && !texte.endsWith('\n\n'));
});

test('Jours : séparateurs variés, accents, doublons, ordre de la semaine', () => {
    assert.deepEqual(normaliserJours('jeudi, Lundi et mardi;JEUDI').jours, ['Lundi', 'Mardi', 'Jeudi']);
    assert.deepEqual(normaliserJours('Mercredi').jours, ['Mercredi']);
    assert.deepEqual(normaliserJours('samedi lundi').invalides, ['samedi']);
});

test('Prix : normalisation', () => {
    assert.equal(normaliserPrix('10 à 15 €'), '10-15');
    assert.equal(normaliserPrix('12€'), '12');
    assert.equal(normaliserPrix('7 - 12'), '7-12');
    assert.equal(normaliserPrix(''), '');
});

test('Listes fermées : paiements reconnus sans tenir compte de la casse ni des accents', () => {
    const r = normaliserListe('cb;titres restaurant CARTE;especes;chèque', PAIEMENTS);
    assert.deepEqual(r.valeurs, ['Titres-restaurant carte', 'CB', 'Espèces']);
    assert.deepEqual(r.invalides, ['chèque']);
});

test('Catégorie déduite du libellé libre (Autre sinon)', () => {
    assert.equal(categorieDepuisCuisine(' Coréen'), 'Asiatique');
    assert.equal(categorieDepuisCuisine('Thailandais'), 'Asiatique');
    assert.equal(categorieDepuisCuisine('Pizza roulée'), 'Italienne / Pizza');
    assert.equal(categorieDepuisCuisine('Tartines / Cuisine maison'), 'Sandwichs / Bagels');
    assert.equal(categorieDepuisCuisine('Salad bar'), 'Salades');
    assert.equal(categorieDepuisCuisine('Fusion moléculaire'), 'Autre');
});

test('Validation : établissement correct (nouveaux champs)', () => {
    const { foodtruck, erreurs } = validerFoodtruck({
        nom: ' Moya ', type: 'Restaurant', cuisine: 'Mexicain', jours: 'mercredi', emplacement: URL_AVEC_VIRGULES,
        prix: '10 à 15', site: '', paiements: 'CB;Titres-restaurant papier', etiquettes: 'végétarien possible', horaires: '11h30-14h',
    });
    assert.deepEqual(erreurs, []);
    assert.equal(foodtruck.nom, 'Moya');
    assert.equal(foodtruck.type, 'restaurant');
    assert.equal(foodtruck.categorie, 'Mexicaine');
    assert.equal(foodtruck.jours, 'Mercredi');
    assert.equal(foodtruck.prix, '10-15');
    assert.equal(foodtruck.paiements, 'Titres-restaurant papier;CB');
    assert.equal(foodtruck.etiquettes, 'Végétarien possible');
    assert.equal(foodtruck.statut, 'actif');
});

test("Validation : l'emplacement Maps devient facultatif si un lieu est renseigné", () => {
    const base = { nom: 'A', cuisine: 'B', jours: 'Lundi' };
    assert.ok(validerFoodtruck(base).erreurs.some(e => /lieu ou l'emplacement/.test(e)));
    assert.deepEqual(validerFoodtruck({ ...base, lieu: 'parking' }, { lieux: ['parking'] }).erreurs, []);
    assert.ok(validerFoodtruck({ ...base, lieu: 'inconnu' }, { lieux: ['parking'] }).erreurs.some(e => /Lieu inconnu/.test(e)));
});

test('Validation : erreurs (champs manquants, URL, week-end, formule Excel, listes, statut)', () => {
    const { foodtruck, erreurs } = validerFoodtruck({
        nom: '=HYPERLINK("x")', cuisine: '', jours: 'samedi', emplacement: 'javascript:alert(1)', site: 'pas une url',
        paiements: 'chèque', categorie: 'Martienne', statut: 'supprime', type: 'camion', horaires: '@SUM(1)',
    });
    assert.ok(erreurs.length >= 10, erreurs.join('\n'));
    assert.equal(validerFoodtruck({ nom: 'A\nB' }).foodtruck.nom, 'A B');
    assert.equal(foodtruck.jours, '');
});

test('Validation des lieux et identifiant lisible', () => {
    assert.deepEqual(validerLieu({ nom: 'Parking Nord', minutes_a_pied: '3', maps: 'https://maps.app.goo.gl/x' }).erreurs, []);
    assert.equal(validerLieu({ nom: '', minutes_a_pied: 'trois', maps: 'x' }).erreurs.length, 3);
    assert.equal(slug("Place de l'Église"), 'place-de-l-eglise');
});

test('TRUST_PROXY : loopback, IP, liste ; « true » accepté avec avertissement ; valeur invalide ignorée', () => {
    assert.deepEqual(lireTrustProxy(''), { valeur: false, avertissements: [] });
    assert.deepEqual(lireTrustProxy('false').valeur, false);
    assert.deepEqual(lireTrustProxy('loopback').valeur, ['loopback']);
    assert.deepEqual(lireTrustProxy('10.0.0.5, 192.168.0.0/16').valeur, ['10.0.0.5', '192.168.0.0/16']);
    const vrai = lireTrustProxy('true');
    assert.equal(vrai.valeur, true);
    assert.match(vrai.avertissements[0], /falsifi/);
    const invalide = lireTrustProxy('loopback, mon-proxy');
    assert.equal(invalide.valeur, false);
    assert.match(invalide.avertissements[0], /mon-proxy/);
});

test('Limites de fréquence : par clé, facteur pour l\'IP, fenêtre glissée', () => {
    let t = 0;
    const l = new Limiteur({ max: 3, fenetreMs: 1000, maintenant: () => t });
    const cles = v => [{ cle: 'ip:1', facteur: 2 }, { cle: `v:${v}` }];
    assert.ok(l.autoriser(cles('a')) && l.autoriser(cles('a')) && l.autoriser(cles('a')));
    assert.equal(l.autoriser(cles('a')), false); // 4e requête du même navigateur
    assert.ok(l.autoriser(cles('b')) && l.autoriser(cles('b'))); // autre navigateur, même IP : 6 au total
    assert.equal(l.autoriser(cles('c')), false); // l'IP dépasse 3 × 2
    t = 1000;
    assert.ok(l.autoriser(cles('a'))); // nouvelle fenêtre
    assert.ok(new Limiteur({ max: 0 }).autoriser(cles('a'))); // 0 = désactivé
});

test('Renommage : réessais sur EBUSY/EPERM puis succès ; autre erreur immédiate', async () => {
    let essais = 0;
    const renommer = async () => {
        essais++;
        if (essais < 3) throw Object.assign(new Error('verrouillé'), { code: essais === 1 ? 'EBUSY' : 'EPERM' });
    };
    await renommerAvecReessais('a', 'b', { renommer, delais: [1, 1, 1] });
    assert.equal(essais, 3);

    essais = 0;
    const toujours = async () => { essais++; throw Object.assign(new Error('verrouillé'), { code: 'EACCES' }); };
    await assert.rejects(renommerAvecReessais('a', 'b', { renommer: toujours, delais: [1, 1] }), /verrouillé/);
    assert.equal(essais, 3); // 1 essai + 2 réessais

    essais = 0;
    const absent = async () => { essais++; throw Object.assign(new Error('absent'), { code: 'ENOENT' }); };
    await assert.rejects(renommerAvecReessais('a', 'b', { renommer: absent, delais: [1, 1] }), /absent/);
    assert.equal(essais, 1);
});

test('Audience : chemins normalisés et exclusions', () => {
    assert.equal(audience.normaliserChemin('/'), '/index.html');
    assert.equal(audience.normaliserChemin('/INDEX.html?x=1'), '/index.html');
    assert.equal(audience.normaliserChemin('/%61dmin/index.html'), '/admin/index.html');
    assert.ok(audience.estExclu(audience.normaliserChemin('/%41DMIN/')));
    const ua = 'Mozilla/5.0 Chrome/131.0';
    const vue = (o) => audience.estPageVue({ methode: 'GET', chemin: '/index.html', statut: 200, ua, ...o });
    assert.ok(vue({}));
    assert.ok(vue({ statut: 304 }));
    assert.equal(vue({ statut: 404 }), false);
    assert.equal(vue({ statut: 301 }), false);
    assert.equal(vue({ chemin: '/admin/index.html' }), false);
    assert.equal(vue({ chemin: '/api/foodtrucks' }), false);
    assert.equal(vue({ methode: 'POST' }), false);
    assert.equal(vue({ ua: 'Googlebot/2.1' }), false);
    assert.equal(vue({ ua: 'curl/8.0' }), false);
    assert.equal(vue({ ua: '' }), false);
});

test('Audience : évènements en liste blanche, types serveur refusés, anciens libellés', () => {
    assert.deepEqual(audience.validerEvenement({ type: 'clic_maps', cible: 'abc123', page: '/' }).evenement,
        { type: 'clic_maps', cible: 'abc123', page: '/index.html' });
    assert.equal(audience.validerEvenement({ type: 'inconnu' }).statut, 400);
    assert.equal(audience.validerEvenement({ type: 'suggestion' }).statut, 403);
    assert.equal(audience.validerEvenement({ type: 'admin_ajout' }).statut, 403);
    assert.equal(audience.validerEvenement({ type: 'page_vue' }).statut, 403);
    assert.equal(audience.validerEvenement({ type: 'filtre', cible: { a: 1 } }).statut, 400);
    assert.equal(audience.validerEvenement({ type: 'recherche', cible: 'x'.repeat(500) }).evenement.cible.length, 80);
    assert.equal(audience.ancienLibelleAccepte('Admin clic sur Valider foodtruck : X'), false);
    assert.equal(audience.ancienLibelleAccepte('Ajout de : X'), false);
    assert.equal(audience.ancienLibelleAccepte('Jour sélectionné : Mardi'), true);
    assert.deepEqual(audience.convertirAncienLibelle('Jour sélectionné : Mardi'), { type: 'jour_ancien', cible: 'Mardi' });
    assert.equal(audience.convertirAncienLibelle('Clic sur envoyer foodtruck : succès').type, 'suggestion');
    assert.equal(audience.convertirAncienLibelle('Clic sur envoyer foodtruck : succès', { recu: true }).type, 'ancien');
});

test('Audience : identifiant de navigateur (128 bits) et HMAC', () => {
    const id = audience.nouvelIdNavigateur();
    assert.ok(audience.idValide(id));
    assert.equal(Buffer.from(id, 'base64url').length, 16);
    assert.equal(audience.idValide('court'), false);
    const h = audience.hacher('secret', id);
    assert.match(h, /^[0-9a-f]{32}$/);
    assert.notEqual(h, audience.hacher('autre-secret', id));
    assert.equal(h, audience.hacher('secret', id));
});
