@echo off
REM Doppelklick: laedt neue Karten von digimoncard.io und aktualisiert data\cards.data.js.

cd /d "%~dp0"

where python >nul 2>nul
if %ERRORLEVEL% equ 0 (
  python scripts\sync-cards.py %*
  goto :end
)
where py >nul 2>nul
if %ERRORLEVEL% equ 0 (
  py scripts\sync-cards.py %*
  goto :end
)

echo Fehler: Python nicht gefunden.
echo Bitte Python 3 von https://www.python.org/downloads/ installieren.

:end
echo.
pause
