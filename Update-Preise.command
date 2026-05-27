#!/bin/bash
# Doppelklick → baut prices.data.js aus den lokalen Cardmarket-JSONs.
# Voraussetzung: price_guide_17.json und products_singles_17.json liegen im Projekt-Root.

cd "$(dirname "$0")" || exit 1

if ! command -v python3 >/dev/null 2>&1; then
  echo "Fehler: python3 nicht gefunden."
  echo "Bitte einmal 'xcode-select --install' im Terminal ausführen."
  read -r -p "Enter zum Schließen …"
  exit 1
fi

python3 scripts/sync-prices.py "$@"
echo ""
read -r -p "Fertig. Enter zum Schließen …"
