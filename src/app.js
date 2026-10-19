'use strict';

// Application Express : pages publiques, API publique, espace administrateur protégé.

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { Stockage, ErreurHttp } = require('./stockage');
const { validerFoodtruck, JOURS } = require('./validation');
const { COLONNES, depuisFoodtrucks } = require('./csv');
const { statistiquesUsage, statistiquesAcces, filtrerParDate } = require('./statistiques');
const { version } = require('../package.json');

const DOSSIER_PUBLIC = path.join(__dirname, '..', 'public');
// Chart.js n'exporte pas ses fichiers dist : chemin déduit de son point d'entrée (dist/chart.cjs)
const CHART_JS = path.join(path.dirname(require.resolve('chart.js')), 'chart.umd.min.js');
const EXTENSIONS_STATIQUES = /\.(css|js|png|jpe?g|svg|ico|woff2?|map)$/i;

function creerApplication(config, options = {}) {
    const stockage = new Stockage(config);
    const app = express();
    const journal = options.journal || console;
    let transporteur = options.transporteur || null;
    if (!transporteur && config.mail.hote) {
        transporteur = nodemailer.createTransport({
            host: config.mail.hote,
            port: config.mail.port,
            secure: config.mail.securise,
            auth: config.mail.utilisateur ? { user: config.mail.utilisateur, pass: config.mail.motDePasse } : undefined,
            tls: config.mail.ignorerCertificat ? { rejectUnauthorized: false } : undefined,
        });
    }

    app.disable('x-powered-by');
    if (config.trustProxy) app.set('trust proxy', true);
    app.use(express.json({ limit: '20kb' }));

    const ipDe = req => req.ip || req.socket.remoteAddress;
    const usage = (req, event) => stockage
        .journaliser(config.fichierUsage, { timestamp: new Date().toISOString(), ip: ipDe(req), event })
        .catch(err => journal.error("Écriture d'usage.log impossible :", err.message));

    // --- Journal d'accès : une ligne par page ou appel d'API (pas pour les images/CSS/JS)
    if (config.journaliserAcces) {
        app.use((req, res, next) => {
            if (EXTENSIONS_STATIQUES.test(req.path)) return next();
            const debut = Date.now();
            res.on('finish', () => {
                stockage.journaliser(config.fichierAcces, {
                    timestamp: new Date(debut).toISOString(),
                    ip: ipDe(req),
                    url: req.originalUrl,
                    method: req.method,
                    status: res.statusCode,
                    durationMs: Date.now() - debut,
                    userAgent: req.headers['user-agent'],
                }).catch(err => journal.error("Écriture d'acces.log impossible :", err.message));
            });
            next();
        });
    }

    // --- Authentification de l'espace administrateur (HTTP Basic)
    function egalSecurise(a, b) {
        const ha = crypto.createHash('sha256').update(String(a)).digest();
        const hb = crypto.createHash('sha256').update(String(b)).digest();
        return crypto.timingSafeEqual(ha, hb);
    }
    function exigerAdmin(req, res, next) {
        if (!config.admin.motDePasse) {
            return res.status(503).type('text/plain; charset=utf-8')
                .send("Espace administrateur désactivé : définissez ADMIN_PASSWORD dans le fichier .env puis redémarrez.");
        }
        const [schema, encode] = (req.headers.authorization || '').split(' ');
        if (schema === 'Basic' && encode) {
            const texte = Buffer.from(encode, 'base64').toString('utf8');
            const sep = texte.indexOf(':');
            const utilisateur = texte.slice(0, sep);
            const motDePasse = texte.slice(sep + 1);
            if (sep > 0 && egalSecurise(utilisateur, config.admin.utilisateur)
                && egalSecurise(motDePasse, config.admin.motDePasse)) {
                return next();
            }
        }
        res.set('WWW-Authenticate', 'Basic realm="Administration Food Trucks", charset="UTF-8"');
        res.status(401).type('text/plain; charset=utf-8').send('Authentification requise.');
    }

    // --- Compatibilité avec les anciennes adresses
    app.get(['/administration.html', '/generationCSV.html', '/ajouterFoodtruck.html'], (req, res) => res.redirect(301, '/admin/'));
    app.get('/statistiques.html', (req, res) => res.redirect(301, '/admin/statistiques.html'));
    app.get('/data/Foodtruck_logo.PNG', (req, res) => res.redirect(301, '/img/logo.png'));
    app.get('/data/foodtrucks.csv', async (req, res, next) => {
        try {
            res.type('text/csv; charset=utf-8').send(depuisFoodtrucks(await stockage.lireFoodtrucks(), true));
        } catch (err) { next(err); }
    });

    // --- Espace administrateur (pages statiques protégées)
    app.use('/admin', exigerAdmin, express.static(path.join(DOSSIER_PUBLIC, 'admin')));
    app.use('/api/admin', exigerAdmin);

    // --- Pages publiques (Chart.js est servi localement : pas de dépendance à un CDN)
    app.use(express.static(DOSSIER_PUBLIC, { index: 'index.html' }));
    app.get('/vendor/chart.umd.min.js', (req, res) => res.sendFile(CHART_JS));

    // --- API publique
    app.get('/api/config', (req, res) => {
        res.json({ titre: config.titre, environnement: config.environnement, contactEmail: config.contactEmail, jours: JOURS, version });
    });

    app.get('/api/foodtrucks', async (req, res, next) => {
        try { res.json(await stockage.lireFoodtrucks()); } catch (err) { next(err); }
    });

    async function suggerer(req, res, next) {
        try {
            const { foodtruck, erreurs } = validerFoodtruck(req.body);
            if (erreurs.length) throw new ErreurHttp(400, 'Suggestion incomplète ou invalide.', erreurs);
            await stockage.ajouterSuggestion(foodtruck);
            envoyerMailSuggestion(foodtruck);
            res.status(201).json({ message: 'Suggestion enregistrée. Merci !' });
        } catch (err) { next(err); }
    }
    app.post('/api/suggestions', suggerer);
    app.post('/api/suggest-foodtruck', suggerer); // ancienne adresse

    app.post('/api/log', (req, res) => {
        const event = req.body && typeof req.body.event === 'string' ? req.body.event.trim().slice(0, 300) : '';
        if (!event) return res.status(400).json({ error: 'Champ "event" manquant.' });
        usage(req, event);
        res.status(204).end();
    });

    function envoyerMailSuggestion(ft) {
        if (!transporteur || !config.mail.destinataire) return;
        const corps = COLONNES.map(c => `${c} : ${ft[c] || '-'}`).join('\n');
        transporteur.sendMail({
            from: config.mail.expediteur,
            to: config.mail.destinataire,
            subject: `[FoodTrucks] Nouvelle suggestion : ${ft.nom}`,
            text: `Une nouvelle suggestion de foodtruck est à valider :\n\n${corps}\n\nÀ valider dans l'espace administrateur (/admin/).`,
        }).then(
            info => journal.log('Mail de suggestion envoyé :', info.response || info.messageId),
            err => journal.error("Envoi du mail de suggestion impossible :", err.message),
        );
    }

    // --- API administrateur
    /** Retrouve l'élément `index` en vérifiant qu'il n'a pas changé depuis l'affichage. */
    function retrouver(liste, index, original) {
        const identique = ft => original && COLONNES.every(c => (ft[c] || '') === (original[c] || ''));
        const i = Number(index);
        if (Number.isInteger(i) && liste[i] && identique(liste[i])) return i;
        const ailleurs = liste.findIndex(identique);
        if (ailleurs >= 0) return ailleurs;
        throw new ErreurHttp(409, 'Cet élément a été modifié entre-temps. Rechargez la page.');
    }

    function validerOuErreur(donnees) {
        const { foodtruck, erreurs } = validerFoodtruck(donnees);
        if (erreurs.length) throw new ErreurHttp(400, 'Données invalides.', erreurs);
        return foodtruck;
    }

    app.get('/api/admin/suggestions', async (req, res, next) => {
        try { res.json(await stockage.lireAValider()); } catch (err) { next(err); }
    });

    app.post('/api/admin/suggestions/:index/valider', async (req, res, next) => {
        try {
            const foodtruck = validerOuErreur(req.body.foodtruck);
            await stockage.enSerie(async () => {
                const attente = await stockage.lireAValider();
                const i = retrouver(attente, req.params.index, req.body.original);
                const publies = await stockage.lireFoodtrucks();
                await stockage.ecrireFichier(config.fichierFoodtrucks, [...publies, foodtruck]);
                attente.splice(i, 1);
                await stockage.ecrireFichier(config.fichierAValider, attente);
            });
            usage(req, `Admin clic sur Valider foodtruck : ${foodtruck.nom}`);
            res.json({ message: `« ${foodtruck.nom} » est maintenant publié.` });
        } catch (err) { next(err); }
    });

    app.delete('/api/admin/suggestions/:index', async (req, res, next) => {
        try {
            let nom;
            await stockage.modifier(config.fichierAValider, attente => {
                const i = retrouver(attente, req.params.index, req.body.original);
                nom = attente[i].nom;
                return attente.filter((_, j) => j !== i);
            });
            usage(req, `Admin clic sur Supprimer foodtruck : ${nom}`);
            res.json({ message: `Suggestion « ${nom} » rejetée.` });
        } catch (err) { next(err); }
    });

    app.get('/api/admin/foodtrucks', async (req, res, next) => {
        try { res.json(await stockage.lireFoodtrucks()); } catch (err) { next(err); }
    });

    app.post('/api/admin/foodtrucks', async (req, res, next) => {
        try {
            const foodtruck = validerOuErreur(req.body);
            await stockage.ajouterFoodtruck(foodtruck);
            usage(req, `Ajout de : ${foodtruck.nom}`);
            res.status(201).json({ message: `« ${foodtruck.nom} » ajouté.` });
        } catch (err) { next(err); }
    });

    app.put('/api/admin/foodtrucks/:index', async (req, res, next) => {
        try {
            const foodtruck = validerOuErreur(req.body.foodtruck);
            await stockage.modifier(config.fichierFoodtrucks, liste => {
                const i = retrouver(liste, req.params.index, req.body.original);
                return liste.map((ft, j) => (j === i ? foodtruck : ft));
            });
            usage(req, `Admin modification foodtruck : ${foodtruck.nom}`);
            res.json({ message: `« ${foodtruck.nom} » modifié.` });
        } catch (err) { next(err); }
    });

    app.delete('/api/admin/foodtrucks/:index', async (req, res, next) => {
        try {
            let nom;
            await stockage.modifier(config.fichierFoodtrucks, liste => {
                const i = retrouver(liste, req.params.index, req.body.original);
                nom = liste[i].nom;
                return liste.filter((_, j) => j !== i);
            });
            usage(req, `Admin suppression foodtruck publié : ${nom}`);
            res.json({ message: `« ${nom} » retiré de la liste.` });
        } catch (err) { next(err); }
    });

    app.get('/api/admin/export/foodtrucks.csv', async (req, res, next) => {
        try {
            res.attachment('foodtrucks.csv').type('text/csv; charset=utf-8')
                .send(depuisFoodtrucks(await stockage.lireFoodtrucks(), true));
        } catch (err) { next(err); }
    });

    app.get('/api/admin/statistiques', async (req, res, next) => {
        try {
            const dateValide = d => (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : undefined);
            const debut = dateValide(req.query.debut);
            const fin = dateValide(req.query.fin);
            const [usageLog, accesLog] = await Promise.all([
                stockage.lireJournal(config.fichierUsage),
                stockage.lireJournal(config.fichierAcces),
            ]);
            const dates = [...usageLog, ...accesLog].map(e => e.timestamp).filter(Boolean).sort();
            res.json({
                periode: { debut: debut || null, fin: fin || null, premiereDonnee: dates[0] || null, derniereDonnee: dates[dates.length - 1] || null },
                usage: statistiquesUsage(filtrerParDate(usageLog, debut, fin)),
                acces: statistiquesAcces(filtrerParDate(accesLog, debut, fin)),
            });
        } catch (err) { next(err); }
    });

    // --- 404 et erreurs
    app.use('/api', (req, res) => res.status(404).json({ error: 'Adresse inconnue.' }));
    app.use((req, res) => res.status(404).sendFile(path.join(DOSSIER_PUBLIC, '404.html')));
    // eslint-disable-next-line no-unused-vars
    app.use((err, req, res, next) => {
        if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') {
            return res.status(400).json({ error: 'Requête invalide.' });
        }
        const statut = err.statut || 500;
        if (statut >= 500) journal.error(err);
        res.status(statut).json({ error: statut >= 500 ? 'Erreur interne du serveur.' : err.message, details: err.details });
    });

    app.locals.stockage = stockage;
    return app;
}

module.exports = { creerApplication };
