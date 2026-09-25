@echo off
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js 24 or later is required. Install it from https://nodejs.org/
  pause
  exit /b 1
)
node -e "process.exit(Number(process.versions.node.split('.')[0]) >= 24 ? 0 : 1)"
if errorlevel 1 (
  echo Update Node.js to version 24 or later: https://nodejs.org/
  pause
  exit /b 1
)
node launch.mjs
if errorlevel 1 (
  echo REI could not start. Check the error above.
  pause
  exit /b 1
)
