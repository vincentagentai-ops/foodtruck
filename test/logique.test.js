'use strict';

// Logique de la page d'accueil (public/js/logique.js, partagée avec le navigateur) : filtres, « Au hasard » avec
// exclusions, liens partageables, texte « Copier pour Teams », carnet, préférences, plan.

const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../public/js/logique');

const MOYA = { id: 'moya01', nom: 'Moya', categorie: 'Mexicain', cuisine: 'Tacos', type: 'foodtruck', prix: '10-14', jours: 'Mercredi;Jeudi',
    etiquettes: 'Végétarien possible', paiements: 'CB;Titres-restaurant carte', lieu: 'parking-nord', lieux_jours: 'Jeudi=place-marche' };
const TUK = { id: 'tuk002', nom: 'Ô Tuk Tuk', categorie: 'Asiatique', cuisine: 'Thaï', type: 'foodtruck', prix: '10-15', jours: 'Mercredi',
    etiquettes: 'Halal;Végétarien possible', paiements: 'CB', lieu: 'parking-nord', lieux_jours: '' };
const BISTROT = { id: 'bis003', nom: 'Le Bistrot', categorie: 'Française', cuisine: 'Bistrot', type: 'restaurant', prix: '', jours: 'Lundi;Mardi;Mercredi;Jeudi;Vendredi',
    etiquettes: '', paiements: 'Espèces', lieu: '', lieux_jours: '' };
const TOUS = [MOYA, TUK, BISTROT];
const LIEUX = { 'parking-nord': { id: 'parking-nord', nom: 'Parking Nord' }, 'place-marche': { id: 'place-marche', nom: 'Place du marché' } };
const ids = liste => liste.map(ft => ft.id);
const filtrer = contexte => ids(TOUS.filter(ft => L.correspond(ft, { lieux: LIEUX, jour: 'Mercredi', ...contexte })));

test('Filtres : cuisine, type, prix, régime, paiement, combinés', () => {
    assert.deepEqual(filtrer({}), ['moya01', 'tuk002', 'bis003']);
    assert.deepEqual(filtrer({ filtres: { categorie: 'Asiatique' } }), ['tuk002']);
    assert.deepEqual(filtrer({ filtres: { type: 'restaurant' } }), ['bis003']);
    assert.deepEqual(filtrer({ filtres: { prixMax: '10' } }), ['moya01', 'tuk002']); // prix inconnu : écarté
    assert.deepEqual(filtrer({ filtres: { prixMax: '8' } }), []);
    assert.deepEqual(filtrer({ filtres: { etiquette: 'Halal' } }), ['tuk002']);
    assert.deepEqual(filtrer({ filtres: { paiement: 'CB', etiquette: 'Végétarien possible', categorie: 'Mexicain' } }), ['moya01']);
});

test('Recherche : sans accents ni majuscules, tous les mots, nom du lieu du jour', () => {
    assert.deepEqual(filtrer({ recherche: 'THAI' }), ['tuk002']);
    assert.deepEqual(filtrer({ recherche: 'vegetarien cb' }), ['moya01', 'tuk002']);
    assert.deepEqual(filtrer({ recherche: 'parking' }), ['moya01', 'tuk002']);
    // Le jeudi, Moya est sur la place du marché
    assert.deepEqual(ids(TOUS.filter(ft => L.correspond(ft, { lieux: LIEUX, jour: 'Jeudi', recherche: 'marche' }))), ['moya01']);
});

test('Filtre « Essayé ? » : pas encore essayé, à tester, déjà essayé (marques et carnet)', () => {
    const marques = { moya01: 'essaye', bis003: 'a_tester' };
    const carnet = [{ id: 'tuk002', nom: 'Ô Tuk Tuk', date: '2026-10-12' }];
    assert.deepEqual(filtrer({ filtres: { essai: 'pas_essaye' }, marques }), ['tuk002', 'bis003']);
    assert.deepEqual(filtrer({ filtres: { essai: 'pas_essaye' }, marques, carnet }), ['bis003']);
    assert.deepEqual(filtrer({ filtres: { essai: 'essaye' }, marques, carnet }), ['moya01', 'tuk002']);
    assert.deepEqual(filtrer({ filtres: { essai: 'a_tester' }, marques, carnet }), ['bis003']);
    assert.ok(L.filtresActifs({ essai: 'pas_essaye' }));
    assert.ok(!L.filtresActifs({ ...L.FILTRES_VIDES }));
    assert.ok(L.memesFiltres({ categorie: 'Asiatique' }, { ...L.FILTRES_VIDES, categorie: 'Asiatique' }));
    assert.deepEqual(L.nettoyerFiltres({ essai: 'n_importe', prixMax: 'abc', categorie: 'Asiatique', inconnu: 'x' }),
        { ...L.FILTRES_VIDES, categorie: 'Asiatique' });
});

