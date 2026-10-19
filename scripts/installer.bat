@echo off
rem Premiere installation de Food Trucks sur le serveur Windows (a lancer depuis le dossier du site).
cd /d "%~dp0.."
rem Le zip de livraison contient node_modules : npm n'est utilise que s'il manque
if not exist node_modules\express (
    call npm install --omit=dev || goto erreur
)
if not exist .env (
    copy .env.example .env >nul
    echo Fichier .env cree : ouvrez-le pour regler PORT, ADMIN_PASSWORD, CONTACT_EMAIL et SMTP_HOST.
    notepad .env
)
call pm2 start ecosystem.config.js || goto erreur
call pm2 save
echo.
echo Installation terminee. Verifiez le site dans le navigateur.
pause
exit /b 0
:erreur
echo.
echo ERREUR : voir le message ci-dessus.
pause
exit /b 1
