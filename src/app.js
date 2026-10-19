'use strict';

// Application Express : pages publiques, API publique collaborative, espace administrateur protégé.

const express = require('express');
const path = require('path');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { Stockage, ErreurHttp } = require('./stockage');
const {
    validerFoodtruck, validerLieu, slug, JOURS, TYPES, CATEGORIES, ETIQUETTES, PAIEMENTS,
} = require('./validation');
const { COLONNES, depuisFoodtrucks, depuisLieux, depuisObjets } = require('./csv');
const audience = require('./audience');
const identite = require('./identite');
const { Statistiques } = require('./statistiques');
const { Limiteur, limiter } = require('./limites');
const { Etablissements, CHAMPS_FACTUELS, LIBELLES_CHAMPS, chercherDoublons, champsModifies } = require('./etablissements');
const { Contributions, CRITERES, TYPES_SIGNALEMENT } = require('./contributions');
const { version } = require('../package.json');

const DOSSIER_PUBLIC = path.join(__dirname, '..', 'public');
// Pages d'administration : hors de public/ pour qu'aucune variante d'adresse ne les serve sans mot de passe
const DOSSIER_ADMIN = path.join(__dirname, '..', 'admin');
// Chart.js n'exporte pas ses fichiers dist : chemin déduit de son point d'entrée (dist/chart.cjs)
const CHART_JS = path.join(path.dirname(require.resolve('chart.js')), 'chart.umd.min.js');
const EXTENSIONS_STATIQUES = /\.(css|js|png|jpe?g|svg|ico|woff2?|map)$/i;
const METHODES_ECRITURE = ['POST', 'PUT', 'PATCH', 'DELETE'];

const CSP = [
    "default-src 'self'", "script-src 'self'", "style-src 'self'", "img-src 'self' data:", "connect-src 'self'",
    "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
].join('; ');

// Champs repris dans le mail envoyé à l'administrateur lors d'un ajout
const CHAMPS_MAIL = ['nom', 'type', 'cuisine', 'categorie', 'jours', 'horaires', 'prix', 'paiements', 'emplacement', 'site'];

/** L'en-tête Origin désigne-t-il ce site ? (même hôte que la requête, ou hôte autorisé par la configuration) */
function origineAutorisee(origine, hote, autorises = []) {
    let url;
    try { url = new URL(origine); } catch { return false; }
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    const h = url.host.toLowerCase();
    return h === String(hote || '').toLowerCase() || autorises.includes(h) || autorises.includes(url.hostname.toLowerCase());
}

