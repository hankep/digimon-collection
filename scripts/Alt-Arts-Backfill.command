#!/bin/bash
# Einmaliger Lauf: probt ALLE Karten in cards.data.js auf Alt-Arts (_P1, _P2, _P3)
# und aktualisiert altImages entsprechend. Dauert ~15–25 min für ~4000 Karten.

cd "$(dirname "$0")/.." || exit 1

if ! command -v python3 >/dev/null 2>&1; then
  echo "Fehler: python3 nicht gefunden."
  read -r -p "Enter zum Schließen …"
  exit 1
fi

python3 scripts/sync-cards.py --backfill-alts
echo ""
read -r -p "Fertig. Enter zum Schließen …"
