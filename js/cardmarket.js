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

  // Standard-Import: simple Liste ("4x Agumon BT26-02", "3 BT1-001", optional
  // "(V.N)") wird über den erprobten plain-text-Parser aufgelöst und auf dieselbe
  // items-Struktur wie parse() gemappt — nur mit Pauschalpreis statt CM-Preisen
  // und ohne originSet. So bleibt der gesamte Downstream-Code (summarize, apply,
  // analyzeWantsImpact, Vorschau, Cross-Variant-Modal) unverändert nutzbar.
  function parseStandard(text, priceEur) {
    const price = (priceEur == null || Number.isNaN(Number(priceEur))) ? null : Number(priceEur);
    const fmt = (window.IO_FORMATS || []).find(f => f.id === 'plain-text');
    if (!fmt) return { items: [], unknown: [] };

    const result = fmt.importDeck(String(text || ''));
    const items = [];
    for (const e of (result.entries || [])) {
      if (!e || e.count <= 0) continue;
      const card = CardDB.byId.get(e.cardId);
      const info = CardDB.allVariants.get(e.variant);
      items.push({
        rawId: e.cardId,
        cardId: e.cardId,
        cardName: card ? CardDB.cleanDisplayName(card) : e.cardId,
        variant: e.variant,
        isAlt: info ? !!info.isAlt : false,
        version: 1,
        qty: e.count,
        unitPrice: price,
        originSet: null
      });
    }
    const unknown = (result.unknownIds || []).map(id => ({ rawId: id, version: 1, qty: 1, price: null }));
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
      cardName: CardDB.cleanDisplayName(card),
      variant: chosen.key,
      isAlt: chosen.isAlt
    };
  }

  // Set-Guard: liefert die Items, deren angehaengtes originSet nicht zur Karte
  // passt. reason 'mismatch' = Set gesetzt, aber Karte kommt da nicht vor
  // (appearsInSet=false). reason 'missing' = gar kein Set erkannt — nur relevant,
  // wenn opts.requireSet (Cardmarket-Pastes haben IMMER ein Set).
  function findOriginSetConflicts(items, opts) {
    const requireSet = !!(opts && opts.requireSet);
    const conflicts = [];
    for (const it of items || []) {
      const card = CardDB.byId.get(it.cardId);
      if (!card) continue; // unbekannte IDs landen ohnehin nicht in items
      if (!it.originSet) {
        if (requireSet) conflicts.push({ item: it, reason: 'missing' });
        continue;
      }
      if (!CardDB.appearsInSet(card, it.originSet)) {
        conflicts.push({ item: it, reason: 'mismatch' });
      }
    }
    return conflicts;
  }

  // items -> Map variant -> qty (summiert ueber alle items mit gleicher variant).
  function buildAddedByVariant(items) {
    const m = new Map();
    for (const it of items) {
      m.set(it.variant, (m.get(it.variant) || 0) + it.qty);
    }
    return m;
  }

  // Analyse-Phase (read-only): bestimmt aus dem Import einen Plan, was an
  // Wants-Listen abgezogen werden wuerde. Liefert exakt-passende Treffer
  // (kommen IMMER) und Cross-Variant-Kandidaten (selbe Card-ID, andere Variante;
  // werden im UI mit Rueckfrage versehen). Schreibt keine Daten.
  function analyzeWantsImpact(items) {
    const addedByVariant = buildAddedByVariant(items);
    const state = Store.loadDecks();
    // Working-Counts, damit dieselbe Wants-Zeile durch mehrere Imports nicht
    // gleichzeitig komplett "drainen" als Plan dargestellt wird.
    const working = new Map();
    const wKey = (deckId, cardId, variant) => `${deckId}|${cardId}|${variant}`;
    const getRem = (d, e) => {
      const k = wKey(d.id, e.cardId, e.variant);
      if (!working.has(k)) working.set(k, e.count);
      return working.get(k);
    };
    const drain = (d, e, n) => {
      const k = wKey(d.id, e.cardId, e.variant);
      working.set(k, getRem(d, e) - n);
    };

    const exact = [];
    const crossVariant = [];

    for (const [variant, qty] of addedByVariant) {
      if (qty <= 0) continue;
      const cardId = variant.replace(/_P\d+$/, '');

      // 1) Exakte Treffer (kleinste Liste zuerst).
      const exactMatches = [];
      for (const d of state.decks) {
        if (d.kind !== 'wants') continue;
        for (const entry of d.entries) {
          if (entry.variant === variant && getRem(d, entry) > 0) {
            exactMatches.push({ deck: d, entry });
          }
        }
      }
      exactMatches.sort((a, b) => getRem(a.deck, a.entry) - getRem(b.deck, b.entry));

      let remaining = qty;
      for (const m of exactMatches) {
        if (remaining <= 0) break;
        const avail = getRem(m.deck, m.entry);
        const take = Math.min(remaining, avail);
        if (take <= 0) continue;
        exact.push({
          deckId: m.deck.id,
          deckName: m.deck.name,
          cardId: m.entry.cardId,
          variant: m.entry.variant,
          take,
          importedQty: qty
        });
        drain(m.deck, m.entry, take);
        remaining -= take;
      }

      // 2) Cross-Variant-Kandidaten: selbe Card-ID, andere Variante. Wird nur
      // ergaenzt, wenn nach Exakt-Treffern noch Import-Menge uebrig ist.
      if (remaining > 0) {
        for (const d of state.decks) {
          if (d.kind !== 'wants') continue;
          for (const entry of d.entries) {
            if (entry.cardId !== cardId) continue;
            if (entry.variant === variant) continue;
            const remInEntry = getRem(d, entry);
            if (remInEntry <= 0) continue;
            crossVariant.push({
              deckId: d.id,
              deckName: d.name,
              cardId: entry.cardId,
              wantsVariant: entry.variant,
              importedVariant: variant,
              wantsCount: remInEntry,
              importedRemainder: remaining,
              maxTake: Math.min(remaining, remInEntry)
            });
          }
        }
      }
    }

    return { exact, crossVariant };
  }

  // Voller Import-Apply. decisions ist optional. Wenn gegeben:
  //   decisions.acceptCrossVariant = [{deckId, cardId, wantsVariant, take}, ...]
  // werden zusaetzlich zu den exakten Treffern abgezogen.
  function apply(items, decisions) {
    // Sicherheitsnetz: KEIN Code-Pfad darf Kopien mit nicht passendem Set
    // schreiben (egal ob Cardmarket- oder Standard-Import). Mode-unabhaengig,
    // weil ein falsch zugeordnetes Set immer ein Fehler ist.
    const badSet = findOriginSetConflicts(items, { requireSet: false });
    if (badSet.length) {
      const sample = badSet.slice(0, 5)
        .map(c => `${c.item.cardId} ⟂ ${c.item.originSet}`).join(', ');
      throw new Error(`Import abgebrochen: ${badSet.length} Karte(n) mit nicht passendem Set (${sample}).`);
    }
    const coll = Store.loadCollection();
    let addedCopies = 0;
    let addedValue = 0;
    // Bewusst ohne deckId: neue Kopien landen im Frei-Pool. Imports slotten nie.
    // originSet aus dem Parsing wandert mit, sofern verfügbar.
    for (const it of items) {
      for (let i = 0; i < it.qty; i++) {
        Store.addPrice(coll, it.variant, it.unitPrice, it.originSet);
        addedCopies++;
        if (it.unitPrice != null) addedValue += it.unitPrice;
      }
    }
    Store.saveCollection(coll);

    const addedByVariant = buildAddedByVariant(items);
    const removedFromWants = applyExactWantsConsumption(addedByVariant);
    let crossVariantRemoved = 0;
    if (decisions && Array.isArray(decisions.acceptCrossVariant) && decisions.acceptCrossVariant.length) {
      crossVariantRemoved = applyCrossVariantConsumption(decisions.acceptCrossVariant);
    }
    return { addedCopies, addedValue, removedFromWants, crossVariantRemoved };
  }

  // Exakt-Treffer-Abzug (Variante deckt Variante). Wird IMMER vom Import gefahren.
  function applyExactWantsConsumption(addedByVariant) {
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

  // Cross-Variant-Abzug: nur die im UI bestaetigten Entscheidungen anwenden.
  function applyCrossVariantConsumption(decisions) {
    if (!decisions.length) return 0;
    const state = Store.loadDecks();
    let removed = 0;
    let touched = false;
    for (const dec of decisions) {
      const deck = state.decks.find(d => d.id === dec.deckId && d.kind === 'wants');
      if (!deck) continue;
      const entry = deck.entries.find(e => e.cardId === dec.cardId && e.variant === dec.wantsVariant);
      if (!entry || entry.count <= 0) continue;
      const take = Math.min(dec.take, entry.count);
      if (take <= 0) continue;
      Store.addToDeck(deck, dec.cardId, dec.wantsVariant, -take);
      removed += take;
      touched = true;
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

  window.Cardmarket = { parse, parseStandard, apply, summarize, analyzeWantsImpact, findOriginSetConflicts };
})();