test('Au hasard : parmi la liste, option « que je n\'ai pas essayé », sans retomber sur le tirage précédent', () => {
    const premier = () => 0;
    const dernier = () => 0.9999;
    assert.equal(L.tirerAuHasard(TOUS, { aleatoire: premier }).id, 'moya01');
    assert.equal(L.tirerAuHasard(TOUS, { aleatoire: dernier }).id, 'bis003');
    assert.equal(L.tirerAuHasard([], {}), null);
    // Exclusions : déjà essayé (marque ou carnet)
    const marques = { moya01: 'essaye', tuk002: 'a_tester' };
    const carnet = [{ id: 'bis003', nom: 'Le Bistrot', date: '2026-10-01' }];
    assert.equal(L.tirerAuHasard(TOUS, { nonEssaye: true, marques, aleatoire: premier }).id, 'tuk002');
    assert.equal(L.tirerAuHasard(TOUS, { nonEssaye: true, marques, carnet }).id, 'tuk002');
    assert.equal(L.tirerAuHasard(TOUS, { nonEssaye: true, marques: { moya01: 'essaye', tuk002: 'essaye' }, carnet }), null);
    // Le tirage précédent est écarté… sauf s'il est le seul candidat
    assert.equal(L.tirerAuHasard(TOUS, { exclure: ['moya01'], aleatoire: premier }).id, 'tuk002');
    assert.equal(L.tirerAuHasard([MOYA], { exclure: ['moya01'] }).id, 'moya01');
    // Répartition : chaque candidat peut sortir
    const vus = new Set();
    for (let i = 0; i < 300; i++) vus.add(L.tirerAuHasard(TOUS).id);
    assert.equal(vus.size, 3);
});

test('Liens partageables : construction (ordre stable, valeurs par défaut omises) et lecture', () => {
    assert.equal(L.construireLien({}), '');
    assert.equal(L.construireLien({ tri: 'lieu', filtres: { ...L.FILTRES_VIDES } }), '');
    const lien = L.construireLien({
        jour: 'Jeudi', recherche: 'thaï épicé', filtres: { categorie: 'Asiatique', prixMax: '12', essai: 'pas_essaye' }, tri: 'prix', fiche: 'tuk002',
    });
    assert.equal(lien, '?jour=jeudi&q=tha%C3%AF+%C3%A9pic%C3%A9&categorie=Asiatique&prix=12&essai=pas_essaye&tri=prix&fiche=tuk002');
    const lu = L.lireLien(lien);
    assert.deepEqual(lu, {
        jour: 'Jeudi', vue: '', recherche: 'thaï épicé', filtres: { categorie: 'Asiatique', prixMax: '12', essai: 'pas_essaye' },
        tri: 'prix', fiche: 'tuk002', present: true,
    });
    // Aller-retour
    assert.equal(L.construireLien(lu), lien);
    assert.equal(L.construireLien({ vue: 'semaine', filtres: { type: 'restaurant' } }), '?vue=semaine&type=restaurant');
    assert.deepEqual(L.lireLien('?vue=semaine'), { jour: '', vue: 'semaine', recherche: '', filtres: {}, tri: '', fiche: '', present: true });
});

test('Liens partageables : valeurs inconnues ou dangereuses ignorées', () => {
    assert.equal(L.lireLien('').present, false);
    assert.equal(L.lireLien('?utm=x&autre=1').present, false);
    const lu = L.lireLien('?jour=samedi&tri=hasard&prix=douze&essai=tout&fiche=<script>&vue=mois&q=' + 'a'.repeat(200));
    assert.equal(lu.jour, '');
    assert.equal(lu.tri, '');
    assert.equal(lu.fiche, '');
    assert.equal(lu.vue, '');
    assert.deepEqual(lu.filtres, {});
    assert.equal(lu.recherche.length, 80);
    assert.equal(L.lireLien('?jour=MERCREDI').jour, 'Mercredi');
    assert.equal(L.lireLien('jour=vendredi').jour, 'Vendredi');
});

test('« Copier pour Teams » : texte prêt à coller', () => {
    assert.equal(L.texteTeams(TUK, { lieu: 'Parking Nord', presence: { presents: 2, derniere: '11h40' } }),
        'Midi : Ô Tuk Tuk (asiatique, 10–15 €), Parking Nord, confirmé à 11h40 — on y va ?');
    // Sans confirmation ni lieu ; prix inconnu ; lien sur une seconde ligne
    assert.equal(L.texteTeams(BISTROT, { presence: { presents: 0, derniere: '' }, lien: 'http://foodtrucks/?fiche=bis003' }),
        'Midi : Le Bistrot (française) — on y va ?\nhttp://foodtrucks/?fiche=bis003');
    assert.equal(L.texteTeams({ nom: 'X', categorie: 'Autre', cuisine: 'Crêpes', prix: '7' }), 'Midi : X (crêpes, 7 €) — on y va ?');
    assert.equal(L.texteTeams({ nom: 'Y' }), 'Midi : Y — on y va ?');
    assert.equal(L.prixCourt('7 à 12 €'), '7–12 €');
});

