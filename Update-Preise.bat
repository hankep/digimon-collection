@echo off
REM Doppelklick: baut data\prices.data.js aus den lokalen Cardmarket-JSONs.
REM Voraussetzung: price_guide_17.json und products_singles_17.json liegen im Projekt-Root.

cd /d "%~dp0"

where python >nul 2>nul
if %ERRORLEVEL% equ 0 (
  python scripts\sync-prices.py %*
  goto :end
)
where py >nul 2>nul
if %ERRORLEVEL% equ 0 (
  py scripts\sync-prices.py %*
  goto :end
)

echo Fehler: Python nicht gefunden.
echo Bitte Python 3 von https://www.python.org/downloads/ installieren.

:end
echo.
pause
