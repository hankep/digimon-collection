// Cardmarket-Preise (statische JSON-Dumps).
// Daten kommen aus prices.data.js (optional eingebunden).
//
// API:
//   CM.get(cardId)              -> { low, avg, trend, prints, bySet?, byVariant? } | null
//   CM.getForSet(cardId, code)  -> { low, avg, trend } | null  (NUR exakter Per-Set-Treffer)
//   CM.getForVariant(variantKey)-> { low, avg, trend } | null  (NUR exakter Per-Variant-Treffer)
//   CM.fmt(n)                   -> "0,12 €" oder "—"
//   CM.hasData()                -> boolean
//   CM.updatedAt()              -> ISO-String oder null
//
// Bewusst keine Top-Level-Fallbacks: lieber gar keinen Preis als ein verzerrender
// Aggregat-Min, der bei Mismatch alle Varianten gleich aussehen laesst.

(function () {
  function get(cardId) {
    if (!window.CM_PRICES) return null;
    return window.CM_PRICES[cardId] || null;
  }

  // Liefert Per-Set-Preis fuer (cardId, setCode). Null, wenn kein bySet-Eintrag
  // fuer diesen Set-Code existiert. setCode=null liefert den Top-Level-Aggregat
  // (Min ueber alle Drucke) — fuer Aufrufer, die explizit das Aggregat wollen.
  function getForSet(cardId, setCode) {
    const p = get(cardId);
    if (!p) return null;
    if (setCode) {
      return (p.bySet && p.bySet[setCode]) || null;
    }
    return { low: p.low, avg: p.avg, trend: p.trend };
  }

  // Liefert Per-Variant-Preis (Main/Alt-Art-spezifisch). Null, wenn kein
  // byVariant-Eintrag existiert. Kein Fallback auf den Top-Level-Aggregat.
  function getForVariant(variantKey) {
    if (!variantKey) return null;
    const cardId = String(variantKey).replace(/_P\d+$/, '');
    const p = get(cardId);
    if (!p) return null;
    return (p.byVariant && p.byVariant[variantKey]) || null;
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

  window.CM = { get, getForSet, getForVariant, fmt, hasData, updatedAt };
})();
