'use strict';

// Application Express : pages publiques, API publique, espace administrateur protégé.

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { Stockage, ErreurHttp, aujourdhui, nouvelId } = require('./stockage');
const {
    validerFoodtruck, validerLieu, slug, JOURS, TYPES, CATEGORIES, ETIQUETTES, PAIEMENTS,
} = require('./validation');
const { COLONNES, depuisFoodtrucks, depuisLieux } = require('./csv');
const audience = require('./audience');
const { Statistiques } = require('./statistiques');
const { Limiteur, limiter } = require('./limites');
const { version } = require('../package.json');

const DOSSIER_PUBLIC = path.join(__dirname, '..', 'public');
// Pages d'administration : hors de public/ pour qu'aucune variante d'adresse ne les serve sans mot de passe
const DOSSIER_ADMIN = path.join(__dirname, '..', 'admin');
// Chart.js n'exporte pas ses fichiers dist : chemin déduit de son point d'entrée (dist/chart.cjs)
const CHART_JS = path.join(path.dirname(require.resolve('chart.js')), 'chart.umd.min.js');
const EXTENSIONS_STATIQUES = /\.(css|js|png|jpe?g|svg|ico|woff2?|map)$/i;

const CSP = [
    "default-src 'self'", "script-src 'self'", "style-src 'self'", "img-src 'self' data:", "connect-src 'self'",
    "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
].join('; ');

// Champs repris dans le mail de suggestion
const CHAMPS_MAIL = ['nom', 'type', 'cuisine', 'categorie', 'jours', 'horaires', 'prix', 'paiements', 'emplacement', 'site'];

