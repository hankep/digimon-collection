#!/bin/bash
# Doppelklick → lädt neue Karten von digimoncard.io und aktualisiert cards.data.js.

cd "$(dirname "$0")" || exit 1

if ! command -v python3 >/dev/null 2>&1; then
  echo "Fehler: python3 nicht gefunden."
  echo "Bitte einmal 'xcode-select --install' im Terminal ausführen."
  read -r -p "Enter zum Schließen …"
  exit 1
fi

python3 scripts/sync-cards.py "$@"
echo ""
read -r -p "Fertig. Enter zum Schließen …"
