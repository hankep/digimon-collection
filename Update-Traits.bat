@echo off
REM Doppelklick: laedt fehlende Trait-Daten (digi_type1-4) pro Karte und
REM schreibt sie als 'traits'-Array in data\cards.data.js. Idempotent.

cd /d "%~dp0"

where python >nul 2>nul
if %ERRORLEVEL% equ 0 (
  python scripts\backfill-traits.py %*
  goto :end
)
where py >nul 2>nul
if %ERRORLEVEL% equ 0 (
  py scripts\backfill-traits.py %*
  goto :end
)

echo Fehler: Python nicht gefunden.
echo Bitte Python 3 von https://www.python.org/downloads/ installieren.

:end
echo.
pause