function creerApplication(config, options = {}) {
    const stockage = new Stockage(config);
    const journal = options.journal || console;
    const statistiques = new Statistiques(stockage, { journal });
    const app = express();
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
    if (config.trustProxy) app.set('trust proxy', config.trustProxy);

    // --- En-têtes de sécurité (aucun script ni style en ligne dans les pages)
    app.use((req, res, next) => {
        res.set({
            'Content-Security-Policy': CSP,
            'X-Content-Type-Options': 'nosniff',
            'X-Frame-Options': 'DENY',
            'Referrer-Policy': 'same-origin',
        });
        next();
    });

    // Évènements d'usage : corps limité à 2 ko (le reste de l'API : 20 ko)
    app.use(['/api/evenements', '/api/log'], express.json({ limit: '2kb' }));
    app.use(express.json({ limit: '20kb' }));

    const ipDe = req => req.ip || req.socket.remoteAddress;

    // --- Identifiant anonyme de navigateur (cookie ft_v, posé une fois, 13 mois, jamais prolongé)
    app.use((req, res, next) => {
        if (EXTENSIONS_STATIQUES.test(req.path)) return next();
        const existant = audience.lireCookies(req.headers.cookie)[audience.NOM_COOKIE];
        if (audience.idValide(existant)) {
            req.idNavigateur = existant;
        } else {
            req.idNavigateur = audience.nouvelIdNavigateur();
            res.append('Set-Cookie', audience.enteteCookie(req.idNavigateur));
        }
        next();
    });
    const navigateurDe = req => audience.hacher(stockage.secret, req.idNavigateur);

    /** Évènement d'audience typé, écrit dans usage-AAAA-MM.jsonl (sans IP). */
    function evenement(req, type, cible = '', page = '', extra = {}) {
        const maintenant = new Date();
        return stockage.journaliser(audience.fichierMensuel(config.dossierDonnees, 'usage', 'jsonl', maintenant), {
            ts: maintenant.toISOString(), v: navigateurDe(req), type, cible, page, version, ...extra,
        }).catch(err => journal.error("Écriture du journal d'usage impossible :", err.message));
    }

    // --- Journal d'accès technique (acces-AAAA-MM.log) et pages vues (pas pour les images/CSS/JS)
    app.use((req, res, next) => {
        if (EXTENSIONS_STATIQUES.test(req.path)) return next();
        const debut = Date.now();
        res.on('finish', () => {
            const ua = req.headers['user-agent'];
            if (config.journaliserAcces) {
                stockage.journaliser(audience.fichierMensuel(config.dossierDonnees, 'acces', 'log', new Date(debut)), {
                    timestamp: new Date(debut).toISOString(),
                    ip: ipDe(req),
                    url: req.originalUrl,
                    method: req.method,
                    status: res.statusCode,
                    durationMs: Date.now() - debut,
                    userAgent: ua,
                }).catch(err => journal.error("Écriture du journal d'accès impossible :", err.message));
            }
            const chemin = audience.normaliserChemin(req.originalUrl);
            if (audience.estPageVue({ methode: req.method, chemin, statut: res.statusCode, ua })) {
                evenement(req, 'page_vue', '', chemin, { nav: audience.famille(ua) });
            }
        });
        next();
    });

    // --- Limites de fréquence des écritures publiques (par navigateur et par IP)
    const clesLimite = req => [
        { cle: `ip:${ipDe(req)}`, facteur: config.limites.facteurIp },
        { cle: `v:${req.idNavigateur}` },
    ];
    const limiteSuggestions = limiter(new Limiteur({ max: config.limites.suggestions }), clesLimite);
    const limiteEvenements = limiter(new Limiteur({ max: config.limites.evenements }), clesLimite);

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

    const publics = liste => liste.filter(ft => ft.statut !== 'archive');

    // --- Compatibilité avec les anciennes adresses
    app.get(['/administration.html', '/generationCSV.html', '/ajouterFoodtruck.html'], (req, res) => res.redirect(301, '/admin/'));
    app.get('/statistiques.html', (req, res) => res.redirect(301, '/admin/statistiques.html'));
    app.get('/data/Foodtruck_logo.PNG', (req, res) => res.redirect(301, '/img/logo.png'));
    app.get('/data/foodtrucks.csv', async (req, res, next) => {
        try {
            res.type('text/csv; charset=utf-8').send(depuisFoodtrucks(publics(await stockage.lireFoodtrucks())));
        } catch (err) { next(err); }
    });

    // --- Espace administrateur (pages statiques protégées, servies uniquement par cette route)
    app.use('/admin', exigerAdmin, express.static(DOSSIER_ADMIN));
    app.use('/api/admin', exigerAdmin);

    // Défense en profondeur : une adresse qui, décodée, désigne l'administration sans passer par la route
    // ci-dessus (/%61dmin/…) n'atteint jamais le statique public (même si un ancien public/admin traînait).
    app.use((req, res, next) => {
        const chemin = audience.normaliserChemin(req.path);
        if (chemin === '/admin' || chemin.startsWith('/admin/')) return res.status(404).sendFile(path.join(DOSSIER_PUBLIC, '404.html'));
        next();
    });

    // --- Pages publiques (Chart.js est servi localement : pas de dépendance à un CDN)
    app.use(express.static(DOSSIER_PUBLIC, { index: 'index.html' }));
    app.get('/vendor/chart.umd.min.js', (req, res) => res.sendFile(CHART_JS));

    // --- API publique
    app.get('/api/config', (req, res) => {
        res.json({
            titre: config.titre, environnement: config.environnement, contactEmail: config.contactEmail, version,
            jours: JOURS, types: TYPES, categories: CATEGORIES, etiquettes: ETIQUETTES, paiements: PAIEMENTS,
        });
    });

    app.get('/api/foodtrucks', async (req, res, next) => {
        try { res.json(publics(await stockage.lireFoodtrucks())); } catch (err) { next(err); }
    });

    app.get('/api/lieux', async (req, res, next) => {
        try { res.json(await stockage.lireLieux()); } catch (err) { next(err); }
    });

    async function suggerer(req, res, next) {
        try {
            const lieux = (await stockage.lireLieux()).map(l => l.id);
            const { foodtruck, erreurs } = validerFoodtruck(req.body, { lieux });
            if (erreurs.length) throw new ErreurHttp(400, 'Suggestion incomplète ou invalide.', erreurs);
            foodtruck.statut = 'actif';
            await stockage.ajouterSuggestion(foodtruck);
            evenement(req, 'suggestion'); // comptée par le serveur (non falsifiable depuis une page)
            envoyerMailSuggestion(foodtruck);
            res.status(201).json({ message: 'Suggestion enregistrée. Merci !' });
        } catch (err) { next(err); }
    }
    app.post('/api/suggestions', limiteSuggestions, suggerer);
    app.post('/api/suggest-foodtruck', limiteSuggestions, suggerer); // ancienne adresse

    // Évènements typés envoyés par les pages (liste blanche)
    app.post('/api/evenements', limiteEvenements, (req, res) => {
        const { evenement: ev, statut, erreur } = audience.validerEvenement(req.body);
        if (!ev) return res.status(statut).json({ error: erreur });
        evenement(req, ev.type, ev.cible, ev.page);
        res.status(204).end();
    });

    // Ancienne adresse (pages encore en cache) : libellé libre converti en évènement typé
    app.post('/api/log', limiteEvenements, (req, res) => {
        const event = req.body && typeof req.body.event === 'string' ? req.body.event.trim().slice(0, 300) : '';
        if (!event) return res.status(400).json({ error: 'Champ "event" manquant.' });
        if (!audience.ancienLibelleAccepte(event)) return res.status(403).json({ error: "Libellé réservé au serveur." });
        const ev = audience.convertirAncienLibelle(event, { recu: true });
        if (ev) evenement(req, ev.type, ev.cible);
        res.status(204).end();
    });

    function envoyerMailSuggestion(ft) {
        if (!transporteur || !config.mail.destinataire) return;
        const corps = CHAMPS_MAIL.map(c => `${c} : ${ft[c] || '-'}`).join('\n');
        transporteur.sendMail({
            from: config.mail.expediteur,
            to: config.mail.destinataire,
            subject: `[FoodTrucks] Nouvelle suggestion : ${ft.nom}`,
            text: `Une nouvelle suggestion est à valider :\n\n${corps}\n\nÀ valider dans l'espace administrateur (/admin/).`,
        }).then(
            info => journal.log('Mail de suggestion envoyé :', info.response || info.messageId),
            err => journal.error("Envoi du mail de suggestion impossible :", err.message),
        );
    }

    // --- API administrateur
    /** Retrouve la suggestion `index` en vérifiant qu'elle n'a pas changé depuis l'affichage. */
    function retrouver(liste, index, original) {
        const identique = ft => original && COLONNES.every(c => (ft[c] || '') === (original[c] || ''));
        const i = Number(index);
        if (Number.isInteger(i) && liste[i] && identique(liste[i])) return i;
        const ailleurs = liste.findIndex(identique);
        if (ailleurs >= 0) return ailleurs;
        throw new ErreurHttp(409, 'Cet élément a été modifié entre-temps. Rechargez la page.');
    }

    /** Retrouve l'établissement `id` et vérifie sa version (modification concurrente -> 409). */
    function retrouverParId(liste, id, versionAttendue) {
        const i = liste.findIndex(ft => ft.id === id);
        if (i < 0) throw new ErreurHttp(404, 'Établissement introuvable (supprimé entre-temps ?). Rechargez la page.');
        if (String(versionAttendue) !== liste[i].version) {
            throw new ErreurHttp(409, 'Cet établissement a été modifié entre-temps. Rechargez la page.');
        }
        return i;
    }

    async function validerOuErreur(donnees) {
        const lieux = (await stockage.lireLieux()).map(l => l.id);
        const { foodtruck, erreurs } = validerFoodtruck(donnees, { lieux });
        if (erreurs.length) throw new ErreurHttp(400, 'Données invalides.', erreurs);
        return foodtruck;
    }

    app.get('/api/admin/suggestions', async (req, res, next) => {
        try { res.json(await stockage.lireAValider()); } catch (err) { next(err); }
    });

    app.post('/api/admin/suggestions/:index/valider', async (req, res, next) => {
        try {
            const foodtruck = await validerOuErreur(req.body.foodtruck);
            let publie;
            await stockage.enSerie(async () => {
                const attente = await stockage.lireAValider();
                const i = retrouver(attente, req.params.index, req.body.original);
                const liste = await stockage.lireFoodtrucks();
                const jour = aujourdhui();
                publie = { ...foodtruck, id: nouvelId(liste.map(f => f.id)), cree_le: jour, maj_le: jour, version: '1' };
                await stockage.ecrireFichier(config.fichierFoodtrucks, [...liste, publie]);
                attente.splice(i, 1);
                await stockage.ecrireFichier(config.fichierAValider, attente);
            });
            evenement(req, 'admin_validation', publie.id);
            res.json({ message: `« ${foodtruck.nom} » est maintenant publié.`, foodtruck: publie });
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
            evenement(req, 'admin_rejet');
            res.json({ message: `Suggestion « ${nom} » rejetée.` });
        } catch (err) { next(err); }
    });

    app.get('/api/admin/foodtrucks', async (req, res, next) => {
        try { res.json(await stockage.lireFoodtrucks()); } catch (err) { next(err); }
    });

    app.post('/api/admin/foodtrucks', async (req, res, next) => {
        try {
            const ajoute = await stockage.ajouterFoodtruck(await validerOuErreur(req.body));
            evenement(req, 'admin_ajout', ajoute.id);
            res.status(201).json({ message: `« ${ajoute.nom} » ajouté.`, foodtruck: ajoute });
        } catch (err) { next(err); }
    });

    app.put('/api/admin/foodtrucks/:id', async (req, res, next) => {
        try {
            const donnees = await validerOuErreur(req.body.foodtruck);
            let modifie;
            await stockage.modifier(config.fichierFoodtrucks, liste => {
                const i = retrouverParId(liste, req.params.id, req.body.version);
                const ancien = liste[i];
                modifie = { ...ancien, ...donnees, maj_le: aujourdhui(), version: String(Number(ancien.version) + 1) };
                return liste.map((ft, j) => (j === i ? modifie : ft));
            });
            evenement(req, 'admin_modification', modifie.id);
            res.json({ message: `« ${modifie.nom} » modifié.`, foodtruck: modifie });
        } catch (err) { next(err); }
    });

    app.delete('/api/admin/foodtrucks/:id', async (req, res, next) => {
        try {
            let nom;
            await stockage.modifier(config.fichierFoodtrucks, liste => {
                const i = retrouverParId(liste, req.params.id, req.body.version);
                nom = liste[i].nom;
                return liste.filter((_, j) => j !== i);
            });
            evenement(req, 'admin_suppression', req.params.id);
            res.json({ message: `« ${nom} » supprimé définitivement.` });
        } catch (err) { next(err); }
    });

    app.get('/api/admin/export/foodtrucks.csv', async (req, res, next) => {
        try {
            res.attachment('foodtrucks.csv').type('text/csv; charset=utf-8')
                .send(depuisFoodtrucks(await stockage.lireFoodtrucks()));
        } catch (err) { next(err); }
    });

    // Lieux
    app.get('/api/admin/lieux', async (req, res, next) => {
        try {
            const [lieux, liste] = await Promise.all([stockage.lireLieux(), stockage.lireFoodtrucks()]);
            res.json(lieux.map(l => ({ ...l, utilisations: liste.filter(ft => ft.lieu === l.id).length })));
        } catch (err) { next(err); }
    });

    function lieuOuErreur(donnees) {
        const { lieu, erreurs } = validerLieu(donnees);
        if (erreurs.length) throw new ErreurHttp(400, 'Lieu invalide.', erreurs);
        return lieu;
    }

    app.post('/api/admin/lieux', async (req, res, next) => {
        try {
            const lieu = lieuOuErreur(req.body);
            let ajoute;
            await stockage.modifierLieux(lieux => {
                const base = slug(lieu.nom);
                let id = base;
                for (let n = 2; lieux.some(l => l.id === id); n++) id = `${base}-${n}`;
                ajoute = { id, ...lieu };
                return [...lieux, ajoute];
            });
            evenement(req, 'admin_lieu', ajoute.id);
            res.status(201).json({ message: `Lieu « ${ajoute.nom} » ajouté.`, lieu: ajoute });
        } catch (err) { next(err); }
    });

    app.put('/api/admin/lieux/:id', async (req, res, next) => {
        try {
            const lieu = lieuOuErreur(req.body);
            await stockage.modifierLieux(lieux => {
                if (!lieux.some(l => l.id === req.params.id)) throw new ErreurHttp(404, 'Lieu introuvable.');
                return lieux.map(l => (l.id === req.params.id ? { id: l.id, ...lieu } : l));
            });
            evenement(req, 'admin_lieu', req.params.id);
            res.json({ message: `Lieu « ${lieu.nom} » modifié.` });
        } catch (err) { next(err); }
    });

    app.delete('/api/admin/lieux/:id', async (req, res, next) => {
        try {
            const utilise = (await stockage.lireFoodtrucks()).filter(ft => ft.lieu === req.params.id);
            if (utilise.length) {
                throw new ErreurHttp(409, `Ce lieu est utilisé par ${utilise.length} établissement(s) : changez-leur d'abord de lieu.`);
            }
            await stockage.modifierLieux(lieux => {
                if (!lieux.some(l => l.id === req.params.id)) throw new ErreurHttp(404, 'Lieu introuvable.');
                return lieux.filter(l => l.id !== req.params.id);
            });
            evenement(req, 'admin_lieu', req.params.id);
            res.json({ message: 'Lieu supprimé.' });
        } catch (err) { next(err); }
    });

    app.get('/api/admin/export/lieux.csv', async (req, res, next) => {
        try {
            res.attachment('lieux.csv').type('text/csv; charset=utf-8').send(depuisLieux(await stockage.lireLieux()));
        } catch (err) { next(err); }
    });

    app.get('/api/admin/statistiques', async (req, res, next) => {
        try {
            const dateValide = d => (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : undefined);
            const r = await statistiques.calculer(dateValide(req.query.debut), dateValide(req.query.fin));
            const noms = Object.fromEntries((await stockage.lireFoodtrucks()).map(ft => [ft.id, ft.nom]));
            r.noms = noms; // pour afficher les établissements consultés par leur nom
            res.json(r);
        } catch (err) { next(err); }
    });

    // --- 404 et erreurs
    app.use('/api', (req, res) => res.status(404).json({ error: 'Adresse inconnue.' }));
    app.use((req, res) => res.status(404).sendFile(path.join(DOSSIER_PUBLIC, '404.html')));
    // eslint-disable-next-line no-unused-vars
    app.use((err, req, res, next) => {
        if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Requête trop volumineuse.' });
        if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Requête invalide.' });
        const statut = err.statut || 500;
        if (statut >= 500) journal.error(err);
        res.status(statut).json({ error: statut >= 500 ? 'Erreur interne du serveur.' : err.message, details: err.details });
    });

    app.locals.stockage = stockage;
    app.locals.statistiques = statistiques;
    return app;
}

module.exports = { creerApplication };
