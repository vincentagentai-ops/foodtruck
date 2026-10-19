'use strict';

// Contrastes des couleurs principales (WCAG 2.1, niveau AA : 4,5 pour le texte, 3 pour les éléments graphiques),
// pour le thème clair et le thème sombre de public/css/styles.css. Et quelques règles d'accessibilité des pages.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const CSS = fs.readFileSync(path.join(__dirname, '..', 'public', 'css', 'styles.css'), 'utf8');

/** Variables --nom: #rrggbb d'un bloc de texte. */
function variables(bloc) {
    const v = {};
    for (const [, nom, valeur] of bloc.matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\b/g)) v[nom] = valeur;
    return v;
}

const clair = variables(CSS.slice(CSS.indexOf(':root {'), CSS.indexOf('}', CSS.indexOf(':root {'))));
const debutSombre = CSS.indexOf('@media (prefers-color-scheme: dark)');
const sombre = { ...clair, ...variables(CSS.slice(debutSombre, CSS.indexOf('}', CSS.indexOf(':root {', debutSombre)))) };

function luminance(hex) {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
        .map(c => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contraste(a, b) {
    const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (l1 + 0.05) / (l2 + 0.05);
}

// [texte, fond] : texte courant de l'interface
const PAIRES_TEXTE = [
    ['texte', 'fond'], ['texte', 'surface'], ['texte', 'surface-alt'], ['texte', 'survol'],
    ['texte-2', 'fond'], ['texte-2', 'surface'], ['texte-2', 'surface-alt'],
    ['lien', 'fond'], ['lien', 'surface'], ['lien', 'surface-alt'], ['lien', 'jaune-fond'], ['lien', 'vert-fond'],
    ['accent', 'surface'], ['accent', 'badge-fond'],
    ['sur-primaire', 'primaire'], ['sur-primaire', 'primaire-fonce'], ['sur-primaire', 'secondaire'], ['sur-primaire', 'secondaire-fonce'],
    ['sur-primaire', 'erreur'], ['sur-primaire', 'erreur-fonce'], ['sur-primaire', 'succes'], ['sur-primaire', 'succes-fonce'],
    ['sur-primaire', 'attention'],
    ['erreur-texte', 'surface'], ['succes-texte', 'surface'], ['attention-texte', 'surface'],
    ['attention-texte', 'jaune-fond'], ['attention-texte', 'ambre-badge'],
    ['rouge-texte', 'rouge-fond'], ['vert-texte', 'vert-fond'], ['vert-texte', 'vert-badge'],
    ['texte', 'jaune-fond'], ['texte', 'vert-fond'], ['texte', 'rouge-fond'], ['texte', 'orange-fond'],
];
// [élément, fond] : éléments graphiques (contour des champs, étoiles)
const PAIRES_GRAPHIQUES = [['bordure-champ', 'surface'], ['etoile', 'surface'], ['notation-vide', 'jaune-fond'], ['favori', 'surface']];

for (const [nomTheme, theme] of [['clair', clair], ['sombre', sombre]]) {
    test(`Contrastes AA du thème ${nomTheme}`, () => {
        const echecs = [];
        for (const [a, b] of PAIRES_TEXTE) {
            assert.ok(theme[a] && theme[b], `variable manquante : --${theme[a] ? b : a}`);
            const c = contraste(theme[a], theme[b]);
            if (c < 4.5) echecs.push(`--${a} sur --${b} : ${c.toFixed(2)}`);
        }
        for (const [a, b] of PAIRES_GRAPHIQUES) {
            const c = contraste(theme[a], theme[b]);
            if (c < 3) echecs.push(`--${a} sur --${b} (graphique) : ${c.toFixed(2)}`);
        }
        assert.deepEqual(echecs, []);
    });
}

test('Le thème sombre redéfinit toutes les couleurs du thème clair', () => {
    const redefinies = variables(CSS.slice(debutSombre, CSS.indexOf('}', CSS.indexOf(':root {', debutSombre))));
    assert.deepEqual(Object.keys(clair).filter(k => !(k in redefinies)), []);
});

test('Pages publiques : langue, titre, lien d\'évitement, champs étiquetés', () => {
    const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
    assert.match(page, /<html lang="fr">/);
    assert.match(page, /class="aller-contenu" href="#titreResultat"/);
    for (const [, id] of page.matchAll(/<(?:input|select|textarea)[^>]*\bid="([^"]+)"/g)) {
        const etiquete = new RegExp(`for="${id}"`).test(page) || new RegExp(`id="${id}"[^>]*aria-label=|aria-label=[^>]*id="${id}"`).test(page)
            || new RegExp(`<label[^>]*>\\s*<input[^>]*id="${id}"`).test(page);
        assert.ok(etiquete, `champ sans étiquette : #${id}`);
    }
});
