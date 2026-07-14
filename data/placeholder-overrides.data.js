// Rein manuell gepflegte Zusatzinfos zu einzelnen Platzhalter-Slots (noch
// nicht enthüllte Karten). Wird vom Sync-Skript (scripts/sync-cards.py) NIE
// gelesen oder geschrieben — Einträge hier sind vor dem täglichen Sync sicher.
//
// Sinn: manchmal weiß man Dinge, die sich aus keiner Quelle automatisch
// ableiten lassen (z.B. "dieser ID-Slot muss ein Alt-Art sein, weil die
// Rarity-Verteilung des Sets das so vorgibt").
//
// Format:
//   "<ID>": { note: "V1 AA" }        // Text statt "?" im Platzhalter
//   "<ID>": { image: "https://…" }   // Bild-URL, nur Notnagel — offiziell und
//                                    // digimoncard.dev (reveal-images.data.js)
//                                    // haben immer Vorrang, sobald verfügbar
//   "<ID>": { note: "V1 AA", image: "https://…" }  // beides kombinierbar
//
// Sobald eine Karte offiziell erfasst ist (in cards.data.js), wird ihr
// Override-Eintrag automatisch ignoriert — er kann dann entfernt werden,
// muss aber nicht.
window.PLACEHOLDER_OVERRIDES = {
  "BT26-032": { note: "V1 AA" },
  "BT26-034": { note: "V1 AA" },
  "BT26-035": { note: "V2 AA" },
  "BT26-051": { note: "V1 AA" }
};
