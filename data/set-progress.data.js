// Offizielle Gesamt-Kartenzahl pro Set, solange es noch nicht vollständig
// enthüllt ist (Quelle: world.digimoncard.com Produktseite des Sets).
//
// js/cards.js ergänzt für jede fehlende ID zwischen 1 und dieser Zahl eine
// Platzhalter-Karte ("Noch nicht enthüllt"), damit das Set vollständig
// durchsuchbar/browsbar ist, bevor Bandai alle Karten gespoilert hat.
//
// Sobald ein Set komplett bekannt ist, kann der Eintrag entfernt werden
// (schadet aber nicht, es werden dann einfach keine Lücken mehr gefunden).
//
// Format bewusst gültiges JSON (quoted keys, kein trailing comma) — wird
// von scripts/sync-cards.py mit json.loads() mitgelesen.
window.SET_PROGRESS = {"BT26": 108};
