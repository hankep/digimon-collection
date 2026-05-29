// LocalStorage-Wrapper für Collection & Decks.
// Schema v3: jede physische Karten-Kopie ist eine eigene Instanz mit ID.

(function () {
  const COLLECTION_KEY = window.Util.LS_KEYS.collection;
  const DECKS_KEY = window.Util.LS_KEYS.decks;

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw);
    } catch (e) {
      console.warn('Konnte', key, 'nicht lesen, nutze Fallback:', e);
      return fallback;
    }
  }

  function writeJSON(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function genCopyId() {
    return 'c_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  // ── Collection ────────────────────────────────────────────────────────────

  function emptyCollection() {
    return { version: 3, copies: {}, notes: {}, updatedAt: null };
  }

  function loadCollection() {
    const raw = readJSON(COLLECTION_KEY, null);
    if (!raw || !raw.copies) return emptyCollection();
    raw.notes = raw.notes || {};
    return raw;
  }

  // opts.touch === false  → updatedAt NICHT neu setzen (z.B. beim Übernehmen von
  //                          Remote-Daten, damit der Zeitstempel erhalten bleibt).
  // opts.silent === true   → kein 'collection-changed'-Event (kein Auto-Sync-Push).
  function saveCollection(collection, opts) {
    opts = opts || {};
    if (opts.touch !== false) collection.updatedAt = new Date().toISOString();
    writeJSON(COLLECTION_KEY, collection);
    if (!opts.silent) {
      try { document.dispatchEvent(new CustomEvent('collection-changed')); } catch (e) {}
    }
  }

  // ── Copy-Primitive ────────────────────────────────────────────────────────

  function allCopies(coll) {
    const out = [];
    for (const [id, c] of Object.entries(coll.copies || {})) {
      out.push(Object.assign({ id }, c));
    }
    return out;
  }

  function copiesOfVariant(coll, variant) {
    const out = [];
    const src = coll.copies || {};
    for (const id in src) {
      const c = src[id];
      if (c.variant === variant) out.push(Object.assign({ id }, c));
    }
    return out;
  }

  // Performance-Helper: ein einziger Walk durch alle Copies, liefert pro Variante
  // die aggregierten Counts. Nutzbar für Grid-Rendering, wo sonst pro Tile
  // dutzende O(N)-Lookups anfallen.
  function buildVariantIndex(coll) {
    const idx = Object.create(null);
    const src = coll.copies || {};
    for (const id in src) {
      const c = src[id];
      let slot = idx[c.variant];
      if (!slot) {
        slot = { real: 0, proxy: 0, freeReal: 0, freeProxy: 0, assignedReal: 0, assignedProxy: 0 };
        idx[c.variant] = slot;
      }
      if (c.isProxy) {
        slot.proxy++;
        if (c.deckId === null) slot.freeProxy++; else slot.assignedProxy++;
      } else {
        slot.real++;
        if (c.deckId === null) slot.freeReal++; else slot.assignedReal++;
      }
    }
    return idx;
  }

  function variantStats(idx, variant) {
    return idx[variant] || { real: 0, proxy: 0, freeReal: 0, freeProxy: 0, assignedReal: 0, assignedProxy: 0 };
  }

  // Wie buildVariantIndex, aber PRO Deck: idx[deckId][variant] = { real, proxy }.
  // buildVariantIndex aggregiert assignedReal/Proxy über alle Decks und kann daher
  // nicht "wie viele von Variante V hängen an Deck D" beantworten — dafür dieser
  // zweite Ein-Pass-Index. Freie Kopien (deckId == null) werden übersprungen
  // (Frei-Pool kommt aus buildVariantIndex().freeReal/freeProxy).
  function buildDeckAssignedIndex(coll) {
    const idx = Object.create(null);
    const src = coll.copies || {};
    for (const id in src) {
      const c = src[id];
      if (c.deckId == null) continue;
      let deck = idx[c.deckId];
      if (!deck) { deck = Object.create(null); idx[c.deckId] = deck; }
      let slot = deck[c.variant];
      if (!slot) { slot = { real: 0, proxy: 0 }; deck[c.variant] = slot; }
      if (c.isProxy) slot.proxy++; else slot.real++;
    }
    return idx;
  }

  function deckAssignedStats(idx, deckId, variant) {
    const d = idx[deckId];
    return (d && d[variant]) || { real: 0, proxy: 0 };
  }

  function priceSortCmp(a, b) {
    const pa = a.price, pb = b.price;
    if (pa == null && pb == null) return 0;
    if (pa == null) return 1;
    if (pb == null) return -1;
    return pa - pb;
  }

  function realCopiesSortedByPrice(coll, variant) {
    return copiesOfVariant(coll, variant).filter(c => !c.isProxy).sort(priceSortCmp);
  }

  function createCopy(coll, variant, opts) {
    opts = opts || {};
    const id = genCopyId();
    coll.copies[id] = {
      variant,
      price: (opts.price == null || Number.isNaN(Number(opts.price))) ? null : Number(opts.price),
      isProxy: !!opts.isProxy,
      deckId: opts.deckId || null,
      addedAt: opts.addedAt || new Date().toISOString(),
      // Optionales Herkunfts-Set ("AD1", "BT16", …). null = unbekannt (Bestand vor
      // dem Reprint-Umbau oder manuell hinzugefügte Kopie ohne Set-Info).
      originSet: opts.originSet || null
    };
    return id;
  }

  function deleteCopy(coll, copyId) {
    delete coll.copies[copyId];
  }

  function assignToDeck(coll, copyId, deckId) {
    if (coll.copies[copyId]) coll.copies[copyId].deckId = deckId;
  }

  function releaseToFree(coll, copyId) {
    if (coll.copies[copyId]) coll.copies[copyId].deckId = null;
  }

  // Greedy-Reservierung: zuerst freie reale Kopien (älteste zuerst), dann freie Proxies.
  function autoClaim(coll, deckId, variant, n) {
    if (n <= 0) return 0;
    let claimed = 0;
    const free = copiesOfVariant(coll, variant)
      .filter(c => c.deckId === null)
      .sort((a, b) => {
        if (a.isProxy !== b.isProxy) return a.isProxy ? 1 : -1; // real zuerst
        return (a.addedAt || '').localeCompare(b.addedAt || ''); // älteste zuerst
      });
    for (const c of free) {
      if (claimed >= n) break;
      coll.copies[c.id].deckId = deckId;
      claimed++;
    }
    return claimed;
  }

  // Freigabe: zuerst Proxies, dann jüngste reale Kopie (heuristisch).
  function releaseN(coll, deckId, variant, n) {
    if (n <= 0) return 0;
    let released = 0;
    const assigned = copiesOfVariant(coll, variant)
      .filter(c => c.deckId === deckId)
      .sort((a, b) => {
        if (a.isProxy !== b.isProxy) return a.isProxy ? -1 : 1; // Proxy zuerst opfern
        return (b.addedAt || '').localeCompare(a.addedAt || ''); // dann jüngste real
      });
    for (const c of assigned) {
      if (released >= n) break;
      coll.copies[c.id].deckId = null;
      released++;
    }
    return released;
  }

  // ── Lookup-Helfer ─────────────────────────────────────────────────────────

  function ownedTotalReal(coll, variant) {
    let n = 0;
    const src = coll.copies || {};
    for (const id in src) {
      const c = src[id];
      if (c.variant === variant && !c.isProxy) n++;
    }
    return n;
  }

  function ownedTotalProxy(coll, variant) {
    let n = 0;
    const src = coll.copies || {};
    for (const id in src) {
      const c = src[id];
      if (c.variant === variant && c.isProxy) n++;
    }
    return n;
  }

  function ownedTotal(coll, variant) {
    let n = 0;
    const src = coll.copies || {};
    for (const id in src) {
      if (src[id].variant === variant) n++;
    }
    return n;
  }

  function freeCount(coll, variant) {
    let n = 0;
    const src = coll.copies || {};
    for (const id in src) {
      const c = src[id];
      if (c.variant === variant && c.deckId === null && !c.isProxy) n++;
    }
    return n;
  }

  function freeProxyCount(coll, variant) {
    let n = 0;
    const src = coll.copies || {};
    for (const id in src) {
      const c = src[id];
      if (c.variant === variant && c.deckId === null && c.isProxy) n++;
    }
    return n;
  }

  function freeTotal(coll, variant) {
    let n = 0;
    const src = coll.copies || {};
    for (const id in src) {
      const c = src[id];
      if (c.variant === variant && c.deckId === null) n++;
    }
    return n;
  }

  function assignedRealTo(coll, deckId, variant) {
    let n = 0;
    const src = coll.copies || {};
    for (const id in src) {
      const c = src[id];
      if (c.variant === variant && c.deckId === deckId && !c.isProxy) n++;
    }
    return n;
  }

  function assignedProxyTo(coll, deckId, variant) {
    let n = 0;
    const src = coll.copies || {};
    for (const id in src) {
      const c = src[id];
      if (c.variant === variant && c.deckId === deckId && c.isProxy) n++;
    }
    return n;
  }

  function assignedTo(coll, deckId, variant) {
    let n = 0;
    const src = coll.copies || {};
    for (const id in src) {
      const c = src[id];
      if (c.variant === variant && c.deckId === deckId) n++;
    }
    return n;
  }

  // ── Legacy-Wrapper (für UI, die noch auf das alte API zugreift) ───────────

  function getCount(coll, variant) {
    return ownedTotalReal(coll, variant);
  }

  function setCount(coll, variant, n) {
    const current = getCount(coll, variant);
    if (n === current) return;
    if (n > current) {
      for (let i = 0; i < n - current; i++) createCopy(coll, variant, { isProxy: false });
      return;
    }
    // n < current: zuerst Frei-Pool abräumen (jüngste zuerst), dann assigned.
    const toRemove = current - n;
    const reals = copiesOfVariant(coll, variant)
      .filter(c => !c.isProxy)
      .sort((a, b) => {
        const aFree = a.deckId === null ? 0 : 1;
        const bFree = b.deckId === null ? 0 : 1;
        if (aFree !== bFree) return aFree - bFree;
        return (b.addedAt || '').localeCompare(a.addedAt || '');
      });
    for (let i = 0; i < toRemove && i < reals.length; i++) {
      delete coll.copies[reals[i].id];
    }
  }

  function getPrices(coll, variant) {
    return realCopiesSortedByPrice(coll, variant).map(c => c.price);
  }

  function addPrice(coll, variant, price, originSet) {
    createCopy(coll, variant, { price, isProxy: false, originSet: originSet || null });
  }

  function removePriceAt(coll, variant, idx) {
    const sorted = realCopiesSortedByPrice(coll, variant);
    if (idx < 0 || idx >= sorted.length) return;
    delete coll.copies[sorted[idx].id];
  }

  function setPriceAt(coll, variant, idx, price) {
    const sorted = realCopiesSortedByPrice(coll, variant);
    if (idx < 0 || idx >= sorted.length) return;
    const id = sorted[idx].id;
    coll.copies[id].price = (price == null || Number.isNaN(Number(price))) ? null : Number(price);
  }

  function getProxyCount(coll, variant) {
    return ownedTotalProxy(coll, variant);
  }

  function setProxyCount(coll, variant, n) {
    const current = getProxyCount(coll, variant);
    if (n === current) return;
    if (n > current) {
      for (let i = 0; i < n - current; i++) createCopy(coll, variant, { isProxy: true });
      return;
    }
    const toRemove = current - n;
    const proxies = copiesOfVariant(coll, variant)
      .filter(c => c.isProxy)
      .sort((a, b) => {
        const aFree = a.deckId === null ? 0 : 1;
        const bFree = b.deckId === null ? 0 : 1;
        if (aFree !== bFree) return aFree - bFree;
        return (b.addedAt || '').localeCompare(a.addedAt || '');
      });
    for (let i = 0; i < toRemove && i < proxies.length; i++) {
      delete coll.copies[proxies[i].id];
    }
  }

  function getOwnedTotal(coll, variant) {
    return ownedTotal(coll, variant);
  }

  // Notes
  function getCardNote(coll, cardId) {
    if (!coll.notes) return '';
    return coll.notes[cardId] || '';
  }
  function setCardNote(coll, cardId, text) {
    if (!coll.notes) coll.notes = {};
    const t = (text || '').trim();
    if (!t) delete coll.notes[cardId];
    else coll.notes[cardId] = t;
  }

  function collectionValue(coll) {
    let total = 0, known = 0, unknown = 0;
    for (const c of Object.values(coll.copies || {})) {
      if (c.isProxy) continue;
      if (c.price == null) unknown++;
      else { total += c.price; known++; }
    }
    return { total, known, unknown, copies: known + unknown };
  }

  // ── Decks ─────────────────────────────────────────────────────────────────

  function loadDecks() {
    return readJSON(DECKS_KEY, { version: 1, decks: [], updatedAt: null });
  }

  // opts wie bei saveCollection: { touch, silent }.
  function saveDecks(state, opts) {
    opts = opts || {};
    if (opts.touch !== false) state.updatedAt = new Date().toISOString();
    writeJSON(DECKS_KEY, state);
    if (!opts.silent) {
      try { document.dispatchEvent(new CustomEvent('decks-changed')); } catch (e) {}
    }
  }

  function createDeck(state, name, kind) {
    const now = new Date().toISOString();
    const deck = {
      id: 'd_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
      name: name || 'Untitled',
      kind: kind || 'deck',
      notes: '',
      createdAt: now,
      updatedAt: now,
      entries: []
    };
    state.decks.push(deck);
    return deck;
  }

  function deleteDeck(state, deckId) {
    state.decks = state.decks.filter(d => d.id !== deckId);
  }

  // Wird auch beim Löschen eines Decks aufgerufen: gibt alle ihm zugewiesenen Kopien frei.
  function releaseAllForDeck(coll, deckId) {
    let count = 0;
    for (const c of Object.values(coll.copies || {})) {
      if (c.deckId === deckId) { c.deckId = null; count++; }
    }
    return count;
  }

  function addToDeck(deck, cardId, variantKey, delta) {
    const existing = deck.entries.find(e => e.cardId === cardId && e.variant === variantKey);
    if (existing) {
      existing.count += delta;
      if (existing.count <= 0) {
        deck.entries = deck.entries.filter(e => e !== existing);
      }
    } else if (delta > 0) {
      deck.entries.push({ cardId, variant: variantKey, count: delta });
    }
    deck.updatedAt = new Date().toISOString();
  }

  // Cheapest-Allocation aller realen Kopien dieser Variante (Legacy-Kompatibilität).
  function computeDeckCost(deck, coll) {
    let total = 0, missing = 0, unknown = 0, used = 0;
    for (const entry of deck.entries) {
      const sorted = realCopiesSortedByPrice(coll, entry.variant);
      const take = Math.min(entry.count, sorted.length);
      for (let i = 0; i < take; i++) {
        if (sorted[i].price == null) unknown++;
        else total += sorted[i].price;
      }
      used += take;
      missing += entry.count - take;
    }
    return { total, missing, unknown, used };
  }

  function computeEntryCost(entry, coll) {
    const sorted = realCopiesSortedByPrice(coll, entry.variant);
    const take = Math.min(entry.count, sorted.length);
    let total = 0, unknown = 0;
    for (let i = 0; i < take; i++) {
      if (sorted[i].price == null) unknown++;
      else total += sorted[i].price;
    }
    return { total, unknown, used: take, missing: entry.count - take };
  }

  window.Store = {
    // Collection
    loadCollection,
    saveCollection,

    // Copy-Primitive
    allCopies,
    copiesOfVariant,
    buildVariantIndex,
    variantStats,
    buildDeckAssignedIndex,
    deckAssignedStats,
    createCopy,
    deleteCopy,
    assignToDeck,
    releaseToFree,
    autoClaim,
    releaseN,
    releaseAllForDeck,

    // Lookup
    ownedTotalReal,
    ownedTotalProxy,
    ownedTotal,
    freeCount,
    freeProxyCount,
    freeTotal,
    assignedRealTo,
    assignedProxyTo,
    assignedTo,

    // Legacy-Wrapper
    getCount,
    setCount,
    getPrices,
    addPrice,
    removePriceAt,
    setPriceAt,
    getProxyCount,
    setProxyCount,
    getOwnedTotal,
    getCardNote,
    setCardNote,
    collectionValue,

    // Decks
    loadDecks,
    saveDecks,
    createDeck,
    deleteDeck,
    addToDeck,
    computeDeckCost,
    computeEntryCost
  };
})();
