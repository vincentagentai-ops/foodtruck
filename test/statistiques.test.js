'use strict';

// Tableau de bord des statistiques (3.3.0) : agrégats incrémentaux sur des journaux fabriqués
// (DAU/WAU/MAU, nouveaux et récurrents, visites, retour à S+1, cohortes, entonnoir, fonctionnalités, contributions),
// égalité calcul incrémental = calcul complet, période chevauchant une purge, marqueurs de version,
// exclusions (administration, robots) et absence de tout identifiant dans l'API et dans l'export.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { charger } = require('../src/config');
const { Stockage } = require('../src/stockage');
const {
    Statistiques, calculerAgregats, construireStatistiques, statistiquesContributeurs, semaine,
} = require('../src/statistiques');
const { dossierTemporaire, demarrer, patienter, AUTH } = require('./outils');

const SILENCE = { log() {}, error() {} };
const AUJOURDHUI = '2026-10-19'; // lundi ; S41 = 05/10 → 11/10, S42 = 12/10 → 18/10

function environnement(fichiers = {}) {
    const racine = dossierTemporaire();
    const dossier = path.join(racine, 'data');
    fs.mkdirSync(dossier);
    for (const [nom, contenu] of Object.entries(fichiers)) fs.writeFileSync(path.join(dossier, nom), contenu);
    const config = charger({ DATA_DIR: dossier, BACKUP_DIR: path.join(racine, 'sauvegardes'), STATS_SECRET: 's'.repeat(40) });
    const stockage = new Stockage(config);
    const stats = new Statistiques(stockage, { journal: SILENCE });
    return { racine, dossier, config, stockage, stats, nettoyer: () => fs.rmSync(racine, { recursive: true, force: true }) };
}

const ts = (date, heure = 12, minute = 0) => {
    const [a, m, j] = date.split('-').map(Number);
    return new Date(a, m - 1, j, heure, minute).toISOString();
};
const jsonl = lignes => lignes.map(l => JSON.stringify(l)).join('\n') + '\n';
/** Évènement d'usage : u('2026-10-05', 'A', 'page_vue', '', 12, 5). */
const u = (date, v, type, cible = '', heure = 12, minute = 0, version = '3.2.0') => ({
    ts: ts(date, heure, minute), v, type, cible, page: '/index.html', version, ...(type === 'page_vue' ? { nav: 'Firefox' } : {}),
});

function journaux() {
    return {
        'usage-2026-09.jsonl': jsonl([u('2026-09-07', 'Z', 'page_vue', '', 12, 0, '3.1.0')]),
        'usage-2026-10.jsonl': jsonl([
            // Lundi 05/10 : A fait deux visites (pause de 55 min), B une
            u('2026-10-05', 'A', 'page_vue', '', 12, 0), u('2026-10-05', 'A', 'fiche_ouverte', 'f1', 12, 5),
            u('2026-10-05', 'A', 'clic_maps', 'f1', 12, 6),
            u('2026-10-05', 'A', 'page_vue', '', 13, 1), u('2026-10-05', 'A', 'recherche', 'pizza', 13, 2),
            u('2026-10-05', 'B', 'page_vue', '', 12, 10), u('2026-10-05', 'B', 'hasard', 'f2', 12, 11),
            u('2026-10-05', 'B', 'clic_site', 'f2', 12, 12), // clic depuis la liste, sans ouvrir la fiche
            // Mardi 06/10 : E à 23 h 50 ; une contribution (comptée par le serveur, sans identifiant)
            u('2026-10-06', 'E', 'page_vue', '', 23, 50), u('2026-10-06', null, 'avis', 'f1', 14),
            // Mercredi 07/10 : E juste après minuit (autre jour, autre visite), B revient
            u('2026-10-07', 'E', 'page_vue', '', 0, 10), u('2026-10-07', 'B', 'page_vue', '', 12),
            // Lundi 12/10 : A revient (retour à S+1), C arrive ; D est l'administrateur (exclu dès ce jour)
            u('2026-10-12', 'A', 'page_vue', '', 12, 0, '3.3.0'),
            u('2026-10-12', 'C', 'page_vue', '', 12, 0), u('2026-10-12', 'C', 'fiche_ouverte', 'f2', 12, 3),
            u('2026-10-12', 'C', 'favori_ajout', 'f2', 12, 4), u('2026-10-12', 'C', 'recherche_vide', 'Sushi', 12, 5),
            u('2026-10-12', 'D', 'page_vue', '', 11), u('2026-10-12', 'D', 'admin_vu', '', 12, 30),
            u('2026-10-12', null, 'presence', 'f1', 12, 40),
            // Mardi 13/10
            u('2026-10-13', 'C', 'page_vue', '', 12), u('2026-10-13', 'D', 'page_vue', '', 12),
            u('2026-10-13', null, 'ajout', 'f3', 15),
            // Aujourd'hui (journée en cours)
            u('2026-10-19', 'F', 'page_vue', '', 9),
        ]),
        'acces-2026-10.log': jsonl([
            { timestamp: ts('2026-10-05'), ip: '10.0.0.1', url: '/', method: 'GET', status: 200, durationMs: 10, userAgent: 'Firefox' },
            { timestamp: ts('2026-10-05'), ip: '10.0.0.1', url: '/x.html', method: 'GET', status: 404, durationMs: 2, userAgent: 'Firefox' },
        ]),
    };
}