test('Carnet : une entrée par jour et par établissement, plus récentes d\'abord, résumé, effacement d\'une entrée', () => {
    let carnet = [];
    carnet = L.ajouterAuCarnet(carnet, { id: 'moya01', nom: 'Moya', date: '2026-10-12' });
    carnet = L.ajouterAuCarnet(carnet, { id: 'tuk002', nom: 'Ô Tuk Tuk', date: '2026-10-14' });
    carnet = L.ajouterAuCarnet(carnet, { id: 'moya01', nom: 'Moya', date: '2026-10-12' }); // doublon
    carnet = L.ajouterAuCarnet(carnet, { id: 'moya01', nom: 'Moya', date: '2026-10-16' });
    assert.deepEqual(carnet.map(e => `${e.date} ${e.id}`), ['2026-10-16 moya01', '2026-10-14 tuk002', '2026-10-12 moya01']);
    assert.deepEqual(L.resumeCarnet(carnet, { bis003: 'essaye', autre: 'a_tester' }), { repas: 3, adresses: 3 });
    carnet = L.retirerDuCarnet(carnet, 'moya01', '2026-10-12');
    assert.equal(carnet.length, 2);
    assert.deepEqual(L.nettoyerCarnet([null, { id: 'a', date: 'hier' }, { id: 'b', nom: 'B', date: '2026-01-02', x: 1 }, 'x']),
        [{ id: 'b', nom: 'B', date: '2026-01-02' }]);
    assert.deepEqual(L.nettoyerCarnet('corrompu'), []);
    // Taille limitée
    let gros = [];
    for (let i = 0; i < L.CARNET_MAX + 10; i++) gros = L.ajouterAuCarnet(gros, { id: `id${i}`, nom: '', date: '2026-01-01' });
    assert.equal(gros.length, L.CARNET_MAX);
});

test('Marques : bascule (même bouton = retrait), fiches fusionnées et établissements disparus', () => {
    let m = L.basculerMarque({}, 'moya01', 'a_tester');
    assert.deepEqual(m, { moya01: 'a_tester' });
    m = L.basculerMarque(m, 'moya01', 'essaye');
    assert.deepEqual(m, { moya01: 'essaye' });
    assert.deepEqual(L.basculerMarque(m, 'moya01', 'essaye'), {});
    assert.deepEqual(L.basculerMarque(m, 'moya01', 'inconnue'), {});
    const r = L.suivreAlias({ marques: { ancien: 'essaye', moya01: 'a_tester', parti: 'essaye' }, carnet: [{ id: 'ancien', nom: 'A', date: '2026-01-01' }] },
        { ancien: 'moya01' }, new Set(['moya01', 'tuk002']));
    assert.deepEqual(r.marques, { moya01: 'essaye' });
    assert.equal(r.carnet[0].id, 'moya01');
});

test('Préférences : filtres par défaut nettoyés, étiquettes privilégiées', () => {
    assert.deepEqual(L.nettoyerPreferences(null), { filtres: { ...L.FILTRES_VIDES }, privilegier: [] });
    const p = L.nettoyerPreferences({ filtres: { etiquette: 'Halal', prixMax: 12, x: 1 }, privilegier: ['Halal', 3, 'Végétarien possible'] });
    assert.deepEqual(p.filtres, { ...L.FILTRES_VIDES, etiquette: 'Halal', prixMax: '12' });
    assert.deepEqual(p.privilegier, ['Halal', 'Végétarien possible']);
    assert.equal(L.scorePreference(TUK, p.privilegier), 2);
    assert.equal(L.scorePreference(MOYA, p.privilegier), 1);
    assert.equal(L.scorePreference(BISTROT, p.privilegier), 0);
    assert.equal(L.scorePreference(TUK, []), 0);
});

test('Plan : numérotation des lieux du jour dans l\'ordre de la liste, positions valides', () => {
    assert.deepEqual(L.numeroterLieux(['parking-nord', '', 'place-marche', 'parking-nord']), { 'parking-nord': 1, 'place-marche': 2 });
    assert.ok(L.positionValide({ x: 0, y: 100 }));
    assert.ok(!L.positionValide({ x: -1, y: 5 }));
    assert.ok(!L.positionValide({ x: '5', y: 5 }));
    assert.ok(!L.positionValide(null));
});

test('Jour de la semaine et lieu du jour', () => {
    assert.equal(L.jourDeLaSemaine(new Date(2026, 9, 15)), 'Jeudi');
    assert.equal(L.jourDeLaSemaine(new Date(2026, 9, 18)), null); // dimanche
    assert.equal(L.lieuDuJour(MOYA, 'Jeudi'), 'place-marche');
    assert.equal(L.lieuDuJour(MOYA, 'Mercredi'), 'parking-nord');
    assert.deepEqual(L.lireLieuxJours('Jeudi=https://maps.example/?a=1;b=2;Vendredi=x'), { Jeudi: 'https://maps.example/?a=1;b=2', Vendredi: 'x' });
});
