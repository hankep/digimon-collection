// Cardmarket-Preise (statische JSON-Dumps).
// Daten kommen aus prices.data.js (optional eingebunden).
//
// API:
//   CM.get(cardId)       -> { low, avg, trend, prints } | null
//   CM.fmt(n)            -> "0,12 €" oder "—"
//   CM.hasData()         -> boolean
//   CM.updatedAt()       -> ISO-String oder null

(function () {
  function get(cardId) {
    if (!window.CM_PRICES) return null;
    return window.CM_PRICES[cardId] || null;
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

  window.CM = { get, fmt, hasData, updatedAt };
})();