test('Indicateurs sur journaux fabriqués : DAU/WAU/MAU, nouveaux, visites, retour S+1, cohortes, entonnoir, fonctionnalités', async () => {
    const e = environnement(journaux());
    try {
        const { faits, techniques } = await e.stats.lireFaits();
        const a = calculerAgregats(faits, techniques, AUJOURDHUI);
        const j5 = a.jours['2026-10-05'];
        assert.deepEqual([j5.actifs, j5.nouveaux, j5.visites], [2, 2, 3]); // A : 2 visites (pause > 30 min), B : 1
        assert.deepEqual(j5.fonctionnalites, { fiche: 1, maps: 1, recherche: 1, hasard: 1, site: 1 });
        assert.deepEqual(j5.entonnoir, { fiche: 1, ficheClic: 1, clicSansFiche: 1 });
        assert.deepEqual(j5.consultations.f1, { fiche: 1, site: 0, maps: 1, autres: 0 });
        assert.deepEqual(j5.technique, { requetes: 2, erreurs: 1, dureeTotaleMs: 12 });
        assert.equal(j5.heures[12], 2);
        assert.equal(j5.heures[13], 1);
        // Visites coupées à minuit
        assert.deepEqual([a.jours['2026-10-06'].visites, a.jours['2026-10-07'].visites], [1, 2]);
        assert.deepEqual([a.jours['2026-10-07'].actifs, a.jours['2026-10-07'].nouveaux], [2, 0]);
        assert.equal(a.jours['2026-10-06'].evenements.avis, 1);

        // 12/10 : l'administrateur D est exclu (pages publiques comprises), C est nouveau, A revient
        const j12 = a.jours['2026-10-12'];
        assert.deepEqual([j12.actifs, j12.nouveaux, j12.pagesVues, j12.visites], [2, 1, 2, 2]);
        assert.deepEqual(j12.recherchesVides, { sushi: 1 });
        assert.deepEqual(j12.entonnoir, { fiche: 1, ficheClic: 0, clicSansFiche: 0 });
        assert.equal(j12.evenements.admin_vu, 1);
        assert.deepEqual([a.jours['2026-10-13'].actifs, a.jours['2026-10-13'].pagesVues], [1, 1]); // D toujours exclu

        // Actifs sur 7 jours glissants (WAU glissant)
        assert.equal(a.jours['2026-10-12'].actifs7j, 4); // A, B, C, E (actifs du 06 au 12)
        assert.equal(a.jours['2026-10-14'].actifs7j, 2); // A, C : jour sans visite, mais présent pour la courbe
        assert.equal(a.jours['2026-10-14'].actifs, 0);

        // Semaines ISO : WAU, nouveaux, récurrents, retour à S+1 ; mois (MAU)
        const s41 = a.semaines[semaine('2026-10-05').cle];
        const s42 = a.semaines[semaine('2026-10-12').cle];
        assert.deepEqual([s41.actifs, s41.nouveaux, s41.retenus], [3, 3, 0]);
        assert.deepEqual([s42.actifs, s42.nouveaux, s42.retenus], [2, 1, 1]);
        assert.deepEqual([a.mois['2026-10'].actifs, a.mois['2026-10'].nouveaux, a.mois['2026-10'].retenus], [5, 5, 0]); // A, B, C, E, F

        // Cohortes hebdomadaires : S41 (A, B, E) -> 1 revenu en S42
        assert.deepEqual(a.cohortes[semaine('2026-10-05').cle], { debut: '2026-10-05', taille: 3, semaines: [3, 1] });
        assert.deepEqual(a.cohortes[semaine('2026-10-12').cle], { debut: '2026-10-12', taille: 1, semaines: [1] });

        // Lecture d'une période : tuiles, comparaison à la période précédente, carte de chaleur
        const r = construireStatistiques(a, '2026-10-05', '2026-10-18');
        assert.equal(r.tuiles.actifsJour, 1.6); // (2 + 1 + 2 + 2 + 1) / 5 jours avec visites
        assert.equal(r.tuiles.nouveaux, 4);
        assert.deepEqual(r.tuiles.retourS1, { taux: 33, revenus: 1, base: 3 }); // S41 -> S42 ; S42 -> S43 pas terminée
        assert.equal(r.tuiles.contributions, 3);
        assert.deepEqual(r.periode.precedente, { debut: '2026-09-21', fin: '2026-10-04' });
        assert.equal(r.precedente.nouveaux, 0);
        assert.deepEqual(r.entonnoir, { visites: 9, fiche: 2, ficheClic: 1, clicSansFiche: 1 });
        assert.equal(r.fonctionnalites.recherche, 2); // recherche + recherche sans résultat
        assert.deepEqual(r.recherchesVides, [{ texte: 'sushi', n: 1 }]);
        assert.equal(r.carteChaleur[0][12], 4); // lundis à midi : A + B le 05, A + C le 12
        assert.equal(r.carteChaleur[0][13], 1);
        assert.equal(r.carteChaleur[1][23], 1); // mardi 23 h : E
        const sem = r.semaines.find(s => s.semaine === semaine('2026-10-05').cle);
        assert.deepEqual([sem.retourS1, sem.recurrents, sem.complete], [33, 0, true]);
        assert.deepEqual(sem.contributions, { avis: 1 });
        assert.equal(r.semaines.find(s => s.semaine === semaine('2026-10-12').cle).retourS1, null);
        assert.equal(r.cohortes.length, 2);
        assert.deepEqual(r.cohortes[0].semaines, [3, 1]);

        // Journée en cours : F apparaît, sans terminer la semaine
        const auj = construireStatistiques(a, AUJOURDHUI, AUJOURDHUI);
        assert.deepEqual([auj.jours[0].actifs, auj.jours[0].nouveaux], [1, 1]);
        assert.equal(a.traiteJusqua, '2026-10-18');
    } finally {
        e.nettoyer();
    }
});

