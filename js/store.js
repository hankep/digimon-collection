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
  // Save: synchron in LocalStorage schreiben, danach das change-Event
  // dispatchen. Cache wird invalidiert, damit Renderer frische Daten sehen.
  // (Frueher debounced — fuehrte zu stale Reads in Listener, die selbst aus LS
  // lesen.)
  function saveCollection(collection, opts) {
    opts = opts || {};
    if (opts.touch !== false) collection.updatedAt = new Date().toISOString();
    invalidateIndexCache();
    writeJSON(COLLECTION_KEY, collection);
    if (!opts.silent) {
      document.dispatchEvent(new CustomEvent('collection-changed'));
    }
  }

  // No-Ops fuer Aufrufer (Sync.push, app.js Logout), die die alte Debounce-API
  // erwartet haben — wir schreiben jetzt eh synchron.
  function flushSaves() {}
  function cancelPendingSaves() {}

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

  // ── Index-Cache ──────────────────────────────────────────────────────────
  // VariantIndex/DeckAssignedIndex sind teure O(N)-Walks ueber alle Copies. Sie
  // werden in jedem Render mehrmals gebraucht; ohne Cache lief das pro Filter-
  // Tastendruck 4-5 mal. Cache lebt solange coll referenziell gleich bleibt UND
  // kein Mutator/Save invalidiert hat.
  let cachedColl = null;
  let cachedVIdx = null;
  let cachedDAIdx = null;

  function invalidateIndexCache() {
    cachedColl = null;
    cachedVIdx = null;
    cachedDAIdx = null;
  }

  function getVariantIndex(coll) {
    if (coll === cachedColl && cachedVIdx) return cachedVIdx;
    if (coll !== cachedColl) { cachedColl = coll; cachedDAIdx = null; }
    cachedVIdx = buildVariantIndex(coll);
    return cachedVIdx;
  }

  function getDeckAssignedIndex(coll) {
    if (coll === cachedColl && cachedDAIdx) return cachedDAIdx;
    if (coll !== cachedColl) { cachedColl = coll; cachedVIdx = null; }
    cachedDAIdx = buildDeckAssignedIndex(coll);
    return cachedDAIdx;
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
    invalidateIndexCache();
    return id;
  }

  function deleteCopy(coll, copyId) {
    delete coll.copies[copyId];
    invalidateIndexCache();
  }

  function assignToDeck(coll, copyId, deckId) {
    if (coll.copies[copyId]) {
      coll.copies[copyId].deckId = deckId;
      invalidateIndexCache();
    }
  }

  function releaseToFree(coll, copyId) {
    if (coll.copies[copyId]) {
      coll.copies[copyId].deckId = null;
      invalidateIndexCache();
    }
  }

  // Greedy-Reservierung: zuerst freie echte Kopien (aelteste zuerst), dann freie
  // Proxies. Proxies zaehlen NICHT als 'Besitz/verfuegbar' in der Anzeige,
  // werden aber als Platzhalter geslottet, damit Decks komplett werden koennen.
  function autoClaim(coll, deckId, variant, n) {
    if (n <= 0) return 0;
    let claimed = 0;
    const free = copiesOfVariant(coll, variant)
      .filter(c => c.deckId === null)
      .sort((a, b) => {
        if (a.isProxy !== b.isProxy) return a.isProxy ? 1 : -1; // real zuerst
        return (a.addedAt || '').localeCompare(b.addedAt || ''); // aelteste zuerst
      });
    for (const c of free) {
      if (claimed >= n) break;
      coll.copies[c.id].deckId = deckId;
      claimed++;
    }
    invalidateIndexCache();
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
    invalidateIndexCache();
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
    invalidateIndexCache();
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
    invalidateIndexCache();
  }

  function setPriceAt(coll, variant, idx, price) {
    const sorted = realCopiesSortedByPrice(coll, variant);
    if (idx < 0 || idx >= sorted.length) return;
    const id = sorted[idx].id;
    coll.copies[id].price = (price == null || Number.isNaN(Number(price))) ? null : Number(price);
    // Preis aendert keine Counts → kein Cache-Invalidate noetig.
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
    invalidateIndexCache();
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

  // Einzige erlaubte Deck-kinds. Muss zur DB-Check-Constraint
  // 'shared_decks_kind_check' passen (sonst scheitert der Shared-Upload).
  const DECK_KINDS = ['deck', 'wants', 'trade'];

  // Guard: jeden kind defensiv auf einen erlaubten Wert normalisieren. Faengt
  // Legacy-/Import-Werte ab ('// kind: xy'), Tippfehler, Gross-/Kleinschreibung
  // und Leerzeichen ('Deck', 'deck ' → 'deck'). Unbekanntes → 'deck'. Ohne das
  // landeten kaputte kinds in der UI unter 'Sonstige' (Dropdown zeigte trotzdem
  // 'deck', weil keine <option> matchte) und blockierten den Shared-Sync.
  function normalizeKind(kind) {
    const k = String(kind == null ? '' : kind).trim().toLowerCase();
    return DECK_KINDS.includes(k) ? k : 'deck';
  }

  function genId(prefix) {
    return prefix + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  // Normalisiert categories + deck.categoryId in-place. Wird an beiden Choke-Points
  // (loadDecks/saveDecks) aufgerufen, damit Alt-/Import-/Remote-Daten konsistent
  // sind: categories als Array, jede Kategorie mit gueltigem kind + numeric order,
  // und verwaiste deck.categoryId (Kategorie weg oder kind passt nicht) → null.
  function normalizeCategories(state) {
    if (!Array.isArray(state.categories)) state.categories = [];
    const valid = new Map(); // id → kind
    state.categories = state.categories
      .filter(c => c && typeof c.id === 'string')
      .map((c, i) => {
        const kind = normalizeKind(c.kind);
        const cat = {
          id: c.id,
          kind,
          name: String(c.name == null ? '' : c.name),
          order: Number.isFinite(c.order) ? c.order : i
        };
        valid.set(cat.id, cat.kind);
        return cat;
      });
    if (Array.isArray(state.decks)) {
      for (const d of state.decks) {
        if (d.categoryId == null) { d.categoryId = null; continue; }
        // verwaist oder kind-Mismatch → loesen
        if (valid.get(d.categoryId) !== normalizeKind(d.kind)) d.categoryId = null;
      }
    }
  }

  function loadDecks() {
    const state = readJSON(DECKS_KEY, { version: 1, decks: [], categories: [], updatedAt: null });
    // Self-Heal: vorhandene kaputte kinds beim Laden korrigieren, damit UI,
    // Dropdown und Sync konsistent sind. Persistiert wird beim naechsten save.
    if (state && Array.isArray(state.decks)) {
      for (const d of state.decks) d.kind = normalizeKind(d.kind);
    }
    if (state) normalizeCategories(state);
    return state;
  }

  // opts wie bei saveCollection: { touch, silent }. Synchroner Write.
  function saveDecks(state, opts) {
    opts = opts || {};
    // Guard am Schreib-Choke-Point: nichts mit ungueltigem kind darf persistiert
    // werden (deckt Import, Duplizieren, applyRemote von Altdaten etc. ab).
    if (state && Array.isArray(state.decks)) {
      for (const d of state.decks) d.kind = normalizeKind(d.kind);
    }
    if (state) normalizeCategories(state);
    if (opts.touch !== false) state.updatedAt = new Date().toISOString();
    writeJSON(DECKS_KEY, state);
    if (!opts.silent) {
      document.dispatchEvent(new CustomEvent('decks-changed'));
    }
  }

  function createDeck(state, name, kind) {
    const now = new Date().toISOString();
    const deck = {
      id: 'd_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
      name: name || 'Untitled',
      kind: normalizeKind(kind),
      categoryId: null,
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

  // Dupliziert eine Liste (kind, notes, entries, favorite). Neuer Name: ' 1' an-
  // gehaengt; wenn schon ' N' hinten dranhing → N+1; bei Kollision weiter hoch.
  function duplicateDeck(state, srcDeckId) {
    const src = state.decks.find(d => d.id === srcDeckId);
    if (!src) return null;
    const taken = new Set(state.decks.map(d => d.name));
    const m = src.name.match(/^(.*)\s(\d+)$/);
    let base, n;
    if (m) { base = m[1]; n = parseInt(m[2], 10) + 1; }
    else { base = src.name; n = 1; }
    let candidate = `${base} ${n}`;
    while (taken.has(candidate)) { n++; candidate = `${base} ${n}`; }
    const now = new Date().toISOString();
    const copy = {
      id: 'd_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36),
      name: candidate,
      kind: src.kind,
      categoryId: src.categoryId || null,
      notes: src.notes || '',
      favorite: !!src.favorite,
      // Kopie startet immer privat — kein versehentliches Mit-Sharen.
      shared: false,
      createdAt: now,
      updatedAt: now,
      // Entries flach kopieren (count + cardId + variant — keine Slot-Refs)
      entries: (src.entries || []).map(e => ({ cardId: e.cardId, variant: e.variant, count: e.count }))
    };
    state.decks.push(copy);
    return copy;
  }

  // ── Kategorien ────────────────────────────────────────────────────────────
  // Eigene, benannte Unterkategorien INNERHALB eines kind (deck/wants/trade).
  // Rein lokale Organisation; reisen via LWW-Blob mit, gehen aber nicht in
  // shared_decks. Collapse-Zustand liegt separat in den UI-Prefs (nicht im Blob).

  function ensureCategories(state) {
    if (!Array.isArray(state.categories)) state.categories = [];
    return state.categories;
  }

  function createCategory(state, kind, name) {
    const cats = ensureCategories(state);
    const k = normalizeKind(kind);
    const maxOrder = cats.filter(c => c.kind === k)
      .reduce((m, c) => Math.max(m, c.order), -1);
    const cat = { id: genId('c_'), kind: k, name: name || 'Neue Kategorie', order: maxOrder + 1 };
    cats.push(cat);
    return cat;
  }

  function renameCategory(state, categoryId, name) {
    const cat = ensureCategories(state).find(c => c.id === categoryId);
    if (cat) cat.name = name || cat.name;
    return cat;
  }

  // Loescht die Kategorie und loest die Zuordnung aller betroffenen Decks (Decks
  // bleiben erhalten, rutschen nach "Ohne Kategorie").
  function deleteCategory(state, categoryId) {
    state.categories = ensureCategories(state).filter(c => c.id !== categoryId);
    for (const d of (state.decks || [])) {
      if (d.categoryId === categoryId) d.categoryId = null;
    }
  }

  // Schreibt order gemaess orderedIds neu — nur fuer das angegebene kind. Andere
  // kinds bleiben unberuehrt. Safety: orderedIds muss exakt die Kategorien des
  // kind abdecken, sonst no-op (analog reorderKind in der UI).
  function reorderCategories(state, kind, orderedIds) {
    const k = normalizeKind(kind);
    const cats = ensureCategories(state);
    const inKind = cats.filter(c => c.kind === k);
    if (orderedIds.length !== inKind.length) return;
    const byId = new Map(inKind.map(c => [c.id, c]));
    if (!orderedIds.every(id => byId.has(id))) return;
    orderedIds.forEach((id, i) => { byId.get(id).order = i; });
  }

  // Setzt deck.categoryId. Validierung: categoryId == null erlaubt; sonst muss die
  // Kategorie existieren UND denselben kind wie das Deck haben, sonst → null.
  function assignDeckToCategory(state, deckId, categoryId) {
    const deck = (state.decks || []).find(d => d.id === deckId);
    if (!deck) return;
    if (categoryId == null) { deck.categoryId = null; return; }
    const cat = ensureCategories(state).find(c => c.id === categoryId);
    deck.categoryId = (cat && cat.kind === normalizeKind(deck.kind)) ? categoryId : null;
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
    flushSaves,
    cancelPendingSaves,

    // Copy-Primitive
    allCopies,
    copiesOfVariant,
    buildVariantIndex,
    getVariantIndex,
    invalidateIndexCache,
    variantStats,
    buildDeckAssignedIndex,
    getDeckAssignedIndex,
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
    normalizeKind,
    loadDecks,
    saveDecks,
    createDeck,
    deleteDeck,
    duplicateDeck,
    createCategory,
    renameCategory,
    deleteCategory,
    reorderCategories,
    assignDeckToCategory,
    addToDeck,
    computeDeckCost,
    computeEntryCost
  };
})();
