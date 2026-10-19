@echo off
rem Mise a jour de Food Trucks a partir du zip de livraison.
rem 1. Extraire le zip dans un dossier temporaire (ex. C:\SITES\foodtruck-maj).
rem 2. Double-cliquer sur scripts\mettre-a-jour.bat DE CE DOSSIER TEMPORAIRE.
rem Le site mis a jour est C:\SITES\FoodTrucksNodejs (ou le dossier passe en premier argument).
rem src, public, admin, scripts, docs, data-exemple et node_modules sont remplaces entierement (robocopy /MIR) ;
rem data\, sauvegardes\ et .env ne sont jamais touches. npm n'est pas utilise.
setlocal
for %%I in ("%~dp0..") do set "SOURCE=%%~fI"
set "CIBLE=%~1"
if "%CIBLE%"=="" set "CIBLE=C:\SITES\FoodTrucksNodejs"
for %%I in ("%CIBLE%") do set "CIBLE=%%~fI"
if /I "%SOURCE%"=="%CIBLE%" (
    echo ERREUR : lancez ce script depuis le dossier ou le zip a ete extrait, pas depuis le site installe.
    goto erreur
)
if not exist "%CIBLE%\server.js" (
    echo ERREUR : aucun site trouve dans %CIBLE%
    goto erreur
)
if not exist "%SOURCE%\node_modules\express" (
    echo ERREUR : node_modules absent du paquet ^(zip incomplet^).
    goto erreur
)
echo Mise a jour de %CIBLE%
echo   depuis %SOURCE%

rem 1. Copie de securite de data\ (en plus de la sauvegarde quotidienne automatique)
for /f %%D in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set "HORODATAGE=%%D"
robocopy "%CIBLE%\data" "%CIBLE%\sauvegardes\avant-mise-a-jour-%HORODATAGE%" /E /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 goto erreur
echo Copie de data\ : %CIBLE%\sauvegardes\avant-mise-a-jour-%HORODATAGE%

rem 2. Arret du site
call pm2 stop foodtruck >nul 2>&1

rem 3. Remplacement complet des dossiers de code (les fichiers retires de la nouvelle version disparaissent)
for %%R in (src public admin scripts docs data-exemple node_modules) do (
    robocopy "%SOURCE%\%%R" "%CIBLE%\%%R" /MIR /NFL /NDL /NJH /NJS /NP >nul
    if errorlevel 8 goto erreur
)

rem 4. Fichiers a la racine (.env n'est pas dans le paquet)
for %%F in (server.js package.json package-lock.json ecosystem.config.js .env.example README.md CHANGELOG.md) do (
    copy /Y "%SOURCE%\%%F" "%CIBLE%\%%F" >nul || goto erreur
)

rem 5. Redemarrage (la migration eventuelle des donnees se fait au demarrage, avec copie de sauvegarde)
cd /d "%CIBLE%"
call pm2 restart foodtruck || call pm2 start ecosystem.config.js || goto erreur
call pm2 save
echo.
echo Mise a jour terminee. Verifiez le site dans le navigateur, puis supprimez le dossier temporaire.
pause
exit /b 0
:erreur
echo.
echo ERREUR : voir le message ci-dessus. Le site n'a peut-etre pas redemarre : scripts\demarrer.bat
pause
exit /b 1