test('Calcul incrémental (jour après jour, plusieurs exécutions) = calcul complet', async () => {
    const e = environnement(journaux());
    try {
        const { faits, techniques } = await e.stats.lireFaits();
        const periodes = [[undefined, undefined], ['2026-10-05', '2026-10-18'], ['2026-10-12', AUJOURDHUI], ['2026-09-01', '2026-09-30']];
        const complet = calculerAgregats(faits, techniques, AUJOURDHUI);

        // Exécutions successives : le 06, le 08, le 13 puis aujourd'hui
        for (const jour of ['2026-10-06', '2026-10-08', '2026-10-13']) await e.stats.mettreAJourAgregats(jour);
        const etat = JSON.parse(fs.readFileSync(path.join(e.dossier, 'stats-etat.json'), 'utf8'));
        assert.equal(etat.traiteJusqua, '2026-10-12');
        for (const [d, f] of periodes) {
            assert.deepEqual(await e.stats.calculer(d, f, AUJOURDHUI), construireStatistiques(complet, d, f), `${d} -> ${f}`);
        }
        const enregistres = JSON.parse(fs.readFileSync(e.config.fichierAgregats, 'utf8'));
        assert.equal(enregistres.traiteJusqua, '2026-10-18');
        assert.ok(!enregistres.jours[AUJOURDHUI]); // la journée en cours n'est jamais enregistrée

        // Les agrégats ne contiennent aucune empreinte de navigateur
        const texte = fs.readFileSync(e.config.fichierAgregats, 'utf8');
        for (const v of ['"A"', '"B"', '"C"', '"D"', '"E"', '"F"']) assert.ok(!texte.includes(v), v);

        // Un jour déjà traité n'est jamais recalculé : une ligne ajoutée après coup pour le 05 est ignorée
        fs.appendFileSync(path.join(e.dossier, 'usage-2026-10.jsonl'), jsonl([u('2026-10-05', 'X', 'page_vue')]));
        assert.equal((await e.stats.calculer('2026-10-05', '2026-10-05', AUJOURDHUI)).jours[0].actifs, 2);

        // État interne incohérent (agrégats restaurés seuls, par exemple) : tout est recalculé depuis les journaux
        fs.rmSync(path.join(e.dossier, 'stats-etat.json'));
        assert.equal((await e.stats.calculer('2026-10-05', '2026-10-05', AUJOURDHUI)).jours[0].actifs, 3);
    } finally {
        e.nettoyer();
    }
});

