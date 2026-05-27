@echo off
REM Einmaliger Lauf: probt ALLE Karten in data\cards.data.js auf Alt-Arts (_P1, _P2, _P3).

cd /d "%~dp0\.."

where python >nul 2>nul
if %ERRORLEVEL% equ 0 (
  python scripts\sync-cards.py --backfill-alts
  goto :end
)
where py >nul 2>nul
if %ERRORLEVEL% equ 0 (
  py scripts\sync-cards.py --backfill-alts
  goto :end
)

echo Fehler: Python nicht gefunden.
echo Bitte Python 3 von https://www.python.org/downloads/ installieren.

:end
echo.
pause
