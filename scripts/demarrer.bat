@echo off
rem Redemarre Food Trucks (par exemple apres un redemarrage du serveur si pm2 ne l'a pas relance).
cd /d "%~dp0.."
call pm2 describe foodtruck >nul 2>&1 && (call pm2 restart foodtruck) || (call pm2 start ecosystem.config.js)
call pm2 save