test('Mise à jour depuis la 3.2.0 : les agrégats de l\'ancien format sont recalculés, les jours purgés conservés', async () => {
    const e = environnement({
        ...journaux(),
        'stats-jours.json': JSON.stringify({
            version: 1,
            jours: { '2024-01-08': { pagesVues: 7, pages: {}, actifs: 3, actifsIp: 0, nouveaux: 3, heures: Array(24).fill(0), navigateurs: {},
                evenements: {}, joursConsultes: {}, consultations: {}, technique: { requetes: 0, erreurs: 0, dureeTotaleMs: 0 } } },
            semaines: { '2024-S02': { debut: '2024-01-08', fin: '2024-01-14', actifs: 3, actifsIp: 0, nouveaux: 3, recurrents: 0 } },
            mois: {},
        }),
    });
    try {
        const r = await e.stats.calculer(undefined, undefined, AUJOURDHUI);
        assert.equal(r.jours[0].date, '2024-01-08'); // journaux bruts purgés depuis longtemps : agrégat gardé
        assert.equal(r.jours[0].actifs, 3);
        assert.equal(r.jours[0].visites, 0);
        assert.equal(r.semaines[0].actifs, 3);
        const enregistres = JSON.parse(fs.readFileSync(e.config.fichierAgregats, 'utf8'));
        assert.equal(enregistres.version, 2);
        assert.equal(enregistres.jours['2026-10-05'].visites, 3);
    } finally {
        e.nettoyer();
    }
});

