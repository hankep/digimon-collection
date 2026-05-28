// Cardmarket-Preise (statische JSON-Dumps).
// Daten kommen aus prices.data.js (optional eingebunden).
//
// API:
//   CM.get(cardId)              -> { low, avg, trend, prints, bySet? } | null
//   CM.getForSet(cardId, code)  -> { low, avg, trend } | null  (Per-Set, sonst Top-Level-Fallback)
//   CM.fmt(n)                   -> "0,12 €" oder "—"
//   CM.hasData()                -> boolean
//   CM.updatedAt()              -> ISO-String oder null

(function () {
  function get(cardId) {
    if (!window.CM_PRICES) return null;
    return window.CM_PRICES[cardId] || null;
  }

  // Liefert Per-Set-Preis, fällt auf den aggregierten Top-Level-Preis zurück,
  // wenn kein bySet-Eintrag für diesen Set-Code existiert. setCode=null liefert
  // den Top-Level direkt. Liefert null wenn die Karte gar nicht in CM steht.
  function getForSet(cardId, setCode) {
    const p = get(cardId);
    if (!p) return null;
    if (setCode && p.bySet && p.bySet[setCode]) return p.bySet[setCode];
    return { low: p.low, avg: p.avg, trend: p.trend };
  }

  function fmt(n) {
    if (n == null || Number.isNaN(Number(n))) return '—';
    return Number(n).toFixed(2).replace('.', ',') + ' €';
  }

  function hasData() {
    return !!(window.CM_PRICES && Object.keys(window.CM_PRICES).length);
  }

  function updatedAt() {
    return window.CM_PRICES_UPDATED_AT || null;
  }

  window.CM = { get, getForSet, fmt, hasData, updatedAt };
})();
