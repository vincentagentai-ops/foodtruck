'use strict';

// Migration du CSV, agrégats statistiques, purge des journaux et sauvegarde quotidienne
// (dossiers temporaires et dates simulées).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { charger } = require('../src/config');
const { Stockage } = require('../src/stockage');
const { parserCSV, ANCIENNES_COLONNES } = require('../src/csv');
const {
    Statistiques, calculerAgregats, construireStatistiques, semaine, moinsMois,
} = require('../src/statistiques');
const { sauvegarderSiNecessaire, rotation } = require('../src/sauvegarde');
const { maintenanceQuotidienne } = require('../src/maintenance');
const { dossierTemporaire } = require('./outils');

const SILENCE = { log() {}, error() {} };

function environnement(fichiers = {}) {
    const racine = dossierTemporaire();
    const dossier = path.join(racine, 'data');
    fs.mkdirSync(dossier);
    for (const [nom, contenu] of Object.entries(fichiers)) fs.writeFileSync(path.join(dossier, nom), contenu);
    const config = charger({ DATA_DIR: dossier, BACKUP_DIR: path.join(racine, 'sauvegardes'), STATS_SECRET: 's'.repeat(40) });
    const stockage = new Stockage(config);
    return { racine, dossier, config, stockage, nettoyer: () => fs.rmSync(racine, { recursive: true, force: true }) };
}

// --- Migration

const CSV_3_0_0 = [
    'Nom,Cuisine,Jours,Emplacement,Prix,Site',
    'Neki Neko,Japonais,Mardi,https://maps.app.goo.gl/CBVJ7CwHx8bk3SFk8,10-15,https://nekinekofood31.wixsite.com/site',
    "L'épicurieux,Bagel,Mercredi,https://maps.app.goo.gl/V6bXfQe4PXJ1y4s76,12,https://www.lepicurieux.net/",
    "L'épicurieux,Bagel,Jeudi,https://maps.app.goo.gl/tD6EdmYzDJneNAGh9,12,https://www.lepicurieux.net/",
    'Bibim Pop, Coréen,Lundi;Mardi;Mercredi;Jeudi;Vendredi,https://maps.app.goo.gl/zRiMijYwyYRWGxnU8,7 à 12,https://www.bibimpop.fr/',
    '"Tarn ""maison""",Tartines / Cuisine maison,Mardi,"https://www.google.fr/maps/place/12+Rue,+31100+Toulouse/@43.5,1.38,19z",,',
    'Spice Box,Indien,Lundi,https://maps.app.goo.gl/rDjvEgcabAxqhwJh6,,https://www.spicebox.fr/general-3',
].join('\r\n'); // fins de ligne Windows, pas de saut final