function creerApplication(config, options = {}) {
    const stockage = new Stockage(config);
    const journal = options.journal || console;
    const horloge = options.horloge || (() => new Date());
    const statistiques = new Statistiques(stockage, { journal });
    let contributions;
    const etablissements = new Etablissements(stockage, { horloge, journal, moderation: () => contributions.seuils() });
    contributions = new Contributions(stockage, etablissements, { horloge });
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

    // --- Écritures : uniquement depuis les pages du site (en-tête Origin) et en JSON (T7).
    // Un navigateur envoie toujours Origin sur un POST / PUT / DELETE ; une autre origine est refusée.
    app.use((req, res, next) => {
        if (!METHODES_ECRITURE.includes(req.method)) return next();
        const origine = req.headers.origin;
        if (origine !== undefined && !origineAutorisee(origine, req.headers.host, config.hotesAutorises)) {
            return res.status(403).json({ error: "Requête refusée : elle ne provient pas d'une page de ce site." });
        }
        if (!/^application\/json\b/i.test(req.headers['content-type'] || '')) {
            return res.status(415).json({ error: 'Format attendu : JSON (Content-Type: application/json).' });
        }
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
            req.cookieExistant = true;
        } else {
            req.idNavigateur = audience.nouvelIdNavigateur();
            res.append('Set-Cookie', audience.enteteCookie(req.idNavigateur));
        }
        next();
    });
    const navigateurDe = req => audience.hacher(stockage.secret, req.idNavigateur);
    // Jeton d'auteur des contributions : autre clé que l'audience (non reliable aux journaux d'audience).
    // Exige un cookie déjà présent : sans cookie, chaque requête serait un « nouvel auteur ».
    let cleAuteur = null;
    const auteurDe = req => {
        if (!req.cookieExistant) return null;
        cleAuteur = cleAuteur || identite.cleAuteur(stockage.secret);
        return identite.jetonAuteur(cleAuteur, req.idNavigateur);
    };
    function pseudoDe(req) {
        const { pseudo, erreur } = identite.validerPseudo(req.body && req.body.pseudo);
        if (erreur) throw new ErreurHttp(400, erreur, [erreur]);
        return pseudo;
    }

    /** Évènement d'audience typé, écrit dans usage-AAAA-MM.jsonl (sans IP). */
    function evenement(req, type, cible = '', page = '', extra = {}) {
        const maintenant = new Date();
        return stockage.journaliser(audience.fichierMensuel(config.dossierDonnees, 'usage', 'jsonl', maintenant), {
            ts: maintenant.toISOString(), v: req ? navigateurDe(req) : null, type, cible, page, version, ...extra,
        }).catch(err => journal.error("Écriture du journal d'usage impossible :", err.message));
    }
    /** Contribution comptée par le serveur, SANS identifiant de navigateur (non reliable à l'audience). */
    const compter = (type, cible = '') => evenement(null, type, cible);

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
    const limiteContributions = limiter(new Limiteur({ max: config.limites.contributions }), clesLimite);
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
    /** Route asynchrone : les erreurs vont au gestionnaire d'erreurs. */
    const route = traitement => (req, res, next) => Promise.resolve(traitement(req, res, next)).catch(next);

    // --- Compatibilité avec les anciennes adresses
    app.get(['/administration.html', '/generationCSV.html', '/ajouterFoodtruck.html'], (req, res) => res.redirect(301, '/admin/'));
    app.get('/statistiques.html', (req, res) => res.redirect(301, '/admin/statistiques.html'));
    app.get('/data/Foodtruck_logo.PNG', (req, res) => res.redirect(301, '/img/logo.png'));
    app.get('/data/foodtrucks.csv', route(async (req, res) => {
        res.type('text/csv; charset=utf-8').send(depuisFoodtrucks(publics(await stockage.lireFoodtrucks()), { export: true }));
    }));

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

    // --- API publique : lecture
    app.get('/api/config', route(async (req, res) => {
        const seuils = await contributions.seuils();
        res.json({
            titre: config.titre, environnement: config.environnement, contactEmail: config.contactEmail, version,
            jours: JOURS, types: TYPES, categories: CATEGORIES, etiquettes: ETIQUETTES, paiements: PAIEMENTS,
            criteres: CRITERES, signalements: TYPES_SIGNALEMENT, champs: LIBELLES_CHAMPS,
            delaiGraceMinutes: seuils.delaiGraceMinutes, avisMinimum: 3,
        });
    }));

    app.get('/api/foodtrucks', route(async (req, res) => {
        res.json(publics(await stockage.lireFoodtrucks()));
    }));

    app.get('/api/lieux', route(async (req, res) => {
        res.json(await stockage.lireLieux());
    }));

    /** Liste publique enrichie : note, présence du jour, fermetures, signalements « plus présent ». */
    app.get('/api/etablissements', route(async (req, res) => {
        const etat = await contributions.etat();
        const auteur = auteurDe(req);
        const liste = publics(await etablissements.lister()).map(ft => ({ ...ft, resume: contributions.resume(etat, ft.id, auteur) }));
        res.json({ date: contributions.aujourdhui(), etablissements: liste, alias: etat.alias });
    }));

    app.get('/api/doublons', route(async (req, res) => {
        const texte = v => (typeof v === 'string' ? v.slice(0, 1000) : '');
        const candidat = { nom: texte(req.query.nom), lieu: texte(req.query.lieu), emplacement: texte(req.query.emplacement) };
        res.json(chercherDoublons(await etablissements.lister(), candidat, texte(req.query.sauf) || null));
    }));

    /** Fiche publique (non archivée) : infos, résumé, avis, avis de ce navigateur, délai de grâce. */
    async function fichePublique(id) {
        const ft = await etablissements.trouver(id);
        if (ft.statut === 'archive') throw new ErreurHttp(404, 'Cet établissement a été archivé.');
        return ft;
    }

    app.get('/api/etablissements/:id', route(async (req, res) => {
        const ft = await fichePublique(req.params.id);
        const etat = await contributions.etat();
        const auteur = auteurDe(req);
        res.json({
            etablissement: ft,
            resume: contributions.resume(etat, ft.id, auteur),
            avis: contributions.avisPublics(etat, ft.id, auteur),
            monAvis: contributions.monAvis(etat, ft.id, auteur),
            grace: await etablissements.dansGrace(ft.id, auteur),
        });
    }));

    app.get('/api/etablissements/:id/historique', route(async (req, res) => {
        const ft = await etablissements.trouver(req.params.id);
        const alias = await etablissements.alias();
        const anciens = Object.keys(alias).filter(a => alias[a] === ft.id);
        const entrees = (await etablissements.historique()).filter(e => e.cible === ft.id || anciens.includes(e.cible));
        // Version d'avant la première modification enregistrée (fiches antérieures à l'historique) : restaurable aussi
        const apres = new Set(entrees.filter(e => e.cible === ft.id && e.apres).map(e => e.apres.version));
        const versionAvant = e => (e.cible === ft.id && e.avant && e.avant.version && !apres.has(e.avant.version)
            && e.avant.version !== ft.version ? e.avant.version : '');
        res.json({
            version: ft.version,
            entrees: entrees.reverse().map(e => ({
                ts: e.ts, version: e.version, action: e.action, pseudo: e.pseudo || '', raison: e.raison || '',
                parAdmin: e.auteur === 'admin', automatique: e.auteur === 'systeme',
                ancienneFiche: e.cible !== ft.id ? (e.avant || {}).nom || e.cible : '',
                champs: (e.action === 'creer' ? [] : champsModifies(e.avant, e.apres)).map(c => ({
                    champ: c, libelle: LIBELLES_CHAMPS[c] || c, avant: (e.avant || {})[c] || '', apres: (e.apres || {})[c] || '',
                })),
                restaurable: e.cible === ft.id && Boolean(e.apres) && e.apres.version !== ft.version,
                versionAvant: versionAvant(e),
            })),
        });
    }));

    app.get('/api/quoi-de-neuf', route(async (req, res) => {
        res.json(await contributions.quoiDeNeuf(30));
    }));

    // --- API publique : contributions (publication immédiate, auteur = jeton de navigateur)

    async function auteurAutorise(req) {
        const auteur = auteurDe(req);
        await contributions.verifierAuteur(auteur);
        return auteur;
    }

    async function validerOuErreur(donnees, { admin = false } = {}) {
        const lieux = (await stockage.lireLieux()).map(l => l.id);
        const { foodtruck, erreurs } = validerFoodtruck(donnees, { lieux });
        if (erreurs.length) throw new ErreurHttp(400, admin ? 'Données invalides.' : 'Informations incomplètes ou invalides.', erreurs);
        return foodtruck;
    }

    function envoyerMail(sujet, texte) {
        if (!transporteur || !config.mail.destinataire) return;
        transporteur.sendMail({ from: config.mail.expediteur, to: config.mail.destinataire, subject: sujet, text: texte }).then(
            info => journal.log('Mail envoyé :', info.response || info.messageId),
            err => journal.error("Envoi du mail impossible :", err.message),
        );
    }

    // C1 : ajout publié immédiatement (doublons signalés dans la réponse, sans blocage)
    app.post('/api/etablissements', limiteContributions, route(async (req, res) => {
        const auteur = await auteurAutorise(req);
        const pseudo = pseudoDe(req);
        const donnees = await validerOuErreur(req.body);
        const { fiche, doublons } = await etablissements.creer(donnees, { auteur, pseudo });
        compter('ajout', fiche.id);
        const corps = CHAMPS_MAIL.map(c => `${c} : ${fiche[c] || '-'}`).join('\n');
        envoyerMail(`[FoodTrucks] Nouvel établissement publié : ${fiche.nom}`,
            `Un collègue${pseudo ? ` (nom déclaré : ${pseudo})` : ''} a ajouté un établissement, déjà visible par tous :\n\n${corps}\n\n`
            + `Rien à faire si tout va bien. En cas de problème : page « À surveiller » de l'espace administrateur (/admin/).`);
        const { delaiGraceMinutes } = await contributions.seuils();
        res.status(201).json({
            message: `Merci ! « ${fiche.nom} » est visible par tous. Vous pouvez le corriger pendant ${delaiGraceMinutes} min depuis ce navigateur ; ensuite tout le monde peut l'améliorer.`,
            etablissement: fiche, doublons,
        });
    }));
    // Ancienne file de suggestions : les anciennes pages (en cache) publient désormais directement
    app.post(['/api/suggestions', '/api/suggest-foodtruck'], (req, res) => res.redirect(308, '/api/etablissements'));

    // C2 : modification des infos factuelles avec version attendue (409 + différences)
    app.put('/api/etablissements/:id', limiteContributions, route(async (req, res) => {
        const auteur = await auteurAutorise(req);
        const pseudo = pseudoDe(req);
        const ft = await fichePublique(req.params.id);
        const donnees = await validerOuErreur({ ...(req.body.etablissement || {}), statut: ft.statut });
        const { fiche, modifies } = await etablissements.modifier(ft.id, req.body.version, donnees, { auteur, pseudo });
        if (modifies.length) compter('modification', fiche.id);
        res.json({ message: modifies.length ? 'Modification enregistrée. Merci !' : 'Aucun changement.', etablissement: fiche });
    }));

    // Délai de grâce : l'auteur d'un ajout peut le retirer (archivage, restaurable par l'administrateur)
    app.delete('/api/etablissements/:id', limiteContributions, route(async (req, res) => {
        const auteur = await auteurAutorise(req);
        const ft = await fichePublique(req.params.id);
        if (!(await etablissements.dansGrace(ft.id, auteur))) {
            throw new ErreurHttp(403, "Seul l'auteur d'un ajout peut le retirer, et seulement juste après l'avoir publié. Utilisez « Signaler ».");
        }
        if (String(req.body.version) !== ft.version) throw new ErreurHttp(409, 'La fiche a changé entre-temps. Rechargez-la.');
        await etablissements.changerStatut(ft.id, 'archive', { auteur, action: 'retirer', raison: "Retiré par son auteur pendant le délai de grâce." });
        compter('retrait', ft.id);
        res.json({ message: `« ${ft.nom} » a été retiré.` });
    }));

    // C3 : restauration d'une version de l'historique (par tous ; le statut n'est pas restauré)
    app.post('/api/etablissements/:id/restaurer/:version', limiteContributions, route(async (req, res) => {
        const auteur = await auteurAutorise(req);
        const pseudo = pseudoDe(req);
        const ft = await fichePublique(req.params.id);
        const { fiche } = await etablissements.restaurer(ft.id, req.params.version, req.body.versionActuelle, { auteur, pseudo });
        compter('restauration', fiche.id);
        res.json({ message: `Version ${req.params.version} restaurée (nouvelle version ${fiche.version}).`, etablissement: fiche });
    }));

    // C6/C7 : un avis par navigateur et par fiche, modifiable et supprimable par son auteur
    app.post('/api/etablissements/:id/avis', limiteContributions, route(async (req, res) => {
        const auteur = await auteurAutorise(req);
        const pseudo = pseudoDe(req);
        const ft = await fichePublique(req.params.id);
        const { id, action } = await contributions.publierAvis(ft.id, auteur, pseudo, req.body);
        compter(action === 'creer' ? 'avis' : 'avis_modifie', ft.id);
        res.status(action === 'creer' ? 201 : 200).json({ message: action === 'creer' ? 'Avis publié. Merci !' : 'Avis modifié.', id });
    }));

    app.delete('/api/etablissements/:id/avis', limiteContributions, route(async (req, res) => {
        const auteur = await auteurAutorise(req);
        const ft = await fichePublique(req.params.id);
        await contributions.supprimerAvis(ft.id, auteur);
        compter('avis_supprime', ft.id);
        res.json({ message: 'Votre avis a été supprimé.' });
    }));

    // C4 : présence du jour (une déclaration par navigateur, fiche et jour, modifiable)
    app.post('/api/etablissements/:id/presence', limiteContributions, route(async (req, res) => {
        const auteur = await auteurAutorise(req);
        const ft = await fichePublique(req.params.id);
        const etat = await contributions.declarerPresence(ft.id, auteur, req.body.etat);
        compter('presence', ft.id);
        await appliquerSeuils();
        res.json({ message: etat === 'present' ? 'Merci, présence confirmée !' : etat === 'absent' ? 'Merci, absence signalée.' : 'Déclaration retirée.',
            resume: contributions.resume(await contributions.etat(), ft.id, auteur) });
    }));

    // C5 : signalements (effets automatiques : bandeau de fermeture, seuils d'archivage, masquage des avis)
    app.post('/api/signalements', limiteContributions, route(async (req, res) => {
        const auteur = await auteurAutorise(req);
        const ft = await fichePublique(String(req.body.cible || ''));
        const r = await contributions.signaler(ft.id, auteur, req.body);
        if (!r.deja) compter('signalement', ft.id);
        if (r.masque) compter('avis_masque_auto', ft.id);
        await appliquerSeuils();
        res.status(r.deja ? 200 : 201).json({ message: r.deja ? 'Vous aviez déjà fait ce signalement : il est bien pris en compte.' : 'Merci, signalement enregistré.' });
    }));

    async function appliquerSeuils() {
        try {
            for (const c of await contributions.appliquerSeuils()) compter('statut_auto', c.id);
        } catch (err) {
            journal.error('Application des seuils impossible :', err.message);
        }
    }

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

    // --- API administrateur
    /** Retrouve la suggestion héritée `index` en vérifiant qu'elle n'a pas changé depuis l'affichage. */
    function retrouver(liste, index, original) {
        const identique = ft => original && COLONNES.every(c => (ft[c] || '') === (original[c] || ''));
        const i = Number(index);
        if (Number.isInteger(i) && liste[i] && identique(liste[i])) return i;
        const ailleurs = liste.findIndex(identique);
        if (ailleurs >= 0) return ailleurs;
        throw new ErreurHttp(409, 'Cet élément a été modifié entre-temps. Rechargez la page.');
    }

    // Suggestions héritées (ancienne file, 3.1.0) : publiées une dernière fois ou écartées
    app.get('/api/admin/suggestions', route(async (req, res) => {
        res.json(await stockage.lireAValider());
    }));

    app.post('/api/admin/suggestions/:index/valider', route(async (req, res) => {
        const foodtruck = await validerOuErreur(req.body.foodtruck, { admin: true });
        retrouver(await stockage.lireAValider(), req.params.index, req.body.original); // 409 si elle a changé
        const { fiche } = await etablissements.creer(foodtruck, { auteur: 'admin', statut: foodtruck.statut });
        await stockage.modifier(config.fichierAValider, attente => {
            const i = retrouver(attente, req.params.index, req.body.original);
            return attente.filter((_, j) => j !== i);
        });
        evenement(req, 'admin_validation', fiche.id);
        res.json({ message: `« ${fiche.nom} » est maintenant publié.`, foodtruck: fiche });
    }));

    app.delete('/api/admin/suggestions/:index', route(async (req, res) => {
        let nom;
        await stockage.modifier(config.fichierAValider, attente => {
            const i = retrouver(attente, req.params.index, req.body.original);
            nom = attente[i].nom;
            return attente.filter((_, j) => j !== i);
        });
        evenement(req, 'admin_rejet');
        res.json({ message: `Suggestion « ${nom} » écartée.` });
    }));

    app.get('/api/admin/foodtrucks', route(async (req, res) => {
        res.json(await stockage.lireFoodtrucks());
    }));

    app.post('/api/admin/foodtrucks', route(async (req, res) => {
        const ft = await validerOuErreur(req.body, { admin: true });
        const { fiche } = await etablissements.creer(ft, { auteur: 'admin', statut: ft.statut });
        evenement(req, 'admin_ajout', fiche.id);
        res.status(201).json({ message: `« ${fiche.nom} » ajouté.`, foodtruck: fiche });
    }));

    /** Une fiche remise « active » par l'administrateur : ses signalements « n'est plus présent » sont clos. */
    async function apresReactivation(ancien, fiche) {
        if (ancien.statut === 'actif' || fiche.statut !== 'actif') return;
        const etat = await contributions.etat();
        await contributions.traiterSignalements(
            etat.signalements.filter(s => s.cible === fiche.id && s.type === 'plus_present' && s.etat === 'ouvert').map(s => s.id),
            'fiche réactivée par l\'administrateur');
    }

    app.put('/api/admin/foodtrucks/:id', route(async (req, res) => {
        const donnees = await validerOuErreur(req.body.foodtruck, { admin: true });
        const ancien = await etablissements.trouver(req.params.id);
        const { fiche } = await etablissements.modifier(req.params.id, req.body.version, donnees, { auteur: 'admin', admin: true });
        await apresReactivation(ancien, fiche);
        evenement(req, 'admin_modification', fiche.id);
        res.json({ message: `« ${fiche.nom} » modifié.`, foodtruck: fiche });
    }));

    // Suppression définitive (purge) : la fiche et toutes ses contributions
    app.delete('/api/admin/foodtrucks/:id', route(async (req, res) => {
        const ancien = await etablissements.supprimer(req.params.id, req.body.version);
        await contributions.purgerCible(ancien.id);
        evenement(req, 'admin_suppression', req.params.id);
        res.json({ message: `« ${ancien.nom} » supprimé définitivement, avec ses avis, présences, signalements et son historique.` });
    }));

    app.post('/api/admin/etablissements/:id/restaurer/:version', route(async (req, res) => {
        const ancien = await etablissements.trouver(req.params.id);
        const { fiche } = await etablissements.restaurer(req.params.id, req.params.version, req.body.versionActuelle, { auteur: 'admin', admin: true });
        await apresReactivation(ancien, fiche);
        evenement(req, 'admin_restauration', fiche.id);
        res.json({ message: `« ${fiche.nom} » : version ${req.params.version} restaurée (nouvelle version ${fiche.version}).`, foodtruck: fiche });
    }));

    // C14 : fusion de deux fiches (avis, historique et présences rattachés à la fiche conservée)
    app.post('/api/admin/fusion', route(async (req, res) => {
        const fiche = await etablissements.fusionner(String(req.body.garder || ''), String(req.body.absorber || ''));
        evenement(req, 'admin_fusion', fiche.id);
        res.json({ message: `Fiches fusionnées dans « ${fiche.nom} » (version ${fiche.version}).`, foodtruck: fiche });
    }));

    // C12 : « À surveiller »
    app.get('/api/admin/surveillance', route(async (req, res) => {
        const [surveillance, heritees, fiches] = await Promise.all([
            contributions.surveillance(), stockage.lireAValider(), stockage.lireFoodtrucks()]);
        res.json({ ...surveillance, heritees, horsLigne: fiches.filter(f => f.statut !== 'actif') });
    }));

    app.post('/api/admin/signalements/traiter', route(async (req, res) => {
        const ids = Array.isArray(req.body.ids) ? req.body.ids.map(String) : [];
        const n = await contributions.traiterSignalements(ids, String(req.body.decision || '').slice(0, 100));
        evenement(req, 'admin_moderation');
        res.json({ message: `${n} signalement(s) clos.` });
    }));

    app.post('/api/admin/avis/:id/:action(masquer|retablir)', route(async (req, res) => {
        const a = await contributions.moderer(req.params.id, req.params.action);
        evenement(req, 'admin_moderation', a.cible);
        res.json({ message: req.params.action === 'retablir' ? 'Avis rétabli.' : 'Avis masqué.' });
    }));

    app.delete('/api/admin/avis/:id', route(async (req, res) => {
        await contributions.purgerAvis(req.params.id);
        evenement(req, 'admin_purge');
        res.json({ message: 'Avis supprimé définitivement.' });
    }));

    app.post('/api/admin/blocages', route(async (req, res) => {
        const jours = Number(req.body.jours);
        if (!Number.isInteger(jours) || jours < 0 || jours > 365) throw new ErreurHttp(400, 'Durée de blocage : 0 à 365 jours.');
        await contributions.bloquer(req.body.auteur, jours);
        evenement(req, 'admin_blocage');
        res.json({ message: jours ? `Navigateur bloqué ${jours} jour(s).` : 'Navigateur débloqué.' });
    }));

    app.put('/api/admin/moderation', route(async (req, res) => {
        const seuils = await contributions.reglerSeuils(req.body.seuils);
        evenement(req, 'admin_seuils');
        await appliquerSeuils();
        res.json({ message: 'Seuils enregistrés.', seuils });
    }));

    app.get('/api/admin/export/foodtrucks.csv', route(async (req, res) => {
        res.attachment('foodtrucks.csv').type('text/csv; charset=utf-8')
            .send(depuisFoodtrucks(await stockage.lireFoodtrucks(), { export: true }));
    }));

    app.get('/api/admin/export/avis.csv', route(async (req, res) => {
        const etat = await contributions.etat();
        const noms = Object.fromEntries((await stockage.lireFoodtrucks()).map(ft => [ft.id, ft.nom]));
        const lignes = etat.avis.filter(a => !a.supprime).map(a => ({
            id: a.id, etablissement: noms[a.cible] || a.cible, note: a.note, commentaire: a.texte, plat: a.plat,
            qualite_prix: a.criteres.qualite_prix || '', portions: a.criteres.portions || '', attente: a.criteres.attente || '',
            nom_declare: a.pseudo, date: a.maj, etat: a.masque ? 'masqué' : (a.remplace ? 'remplacé' : 'publié'),
        }));
        const colonnes = ['id', 'etablissement', 'note', 'commentaire', 'plat', 'qualite_prix', 'portions', 'attente', 'nom_declare', 'date', 'etat'];
        res.attachment('avis.csv').type('text/csv; charset=utf-8').send(depuisObjets(lignes, colonnes, { export: true }));
    }));

    // Lieux
    app.get('/api/admin/lieux', route(async (req, res) => {
        const [lieux, liste] = await Promise.all([stockage.lireLieux(), stockage.lireFoodtrucks()]);
        const utilise = (ft, id) => ft.lieu === id || String(ft.lieux_jours || '').split(';').some(m => m.split('=')[1] === id);
        res.json(lieux.map(l => ({ ...l, utilisations: liste.filter(ft => utilise(ft, l.id)).length })));
    }));

    function lieuOuErreur(donnees) {
        const { lieu, erreurs } = validerLieu(donnees);
        if (erreurs.length) throw new ErreurHttp(400, 'Lieu invalide.', erreurs);
        return lieu;
    }

    app.post('/api/admin/lieux', route(async (req, res) => {
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
    }));

    app.put('/api/admin/lieux/:id', route(async (req, res) => {
        const lieu = lieuOuErreur(req.body);
        await stockage.modifierLieux(lieux => {
            if (!lieux.some(l => l.id === req.params.id)) throw new ErreurHttp(404, 'Lieu introuvable.');
            return lieux.map(l => (l.id === req.params.id ? { id: l.id, ...lieu } : l));
        });
        evenement(req, 'admin_lieu', req.params.id);
        res.json({ message: `Lieu « ${lieu.nom} » modifié.` });
    }));

    app.delete('/api/admin/lieux/:id', route(async (req, res) => {
        const utilise = (await stockage.lireFoodtrucks())
            .filter(ft => ft.lieu === req.params.id || String(ft.lieux_jours || '').split(';').some(m => m.split('=')[1] === req.params.id));
        if (utilise.length) {
            throw new ErreurHttp(409, `Ce lieu est utilisé par ${utilise.length} établissement(s) : changez-leur d'abord de lieu.`);
        }
        await stockage.modifierLieux(lieux => {
            if (!lieux.some(l => l.id === req.params.id)) throw new ErreurHttp(404, 'Lieu introuvable.');
            return lieux.filter(l => l.id !== req.params.id);
        });
        evenement(req, 'admin_lieu', req.params.id);
        res.json({ message: 'Lieu supprimé.' });
    }));

    app.get('/api/admin/export/lieux.csv', route(async (req, res) => {
        res.attachment('lieux.csv').type('text/csv; charset=utf-8').send(depuisLieux(await stockage.lireLieux(), { export: true }));
    }));

    app.get('/api/admin/statistiques', route(async (req, res) => {
        const dateValide = d => (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : undefined);
        const r = await statistiques.calculer(dateValide(req.query.debut), dateValide(req.query.fin));
        const noms = Object.fromEntries((await stockage.lireFoodtrucks()).map(ft => [ft.id, ft.nom]));
        r.noms = noms; // pour afficher les établissements consultés par leur nom
        res.json(r);
    }));

    // --- 404 et erreurs
    app.use('/api', (req, res) => res.status(404).json({ error: 'Adresse inconnue.' }));
    app.use((req, res) => res.status(404).sendFile(path.join(DOSSIER_PUBLIC, '404.html')));
    // eslint-disable-next-line no-unused-vars
    app.use((err, req, res, next) => {
        if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Requête trop volumineuse.' });
        if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Requête invalide.' });
        const statut = err.statut || 500;
        if (statut >= 500) journal.error(err);
        res.status(statut).json({ error: statut >= 500 ? 'Erreur interne du serveur.' : err.message, details: err.details, ...(err.donnees || {}) });
    });

    app.locals.stockage = stockage;
    app.locals.statistiques = statistiques;
    app.locals.etablissements = etablissements;
    app.locals.contributions = contributions;
    return app;
}

module.exports = { creerApplication, origineAutorisee, CHAMPS_FACTUELS };
