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
  // Errata-Suffix (z.B. "BT20-077-Errata") wird abgestreift, weil das
  // Cardmarket-Produkt fuer Errata-Reprints identisch zur Original-Variante ist.
  function getForVariant(variantKey) {
    if (!variantKey) return null;
    const canonicalKey = String(variantKey).replace(/-Errata$/i, '');
    const cardId = canonicalKey.replace(/_P\d+$/, '');
    const p = get(cardId);
    if (!p) return null;
    if (p.byVariant) {
      if (p.byVariant[canonicalKey]) return p.byVariant[canonicalKey];
      if (variantKey !== canonicalKey && p.byVariant[variantKey]) return p.byVariant[variantKey];
    }
    return null;
  }

  // Liefert die GUENSTIGSTEN Preise fuer einen Deck-/Wants-Eintrag:
  // - Wenn die Variante in mehreren Sets erhaeltlich ist (Reprint, gleiche
  //   Card-ID), wird der bySet-Eintrag mit dem niedrigsten Low gewaehlt;
  //   trend kommt aus demselben Set, damit beide Werte zur selben Produktseite
  //   gehoeren.
  // - Wenn kein byVariant existiert: Top-Level (min ueber alle Varianten und
  //   Sets) als Fallback.
  // - Alt-Arts werden NICHT mit der Main vermischt, weil getForVariant
  //   variant-spezifisch lookt.
  function _cheapestSetEntry(pv) {
    if (!pv || !pv.bySet) return null;
    let best = null;
    for (const code of Object.keys(pv.bySet)) {
      const e = pv.bySet[code];
      if (!e || e.low == null) continue;
      if (!best || e.low < best.low) best = e;
    }
    return best;
  }

  function lowForEntry(cardId, variantKey) {
    const pv = getForVariant(variantKey);
    const best = _cheapestSetEntry(pv);
    if (best) return best.low;
    if (pv && pv.low != null) return pv.low;
    const p = get(cardId);
    return (p && p.low != null) ? p.low : null;
  }

  function pricesForEntry(cardId, variantKey) {
    const pv = getForVariant(variantKey);
    const best = _cheapestSetEntry(pv);
    if (best) return { low: best.low, trend: best.trend == null ? null : best.trend };
    if (pv && (pv.low != null || pv.trend != null)) {
      return { low: pv.low == null ? null : pv.low, trend: pv.trend == null ? null : pv.trend };
    }
    const p = get(cardId);
    if (!p) return { low: null, trend: null };
    return { low: p.low == null ? null : p.low, trend: p.trend == null ? null : p.trend };
  }

  // Kurzform: liefert direkt das formattierte 'low / trend' fuer die GUENSTIGSTE
  // Variante-im-Set Kombination. Null, wenn kein Preis vorhanden.
  function fmtCheapest(cardId, variantKey) {
    return fmtLowTrend(pricesForEntry(cardId, variantKey));
  }

  function fmt(n) {
    if (n == null || Number.isNaN(Number(n))) return '—';
    return Number(n).toFixed(2).replace('.', ',') + ' €';
  }

  // Liefert eine kombinierte Anzeige aus Low + Trend ("0,35 € / 0,42 €"). Wenn
  // beide gleich sind oder nur einer existiert: nur dieser Wert. Wenn nichts
  // vorhanden: null.
  function fmtLowTrend(p) {
    if (!p) return null;
    const hasLow = p.low != null && !Number.isNaN(Number(p.low));
    const hasTrend = p.trend != null && !Number.isNaN(Number(p.trend));
    if (!hasLow && !hasTrend) return null;
    if (hasLow && hasTrend && Number(p.low) !== Number(p.trend)) return fmt(p.low) + ' / ' + fmt(p.trend);
    return fmt(hasLow ? p.low : p.trend);
  }

  function hasData() {
    return !!(window.CM_PRICES && Object.keys(window.CM_PRICES).length);
  }

  function updatedAt() {
    return window.CM_PRICES_UPDATED_AT || null;
  }

  window.CM = { get, getForSet, getForVariant, lowForEntry, pricesForEntry, fmt, fmtLowTrend, fmtCheapest, hasData, updatedAt };
})();