test('Migration 3.0.0 -> 3.1.0 : aucune perte, aucune fusion, copie de sauvegarde, identifiants stables', async () => {
    const e = environnement({ 'foodtrucks.csv': CSV_3_0_0, 'foodtruckAValider.csv': 'Saveur de Corée,Coréen,Jeudi,https://x,7-13,' });
    try {
        await e.stockage.initialiser();
        const { migration } = e.stockage;
        assert.equal(migration.migre, true);
        // Copie de sauvegarde identique à l'original, faite avant la réécriture
        const copie = migration.copies.find(c => path.basename(c).startsWith('foodtrucks-avant-migration-'));
        assert.ok(copie);
        assert.equal(fs.readFileSync(copie, 'utf8'), CSV_3_0_0);
        assert.ok(migration.copies.some(c => path.basename(c).startsWith('foodtruckAValider-avant-migration-')));

        // Aucune perte : chaque valeur d'origine est retrouvée, dans le même ordre (doublons non fusionnés)
        const origine = parserCSV(CSV_3_0_0).slice(1);
        const migres = await e.stockage.lireFoodtrucks();
        assert.equal(migres.length, origine.length);
        origine.forEach((ligne, i) => {
            ANCIENNES_COLONNES.forEach((col, j) => assert.equal(migres[i][col], ligne[j].trim(), `${i} ${col}`));
        });
        const ids = migres.map(ft => ft.id);
        assert.equal(new Set(ids).size, ids.length);
        assert.deepEqual([...new Set(migres.map(ft => ft.statut))], ['actif']);
        assert.equal(migres[3].categorie, 'Asiatique');
        assert.equal(migres[4].nom, 'Tarn "maison"');
        assert.equal(migres[4].categorie, 'Sandwichs / Bagels');
        assert.ok(migres.every(ft => ft.lieu === '' && ft.cree_le === '' && ft.version === '1' && ft.type === 'foodtruck'));
        assert.equal((await e.stockage.lireAValider())[0].nom, 'Saveur de Corée');
        assert.ok(fs.existsSync(e.config.fichierLieux));

        // Redémarrage : rien à migrer, identifiants inchangés
        const s2 = new Stockage(e.config);
        await s2.initialiser();
        assert.equal(s2.migration.migre, false);
        assert.deepEqual((await s2.lireFoodtrucks()).map(ft => ft.id), ids);

        // Modification puis ligne ajoutée à la main dans Excel (sans identifiant) : nouvelle copie,
        // identifiant attribué à la nouvelle ligne seulement
        await s2.modifier(e.config.fichierFoodtrucks, liste => liste.map((ft, i) => (i === 1 ? { ...ft, prix: '13', version: '2' } : ft)));
        fs.appendFileSync(e.config.fichierFoodtrucks, ',Nouveau,,Pizza,,,Vendredi,,,,,,https://maps.app.goo.gl/n,,,,\n');
        const s3 = new Stockage(e.config);
        await s3.initialiser();
        assert.equal(s3.migration.migre, true);
        assert.equal(s3.migration.copies.length, 1);
        const apres = await s3.lireFoodtrucks();
        assert.deepEqual(apres.slice(0, ids.length).map(ft => ft.id), ids);
        assert.equal(apres[1].prix, '13');
        assert.match(apres[ids.length].id, /^[a-z0-9]{6}$/);
        assert.equal(apres[ids.length].categorie, 'Italienne / Pizza');
    } finally {
        e.nettoyer();
    }
});

// --- Journaux fabriqués

const ts = (date, heure = 12, minute = 0) => {
    const [a, m, j] = date.split('-').map(Number);
    return new Date(a, m - 1, j, heure, minute).toISOString();
};
const jsonl = lignes => lignes.map(l => JSON.stringify(l)).join('\n') + '\n';
const UA = 'Mozilla/5.0 (Windows NT 10.0) Chrome/131.0';
const u = (date, v, type, cible = '', heure = 12) => ({ ts: ts(date, heure), v, type, cible, page: '/index.html', version: '3.1.0', ...(type === 'page_vue' ? { nav: 'Chrome' } : {}) });

function journauxFabriques() {
    return {
        // Avant la 3.1.0 : visiteurs par IP
        'usage.log': jsonl([
            { timestamp: ts('2025-03-10'), ip: 'A', event: 'Jour sélectionné : Lundi' },
            { timestamp: ts('2025-03-10'), ip: 'B', event: 'Consultation : Moya' },
            { timestamp: ts('2025-03-10'), ip: 'Z', event: 'Admin clic sur Valider foodtruck : X' }, // ignoré
            { timestamp: ts('2025-03-11'), ip: 'A', event: 'Tri sur la colonne : Prix' },
            { timestamp: ts('2026-10-01'), ip: 'A', event: 'Jour sélectionné : Jeudi' }, // récent : conservé
        ]) + 'ligne corrompue\n',
        'acces.log': jsonl([
            { timestamp: ts('2025-03-10'), ip: 'A', url: '/', method: 'GET', status: 200, durationMs: 4, userAgent: UA },
            { timestamp: ts('2025-03-10'), ip: 'C', url: '/admin/', method: 'GET', status: 401, durationMs: 1, userAgent: UA },
            { timestamp: ts('2025-03-10'), ip: 'R', url: '/', method: 'GET', status: 200, durationMs: 1, userAgent: 'curl/8.1' },
            { timestamp: ts('2025-03-10'), ip: 'A', url: '/api/log', method: 'POST', userAgent: UA },
            { timestamp: ts('2025-03-10'), ip: 'A', duration: '0.002s' },
        ]),
        'usage-2025-06.jsonl': jsonl([u('2025-06-02', 'v1', 'page_vue'), u('2025-06-03', 'v2', 'page_vue')]),
        'acces-2025-06.log': jsonl([{ timestamp: ts('2025-06-02'), ip: 'A', url: '/', method: 'GET', status: 200, durationMs: 8, userAgent: UA }]),
        'usage-2026-09.jsonl': jsonl([
            u('2026-09-07', 'v1', 'page_vue', '', 11), u('2026-09-07', 'v1', 'clic_maps', 'abc', 11),
            u('2026-09-07', 'v3', 'page_vue', '', 12), u('2026-09-07', 'v3', 'jour_clic', 'Mardi', 12),
            u('2026-09-07', 'v4', 'admin_ajout', 'abc'), // administration : pas un visiteur
            u('2026-09-14', 'v3', 'page_vue'), u('2026-09-14', 'v3', 'suggestion'),
        ]),
        'usage-2026-10.jsonl': jsonl([u('2026-10-12', 'v3', 'page_vue'), u('2026-10-13', 'v5', 'page_vue'), u('2026-10-13', 'v5', 'hasard', 'abc')]),
    };
}