test('Période chevauchant une purge : mêmes chiffres avant et après la purge des journaux bruts', async () => {
    const e = environnement({
        'usage-2025-08.jsonl': jsonl([
            u('2025-08-04', 'G', 'page_vue'), u('2025-08-04', 'G', 'fiche_ouverte', 'f1', 12, 2), u('2025-08-04', 'H', 'page_vue'),
            u('2025-08-11', 'G', 'page_vue'),
        ]),
        'usage-2025-10.jsonl': jsonl([u('2025-10-06', 'G', 'page_vue'), u('2025-10-06', 'K', 'page_vue')]),
        ...journaux(),
    });
    try {
        const periodes = [['2025-08-01', '2025-10-31'], ['2025-08-04', '2025-08-17'], [undefined, undefined]];
        const avant = [];
        for (const [d, f] of periodes) avant.push(await e.stats.calculer(d, f, AUJOURDHUI));
        // S32 : G et H, seul G revient en S33 ; S33 : G, absent en S34 -> 1 retour sur 3
        assert.deepEqual(avant[1].tuiles.retourS1, { taux: 33, revenus: 1, base: 3 });

        const purge = await e.stats.purger(AUJOURDHUI);
        assert.equal(purge.raison, undefined);
        assert.deepEqual(purge.supprimes.map(f => path.basename(f)), ['usage-2025-08.jsonl']);
        for (const [i, [d, f]] of periodes.entries()) assert.deepEqual(await e.stats.calculer(d, f, AUJOURDHUI), avant[i]);
        // G (vu en août puis en octobre 2025) reste récurrent : l'état interne n'a pas oublié son empreinte
        assert.equal(avant[0].jours.find(j => j.date === '2025-10-06').nouveaux, 1);
    } finally {
        e.nettoyer();
    }
});

test('Marqueurs de version : repris des journaux la première fois, puis un par nouvelle version', async () => {
    const e = environnement(journaux());
    try {
        const v1 = await e.stats.noterVersion('3.3.0', AUJOURDHUI);
        assert.deepEqual(v1, [
            { version: '3.1.0', date: '2026-09-07' }, { version: '3.2.0', date: '2026-10-05' }, { version: '3.3.0', date: '2026-10-12' },
        ]);
        assert.deepEqual(await e.stats.noterVersion('3.3.0', '2026-10-20'), v1); // même version : rien de nouveau
        const v2 = await e.stats.noterVersion('3.4.0', '2026-11-02');
        assert.deepEqual(v2[3], { version: '3.4.0', date: '2026-11-02' });
        // Conservés par le calcul des agrégats et renvoyés avec les statistiques
        const r = await e.stats.calculer(undefined, undefined, AUJOURDHUI);
        assert.deepEqual(r.versions, v2);
    } finally {
        e.nettoyer();
    }
});

test('Contributeurs : distincts sur la période, nouveaux, retour dans les 14 jours', () => {
    const activites = [
        { date: '2026-10-01', auteur: 'x' }, { date: '2026-10-05', auteur: 'x' }, // revient 4 jours après
        { date: '2026-10-02', auteur: 'y' }, { date: '2026-10-02', auteur: 'y' }, // même jour : pas un retour
        { date: '2026-10-15', auteur: 'z' }, // fenêtre de 14 jours pas encore écoulée
        { date: '2026-09-01', auteur: 'w' }, { date: '2026-10-03', auteur: 'w' }, // ancien contributeur
        { date: '2026-11-30', auteur: 'y' }, // hors fenêtre et hors période
    ];
    const r = statistiquesContributeurs(activites, '2026-10-01', '2026-10-18', AUJOURDHUI);
    assert.deepEqual(
        [r.contributeurs, r.nouveaux, r.mesures14, r.revenus14, r.enObservation, r.tauxRetour14],
        [4, 3, 2, 1, 1, 50],
    );
    assert.equal(r.parSemaine[semaine('2026-10-01').cle], 3); // x, y, w
});

