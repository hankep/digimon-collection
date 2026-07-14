// Rein manuell gepflegte Zusatzinfos zu einzelnen Platzhalter-Slots (noch
// nicht enthüllte Karten). Wird vom Sync-Skript (scripts/sync-cards.py) NIE
// gelesen oder geschrieben — Einträge hier sind vor dem täglichen Sync sicher.
//
// Sinn: manchmal weiß man Dinge zu einem noch nicht enthüllten ID-Slot, die
// sich aus keiner Quelle automatisch ableiten lassen.
//
// Achtung: Alt-Arts bekommen KEINE eigene ID — sie teilen sich die ID der
// Normal-Art (nur anderes Bild via altImages). Ein einzelner Zahlen-Slot
// (001-108 etc.) ist also nie "ein Alt-Art", sondern immer eine eigenständige
// Karte.
//
// Format:
//   "<ID>": { note: "kurzer Hinweistext" }  // Text statt "?" im Platzhalter
//   "<ID>": { image: "https://…" }   // Bild-URL, nur Notnagel — offiziell und
//                                    // digimoncard.dev (reveal-images.data.js)
//                                    // haben immer Vorrang, sobald verfügbar
//   "<ID>": { note: "…", image: "https://…" }  // beides kombinierbar
//
// Sobald eine Karte offiziell erfasst ist (in cards.data.js), wird ihr
// Override-Eintrag automatisch ignoriert — er kann dann entfernt werden,
// muss aber nicht.
window.PLACEHOLDER_OVERRIDES = {};