const AUJOURDHUI = '2026-10-19';

test('Agrégats : navigateurs actifs, nouveaux et récurrents, ancien calcul par IP, exclusions', async () => {
    const e = environnement(journauxFabriques());
    try {
        const stats = new Statistiques(e.stockage, { journal: SILENCE });
        const { faits, techniques } = await stats.lireFaits();
        const a = calculerAgregats(faits, techniques);
        const j = a.jours['2026-09-07'];
        assert.equal(j.actifs, 2); // v1, v3 (v4 = action d'administration)
        // v1 a été vu en juin 2025 mais plus depuis 13 mois : son empreinte est oubliée (son cookie a forcément expiré)
        assert.equal(j.nouveaux, 2);
        assert.equal(j.pagesVues, 2);
        assert.deepEqual(j.joursConsultes, { Mardi: 1 });
        assert.deepEqual(j.consultations, { abc: { fiche: 0, site: 0, maps: 1, autres: 0 } });
        assert.equal(j.heures[11], 1);
        assert.equal(j.heures[12], 1);
        assert.deepEqual(j.navigateurs, { Chrome: 2 });
        const s = a.semaines[semaine('2026-09-07').cle];
        assert.deepEqual([s.actifs, s.nouveaux], [2, 2]);
        assert.deepEqual([a.mois['2026-09'].actifs, a.mois['2026-10'].actifs, a.mois['2026-10'].nouveaux], [2, 2, 1]);

        const ancien = a.jours['2025-03-10'];
        assert.equal(ancien.actifs, 0);
        assert.equal(ancien.actifsIp, 2); // A et B (pas l'admin C, ni le robot R, ni Z)
        assert.equal(ancien.pagesVues, 1);
        assert.deepEqual(ancien.consultations, { 'nom:Moya': { fiche: 0, site: 0, maps: 0, autres: 1 } });
        assert.equal(ancien.evenements.jour_ancien, 1);
        assert.deepEqual(ancien.joursConsultes, {}); // l'ancien « Jour sélectionné » mélangeait chargements et clics
        assert.deepEqual(ancien.technique, { requetes: 4, erreurs: 1, dureeTotaleMs: 6 });

        const r = construireStatistiques(a, '2026-09-01', '2026-09-30');
        assert.equal(r.totaux.pagesVues, 3);
        assert.equal(r.totaux.suggestions, 1);
        assert.equal(r.totaux.actifsMoyenJour, 1.5); // (2 + 1) / 2 jours avec visites
        assert.equal(r.periode.debutNavigateurs, '2025-06-02');
    } finally {
        e.nettoyer();
    }
});

