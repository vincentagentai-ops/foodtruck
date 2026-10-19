@echo off
rem Mise a jour de Food Trucks apres copie des nouveaux fichiers (data\ et .env ne sont pas touches).
cd /d "%~dp0.."
call npm install --omit=dev || goto erreur
call pm2 restart foodtruck || goto erreur
call pm2 save
echo.
echo Mise a jour terminee. Verifiez le site dans le navigateur.
pause
exit /b 0
:erreur
echo.
echo ERREUR : voir le message ci-dessus.
pause
exit /b 1
