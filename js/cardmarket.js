// Cardmarket-Bestelllisten-Parser.
// Blöcke durch Leerzeilen getrennt. Pro Block lenient parsen:
//   - Quantity:  ^(\d+)x\b
//   - Card-ID:   \(([A-Z]+\d*-\d+[A-Z]?)\)
//   - Version:   \(V\.(\d+)\)
//   - Preis:     (\d+),(\d{1,2})\s*€
//
// Variant-Mapping:
//   - Version 1 oder fehlend → Hauptvariante
//   - Version N ≥ 2 → (N-2)-tes Element von variantsOf(card).filter(isAlt)

(function () {
  function parse(text) {
    const blocks = String(text || '').split(/\r?\n\s*\r?\n/);
    const items = [];
    const unknown = [];

    for (const block of blocks) {
      const lines = block.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
      if (!lines.length) continue;

      let qty = null;
      let rawId = null;
      let version = 1;
      let priceCents = null;
      let originSet = null;

      for (const line of lines) {
        if (qty == null) {
          const m = line.match(/^(\d+)x\b/);
          if (m) qty = parseInt(m[1], 10);
        }
        if (!rawId) {
          const m = line.match(/\(([A-Z]+\d*-\d+[A-Z]?)\)/);
          if (m) rawId = m[1];
        }
        const v = line.match(/\(V\.(\d+)\)/);
        if (v) version = parseInt(v[1], 10);

        if (priceCents == null) {
          const p = line.match(/(\d+),(\d{1,2})\s*€/);
          if (p) {
            const cents = parseInt(p[1], 10) * 100 + parseInt(p[2].padEnd(2, '0').slice(0, 2), 10);
            priceCents = cents;
          }
        }
        // Set-Zeile: alleinstehender Code wie "AD-01" / "BT-16" / "ST21".
        // Card-IDs haben Klammern oder ein # davor → die schließen wir aus.
        // setNameToCode liefert null für unbekannte Sets, was Card-IDs wie "P-180"
        // (P180 ist kein Set) ohnehin abfängt.
        if (!originSet && !line.startsWith('#') && !line.includes('(')) {
          const code = CardDB.setNameToCode ? CardDB.setNameToCode(line) : null;
          if (code) originSet = code;
        }
      }
      if (qty == null) qty = 1;
      if (!rawId) {
        // ignoriere leeren/dekorativen Block
        continue;
      }

      const mapping = mapVariant(rawId, version);
      if (!mapping) {
        unknown.push({ rawId, version, qty, price: priceCents != null ? priceCents / 100 : null });
        continue;
      }
      items.push({
        rawId,
        cardId: mapping.cardId,
        cardName: mapping.cardName,
        variant: mapping.variant,
        isAlt: mapping.isAlt,
        version,
        qty,
        unitPrice: priceCents != null ? priceCents / 100 : null,
        originSet
      });
    }

    return { items, unknown };
  }

  function mapVariant(rawId, version) {
    const card = CardDB.byId.get(rawId);
    if (!card) return null;
    const variants = CardDB.variantsOf(card);
    if (!variants.length) return null;

    let chosen;
    if (!version || version === 1) {
      chosen = variants.find(v => !v.isAlt) || variants[0];
    } else {
      const alts = variants.filter(v => v.isAlt);
      const idx = version - 2;
      chosen = (idx >= 0 && idx < alts.length) ? alts[idx] : (variants.find(v => !v.isAlt) || variants[0]);
    }
    return {
      cardId: card.id,
      cardName: card.name,
      variant: chosen.key,
      isAlt: chosen.isAlt
    };
  }

  function apply(items) {
    const coll = Store.loadCollection();
    let addedCopies = 0;
    let addedValue = 0;
    // Bewusst ohne deckId: neue Kopien landen im Frei-Pool. Imports slotten nie.
    // originSet aus dem Parsing wandert mit, sofern verfügbar.
    const addedByVariant = new Map();
    for (const it of items) {
      for (let i = 0; i < it.qty; i++) {
        Store.addPrice(coll, it.variant, it.unitPrice, it.originSet);
        addedCopies++;
        if (it.unitPrice != null) addedValue += it.unitPrice;
      }
      addedByVariant.set(it.variant, (addedByVariant.get(it.variant) || 0) + it.qty);
    }
    Store.saveCollection(coll);
    const removedFromWants = consumeFromWants(addedByVariant);
    return { addedCopies, addedValue, removedFromWants };
  }

  // Zieht hinzugefügte Kopien direkt von den Wants-Listen ab. kind='deck' und
  // kind='trade' bleiben unberührt. Pro Variante: kleinste Wants-Liste zuerst
  // leeren, dann weiter — so verschwinden Mini-Wants schneller.
  function consumeFromWants(addedByVariant) {
    if (!addedByVariant.size) return 0;
    const state = Store.loadDecks();
    let removed = 0;
    let touched = false;
    for (const [variant, qty] of addedByVariant) {
      let remaining = qty;
      if (remaining <= 0) continue;
      const matches = [];
      for (const d of state.decks) {
        if (d.kind !== 'wants') continue;
        const entry = d.entries.find(e => e.variant === variant);
        if (entry && entry.count > 0) matches.push({ deck: d, entry });
      }
      matches.sort((a, b) => a.entry.count - b.entry.count);
      for (const m of matches) {
        if (remaining <= 0) break;
        const k = Math.min(remaining, m.entry.count);
        Store.addToDeck(m.deck, m.entry.cardId, m.entry.variant, -k);
        remaining -= k;
        removed += k;
        touched = true;
      }
    }
    if (touched) Store.saveDecks(state);
    return removed;
  }

  function summarize(items) {
    let totalQty = 0;
    let totalValue = 0;
    let unpriced = 0;
    for (const it of items) {
      totalQty += it.qty;
      if (it.unitPrice == null) unpriced += it.qty;
      else totalValue += it.unitPrice * it.qty;
    }
    return { totalQty, totalValue, unpriced };
  }

  window.Cardmarket = { parse, apply, summarize };
})();
