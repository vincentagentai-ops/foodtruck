#!/bin/sh
# Crée foodtruck-<version>.zip à copier sur le serveur (sans node_modules, data, .env).
cd "$(dirname "$0")/.." || exit 1
VERSION=$(node -p "require('./package.json').version")
ZIP="livraisons/foodtruck-$VERSION.zip"
mkdir -p livraisons && rm -f "$ZIP"
zip -qr "$ZIP" server.js package.json package-lock.json ecosystem.config.js .env.example README.md CHANGELOG.md \
    src public scripts docs data-exemple
echo "Paquet prêt : $ZIP"
