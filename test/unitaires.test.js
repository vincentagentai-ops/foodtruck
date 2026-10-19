'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parserCSV, serialiserCSV, versFoodtrucks, depuisFoodtrucks } = require('../src/csv');
const { normaliserJours, normaliserPrix, validerFoodtruck } = require('../src/validation');
const { statistiquesUsage, statistiquesAcces, filtrerParDate } = require('../src/statistiques');

const URL_AVEC_VIRGULES = 'https://www.google.fr/maps/place/12+Rue+Michel+Labrousse,+31100+Toulouse/@43.5691689,1.3888636,19.25z';

test('CSV : valeurs avec virgules et guillemets (aller-retour)', () => {
    const lignes = [['Rovès\' Truck', 'Tarn "maison"', 'Jeudi', URL_AVEC_VIRGULES, '10-15', '']];
    const texte = serialiserCSV(lignes);
    assert.match(texte, /"Tarn ""maison"""/);
    assert.deepEqual(parserCSV(texte), lignes);
});

test('CSV : lignes vides, \\r\\n, BOM et absence de saut de ligne final', () => {
    const texte = '﻿Nom,Cuisine,Jours,Emplacement,Prix,Site\r\nA,B,Lundi,https://a,,\r\n\r\n\nC,D,Mardi,https://c,12,https://d';
    const fts = versFoodtrucks(texte);
    assert.equal(fts.length, 2);
    assert.equal(fts[1].site, 'https://d');
    assert.equal(fts[0].prix, '');
});

test("CSV : fichier sans en-tête (ancien foodtruckAValider.csv)", () => {
    const fts = versFoodtrucks('Saveur de Corée,Coréen,Jeudi,https://x,7-13,');
    assert.equal(fts.length, 1);
    assert.equal(fts[0].nom, 'Saveur de Corée');
});

test("CSV : l'écriture ajoute l'en-tête et un saut de ligne final unique", () => {
    const texte = depuisFoodtrucks([{ nom: 'A', cuisine: 'B', jours: 'Lundi', emplacement: 'https://a', prix: '', site: '' }], true);
    assert.equal(texte, 'Nom,Cuisine,Jours,Emplacement,Prix,Site\nA,B,Lundi,https://a,,\n');
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

test('Validation : suggestion correcte', () => {
    const { foodtruck, erreurs } = validerFoodtruck({
        nom: ' Moya ', cuisine: 'Mexicain', jours: 'mercredi', emplacement: URL_AVEC_VIRGULES, prix: '10 à 15', site: '',
    });
    assert.deepEqual(erreurs, []);
    assert.equal(foodtruck.nom, 'Moya');
    assert.equal(foodtruck.jours, 'Mercredi');
    assert.equal(foodtruck.prix, '10-15');
});

test('Validation : erreurs (champs manquants, URL, week-end, formule Excel, saut de ligne)', () => {
    const { foodtruck, erreurs } = validerFoodtruck({ nom: '=HYPERLINK("x")', cuisine: '', jours: 'samedi', emplacement: 'javascript:alert(1)', site: 'pas une url' });
    assert.ok(erreurs.length >= 5, erreurs.join('\n'));
    assert.equal(validerFoodtruck({ nom: 'A\nB' }).foodtruck.nom, 'A B');
    assert.equal(foodtruck.jours, '');
});

test('Statistiques usage : jours, tris, actions séparées (mail ≠ génération CSV)', () => {
    const s = statistiquesUsage([
        { event: 'Jour sélectionné : Mardi' },
        { event: 'Jour sélectionné : Mardi' },
        { event: 'Jour sélectionné : ' },
        { event: 'Tri sur la colonne : Prix' },
        { event: "Clic sur l'envoi de mail" },
        { event: 'Clic sur generer CSV' },
        { event: 'Clic sur envoyer foodtruck : succès' },
        { event: 'Consultation : Moya' },
    ]);
    assert.equal(s.jours.Mardi, 2);
    assert.equal(s.tris.Prix, 1);
    assert.equal(s.actions['Clic sur « Envoyez-moi un mail »'], 1);
    assert.equal(s.actions['Génération de ligne CSV (ancienne page)'], 1);
    assert.equal(s.actions['Suggestion envoyée'], 1);
    assert.equal(s.foodtrucksConsultes.Moya, 1);
});

test('Statistiques accès : ignore les anciennes lignes « duration » et compte les pages', () => {
    const s = statistiquesAcces([
        { timestamp: '2025-02-12T10:00:00Z', ip: '1', url: '/', method: 'GET', userAgent: 'Chrome/131' },
        { timestamp: '2025-02-12T10:00:00Z', ip: '1', duration: '0.002s' },
        { timestamp: '2025-02-12T10:01:00Z', ip: '2', url: '/api/log', method: 'POST' },
        { timestamp: '2025-02-13T10:01:00Z', ip: '2', url: '/index.html', method: 'GET', userAgent: 'Firefox/120' },
    ]);
    assert.equal(s.totalRequetes, 3);
    assert.equal(s.pagesVues, 2);
    assert.equal(s.visiteursUniques, 2);
    assert.deepEqual(s.visiteursParDate, { '2025-02-12': 2, '2025-02-13': 1 });
    assert.equal(s.pagesVuesParPage['/index.html'], 2);
    assert.deepEqual(s.navigateurs, { Chrome: 1, Firefox: 1 });
});

test('Filtre par date (bornes incluses)', () => {
    const e = [{ timestamp: '2025-02-10T12:00:00' }, { timestamp: '2025-02-12T12:00:00' }, { timestamp: '2025-02-14T12:00:00' }, {}];
    assert.equal(filtrerParDate(e, '2025-02-12', '2025-02-14').length, 2);
    assert.equal(filtrerParDate(e).length, 3);
});
