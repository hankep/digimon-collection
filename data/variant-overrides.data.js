// Manuelle Korrekturen fuer Variant→CM-Set-Zuordnungen.
//
// Hintergrund: scripts/sync-prices.py matched pro CM-Set die einzelnen Drucke
// positional (sortiert nach Low-Preis aufsteigend) gegen die App-Varianten
// (Main, _P1, _P2 ...). Diese Heuristik ist meistens richtig, aber nicht
// immer — z.B. wenn das eigentliche _P1.webp Bild aus einem anderen CM-Produkt
// stammt als der positional-cheapest Druck.
//
// Format:
//   variantKey: 'New Set Label'      // re-labelt den/die bySet-Eintraege
//   variantKey: null                 // verwirft den byVariant-Eintrag → fallback auf Top-Level
//
// Wird zur Laufzeit von cm-prices.js angewendet (kein Re-Sync noetig). Die
// Datei wird einmal beim App-Start geladen, anschliessend cached.

window.VARIANT_OVERRIDES = {
  // BT13-015 (RizeGreymon) _P1 ist tatsaechlich das Ultimate-Cup-Artwork,
  // nicht der AD1-Reprint. Die Heuristik hatte _P1 dem AD1-Druck zugeordnet,
  // weil dieser im idExpansion-Bucket den niedrigsten Preis hat.
  'BT13-015_P1': 'Ultimate Cup'
};