test('API : robots et administration exclus, aucun identifiant dans les réponses ni dans les exports', async () => {
    const t = await demarrer();
    try {
        const n1 = await t.navigateur();
        const admin = await t.navigateur();
        await n1('POST', '/api/evenements', { type: 'fiche_ouverte', cible: 'x', page: '/' });
        await n1('POST', '/api/evenements', { type: 'recherche_vide', cible: 'Tacos', page: '/' });
        // Robot : ni page vue ni évènement
        await t.appel('GET', '/', undefined, { 'User-Agent': 'Googlebot/2.1', Cookie: n1.cookie });
        const robot = await t.appel('POST', '/api/evenements', { type: 'hasard', cible: 'x', page: '/' }, { 'User-Agent': 'curl/8.1', Cookie: n1.cookie });
        assert.equal(robot.statut, 204);
        // Contribution (jeton d'auteur dans avis.jsonl)
        const ajout = await n1('POST', '/api/etablissements', { nom: 'Chez Test', cuisine: 'Tacos', jours: 'Lundi', emplacement: 'https://maps.app.goo.gl/x' });
        assert.equal(ajout.statut, 201);
        const id = ajout.json.etablissement.id;
        assert.equal((await n1('POST', `/api/etablissements/${id}/avis`, { note: 4 })).statut, 201);
        // Administrateur : son navigateur est exclu de l'audience
        assert.equal((await admin('GET', '/admin/', undefined, AUTH)).statut, 200);
        await admin('GET', '/');
        await patienter();

        const r = await admin('GET', '/api/admin/statistiques', undefined, AUTH);
        assert.equal(r.statut, 200, r.texte);
        const jour = r.json.jours[r.json.jours.length - 1];
        assert.equal(jour.actifs, 1); // n1 seulement
        assert.equal(r.json.evenements.hasard, undefined);
        assert.deepEqual(r.json.recherchesVides, [{ texte: 'tacos', n: 1 }]);
        assert.equal(r.json.tuiles.contributeurs, 1);
        assert.equal(r.json.tuiles.contributions, 2); // ajout + avis
        const fiche = r.json.etablissements.find(e => e.id === id);
        assert.deepEqual([fiche.nom, fiche.avis, fiche.note], ['Chez Test', 1, null]); // note affichée à partir de 3 avis

        // Aucun identifiant : ni empreinte d'audience, ni jeton d'auteur, ni cookie
        const usage = fs.readdirSync(t.dossier).filter(n => /^usage-.*\.jsonl$/.test(n))
            .flatMap(n => fs.readFileSync(path.join(t.dossier, n), 'utf8').trim().split('\n').map(l => JSON.parse(l)));
        const empreintes = [...new Set(usage.map(e => e.v).filter(Boolean))];
        const jetons = fs.readFileSync(path.join(t.dossier, 'avis.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l).auteur);
        const cookies = [n1.cookie, admin.cookie].map(c => c.split('=')[1]);
        assert.ok(empreintes.length >= 2 && jetons.length >= 1);
        const reponses = [r.texte];
        for (const niveau of ['jours', 'semaines', 'etablissements']) {
            const csv = await admin('GET', `/api/admin/export/statistiques.csv?niveau=${niveau}`, undefined, AUTH);
            assert.equal(csv.statut, 200);
            assert.match(csv.entetes.get('content-disposition'), new RegExp(`statistiques-${niveau}`));
            reponses.push(csv.texte);
        }
        assert.match(reponses[3], /Chez Test/);
        for (const texte of reponses) {
            for (const secret of [...empreintes, ...jetons, ...cookies]) assert.ok(!texte.includes(secret), 'identifiant trouvé');
        }
        // L'état interne (empreintes) existe sur le serveur mais n'est servi par aucune adresse
        assert.ok(fs.existsSync(path.join(t.dossier, 'stats-etat.json')));
        assert.equal((await t.appel('GET', '/stats-etat.json')).statut, 404);
        assert.equal((await t.appel('GET', '/data/stats-etat.json')).statut, 404);
        // Export réservé à l'administrateur
        assert.equal((await t.appel('GET', '/api/admin/export/statistiques.csv')).statut, 401);
    } finally {
        t.fermer();
    }
});
