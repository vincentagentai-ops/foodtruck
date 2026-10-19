#!/bin/sh
# Crée livraisons/foodtruck-<version>.zip, autonome : il contient node_modules (dépendances de production,
# installées ici) pour que le serveur n'ait jamais besoin du registre npm. Ni data/ ni .env.
set -e
cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./package.json').version")
ZIP="$PWD/livraisons/foodtruck-$VERSION.zip"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
mkdir -p livraisons && rm -f "$ZIP"
cp -r server.js package.json package-lock.json ecosystem.config.js .env.example README.md CHANGELOG.md \
    src public admin scripts docs data-exemple "$TMP/"
# Dépendances de production (JavaScript pur, sans compilation : valables sous Windows)
if ! (cd "$TMP" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund >/dev/null 2>&1); then
    echo "npm ci impossible (pas d'accès au registre ?) : copie du node_modules local."
    cp -r node_modules "$TMP/"
fi
(cd "$TMP" && zip -qr "$ZIP" .)
echo "Paquet prêt : $ZIP ($(du -h "$ZIP" | cut -f1))"