test('Agrégats enregistrés = calcul brut, y compris après la purge des journaux bruts', async () => {
    const e = environnement(journauxFabriques());
    try {
        const stats = new Statistiques(e.stockage, { journal: SILENCE });
        const { faits, techniques } = await stats.lireFaits();
        const brut = calculerAgregats(faits, techniques, AUJOURDHUI);
        const periodes = [[undefined, undefined], ['2025-03-01', '2025-03-31'], ['2026-09-07', '2026-10-13'], ['2025-06-02', '2025-06-02']];
        const attendus = periodes.map(([d, f]) => construireStatistiques(brut, d, f));

        // Avant purge : agrégats enregistrés + calcul en cours = calcul brut
        for (const [i, [d, f]] of periodes.entries()) assert.deepEqual(await stats.calculer(d, f, AUJOURDHUI), attendus[i]);
        const enregistres = JSON.parse(fs.readFileSync(e.config.fichierAgregats, 'utf8'));
        assert.deepEqual(enregistres.jours['2026-09-07'], brut.jours['2026-09-07']);

        const purge = await stats.purger(AUJOURDHUI);
        assert.equal(purge.raison, undefined);
        assert.equal(purge.limite, '2025-09-19');
        assert.deepEqual(purge.supprimes.map(f => path.basename(f)).sort(), ['acces-2025-06.log', 'usage-2025-06.jsonl']);

        // Après purge : mêmes résultats, lus dans les agrégats
        for (const [i, [d, f]] of periodes.entries()) assert.deepEqual(await stats.calculer(d, f, AUJOURDHUI), attendus[i]);
    } finally {
        e.nettoyer();
    }
});

test('Purge : rien n\'est supprimé tant que les agrégats ne sont pas écrits et relus', async () => {
    const fichiers = journauxFabriques();
    const e = environnement(fichiers);
    const etat = () => Object.fromEntries(fs.readdirSync(e.dossier).sort().map(n => [n, fs.readFileSync(path.join(e.dossier, n), 'utf8')]));
    try {
        // 1. Agrégats impossibles à écrire (un dossier occupe leur place)
        const avant = etat();
        fs.mkdirSync(e.config.fichierAgregats);
        const stats = new Statistiques(e.stockage, { journal: SILENCE });
        const r1 = await stats.purger(AUJOURDHUI);
        assert.match(r1.raison, /Agrégats illisibles/);
        assert.deepEqual(r1.supprimes, []);
        for (const [nom, contenu] of Object.entries(avant)) assert.equal(fs.readFileSync(path.join(e.dossier, nom), 'utf8'), contenu, nom);
        fs.rmdirSync(e.config.fichierAgregats);

        // 2. Écriture « réussie » mais rien sur le disque : la relecture échoue
        const ecrire = e.stockage.ecrireJSON;
        e.stockage.ecrireJSON = async () => {};
        const r2 = await stats.purger(AUJOURDHUI);
        assert.ok(r2.raison);
        assert.deepEqual(r2.supprimes, []);
        assert.ok(fs.existsSync(path.join(e.dossier, 'usage-2025-06.jsonl')));

        // 3. Agrégats relus mais incomplets (un jour concerné manque) : rien n'est supprimé
        fs.writeFileSync(e.config.fichierAgregats, JSON.stringify({ version: 1, jours: { '2025-03-10': {} }, semaines: {}, mois: {} }));
        const r3 = await stats.purger(AUJOURDHUI);
        assert.match(r3.raison, /Agrégats absents/);
        for (const [nom, contenu] of Object.entries(avant)) assert.equal(fs.readFileSync(path.join(e.dossier, nom), 'utf8'), contenu, nom);
        assert.ok(!fs.existsSync(path.join(e.config.dossierSauvegardes, 'journaux-avant-premiere-purge')));
        e.stockage.ecrireJSON = ecrire;
        fs.rmSync(e.config.fichierAgregats);

        // 4. Cas normal : copie des journaux avant la première purge, puis purge
        const r4 = await stats.purger(AUJOURDHUI);
        assert.equal(r4.raison, undefined);
        const copie = path.join(e.config.dossierSauvegardes, 'journaux-avant-premiere-purge');
        assert.equal(r4.copie, copie);
        for (const nom of ['usage.log', 'acces.log', 'usage-2025-06.jsonl', 'acces-2025-06.log']) {
            assert.equal(fs.readFileSync(path.join(copie, nom), 'utf8'), fichiers[nom], nom);
        }
        assert.ok(!fs.existsSync(path.join(e.dossier, 'usage-2025-06.jsonl')));
        assert.ok(fs.existsSync(path.join(e.dossier, 'usage-2026-09.jsonl')));
        const usage = fs.readFileSync(path.join(e.dossier, 'usage.log'), 'utf8');
        assert.ok(!usage.includes('2025-03-1'));
        assert.match(usage, /Jour sélectionné : Jeudi/); // ligne récente conservée
        assert.match(usage, /ligne corrompue/); // ligne non datée : conservée
        assert.equal(fs.readFileSync(path.join(e.dossier, 'acces.log'), 'utf8'), '');

        // Purge suivante : rien à faire, la copie initiale n'est pas écrasée
        const r5 = await stats.purger(AUJOURDHUI);
        assert.deepEqual([r5.supprimes, r5.reecrits, r5.copie], [[], [], undefined]);
        assert.equal(fs.readFileSync(path.join(copie, 'acces.log'), 'utf8'), fichiers['acces.log']);
    } finally {
        e.nettoyer();
    }
});

