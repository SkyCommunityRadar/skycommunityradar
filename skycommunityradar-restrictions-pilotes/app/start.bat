@echo off
REM Met a jour le frontend (build) puis relance en mode tunnel Cloudflare.
REM A lancer depuis la RACINE du projet (la ou se trouvent frontend\ et backend\).

set ROOT=%~dp0
cd /d "%ROOT%"

if not exist "frontend\package.json" (
  echo [ERREUR] Lance ce script depuis la racine du projet SkyCommunity.
  pause
  exit /b 1
)

echo [1/3] Copie OK - build du frontend...
cd frontend
if not exist "node_modules" (
  echo Installation des dependances...
  call npm ci
  if errorlevel 1 call yarn install
)
call npm run build
if errorlevel 1 (
  echo [ERREUR] npm run build a echoue.
  pause
  exit /b 1
)
cd ..

if not exist "frontend\dist\index.html" (
  echo [ERREUR] frontend\dist\index.html introuvable apres le build.
  pause
  exit /b 1
)

echo [2/3] Build OK.
echo [3/3] Relance start-prod avec -rebuild...
if exist "start-prod.bat" (
  call start-prod.bat -rebuild
) else (
  echo start-prod.bat introuvable.
  echo Lance manuellement le backend + cloudflared, puis hard-refresh le navigateur (Ctrl+Shift+R).
)

echo.
echo Apres ouverture du site : Ctrl+Shift+R pour forcer le rechargement.
pause
