#!/bin/bash
# Doppelklick → holt fehlende Trait-Daten (digi_type1-4) pro Karte aus der
# digimoncard.io-API und schreibt sie als 'traits'-Array in cards.data.js.
# Idempotent: bereits angereicherte Karten werden uebersprungen (--force fuer Re-Fetch).

cd "$(dirname "$0")" || exit 1

if ! command -v python3 >/dev/null 2>&1; then
  echo "Fehler: python3 nicht gefunden."
  echo "Bitte einmal 'xcode-select --install' im Terminal ausführen."
  read -r -p "Enter zum Schließen …"
  exit 1
fi

python3 scripts/backfill-traits.py "$@"
echo ""
read -r -p "Fertig. Enter zum Schließen …"