test('Purge : limite à 13 mois (fins de mois comprises)', () => {
    assert.equal(moinsMois('2026-10-19', 13), '2025-09-19');
    assert.equal(moinsMois('2026-03-31', 13), '2025-02-28');
    assert.equal(moinsMois('2026-01-15', 13), '2024-12-15');
});

test('Sauvegarde quotidienne (CSV, JSON, JSONL), une copie par jour, rotation sur 30 jours, restauration', async () => {
    const e = environnement({
        'foodtrucks.csv': 'id,nom\na,A\n', 'lieux.csv': 'id,nom\n', 'stats-jours.json': '{}', 'usage-2026-10.jsonl': '{}\n',
        'acces-2026-10.log': '{}\n', 'foodtrucks.csv.123.tmp': 'temporaire',
    });
    try {
        const dossier = await sauvegarderSiNecessaire(e.config, '2026-10-19');
        assert.equal(dossier, path.join(e.config.dossierSauvegardes, '2026-10-19'));
        assert.deepEqual(fs.readdirSync(dossier).sort(), ['foodtrucks.csv', 'lieux.csv', 'stats-jours.json', 'usage-2026-10.jsonl']);
        assert.equal(await sauvegarderSiNecessaire(e.config, '2026-10-19'), null); // déjà faite aujourd'hui

        // Restauration : recopier les fichiers de la sauvegarde dans data/
        fs.writeFileSync(path.join(e.dossier, 'foodtrucks.csv'), 'cassé');
        fs.copyFileSync(path.join(dossier, 'foodtrucks.csv'), path.join(e.dossier, 'foodtrucks.csv'));
        assert.equal(fs.readFileSync(path.join(e.dossier, 'foodtrucks.csv'), 'utf8'), 'id,nom\na,A\n');

        for (const jour of ['2026-09-01', '2026-09-19', '2026-09-20', '2026-10-18']) fs.mkdirSync(path.join(e.config.dossierSauvegardes, jour));
        fs.mkdirSync(path.join(e.config.dossierSauvegardes, 'journaux-avant-premiere-purge'));
        const supprimes = await rotation(e.config, '2026-10-19');
        assert.deepEqual(supprimes.sort(), ['2026-09-01', '2026-09-19']);
        assert.deepEqual(fs.readdirSync(e.config.dossierSauvegardes).sort(),
            ['2026-09-20', '2026-10-18', '2026-10-19', 'journaux-avant-premiere-purge']);
    } finally {
        e.nettoyer();
    }
});

test('Maintenance quotidienne : sauvegarde, agrégats et purge enchaînés', async () => {
    const e = environnement(journauxFabriques());
    try {
        await e.stockage.initialiser();
        const statistiques = new Statistiques(e.stockage, { journal: SILENCE });
        const bilan = await maintenanceQuotidienne({ config: e.config, statistiques, journal: SILENCE }, AUJOURDHUI);
        assert.ok(bilan.sauvegarde);
        assert.equal(bilan.agregats, true);
        assert.equal(bilan.purge.supprimes.length, 2);
        assert.ok(fs.existsSync(path.join(bilan.sauvegarde, 'usage-2025-06.jsonl'))); // sauvegarde faite avant la purge
        assert.ok(fs.existsSync(e.config.fichierAgregats));
    } finally {
        e.nettoyer();
    }
});
