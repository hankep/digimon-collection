// Deckbuilder / Wants-List Tab. Keine Regelvalidierung.

(function () {
  const state = {
    decksState: null,
    activeDeckId: null,
    pickerQuery: '',
    pickerColors: [],
    pickerType: null,
    pickerRarity: null,
    pickerLevels: [],
    pickerTraitOwn: null,
    pickerTraitInEffect: null,
    pickerSortBy: 'id',
    pickerSortDir: 'asc',
    // Besitz-Filter (gegenseitig exklusiv). Im Picker default ALLE aus — anders als
    // in der Collection, da man hier auch (noch) nicht besessene Karten zu Listen/
    // Wants hinzufuegt.
    pickerMissingOnly: false,
    pickerOwnedOnly: false,
    pickerOwnedRealOnly: false,
    pickerProxyOnly: false,
    pickerAvailableOnly: false,
    pickerAltOnly: false,
    pickerShowAlts: false,
    pickerOpen: false,  // Mobile-Collapse fuer Picker; auf Desktop irrelevant (Summary versteckt, details immer open)
    deckPickerSplit: 0.5, // 0..1 — Anteil des PICKER am Detail+Picker-Bereich (Desktop). 0.5 = 50/50.
    deckSortBy: 'id',  // id | name | price-asc | price-desc
    deckGroupBy: 'none', // level | cost | type | none
    deckMissingOnly: false, // nur Einträge mit fehlenden echten Kopien anzeigen
    deckView: 'tiles',  // tiles | text — Bilder-Grid oder kompakte Text-Liste
    mainWantsSort: 'id',  // id | price-desc
    mainWantsSetFilter: null  // null = alle Sets; sonst Set-Code (Sitzungsfilter, nicht persistiert)
  };
  const MAIN_WANTS_ID = '__main_wants__';
  function isMainWants(id) { return id === MAIN_WANTS_ID; }
  let rootEl = null;
  let collectionCache = null;

  // Filter-Konstanten — gespiegelt aus der Collection-Ansicht, damit der Picker
  // dieselben Sortierungen/Filter bietet.
  const ALT_RARITY = 'Alternative Art';
  const RARITY_FILTER_ORDER = [ALT_RARITY, 'Secret Rare', 'UR', 'Super Rare', 'Rare', 'Uncommon', 'Common', 'Promo'];
  const PICKER_COLOR_ORDER = ['Red', 'Blue', 'Green', 'Yellow', 'Black', 'Purple', 'White'];
  const PICKER_LEVELS = [2, 3, 4, 5, 6, 7];
  function pickerRarityLabel(r) { return (window.CardDB && CardDB.rarityShort) ? CardDB.rarityShort(r) : (r || ''); }

  function init(el) {
    rootEl = el;
    state.decksState = Store.loadDecks();
    collectionCache = Store.loadCollection();
    state.pickerShowAlts = !!Prefs.get('showAlts', false);
    state.mainWantsSort = Prefs.get('mainWantsSort', 'id');
    state.deckView = Prefs.get('deckView', 'tiles');
    const savedSplit = Prefs.get(window.Util.PREF_KEYS.deckPickerSplit, 0.5);
    state.deckPickerSplit = clampSplit(Number(savedSplit));
    if (!state.activeDeckId) {
      state.activeDeckId = MAIN_WANTS_ID;
    }
    render();
  }

  // Mindestens 0.15 / hoechstens 0.7 — keine kompletten Kollaps-Zustaende.
  function clampSplit(v) {
    if (!Number.isFinite(v)) return 0.5;
    return Math.max(0.15, Math.min(0.7, v));
  }

  function render() {
    // Scroll-Position der Listen-Sidebar merken, damit der User beim Wechsel
    // nicht jedes Mal nach oben springt.
    const prevDeckListScroll = (rootEl.querySelector('#deck-list') || {}).scrollTop || 0;
    // Auf Desktop ist der Picker immer offen (Summary versteckt); auf Mobile haengt es am Session-State.
    const isDesktopLg = window.matchMedia && window.matchMedia('(min-width:1024px)').matches;
    const pickerOpen = isDesktopLg || state.pickerOpen;
    // Anteil: state.deckPickerSplit gehoert dem PICKER, Rest dem Detail.
    const pickerPct = (state.deckPickerSplit * 100).toFixed(2);
    const detailPct = ((1 - state.deckPickerSplit) * 100).toFixed(2);
    rootEl.innerHTML = `
      <div class="flex flex-col lg:flex-row gap-4 lg:h-[calc(100vh_-_7rem)]">
        <aside class="w-full lg:w-64 lg:shrink-0 flex flex-col lg:min-h-0">
          <div class="flex items-center justify-between mb-2 shrink-0">
            <h2 class="text-sm font-bold uppercase text-slate-400">Listen</h2>
            <button id="new-deck" class="bg-amber-500 text-slate-900 px-2 py-1 rounded text-sm font-semibold">+ Neu</button>
          </div>
          <button id="bulk-missing" class="w-full bg-emerald-500 hover:bg-emerald-400 text-slate-900 px-2 py-2 rounded font-semibold mb-3 text-xs shrink-0">
            Fehlende → Clipboard
          </button>
          <div id="deck-list" class="space-y-1 max-h-[50vh] lg:max-h-none lg:flex-1 lg:min-h-0 overflow-y-auto overflow-x-hidden"></div>
        </aside>
        <div class="min-w-0 lg:min-h-0 lg:flex lg:flex-col flex-1" style="flex-basis: ${detailPct}%">
          <div id="deck-detail" class="lg:flex lg:flex-col lg:flex-1 lg:min-h-0"></div>
        </div>
        <div id="deck-picker-resize" class="hidden lg:block w-1.5 cursor-col-resize bg-slate-700 hover:bg-amber-500 transition-colors rounded shrink-0 self-stretch" title="Ziehen zum Anpassen"></div>
        <details id="picker-details" class="min-w-0 lg:min-h-0 lg:flex lg:flex-col flex-1" style="flex-basis: ${pickerPct}%"${pickerOpen ? ' open' : ''}>
          <summary class="lg:hidden cursor-pointer bg-slate-700 hover:bg-slate-600 text-slate-100 px-3 py-2 rounded font-semibold text-sm select-none mb-2">+ Karten hinzufügen</summary>
          <h2 class="hidden lg:block text-sm font-bold uppercase text-slate-400 mb-2 shrink-0">Karten hinzufügen</h2>
          <div class="space-y-2 mb-2 shrink-0">
            <input id="picker-search" type="text" placeholder="Name oder ID…" value="${escapeAttr(state.pickerQuery)}"
              class="bg-slate-800 border border-slate-600 rounded px-3 py-2 w-full" />
            <div id="picker-color-pills" class="flex gap-1 flex-wrap"></div>
            <div class="flex gap-2 flex-wrap items-center">
              <select id="picker-type" class="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm min-h-[40px]">
                <option value="">Typ: alle</option>
                ${CardDB.types.map(t => `<option value="${t}" ${state.pickerType === t ? 'selected' : ''}>${t}</option>`).join('')}
              </select>
              <select id="picker-rarity" class="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm min-h-[40px]">
                <option value="">Rarity: alle</option>
                ${RARITY_FILTER_ORDER
                  .filter(r => r === ALT_RARITY || CardDB.rarities.includes(r))
                  .map(r => `<option value="${escapeAttr(r)}" ${state.pickerRarity === r ? 'selected' : ''}>${escapeHtml(pickerRarityLabel(r))}</option>`).join('')}
              </select>
              <select id="picker-trait-own" class="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm min-h-[40px]" title="Filtert Karten mit diesem Trait (digi_type).">
                <option value="">Trait: alle</option>
                ${(CardDB.traits || []).map(t => `<option value="${escapeAttr(t)}" ${state.pickerTraitOwn === t ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('')}
              </select>
              <select id="picker-trait-effect" class="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm min-h-[40px]" title="Filtert Karten, deren Effekt [TRAIT] referenziert.">
                <option value="">Trait im Effekt: alle</option>
                ${(CardDB.traits || []).map(t => `<option value="${escapeAttr(t)}" ${state.pickerTraitInEffect === t ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('')}
              </select>
              <div class="flex items-center gap-1">
                <span class="text-xs text-slate-400">Lv</span>
                <div id="picker-level-pills" class="flex gap-1 flex-wrap"></div>
              </div>
              <select id="picker-sort-by" class="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm min-h-[40px]">
                <option value="id"    ${state.pickerSortBy === 'id' ? 'selected' : ''}>Sort: ID</option>
                <option value="name"  ${state.pickerSortBy === 'name' ? 'selected' : ''}>Sort: Name</option>
                <option value="level" ${state.pickerSortBy === 'level' ? 'selected' : ''}>Sort: Level</option>
                <option value="cost"  ${state.pickerSortBy === 'cost' ? 'selected' : ''}>Sort: Play-Cost</option>
                <option value="price" ${state.pickerSortBy === 'price' ? 'selected' : ''}>Sort: Preis (CM low)</option>
              </select>
              <button id="picker-sort-dir" class="bg-slate-800 border border-slate-600 rounded px-2 py-1 min-h-[40px] w-10" title="Richtung">${state.pickerSortDir === 'asc' ? '▲' : '▼'}</button>
            </div>
            <div class="flex gap-x-3 gap-y-1 flex-wrap items-center text-xs">
              <label class="flex items-center gap-1" title="Nur Karten, die du (noch) nicht besitzt">
                <input id="picker-missing" type="checkbox" ${state.pickerMissingOnly ? 'checked' : ''} /> Nur fehlende
              </label>
              <label class="flex items-center gap-1">
                <input id="picker-owned" type="checkbox" ${state.pickerOwnedOnly ? 'checked' : ''} /> Im Besitz
              </label>
              <label class="flex items-center gap-1" title="Mind. eine echte Kopie (Proxy-only ausgeschlossen)">
                <input id="picker-owned-real" type="checkbox" ${state.pickerOwnedRealOnly ? 'checked' : ''} /> ohne Proxies
              </label>
              <label class="flex items-center gap-1">
                <input id="picker-proxy" type="checkbox" ${state.pickerProxyOnly ? 'checked' : ''} /> Nur Proxy
              </label>
              <label class="flex items-center gap-1" title="Mind. eine freie (keiner Liste zugewiesene) Kopie">
                <input id="picker-available" type="checkbox" ${state.pickerAvailableOnly ? 'checked' : ''} /> Nur verfügbar
              </label>
              <label class="flex items-center gap-1" title="Alt-Arts als eigene Einträge im Picker">
                <input id="picker-alts" type="checkbox" ${state.pickerShowAlts ? 'checked' : ''} /> Alt-Arts einzeln
              </label>
              <label class="flex items-center gap-1" title="Nur Alt-Art-Varianten anzeigen">
                <input id="picker-alt-only" type="checkbox" ${state.pickerAltOnly ? 'checked' : ''} /> Nur Alt-Arts
              </label>
            </div>
          </div>
          <div id="picker-results" class="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3 max-h-[50vh] lg:max-h-none lg:flex-1 lg:min-h-0 overflow-y-auto pr-1"></div>
        </details>
      </div>
    `;

    renderDeckList();
    renderDeckDetail();
    renderPicker();

    // Scroll der Sidebar wieder herstellen.
    const dl = rootEl.querySelector('#deck-list');
    if (dl && prevDeckListScroll) dl.scrollTop = prevDeckListScroll;

    rootEl.querySelector('#bulk-missing').addEventListener('click', openBulkMissingDialog);
    rootEl.querySelector('#new-deck').addEventListener('click', () => {
      const name = prompt('Name für neue Liste:', 'Neue Liste');
      if (!name) return;
      const kind = prompt('Typ (deck / wants / trade):', 'deck') || 'deck';
      const deck = Store.createDeck(state.decksState, name, kind);
      Store.saveDecks(state.decksState);
      state.activeDeckId = deck.id;
      render();
    });
    rootEl.querySelector('#picker-search').addEventListener('input', debounce(e => {
      state.pickerQuery = e.target.value; renderPicker();
    }, 200));
    rootEl.querySelector('#picker-type').addEventListener('change', e => {
      state.pickerType = e.target.value || null; renderPicker();
    });
    rootEl.querySelector('#picker-rarity').addEventListener('change', e => {
      state.pickerRarity = e.target.value || null; renderPicker();
    });
    rootEl.querySelector('#picker-trait-own').addEventListener('change', e => {
      state.pickerTraitOwn = e.target.value || null; renderPicker();
    });
    rootEl.querySelector('#picker-trait-effect').addEventListener('change', e => {
      state.pickerTraitInEffect = e.target.value || null; renderPicker();
    });
    rootEl.querySelector('#picker-sort-by').addEventListener('change', e => {
      state.pickerSortBy = e.target.value; renderPicker();
    });
    rootEl.querySelector('#picker-sort-dir').addEventListener('click', e => {
      state.pickerSortDir = state.pickerSortDir === 'asc' ? 'desc' : 'asc';
      e.currentTarget.textContent = state.pickerSortDir === 'asc' ? '▲' : '▼';
      renderPicker();
    });
    rootEl.querySelector('#picker-missing').addEventListener('change', e => setPickerOwnership(e.target.checked ? 'missing' : null));
    rootEl.querySelector('#picker-owned').addEventListener('change', e => setPickerOwnership(e.target.checked ? 'owned' : null));
    rootEl.querySelector('#picker-owned-real').addEventListener('change', e => setPickerOwnership(e.target.checked ? 'owned-real' : null));
    rootEl.querySelector('#picker-proxy').addEventListener('change', e => setPickerOwnership(e.target.checked ? 'proxy' : null));
    rootEl.querySelector('#picker-available').addEventListener('change', e => setPickerOwnership(e.target.checked ? 'available' : null));
    rootEl.querySelector('#picker-alts').addEventListener('change', e => {
      state.pickerShowAlts = e.target.checked;
      Prefs.set('showAlts', state.pickerShowAlts);
      renderPicker();
    });
    rootEl.querySelector('#picker-alt-only').addEventListener('change', e => {
      state.pickerAltOnly = e.target.checked;
      // "Nur Alt-Arts" impliziert "Alt-Arts einzeln" (sonst gibt es keine Alt-Eintraege).
      if (state.pickerAltOnly && !state.pickerShowAlts) {
        state.pickerShowAlts = true;
        Prefs.set('showAlts', true);
        const a = rootEl.querySelector('#picker-alts'); if (a) a.checked = true;
      }
      renderPicker();
    });
    renderPickerColorPills();
    renderPickerLevelPills();
    const pickerDetails = rootEl.querySelector('#picker-details');
    if (pickerDetails) {
      pickerDetails.addEventListener('toggle', e => {
        state.pickerOpen = e.target.open;
      });
    }
    wireDeckPickerResize();
  }

  function wireDeckPickerResize() {
    const handle = rootEl.querySelector('#deck-picker-resize');
    if (!handle) return;
    const detailCol = handle.previousElementSibling;
    const pickerCol = handle.nextElementSibling;
    if (!detailCol || !pickerCol) return;

    let dragging = false;
    let containerLeft = 0;
    let containerWidth = 0;
    function onMouseMove(e) {
      if (!dragging) return;
      // Anteil PICKER von rechts (rechts vom Handle bis zum Container-Ende).
      const x = e.clientX - containerLeft;
      let pickerStart = (x / containerWidth);
      // pickerStart ist die Position der Trennung. Picker bekommt (1 - pickerStart).
      // Wir wollen 'split = pickerWidth / (detailWidth + pickerWidth)'. Container
      // umfasst Detail+Handle+Picker; Handle ist schmal — vernachlaessigbar.
      let split = 1 - pickerStart;
      split = clampSplit(split);
      state.deckPickerSplit = split;
      detailCol.style.flexBasis = ((1 - split) * 100).toFixed(2) + '%';
      pickerCol.style.flexBasis = (split * 100).toFixed(2) + '%';
    }
    function onMouseUp() {
      if (!dragging) return;
      dragging = false;
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      Prefs.set(window.Util.PREF_KEYS.deckPickerSplit, state.deckPickerSplit);
    }
    handle.addEventListener('mousedown', e => {
      // Container = Parent des Handles, der Detail + Handle + Picker enthaelt.
      const parent = handle.parentElement;
      const rect = parent.getBoundingClientRect();
      // Nur den Detail+Picker-Bereich verwenden, ohne die Listen-Sidebar (lg:w-48).
      // Detail beginnt direkt links vom Handle (detailCol-Position).
      const detailRect = detailCol.getBoundingClientRect();
      const pickerRect = pickerCol.getBoundingClientRect();
      containerLeft = detailRect.left;
      containerWidth = (pickerRect.right - detailRect.left);
      dragging = true;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mouseup', onMouseUp);
      e.preventDefault();
    });
  }

  // Wants- und Trade-Listen sind reine Kartenlisten (kein Besitz-/Slot-Abgleich).
  function isListKind(kind) { return kind === 'wants' || kind === 'trade'; }

  function mainWantsItemHtml() {
    const mw = computeMainWants();
    const mwActive = isMainWants(state.activeDeckId);
    return `<div class="flex items-center gap-1 mb-2">
      <button data-deck="${MAIN_WANTS_ID}" class="deck-item flex-1 text-left px-3 py-2 rounded ${mwActive ? 'bg-amber-500 text-slate-900' : 'bg-slate-800 hover:bg-slate-700'}">
        <div class="font-semibold text-sm">★ Main Wants</div>
        <div class="text-xs opacity-75">${mw.totalCount} fehlend · ${mw.uniqueCount} unique</div>
      </button>
    </div>`;
  }

  // Pure HTML fuer einen Deck-Listen-Eintrag. idx = VariantIndex, dIdx =
  // DeckAssignedIndex. Berechnet Komplett-/Slottable-/Proxy-Slotted-State und
  // mapped auf passende Styles.
  function deckItemHtml(d, idx, dIdx) {
    const active = d.id === state.activeDeckId;
    const total = d.entries.reduce((s, e) => s + e.count, 0);
    const da = dIdx[d.id] || {};   // variant -> { real, proxy } fuer dieses Deck
    // Wants-/Trade-Listen sind reine Kartenlisten — kein Komplett-Marker.
    const listMode = isListKind(d.kind);
    const complete = !listMode && total > 0 && d.entries.every(e => {
      const s = da[e.variant];
      return (s ? s.real + s.proxy : 0) >= e.count;
    });
    // Slottable: noch offene Slots UND mindestens 1 freie Kopie passend dazu
    let slottable = false;
    if (!complete && !listMode && total > 0) {
      for (const e of d.entries) {
        const sa = da[e.variant];
        const assigned = sa ? sa.real + sa.proxy : 0;
        if (assigned >= e.count) continue;
        const s = idx[e.variant];
        if (s && (s.freeReal + s.freeProxy) > 0) { slottable = true; break; }
      }
    }
    // Vollstaendig, aber mit zugewiesenen Proxies → Name lila markieren.
    const hasSlottedProxy = complete && d.entries.some(e => {
      const s = da[e.variant];
      return s && s.proxy > 0;
    });
    const cls = active
      ? 'bg-amber-500 text-slate-900'
      : (complete
          ? (hasSlottedProxy
              ? 'bg-purple-600/30 border border-purple-500 hover:bg-purple-600/50'
              : 'bg-emerald-600/30 border border-emerald-500 hover:bg-emerald-600/50')
          : (slottable
              ? 'bg-yellow-500/15 border border-yellow-400 hover:bg-yellow-500/25 deck-slottable'
              : 'hover:bg-slate-800'));
    const nameCls = (hasSlottedProxy && !active) ? 'text-purple-400' : '';
    const fav = !!d.favorite;
    const starTitle = fav ? 'Aus Favoriten entfernen' : 'Als Favorit markieren';
    const starColor = fav ? 'text-amber-400' : 'text-slate-500 hover:text-amber-300';
    const sharedIcon = d.shared ? `<span class="text-emerald-400 text-xs" title="Im Shared Space sichtbar">🌐</span>` : '';
    return `<div class="flex items-center gap-1" data-deck-row="${d.id}" data-deck-kind="${escapeHtml(d.kind)}">
      <span data-drag-handle="${d.id}" draggable="true" class="cursor-grab active:cursor-grabbing text-slate-600 hover:text-slate-300 select-none leading-none px-0.5" title="Ziehen zum Sortieren">☰</span>
      <button data-fav="${d.id}" class="${starColor} px-1 text-base leading-none" title="${starTitle}">${fav ? '★' : '☆'}</button>
      <button data-deck="${d.id}" class="deck-item flex-1 min-w-0 text-left px-3 py-2 rounded ${cls}">
        <div class="font-semibold text-sm truncate ${nameCls}">${sharedIcon}${escapeHtml(d.name)}${complete && !active ? ` <span class="${hasSlottedProxy ? 'text-purple-300' : 'text-emerald-300'}">✓</span>` : ''}</div>
        <div class="text-xs opacity-75 truncate">${escapeHtml(d.kind)} · ${total} Karten</div>
      </button>
      <span class="flex flex-col leading-none">
        <button data-move-up="${d.id}" class="text-slate-500 hover:text-slate-200 text-[10px] leading-none" title="Nach oben">▲</button>
        <button data-move-down="${d.id}" class="text-slate-500 hover:text-slate-200 text-[10px] leading-none" title="Nach unten">▼</button>
      </span>
      <button data-dup="${d.id}" class="text-slate-500 hover:text-sky-400 px-1" title="Liste duplizieren">⎘</button>
      <button data-del="${d.id}" class="text-slate-500 hover:text-red-400 px-2">✕</button>
    </div>`;
  }

  // Pure HTML der nach Kind gruppierten Liste (Wants / Trades / Decks +
  // Sonstige als Fallback, jeweils Favoriten zuerst).
  // Favoriten zuerst, sonst Array-Reihenfolge erhalten. Array.sort ist stabil,
  // d.h. die manuelle Sortierung innerhalb der Fav-/Nicht-Fav-Untergruppe bleibt.
  function favFirst(arr) {
    return arr.slice().sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0));
  }

  // Kategorien eines kind, nach order sortiert.
  function catsOfKind(kind) {
    return (state.decksState.categories || [])
      .filter(c => c.kind === kind)
      .slice()
      .sort((a, b) => a.order - b.order);
  }

  function decksBlockHtml(items, idx, dIdx) {
    return `<div class="space-y-1">${items.map(d => deckItemHtml(d, idx, dIdx)).join('')}</div>`;
  }

  // ── Collapse-Zustand (lokal, pro Geraet — nicht im Sync-Blob) ──────────────
  function collapsedMap() {
    return Prefs.get(window.Util.PREF_KEYS.deckCatCollapsed, {}) || {};
  }
  function isCollapsed(key) { return !!collapsedMap()[key]; }
  function toggleCollapsed(key) {
    const m = collapsedMap();
    if (m[key]) delete m[key]; else m[key] = true;
    Prefs.set(window.Util.PREF_KEYS.deckCatCollapsed, m);
  }

  function groupHeaderHtml(label, total, kind) {
    return `<div class="flex items-center justify-between mt-3 mb-1">
      <span class="text-[11px] font-bold uppercase tracking-wide text-slate-500">${label} · ${total}</span>
      <button data-add-cat="${kind}" class="text-slate-500 hover:text-amber-300 text-[11px] font-semibold px-1 leading-none" title="Neue Kategorie in dieser Gruppe">+ Kat.</button>
    </div>`;
  }

  function categoryHeaderHtml(cat, count, collapsed) {
    return `<div class="flex items-center gap-1 mt-1" data-cat-row="${cat.id}" data-cat-id="${cat.id}" data-cat-kind="${escapeAttr(cat.kind)}">
      <span data-cat-drag-handle="${cat.id}" draggable="true" class="cursor-grab active:cursor-grabbing text-slate-600 hover:text-slate-300 select-none leading-none px-0.5" title="Ziehen zum Sortieren">☰</span>
      <button data-cat-toggle="${cat.id}" class="flex-1 min-w-0 flex items-center gap-1 text-left px-1 py-1 rounded hover:bg-slate-800 text-[11px] font-bold uppercase tracking-wide text-slate-400">
        <span class="text-slate-500 leading-none">${collapsed ? '▶' : '▼'}</span>
        <span class="truncate">${escapeHtml(cat.name)}</span>
        <span class="text-slate-600">· ${count}</span>
      </button>
      <span class="flex flex-col leading-none">
        <button data-cat-up="${cat.id}" class="text-slate-500 hover:text-slate-200 text-[10px] leading-none" title="Kategorie nach oben">▲</button>
        <button data-cat-down="${cat.id}" class="text-slate-500 hover:text-slate-200 text-[10px] leading-none" title="Kategorie nach unten">▼</button>
      </span>
      <button data-cat-rename="${cat.id}" class="text-slate-500 hover:text-sky-400 px-1" title="Kategorie umbenennen">✎</button>
      <button data-cat-del="${cat.id}" class="text-slate-500 hover:text-red-400 px-1" title="Kategorie löschen">✕</button>
    </div>`;
  }

  function uncatHeaderHtml(kind, count, collapsed) {
    return `<div class="flex items-center gap-1 mt-1" data-uncat-kind="${escapeAttr(kind)}">
      <span class="px-0.5 text-slate-700 select-none leading-none">·</span>
      <button data-uncat-toggle="${escapeAttr(kind)}" class="flex-1 min-w-0 flex items-center gap-1 text-left px-1 py-1 rounded hover:bg-slate-800 text-[11px] font-bold uppercase tracking-wide text-slate-500">
        <span class="text-slate-600 leading-none">${collapsed ? '▶' : '▼'}</span>
        <span class="truncate">Ohne Kategorie</span>
        <span class="text-slate-600">· ${count}</span>
      </button>
    </div>`;
  }

  // Eine feste Gruppe (kind) inkl. eigener Kategorien rendern. Ohne Kategorien
  // sieht es identisch zum alten Zustand aus (Decks direkt unter dem Header).
  function deckGroupHtml(kind, label, idx, dIdx) {
    const all = state.decksState.decks.filter(d => d.kind === kind);
    const cats = catsOfKind(kind);
    if (!all.length && !cats.length) return '';
    let html = groupHeaderHtml(label, all.length, kind);
    if (!cats.length) {
      html += decksBlockHtml(favFirst(all), idx, dIdx);
      return html;
    }
    for (const cat of cats) {
      const items = favFirst(all.filter(d => d.categoryId === cat.id));
      const collapsed = isCollapsed(cat.id);
      html += categoryHeaderHtml(cat, items.length, collapsed);
      if (!collapsed) html += decksBlockHtml(items, idx, dIdx);
    }
    // „Ohne Kategorie" immer anzeigen (auch leer) — dient als Drop-Ziel.
    const uncat = favFirst(all.filter(d => !d.categoryId));
    const uncatCollapsed = isCollapsed('uncat:' + kind);
    html += uncatHeaderHtml(kind, uncat.length, uncatCollapsed);
    if (!uncatCollapsed) html += decksBlockHtml(uncat, idx, dIdx);
    return html;
  }

  function deckListGroupsHtml(idx, dIdx) {
    const GROUPS = [
      { kind: 'wants', label: 'Wants' },
      { kind: 'trade', label: 'Trades' },
      { kind: 'deck',  label: 'Decks' }
    ];
    let html = '';
    for (const g of GROUPS) html += deckGroupHtml(g.kind, g.label, idx, dIdx);
    // Fallback: unbekannte kinds (sollte dank normalizeKind selten sein) — ohne Kategorien.
    const known = new Set(GROUPS.map(g => g.kind));
    const rest = favFirst(state.decksState.decks.filter(d => !known.has(d.kind)));
    if (rest.length) {
      html += `<div class="text-[11px] font-bold uppercase tracking-wide text-slate-500 mt-3 mb-1">Sonstige · ${rest.length}</div>`
        + decksBlockHtml(rest, idx, dIdx);
    }
    return html;
  }

  function wireDeckList(el) {
    el.querySelectorAll('.deck-item').forEach(btn => {
      btn.addEventListener('click', () => {
        state.activeDeckId = btn.dataset.deck;
        render();
      });
    });
    el.querySelectorAll('[data-fav]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const id = btn.dataset.fav;
        const d = state.decksState.decks.find(x => x.id === id);
        if (!d) return;
        d.favorite = !d.favorite;
        Store.saveDecks(state.decksState);
        renderDeckList();
      });
    });
    el.querySelectorAll('[data-del]').forEach(btn => {
      btn.addEventListener('click', () => {
        if (!confirm('Liste löschen?')) return;
        Store.releaseAllForDeck(collectionCache, btn.dataset.del);
        Store.saveCollection(collectionCache);
        Store.deleteDeck(state.decksState, btn.dataset.del);
        if (state.activeDeckId === btn.dataset.del) state.activeDeckId = null;
        Store.saveDecks(state.decksState);
        render();
      });
    });
    el.querySelectorAll('[data-dup]').forEach(btn => {
      btn.addEventListener('click', () => {
        const copy = Store.duplicateDeck(state.decksState, btn.dataset.dup);
        if (!copy) return;
        Store.saveDecks(state.decksState);
        state.activeDeckId = copy.id;
        render();
      });
    });

    // ── Kategorien: anlegen / umbenennen / loeschen / einklappen / sortieren ──
    el.querySelectorAll('[data-add-cat]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const name = prompt('Name der neuen Kategorie:', 'Neue Kategorie');
        if (!name) return;
        Store.createCategory(state.decksState, btn.dataset.addCat, name.trim());
        Store.saveDecks(state.decksState);
        renderDeckList();
      });
    });
    el.querySelectorAll('[data-cat-toggle]').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); toggleCollapsed(btn.dataset.catToggle); renderDeckList(); });
    });
    el.querySelectorAll('[data-uncat-toggle]').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); toggleCollapsed('uncat:' + btn.dataset.uncatToggle); renderDeckList(); });
    });
    el.querySelectorAll('[data-cat-rename]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const cat = (state.decksState.categories || []).find(c => c.id === btn.dataset.catRename);
        if (!cat) return;
        const name = prompt('Kategorie umbenennen:', cat.name);
        if (!name) return;
        Store.renameCategory(state.decksState, cat.id, name.trim());
        Store.saveDecks(state.decksState);
        renderDeckList();
      });
    });
    el.querySelectorAll('[data-cat-del]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        if (!confirm('Kategorie löschen? Die Listen bleiben erhalten und landen unter „Ohne Kategorie".')) return;
        Store.deleteCategory(state.decksState, btn.dataset.catDel);
        Store.saveDecks(state.decksState);
        renderDeckList();
      });
    });
    el.querySelectorAll('[data-cat-up]').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); moveCategory(btn.dataset.catUp, -1); });
    });
    el.querySelectorAll('[data-cat-down]').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); moveCategory(btn.dataset.catDown, +1); });
    });

    // ── Sortieren: ↑↓-Buttons (Touch-tauglich) ───────────────────────────────
    el.querySelectorAll('[data-move-up]').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); moveDeckInGroup(btn.dataset.moveUp, -1); });
    });
    el.querySelectorAll('[data-move-down]').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); moveDeckInGroup(btn.dataset.moveDown, +1); });
    });

    // ── Drag-and-Drop: Decks (umsortieren + in Kategorie ziehen) UND Kategorien
    //    (umsortieren). dragType unterscheidet die beiden Quellen. ────────────
    let dragType = null, dragId = null, dragKind = null;
    function clearDrag() {
      el.querySelectorAll('.opacity-50').forEach(r => r.classList.remove('opacity-50'));
      el.querySelectorAll('[data-deck-row], [data-cat-row], [data-uncat-kind]').forEach(r => r.classList.remove('ring-1', 'ring-amber-400'));
      dragType = null; dragId = null; dragKind = null;
    }
    function startDrag(type, id, kind, rowSel, h, e) {
      dragType = type; dragId = id; dragKind = kind;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', id);
      const row = h.closest(rowSel);
      if (row) {
        if (e.dataTransfer.setDragImage) e.dataTransfer.setDragImage(row, 10, 10);
        row.classList.add('opacity-50');
      }
    }
    el.querySelectorAll('[data-drag-handle]').forEach(h => {
      h.addEventListener('dragstart', e => {
        const id = h.getAttribute('data-drag-handle');
        const deck = state.decksState.decks.find(d => d.id === id);
        startDrag('deck', id, deck ? deck.kind : null, '[data-deck-row]', h, e);
      });
      h.addEventListener('dragend', clearDrag);
    });
    el.querySelectorAll('[data-cat-drag-handle]').forEach(h => {
      h.addEventListener('dragstart', e => {
        const id = h.getAttribute('data-cat-drag-handle');
        const cat = (state.decksState.categories || []).find(c => c.id === id);
        startDrag('cat', id, cat ? cat.kind : null, '[data-cat-row]', h, e);
      });
      h.addEventListener('dragend', clearDrag);
    });

    // Deck-Zeilen: nur Decks droppen (umsortieren / Kategorie wechseln).
    el.querySelectorAll('[data-deck-row]').forEach(row => {
      const ok = () => dragType === 'deck' && row.getAttribute('data-deck-kind') === dragKind;
      row.addEventListener('dragover', e => {
        if (!ok()) return;
        e.preventDefault(); e.dataTransfer.dropEffect = 'move';
        if (row.getAttribute('data-deck-row') !== dragId) row.classList.add('ring-1', 'ring-amber-400');
      });
      row.addEventListener('dragleave', () => row.classList.remove('ring-1', 'ring-amber-400'));
      row.addEventListener('drop', e => {
        if (!ok()) return;
        e.preventDefault(); row.classList.remove('ring-1', 'ring-amber-400');
        const targetId = row.getAttribute('data-deck-row');
        if (!targetId || targetId === dragId) return;
        const rect = row.getBoundingClientRect();
        const after = (e.clientY - rect.top) > rect.height / 2;
        moveDeckRelative(dragId, targetId, after);
      });
    });

    // Kategorie-Header: Deck → in Kategorie einsortieren; Kategorie → umsortieren.
    el.querySelectorAll('[data-cat-row]').forEach(row => {
      const catId = row.getAttribute('data-cat-id');
      const catKind = row.getAttribute('data-cat-kind');
      const ok = () => dragKind === catKind && (dragType === 'deck' || (dragType === 'cat' && dragId !== catId));
      row.addEventListener('dragover', e => {
        if (!ok()) return;
        e.preventDefault(); e.dataTransfer.dropEffect = 'move';
        row.classList.add('ring-1', 'ring-amber-400');
      });
      row.addEventListener('dragleave', () => row.classList.remove('ring-1', 'ring-amber-400'));
      row.addEventListener('drop', e => {
        if (!ok()) return;
        e.preventDefault(); row.classList.remove('ring-1', 'ring-amber-400');
        if (dragType === 'deck') {
          Store.assignDeckToCategory(state.decksState, dragId, catId);
          Store.saveDecks(state.decksState);
          renderDeckList();
        } else {
          const rect = row.getBoundingClientRect();
          const after = (e.clientY - rect.top) > rect.height / 2;
          moveCategoryRelative(dragId, catId, after);
        }
      });
    });

    // „Ohne Kategorie"-Header: Deck droppen → Kategorie-Zuordnung loesen.
    el.querySelectorAll('[data-uncat-kind]').forEach(row => {
      const k = row.getAttribute('data-uncat-kind');
      const ok = () => dragType === 'deck' && dragKind === k;
      row.addEventListener('dragover', e => {
        if (!ok()) return;
        e.preventDefault(); e.dataTransfer.dropEffect = 'move';
        row.classList.add('ring-1', 'ring-amber-400');
      });
      row.addEventListener('dragleave', () => row.classList.remove('ring-1', 'ring-amber-400'));
      row.addEventListener('drop', e => {
        if (!ok()) return;
        e.preventDefault(); row.classList.remove('ring-1', 'ring-amber-400');
        Store.assignDeckToCategory(state.decksState, dragId, null);
        Store.saveDecks(state.decksState);
        renderDeckList();
      });
    });
  }

  // Ordnet das decks-Array so um, dass die Listen vom Typ `kind` in der Reihen-
  // folge von orderedIds stehen; Slots aller anderen kinds bleiben unveraendert.
  function reorderKind(kind, orderedIds) {
    const decks = state.decksState.decks;
    const byId = new Map(decks.map(d => [d.id, d]));
    const ordered = orderedIds.map(id => byId.get(id)).filter(d => d && d.kind === kind);
    if (ordered.length !== decks.filter(d => d.kind === kind).length) return; // Safety
    let oi = 0;
    state.decksState.decks = decks.map(d => (d.kind === kind ? ordered[oi++] : d));
  }

  // Reihenfolge der Decks einer Kategorie-Teilmenge festschreiben: die Mitglieder
  // (subOrderedIds) werden – in dieser Reihenfolge – in die Array-Positionen
  // gesetzt, die die Teilmenge aktuell im kind belegt; alle anderen Decks bleiben.
  function commitSubOrder(kind, subOrderedIds) {
    const kindDecks = state.decksState.decks.filter(d => d.kind === kind);
    const subSet = new Set(subOrderedIds);
    let si = 0;
    const fullOrder = kindDecks.map(d => (subSet.has(d.id) ? subOrderedIds[si++] : d.id));
    reorderKind(kind, fullOrder);
  }

  // ↑/↓: tauscht eine Liste mit dem Nachbarn in der gerenderten (Fav-zuerst)
  // Reihenfolge INNERHALB ihrer Kategorie. Fav-Grenze wird nicht ueberschritten.
  function moveDeckInGroup(id, dir) {
    const decks = state.decksState.decks;
    const deck = decks.find(d => d.id === id);
    if (!deck) return;
    const cat = deck.categoryId || null;
    const sub = favFirst(decks.filter(d => d.kind === deck.kind && (d.categoryId || null) === cat));
    const i = sub.findIndex(d => d.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= sub.length) return;
    if (!!sub[j].favorite !== !!deck.favorite) return; // Fav/Nicht-Fav nicht mischen
    const tmp = sub[i]; sub[i] = sub[j]; sub[j] = tmp;
    commitSubOrder(deck.kind, sub.map(d => d.id));
    Store.saveDecks(state.decksState);
    renderDeckList();
  }

  // Drop eines Decks auf ein anderes Deck: in dessen Kategorie einsortieren (falls
  // abweichend, wird zuerst umgehaengt) und relativ zu targetId einfuegen.
  function moveDeckRelative(dragId, targetId, after) {
    const decks = state.decksState.decks;
    const deck = decks.find(d => d.id === dragId);
    const target = decks.find(d => d.id === targetId);
    if (!deck || !target || deck.kind !== target.kind) return;
    if ((deck.categoryId || null) !== (target.categoryId || null)) {
      Store.assignDeckToCategory(state.decksState, dragId, target.categoryId || null);
    }
    const cat = deck.categoryId || null;
    const sub = favFirst(decks.filter(d => d.kind === deck.kind && (d.categoryId || null) === cat)).map(d => d.id);
    const from = sub.indexOf(dragId);
    if (from < 0) return;
    sub.splice(from, 1);
    let to = sub.indexOf(targetId);
    if (to < 0) return;
    if (after) to += 1;
    sub.splice(to, 0, dragId);
    commitSubOrder(deck.kind, sub);
    Store.saveDecks(state.decksState);
    renderDeckList();
  }

  // ── Kategorien sortieren ──────────────────────────────────────────────────
  function moveCategory(catId, dir) {
    const cat = (state.decksState.categories || []).find(c => c.id === catId);
    if (!cat) return;
    const ordered = catsOfKind(cat.kind).map(c => c.id);
    const i = ordered.indexOf(catId);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= ordered.length) return;
    const tmp = ordered[i]; ordered[i] = ordered[j]; ordered[j] = tmp;
    Store.reorderCategories(state.decksState, cat.kind, ordered);
    Store.saveDecks(state.decksState);
    renderDeckList();
  }

  function moveCategoryRelative(dragId, targetId, after) {
    const cat = (state.decksState.categories || []).find(c => c.id === dragId);
    if (!cat) return;
    const ordered = catsOfKind(cat.kind).map(c => c.id);
    const from = ordered.indexOf(dragId);
    if (from < 0) return;
    ordered.splice(from, 1);
    let to = ordered.indexOf(targetId);
    if (to < 0) return;
    if (after) to += 1;
    ordered.splice(to, 0, dragId);
    Store.reorderCategories(state.decksState, cat.kind, ordered);
    Store.saveDecks(state.decksState);
    renderDeckList();
  }

  function renderDeckList() {
    const el = rootEl.querySelector('#deck-list');
    if (!el) return;
    const mainWantsHtml = mainWantsItemHtml();
    if (!state.decksState.decks.length) {
      el.innerHTML = mainWantsHtml + `<div class="text-sm text-slate-500">Noch keine Listen.</div>`;
      wireDeckList(el);
      return;
    }
    const idx = Store.getVariantIndex(collectionCache);
    const dIdx = Store.getDeckAssignedIndex(collectionCache);
    el.innerHTML = mainWantsHtml + deckListGroupsHtml(idx, dIdx);
    wireDeckList(el);
  }

  // Aggregat fuer die Cost-/Fehlt-/Wants-Coverage-Zeile. Reine Berechnung;
  // liefert die fertige HTML-Inline-Spannenkette oder '' wenn das Deck leer ist.
  function buildDeckCostLine(deck) {
    const total = deck.entries.reduce((s, e) => s + e.count, 0);
    if (!total) return '';
    const isWants = isListKind(deck.kind);
    // Wants-Coverage: wie viele der fehlenden Slots stehen schon in einer
    // Wants-Liste? Aggregat pro variant ueber alle kind='wants'-Listen.
    const wantsByVariant = new Map();
    if (!isWants) {
      for (const d of state.decksState.decks) {
        if (d.kind !== 'wants') continue;
        for (const e of d.entries) {
          wantsByVariant.set(e.variant, (wantsByVariant.get(e.variant) || 0) + e.count);
        }
      }
    }
    const da = Store.getDeckAssignedIndex(collectionCache)[deck.id] || {};
    const haveCM = !!(window.CM && CM.hasData());

    // ── Summen ueber die GESLOTTETEN echten Kopien dieses Decks ──────────────
    // Nur Karten, die diesem Deck zugewiesen sind UND kein Proxy sind, zaehlen.
    // Ein Pass ueber alle Kopien, gruppiert pro Variante (sum/missing/count).
    const slottedByVariant = Object.create(null);
    let slottedCount = 0;
    for (const id in (collectionCache.copies || {})) {
      const cp = collectionCache.copies[id];
      if (cp.isProxy || cp.deckId !== deck.id) continue;
      let slot = slottedByVariant[cp.variant];
      if (!slot) { slot = { sum: 0, missing: 0, count: 0 }; slottedByVariant[cp.variant] = slot; }
      slot.count++;
      slottedCount++;
      if (cp.price == null) slot.missing++;
      else slot.sum += cp.price;
    }
    let ownTotal = 0, ownUnknown = 0;          // (1) eigene Preise der geslotteten Kopien
    let cmLowOwned = 0, cmTrendOwned = 0;      // (2) CM low/trend ueber geslottete Kopien
    let hybridTotal = 0, hybridMissing = 0;    // (3) eigene + CM-low-Fallback
    for (const variant in slottedByVariant) {
      const slot = slottedByVariant[variant];
      const cardId = (CardDB.allVariants.get(variant) || {}).cardId || variant.replace(/_P\d+$/, '');
      ownTotal += slot.sum;
      ownUnknown += slot.missing;
      const p = haveCM ? CM.pricesForEntry(cardId, variant) : { low: null, trend: null };
      if (p.low != null) cmLowOwned += p.low * slot.count;
      if (p.trend != null) cmTrendOwned += p.trend * slot.count;
      hybridTotal += slot.sum;
      if (p.low != null) hybridTotal += p.low * slot.missing;
      else hybridMissing += slot.missing;
    }

    // ── Fehlende Karten (noch nicht geslottet) ───────────────────────────────
    let missingLow = 0, missingTrend = 0, missingPricedCount = 0, missingNoCm = 0, missingInWants = 0, missingTotal = 0;
    for (const entry of deck.entries) {
      const sa = da[entry.variant];
      const need = isWants ? entry.count : Math.max(0, entry.count - (sa ? sa.real : 0));
      if (!need) continue;
      missingTotal += need;
      if (!isWants) {
        const want = wantsByVariant.get(entry.variant) || 0;
        missingInWants += Math.min(need, want);
      }
      if (haveCM) {
        const p = CM.pricesForEntry(entry.cardId, entry.variant);
        if (p.low != null || p.trend != null) {
          if (p.low != null) missingLow += p.low * need;
          if (p.trend != null) missingTrend += p.trend * need;
          missingPricedCount += need;
        } else {
          missingNoCm += need;
        }
      }
    }

    // Owned-Summen nur zeigen, wenn ueberhaupt etwas geslottet ist
    // (Wants/Trade-Listen slotten nicht → dort entfaellt der Block).
    const ownPart = slottedCount > 0
      ? `<span class="text-emerald-400 font-bold">${Fmt.eur(ownTotal)}</span> <span class="text-slate-500">(bereits bezahlt${ownUnknown ? `, ${ownUnknown} ohne Preis` : ''})</span>`
        + (haveCM ? ` · <span class="text-amber-300" title="CM low / trend ueber geslottete Kopien">CM: ${Fmt.eur(cmLowOwned)} / ${Fmt.eur(cmTrendOwned)}</span>` : '')
        + (haveCM ? ` · <span class="text-sky-300" title="Eigene Preise; geslottete Kopien ohne eigenen Preis mit CM low">Eigene + CM-Fallback: ${Fmt.eur(hybridTotal)}${hybridMissing ? ` <span class="text-slate-500">(${hybridMissing} ohne)</span>` : ''}</span>` : '')
      : '';
    const missingPart = (missingTotal
        ? ` · <span class="text-red-400">${missingTotal} fehlen</span>${missingInWants > 0 ? ` <span class="text-sky-400" title="Davon stehen so viele bereits in einer Wants-Liste">(${missingInWants} in Wants)</span>` : ''}`
        : '')
      + (missingPricedCount > 0
          ? ` · <span class="text-amber-400" title="Cardmarket low / trend Summe der fehlenden Karten">fehlend CM: ${Fmt.eur(missingLow)} / ${Fmt.eur(missingTrend)}</span>${missingNoCm ? ` <span class="text-slate-500">(${missingNoCm} ohne CM-Preis)</span>` : ''}`
          : '');
    // Fuehrendes ' · ' entfernen, falls der Owned-Block leer ist (Wants/Trade).
    return (ownPart + missingPart).replace(/^ · /, '');
  }

  function renderDeckHeaderHtml(deck) {
    const total = deck.entries.reduce((s, e) => s + e.count, 0);
    const costLine = buildDeckCostLine(deck);
    return `
      <div class="bg-slate-800 rounded p-3 mb-3 shrink-0">
        <div class="flex items-center gap-2">
          <input id="deck-name" type="text" value="${escapeAttr(deck.name)}"
            class="bg-transparent text-xl font-bold flex-1 focus:outline-none focus:bg-slate-700 rounded px-1" />
          <span id="deck-note-host">${Notes.iconHtml(!!(deck.notes && deck.notes.trim()))}</span>
          <select id="deck-kind" class="bg-slate-900 border border-slate-600 rounded px-2 py-1 text-sm">
            ${['deck','wants','trade'].map(k => `<option value="${k}" ${deck.kind === k ? 'selected' : ''}>${k}</option>`).join('')}
          </select>
          <select id="deck-category" class="bg-slate-900 border border-slate-600 rounded px-2 py-1 text-sm" title="Kategorie">
            <option value="">Ohne Kategorie</option>
            ${catsOfKind(deck.kind).map(c => `<option value="${escapeAttr(c.id)}" ${deck.categoryId === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('')}
          </select>
        </div>
        <div class="text-xs text-slate-400 mt-1">${total} Karten · ${deck.entries.length} Einträge</div>
        ${costLine ? `<div class="text-sm mt-1">${costLine}</div>` : ''}
        <div id="color-balance" class="mt-2"></div>
      </div>
    `;
  }

  function renderDeckToolbarHtml(deck) {
    const showListKindControls = !isListKind(deck.kind);
    return `
      <div class="flex items-center gap-2 mb-2 text-sm flex-wrap shrink-0">
        <span class="text-slate-400">Ansicht:</span>
        <select id="deck-view" class="bg-slate-800 border border-slate-600 rounded px-2 py-1">
          <option value="tiles" ${state.deckView === 'tiles' ? 'selected' : ''}>Bilder</option>
          <option value="text"  ${state.deckView === 'text'  ? 'selected' : ''}>Text</option>
        </select>
        <span class="text-slate-400">Gruppieren:</span>
        <select id="group-by" class="bg-slate-800 border border-slate-600 rounded px-2 py-1">
          <option value="level" ${state.deckGroupBy === 'level' ? 'selected' : ''}>Level</option>
          <option value="cost"  ${state.deckGroupBy === 'cost'  ? 'selected' : ''}>Cost</option>
          <option value="type"  ${state.deckGroupBy === 'type'  ? 'selected' : ''}>Typ</option>
          <option value="none"  ${state.deckGroupBy === 'none'  ? 'selected' : ''}>Keine</option>
        </select>
        <span class="text-slate-400">Sortieren:</span>
        <select id="sort-by" class="bg-slate-800 border border-slate-600 rounded px-2 py-1">
          <option value="id"         ${state.deckSortBy === 'id'         ? 'selected' : ''}>ID</option>
          <option value="name"       ${state.deckSortBy === 'name'       ? 'selected' : ''}>Name</option>
          <option value="price-asc"  ${state.deckSortBy === 'price-asc'  ? 'selected' : ''}>Preis ↑</option>
          <option value="price-desc" ${state.deckSortBy === 'price-desc' ? 'selected' : ''}>Preis ↓</option>
          <option value="status"     ${state.deckSortBy === 'status'     ? 'selected' : ''}>Status (slottbar → fehlend → fertig)</option>
        </select>
        ${showListKindControls ? `<label class="flex items-center gap-1 text-slate-300" title="Nur Karten mit fehlenden echten Kopien (Proxies zählen als fehlend)">
          <input id="deck-missing-only" type="checkbox" ${state.deckMissingOnly ? 'checked' : ''} />
          Nur fehlende
        </label>` : ''}
        <button id="share-toggle" class="ml-auto text-xs sm:text-sm px-2 sm:px-3 py-1.5 rounded font-semibold ${deck.shared ? 'bg-emerald-600 hover:bg-emerald-500 text-white' : 'bg-slate-700 hover:bg-slate-600 text-slate-100'}"
          title="Diese Liste im Shared Space sichtbar machen (live-synced)">${deck.shared ? '✓ Geteilt' : '🌐 Teilen'}</button>
        <button id="import-into" class="bg-sky-500 hover:bg-sky-400 text-slate-900 text-xs sm:text-sm px-2 sm:px-3 py-1.5 rounded font-semibold"
          title="Karten direkt in diese Liste einfügen (mengen werden addiert)">Importieren</button>
        ${showListKindControls ? `<button id="missing-to-wants" class="bg-purple-500 hover:bg-purple-400 text-white text-xs sm:text-sm px-2 sm:px-3 py-1.5 rounded font-semibold"
          title="Fehlende Karten direkt in eine Wants-Liste übernehmen (Alt-Arts bleiben erhalten)">Fehlende → Wants</button>` : ''}
        <button id="export-missing" class="bg-amber-500 text-slate-900 text-xs sm:text-sm px-2 sm:px-3 py-1.5 rounded font-semibold"
          title="Exportiert nur Karten/Mengen, die in dieser Liste fehlen (Cardmarket-kompatibel)">Fehlende exportieren</button>
        <button id="export-full" class="btn-primary-emerald"
          title="Kopiert die vollständige Liste (Anzahl Name ID) in die Zwischenablage">Exportieren</button>
      </div>
    `;
  }

  // Wired Header- + Toolbar-Buttons. scopeEl ist #deck-detail.
  function wireDeckDetailControls(scopeEl, deck) {
    scopeEl.querySelector('#deck-name').addEventListener('change', e => {
      deck.name = e.target.value.trim() || 'Untitled';
      deck.updatedAt = new Date().toISOString();
      Store.saveDecks(state.decksState);
      renderDeckList();
    });
    scopeEl.querySelector('#deck-kind').addEventListener('change', e => {
      deck.kind = e.target.value;
      // Kind-Wechsel macht die alte Kategorie ungueltig (anderer kind) → loesen.
      deck.categoryId = null;
      deck.updatedAt = new Date().toISOString();
      Store.saveDecks(state.decksState);
      renderDeckList();
      renderDeckDetail(); // Kategorie-Dropdown auf neuen kind aktualisieren
    });
    const catSel = scopeEl.querySelector('#deck-category');
    if (catSel) catSel.addEventListener('change', e => {
      Store.assignDeckToCategory(state.decksState, deck.id, e.target.value || null);
      deck.updatedAt = new Date().toISOString();
      Store.saveDecks(state.decksState);
      renderDeckList();
    });
    scopeEl.querySelector('#deck-view').addEventListener('change', e => {
      state.deckView = e.target.value;
      Prefs.set('deckView', state.deckView);
      renderDeckDetail();
    });
    scopeEl.querySelector('#group-by').addEventListener('change', e => {
      state.deckGroupBy = e.target.value;
      renderDeckDetail();
    });
    scopeEl.querySelector('#sort-by').addEventListener('change', e => {
      state.deckSortBy = e.target.value;
      renderDeckDetail();
    });
    const deckMissingCb = scopeEl.querySelector('#deck-missing-only');
    if (deckMissingCb) deckMissingCb.addEventListener('change', e => {
      state.deckMissingOnly = e.target.checked;
      renderDeckEntries(deck);
    });
    scopeEl.querySelector('#export-missing').addEventListener('click', () => exportMissing(deck));
    scopeEl.querySelector('#export-full').addEventListener('click', () => exportFull(deck));
    scopeEl.querySelector('#import-into').addEventListener('click', () => openImportIntoDeck(deck));
    scopeEl.querySelector('#share-toggle').addEventListener('click', () => {
      deck.shared = !deck.shared;
      deck.updatedAt = new Date().toISOString();
      Store.saveDecks(state.decksState);
      if (window.Util && Util.toast) {
        Util.toast(deck.shared ? `„${deck.name}" wird im Shared Space sichtbar` : `„${deck.name}" ist nicht mehr im Shared Space`, 'info', 2200);
      }
    });
    const mtwBtn = scopeEl.querySelector('#missing-to-wants');
    if (mtwBtn) mtwBtn.addEventListener('click', () => openMissingToWantsDialog(deck));
    scopeEl.querySelector('#deck-note-host [data-note-trigger]').addEventListener('click', () => {
      Notes.openDialog({
        title: deck.name,
        subtitle: 'Listen-Notiz',
        value: deck.notes || '',
        onSave: txt => {
          deck.notes = txt.trim();
          deck.updatedAt = new Date().toISOString();
          Store.saveDecks(state.decksState);
          renderDeckDetail();
        }
      });
    });
  }

  function renderDeckDetail() {
    if (isMainWants(state.activeDeckId)) {
      renderMainWantsDetail();
      return;
    }
    const el = rootEl.querySelector('#deck-detail');
    const deck = currentDeck();
    if (!deck) {
      el.innerHTML = `<div class="text-slate-500 mt-8 text-center">Wähle eine Liste oder erstelle eine neue.</div>`;
      return;
    }
    const prevScroll = (el.querySelector('#deck-entries') || {}).scrollTop || 0;
    el.innerHTML = renderDeckHeaderHtml(deck)
      + renderDeckToolbarHtml(deck)
      + `<div id="deck-entries" class="space-y-4 max-h-[78vh] lg:max-h-none lg:flex-1 lg:min-h-0 overflow-y-auto pr-1"></div>`;
    wireDeckDetailControls(el, deck);
    renderColorBalance(deck);
    renderDeckEntries(deck);
    const entriesEl = rootEl.querySelector('#deck-entries');
    if (entriesEl && prevScroll) entriesEl.scrollTop = prevScroll;
  }

  function renderColorBalance(deck) {
    const el = rootEl.querySelector('#color-balance');
    const totals = {};
    let knownTotal = 0;
    for (const entry of deck.entries) {
      const card = CardDB.byId.get(entry.cardId);
      if (!card || !Array.isArray(card.color) || !card.color.length) continue;
      const share = entry.count / card.color.length;
      for (const c of card.color) { totals[c] = (totals[c] || 0) + share; knownTotal += share; }
    }
    if (!knownTotal) { el.innerHTML = ''; return; }
    el.innerHTML = `
      <div class="flex rounded overflow-hidden h-3 mt-1">
        ${Object.entries(totals).map(([c, v]) => {
          const pct = (v / knownTotal * 100).toFixed(1);
          return `<div class="color-${c}" style="width:${pct}%" title="${c}: ${Math.round(v)} (${pct}%)"></div>`;
        }).join('')}
      </div>
      <div class="text-xs text-slate-500 mt-1">${Object.entries(totals).map(([c, v]) => `${c}: ${Math.round(v)}`).join(' · ')}</div>
    `;
  }

  function renderDeckEntries(deck) {
    const entriesEl = rootEl.querySelector('#deck-entries');
    if (!deck.entries.length) {
      entriesEl.innerHTML = `<div class="text-slate-500 text-sm">Noch keine Karten. Füge welche über den Picker rechts hinzu.</div>`;
      return;
    }
    // Indizes einmal pro Render bauen und an alle Tiles durchreichen (statt
    // O(Copies)-Scans pro Eintrag). da = Slots dieses Decks, vIdx = Frei-Pool.
    const ctx = {
      vIdx: Store.getVariantIndex(collectionCache),
      da: Store.getDeckAssignedIndex(collectionCache)[deck.id] || {}
    };
    // Filter „Nur fehlende": Einträge mit fehlenden ECHTEN Kopien (Proxies zählen
    // als fehlend). Nur für echte Decks — Wants/Trade sind reine Listen.
    let visibleEntries = deck.entries;
    if (state.deckMissingOnly && !isListKind(deck.kind)) {
      visibleEntries = visibleEntries.filter(e => {
        const sa = ctx.da[e.variant];
        return e.count - (sa ? sa.real : 0) > 0;
      });
      if (!visibleEntries.length) {
        entriesEl.innerHTML = `<div class="text-slate-500 text-sm">Keine fehlenden Karten — alle Slots sind mit echten Kopien gefüllt.</div>`;
        return;
      }
    }
    const groups = groupEntries(visibleEntries, state.deckGroupBy);
    const useText = state.deckView === 'text';
    entriesEl.innerHTML = groups.map(g => {
      const head = g.label
        ? `<div class="text-xs uppercase text-slate-500 font-bold mb-2">${escapeHtml(g.label)} <span class="opacity-60">(${g.entries.reduce((s,e)=>s+e.count,0)})</span></div>`
        : '';
      if (useText) {
        return `<div>${head}<table class="wants-table w-full"><tbody>${g.entries.map(entry => renderEntryRow(entry, ctx)).join('')}</tbody></table></div>`;
      }
      return `<div>${head}<div class="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-4 gap-3">${g.entries.map(entry => renderEntryTile(entry, ctx)).join('')}</div></div>`;
    }).join('');

    // Text-Ansicht: Hover-Preview ueber Portal (Element ausserhalb des Scroll-
    // Containers), damit das Bild nicht von overflow-y-auto abgeschnitten wird.
    if (useText) wireHoverPreview(entriesEl);

    entriesEl.querySelectorAll('[data-demand-inc]').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); modifyDemand(btn.dataset.demandInc, 1); });
    });
    entriesEl.querySelectorAll('[data-demand-dec]').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); modifyDemand(btn.dataset.demandDec, -1); });
    });
    entriesEl.querySelectorAll('[data-slot-inc]').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); modifySlot(btn.dataset.slotInc, 1); });
    });
    entriesEl.querySelectorAll('[data-slot-dec]').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); modifySlot(btn.dataset.slotDec, -1); });
    });
    entriesEl.querySelectorAll('.entry-row, .entry-tile').forEach(row => {
      row.addEventListener('click', e => {
        if (e.target.closest('[data-demand-inc], [data-demand-dec], [data-slot-inc], [data-slot-dec], [data-note-trigger]')) return;
        window.Util.bus.emit('open-card-modal', { cardId: row.dataset.entryCardId, variantKey: row.dataset.variantKey });
      });
    });
    entriesEl.querySelectorAll('[data-note-trigger]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const row = btn.closest('.entry-row, .entry-tile');
        if (!row) return;
        const cardId = row.dataset.entryCardId;
        const card = CardDB.byId.get(cardId);
        Notes.openDialog({
          title: card ? CardDB.cleanDisplayName(card) : cardId,
          subtitle: cardId,
          value: Store.getCardNote(collectionCache, cardId),
          onSave: txt => {
            Store.setCardNote(collectionCache, cardId, txt);
            Store.saveCollection(collectionCache);
            renderDeckDetail();
          }
        });
      });
    });
  }

  function renderEntryTile(entry, ctx) {
    const deck = currentDeck();
    const isWants = deck && isListKind(deck.kind);
    const card = CardDB.byId.get(entry.cardId);
    const name = card ? CardDB.cleanDisplayName(card) : entry.cardId;
    const cmText = (window.CM && CM.hasData()) ? CM.fmtCheapest(entry.cardId, entry.variant) : null;
    const note = Store.getCardNote(collectionCache, entry.cardId);

    if (isWants) {
      // Wants-Liste = explizite Liste fehlender Karten. Kein Besitzt-/Fehlt-Vergleich.
      return `<div class="card-tile entry-tile cursor-pointer"
          data-entry-card-id="${escapeAttr(entry.cardId)}" data-card-id="${escapeAttr(entry.cardId)}" data-variant-key="${escapeAttr(entry.variant)}">
        <img loading="lazy" src="${CardDB.imagePath(entry.variant)}" alt="${escapeAttr(name)}" />
        <span class="tile-note">${Notes.iconHtml(!!note)}</span>
        <div class="px-2 pt-1 text-[11px] font-mono leading-tight">
          <span class="text-amber-400" title="Cardmarket low / trend">${cmText ? cmText : 'CM'}</span>
        </div>
        <div class="p-2 pt-1">
          <div class="text-xs font-mono text-slate-400 truncate">${escapeHtml(entry.variant)}${card && card.rarity ? ` <span class="text-slate-300">${escapeHtml(CardDB.rarityShort(card.rarity))}</span>` : ''}</div>
          <div class="text-sm font-semibold truncate" title="${escapeAttr(name)}">${escapeHtml(name)}</div>
        </div>
        <div class="qty-controls">
          <button data-demand-dec="${entry.cardId}|${entry.variant}">−</button>
          <span class="entry-count" title="Gewünschte Anzahl">${entry.count}</span>
          <button data-demand-inc="${entry.cardId}|${entry.variant}">+</button>
        </div>
      </div>`;
    }

    // Slot-Sicht: was diesem konkreten Deck zugewiesen ist (aus vorgebautem Index)
    const sa = ctx.da[entry.variant];
    const assignedReal = sa ? sa.real : 0;
    const assignedProxy = sa ? sa.proxy : 0;
    const assignedTotal = assignedReal + assignedProxy;
    const slotMissing = Math.max(0, entry.count - assignedTotal);
    const realSlotMissing = Math.max(0, entry.count - assignedReal);
    const complete = slotMissing === 0;
    // Globaler Frei-Pool zur Info (aus vorgebautem Variant-Index)
    const vs = ctx.vIdx[entry.variant];
    const freeReal = vs ? vs.freeReal : 0;
    const freeProxy = vs ? vs.freeProxy : 0;
    // Proxies zaehlen NICHT als "verfuegbar"-Anzeige (Besitz), sind aber
    // slottbar (Platzhalter fuer Decks → +Slot bleibt klickbar wenn freeProxy>0).
    const av = otherVariantsAv(card, entry.variant, ctx.vIdx);

    let ownedClass = 'text-slate-500';
    let needText = '';
    let needTitle = '';
    if (complete) {
      ownedClass = 'text-emerald-400';
      needText = '✓';
    } else if (freeReal > 0) {
      ownedClass = 'text-sky-400';
      needText = av.freeOther > 0
        ? `${freeReal} verfügbar <span class="text-amber-300">A.v: ${av.freeOther}/${av.totalOther}</span>`
        : `${freeReal} verfügbar`;
      needTitle = av.freeOther > 0
        ? `${freeReal} exakt frei · ${av.freeOther} frei / ${av.totalOther} besessen in anderen Varianten: ${av.breakdown.join(', ')}`
        : `${freeReal} exakt frei`;
    } else if (av.freeOther > 0) {
      ownedClass = 'text-amber-300';
      needText = `A.v: ${av.freeOther}/${av.totalOther}`;
      needTitle = `${av.freeOther} frei / ${av.totalOther} besessen in anderen Varianten: ${av.breakdown.join(', ')}`;
    }

    const badgeCls = (assignedReal === 0 && assignedProxy === 0)
      ? 'zero'
      : (complete ? 'full' : '');
    const slottable = !complete && (freeReal + freeProxy) > 0;
    return `<div class="card-tile entry-tile cursor-pointer ${complete ? 'playset' : ''} ${assignedTotal === 0 ? 'missing' : ''} ${slottable ? 'tile-slottable' : ''} ${assignedProxy > 0 ? 'tile-proxy-slotted' : ''}"
        data-entry-card-id="${escapeAttr(entry.cardId)}" data-card-id="${escapeAttr(entry.cardId)}" data-variant-key="${escapeAttr(entry.variant)}">
      <img loading="lazy" src="${CardDB.imagePath(entry.variant)}" alt="${escapeAttr(name)}" />
      <span class="tile-note">${Notes.iconHtml(!!note)}</span>
      <div class="px-2 pt-1 text-[11px] font-mono leading-tight flex justify-between gap-2">
        <span class="text-amber-400 truncate" title="Cardmarket low / trend">${cmText ? cmText : 'CM'}</span>
        <span class="${ownedClass}"${needTitle ? ` title="${escapeAttr(needTitle)}"` : ''}>${needText}</span>
      </div>
      <div class="p-2 pt-1 flex items-center gap-2">
        <div class="min-w-0 flex-1">
          <div class="text-xs font-mono text-slate-400 truncate">${escapeHtml(entry.variant)}${card && card.rarity ? ` <span class="text-slate-300">${escapeHtml(CardDB.rarityShort(card.rarity))}</span>` : ''}</div>
          <div class="text-sm font-semibold truncate" title="${escapeAttr(name)}">${escapeHtml(name)}</div>
        </div>
        <div class="flex items-center gap-1 shrink-0">
          ${assignedProxy > 0 ? `<div class="proxy-badge" title="${assignedProxy} Proxy-Slot${assignedProxy > 1 ? 's' : ''}">+${assignedProxy}P</div>` : ''}
          <div class="count-badge ${badgeCls}" title="Real zugewiesen / Benötigt im Deck"><b>${assignedReal}</b><span class="opacity-60"> / ${entry.count}</span></div>
        </div>
      </div>
      <div class="qty-controls" title="Soll: wie viele dieser Karte das Deck haben will">
        <button data-demand-dec="${entry.cardId}|${entry.variant}">−</button>
        <span class="entry-count">Soll ${entry.count}</span>
        <button data-demand-inc="${entry.cardId}|${entry.variant}">+</button>
      </div>
      <div class="slot-controls" title="Slot: aus Frei-Pool zuweisen / freigeben">
        <button data-slot-dec="${entry.cardId}|${entry.variant}" ${assignedTotal === 0 ? 'disabled' : ''}>− Slot</button>
        <span class="slot-count">${assignedReal}${assignedProxy > 0 ? '+' + assignedProxy + 'P' : ''} zugewiesen</span>
        <button data-slot-inc="${entry.cardId}|${entry.variant}" ${(freeReal + freeProxy) === 0 || assignedTotal >= entry.count ? 'disabled' : ''}>+ Slot</button>
      </div>
    </div>`;
  }

  // Sammelt fuer eine Karte die Aggregate ueber alle ANDEREN Varianten (nicht
  // selfVariantKey): wieviele sind frei und wieviele insgesamt besessen.
  // Liefert auch eine Breakdown-Liste fuer Tooltips.
  function otherVariantsAv(card, selfVariantKey, vIdx) {
    const out = { freeOther: 0, totalOther: 0, breakdown: [] };
    if (!card || !vIdx) return out;
    for (const v of CardDB.variantsOf(card)) {
      if (v.key === selfVariantKey) continue;
      const ov = vIdx[v.key];
      if (!ov) continue;
      // Nur echte Kopien zaehlen — Proxies sind kein Besitz.
      const free = ov.freeReal;
      const own = ov.real;
      if (own > 0) {
        out.totalOther += own;
        out.freeOther += free;
        out.breakdown.push(`${own}× ${v.key}${free > 0 ? ` (${free} frei)` : ''}`);
      }
    }
    return out;
  }

  // Singleton-Image am <body>, das beim Hover ueber eine Deck-Text-Zeile mit
  // dem passenden Karten-Bild und Position eingeblendet wird. So ueberlebt es
  // overflow-y-auto-Container.
  function getHoverPreview() {
    let el = document.getElementById('deck-hover-preview');
    if (!el) {
      el = document.createElement('img');
      el.id = 'deck-hover-preview';
      el.style.cssText = 'position:fixed;display:none;z-index:9999;width:220px;aspect-ratio:5/7;object-fit:cover;border-radius:8px;box-shadow:0 8px 24px rgba(0,0,0,0.6);pointer-events:none;background:#0f172a;';
      document.body.appendChild(el);
    }
    return el;
  }

  // Ein einziger delegierter Listener auf dem Scope-Container — egal wie viele
  // .wants-row-Elemente drin sind. Pro Render-Pass werden 2 statt N Listener
  // angehaengt.
  function wireHoverPreview(scopeEl) {
    const preview = getHoverPreview();
    scopeEl.addEventListener('mouseover', e => {
      const row = e.target.closest('.wants-row[data-variant-key]');
      if (!row || !scopeEl.contains(row)) return;
      // Nur reagieren, wenn die Maus tatsaechlich neu in die Zeile rein kommt
      // (relatedTarget liegt ausserhalb der Zeile).
      if (row.contains(e.relatedTarget)) return;
      const variant = row.dataset.variantKey;
      if (!variant) return;
      preview.src = CardDB.imagePath(variant);
      const r = row.getBoundingClientRect();
      const w = 220, h = Math.round(w * 7 / 5);
      let left = r.right + 12;
      if (left + w > window.innerWidth - 8) left = Math.max(8, r.left - w - 12);
      let top = r.top + r.height / 2 - h / 2;
      if (top < 8) top = 8;
      if (top + h > window.innerHeight - 8) top = window.innerHeight - h - 8;
      preview.style.left = `${left}px`;
      preview.style.top = `${top}px`;
      preview.style.display = 'block';
    });
    scopeEl.addEventListener('mouseout', e => {
      const row = e.target.closest('.wants-row[data-variant-key]');
      if (!row) return;
      if (row.contains(e.relatedTarget)) return;
      preview.style.display = 'none';
    });
  }

  // Kompakte Tabellen-Zeile fuer Deck-Eintraege (Text-Ansicht). Feature-Paritaet
  // zum Tile: Slot-Buttons, Highlighting (complete/slottable/proxy-slotted),
  // Cross-Variant-Hinweis (andere Varianten derselben Card-ID frei verfuegbar).
  // Wants-/Trade-Listen sind reine Wunsch-/Tauschlisten — keine Slot-Spalten.
  function renderEntryRow(entry, ctx) {
    const deck = currentDeck();
    const isWants = deck && isListKind(deck.kind);
    const card = CardDB.byId.get(entry.cardId);
    const name = card ? CardDB.cleanDisplayName(card) : entry.cardId;
    const cmText = (window.CM && CM.hasData()) ? CM.fmtCheapest(entry.cardId, entry.variant) : null;
    const note = Store.getCardNote(collectionCache, entry.cardId);
    const rarity = card && card.rarity ? CardDB.rarityShort(card.rarity) : '';

    const sa = ctx.da[entry.variant];
    const assignedReal = sa ? sa.real : 0;
    const assignedProxy = sa ? sa.proxy : 0;
    const assignedTotal = assignedReal + assignedProxy;
    const slotMissing = Math.max(0, entry.count - assignedTotal);
    const complete = !isWants && slotMissing === 0;
    const vs = ctx.vIdx[entry.variant];
    const freeReal = vs ? vs.freeReal : 0;
    const freeProxy = vs ? vs.freeProxy : 0;
    // Verfuegbar-Anzeige zaehlt nur echte Kopien; Slotten geht auch mit Proxies.
    const slottable = !isWants && !complete && (freeReal + freeProxy) > 0;
    const proxySlotted = !isWants && assignedProxy > 0;

    // Cross-Variant: Aggregat ueber andere Varianten der selben Card-ID.
    const av = !isWants
      ? otherVariantsAv(card, entry.variant, ctx.vIdx)
      : { freeOther: 0, totalOther: 0, breakdown: [] };

    // Soll-Counter
    const qty = `<span class="inline-flex items-center gap-1">
      <button data-demand-dec="${entry.cardId}|${entry.variant}" class="wants-qty-btn" title="Soll −">−</button>
      <span class="font-bold text-amber-400 w-6 text-center tabular-nums">${entry.count}</span>
      <button data-demand-inc="${entry.cardId}|${entry.variant}" class="wants-qty-btn" title="Soll +">+</button>
    </span>`;

    // Slot-Spalte (Buttons + Anzeige).
    let slotCell = '';
    if (!isWants) {
      const cls = complete ? 'text-emerald-400' : (assignedTotal === 0 ? 'text-slate-500' : 'text-amber-400');
      const proxy = assignedProxy > 0 ? ` <span class="text-purple-400">+${assignedProxy}P</span>` : '';
      const decDisabled = assignedTotal === 0 ? 'disabled' : '';
      const incDisabled = ((freeReal + freeProxy) === 0 || assignedTotal >= entry.count) ? 'disabled' : '';
      slotCell = `<td class="py-1 pr-3 whitespace-nowrap">
          <span class="inline-flex items-center gap-1">
            <button data-slot-dec="${entry.cardId}|${entry.variant}" class="wants-qty-btn" title="− Slot" ${decDisabled}>−</button>
            <span class="text-xs tabular-nums"><span class="${cls}"><b>${assignedReal}</b>/${entry.count}</span>${proxy}</span>
            <button data-slot-inc="${entry.cardId}|${entry.variant}" class="wants-qty-btn" title="+ Slot" ${incDisabled}>+</button>
          </span>
        </td>`;
    }

    // Status-Spalte (Verfuegbarkeit / Cross-Variant).
    let statusCell = '';
    if (!isWants) {
      let inner = '<span class="text-slate-500">—</span>';
      let titleAttr = '';
      if (complete) {
        inner = '<span class="text-emerald-400">✓</span>';
      } else if (freeReal > 0) {
        const cross = av.freeOther > 0 ? ` <span class="text-amber-300">A.v: ${av.freeOther}/${av.totalOther}</span>` : '';
        inner = `<span class="text-sky-400">${freeReal} verfügbar</span>${cross}`;
        titleAttr = av.freeOther > 0
          ? `title="${escapeAttr(freeReal + ' exakt frei · ' + av.freeOther + ' frei / ' + av.totalOther + ' besessen in anderen Varianten: ' + av.breakdown.join(', '))}"`
          : `title="${escapeAttr(freeReal + ' exakt frei')}"`;
      } else if (av.freeOther > 0) {
        inner = `<span class="text-amber-300">A.v: ${av.freeOther}/${av.totalOther}</span>`;
        titleAttr = `title="${escapeAttr(av.freeOther + ' frei / ' + av.totalOther + ' besessen in anderen Varianten: ' + av.breakdown.join(', '))}"`;
      }
      statusCell = `<td class="py-1 pr-3 text-xs whitespace-nowrap" ${titleAttr}>${inner}</td>`;
    }

    // Row-Highlighting analog zum Tile.
    const rowHighlight = isWants
      ? ''
      : complete && proxySlotted ? ' bg-purple-900/15'
      : complete                  ? ' bg-emerald-900/20'
      : proxySlotted              ? ' bg-purple-900/15'
      : slottable                 ? ' bg-yellow-900/15'
      : assignedTotal === 0       ? ' opacity-60'
      : '';

    return `<tr class="wants-row entry-row group cursor-pointer hover:bg-slate-700/60${rowHighlight}" data-entry-card-id="${escapeAttr(entry.cardId)}" data-card-id="${escapeAttr(entry.cardId)}" data-variant-key="${escapeAttr(entry.variant)}">
        <td class="py-1 pr-3 whitespace-nowrap">${qty}</td>
        ${slotCell}
        ${statusCell}
        <td class="py-1 pr-3">
          <span class="block truncate max-w-[14rem] sm:max-w-[22rem]" title="${escapeAttr(name)}">${escapeHtml(name)}</span>
        </td>
        <td class="py-1 pr-3 font-mono text-slate-400 text-xs whitespace-nowrap">${escapeHtml(entry.variant)}</td>
        <td class="py-1 pr-3 text-slate-500 text-xs whitespace-nowrap">${escapeHtml(rarity)}</td>
        <td class="py-1 pr-3 text-slate-400 text-xs tabular-nums text-right whitespace-nowrap" title="Cardmarket low / trend">${cmText || 'CM'}</td>
        <td class="py-1 text-right whitespace-nowrap">${Notes.iconHtml(!!note)}</td>
      </tr>`;
  }

  function totalOwned(cardId) {
    const card = CardDB.byId.get(cardId);
    if (!card) return 0;
    let total = 0;
    for (const v of CardDB.variantsOf(card)) total += Store.getOwnedTotal(collectionCache, v.key);
    return total;
  }

  function groupEntries(entries, by) {
    if (by === 'none') return [{ label: '', entries: sortEntries(entries) }];
    const buckets = new Map();
    for (const e of entries) {
      const card = CardDB.byId.get(e.cardId);
      let key = '–';
      if (card) {
        if (by === 'level')      key = card.level != null ? 'Lv ' + card.level : 'Lv –';
        else if (by === 'cost')  key = card.cost  != null ? 'Cost ' + card.cost : 'Cost –';
        else if (by === 'type')  key = card.type || '–';
      }
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(e);
    }
    const groups = Array.from(buckets.entries()).map(([label, es]) => ({ label, entries: sortEntries(es) }));
    groups.sort((a, b) => groupSortKey(a.label, by) - groupSortKey(b.label, by));
    return groups;
  }

  function groupSortKey(label, by) {
    if (by === 'type') return label === '–' ? 999 : label.charCodeAt(0);
    const m = label.match(/-?\d+/);
    return m ? Number(m[0]) : 999;
  }

  function sortEntries(entries) {
    const mode = state.deckSortBy || 'id';
    const cmLow = (cardId, variant) => {
      if (!window.CM || !CM.hasData()) return null;
      return CM.lowForEntry(cardId, variant);
    };
    const byName = (a, b) => {
      const ca = CardDB.byId.get(a.cardId);
      const cb = CardDB.byId.get(b.cardId);
      const an = ca ? ca.name : a.cardId;
      const bn = cb ? cb.name : b.cardId;
      if (an < bn) return -1;
      if (an > bn) return 1;
      return a.variant.localeCompare(b.variant);
    };
    const byId = (a, b) => {
      if (a.cardId < b.cardId) return -1;
      if (a.cardId > b.cardId) return 1;
      return a.variant.localeCompare(b.variant);
    };
    if (mode === 'price-asc' || mode === 'price-desc') {
      const dir = mode === 'price-asc' ? 1 : -1;
      // Pre-compute lowForEntry pro Entry — sonst O(n log n) teure CM-Lookups
      // im Comparator (Regex + bySet-Iteration).
      const work = entries.map(e => ({ e, v: cmLow(e.cardId, e.variant) }));
      work.sort((a, b) => {
        if (a.v == null && b.v == null) return byId(a.e, b.e);
        if (a.v == null) return 1;
        if (b.v == null) return -1;
        if (a.v !== b.v) return (a.v - b.v) * dir;
        return byId(a.e, b.e);
      });
      return work.map(w => w.e);
    }
    if (mode === 'status') {
      const deck = currentDeck();
      const idx = Store.getVariantIndex(collectionCache);
      const da = deck ? (Store.getDeckAssignedIndex(collectionCache)[deck.id] || {}) : {};
      // 0 = slottbar (fehlt + frei verfügbar), 1 = fehlt aber nicht verfügbar, 2 = fertig
      const rankOf = e => {
        if (!deck) return 2;
        const sa = da[e.variant];
        const assigned = sa ? sa.real + sa.proxy : 0;
        if (assigned >= e.count) return 2;
        const s = idx[e.variant];
        const free = s ? (s.freeReal + s.freeProxy) : 0;
        return free > 0 ? 0 : 1;
      };
      // Rang einmal pro Eintrag berechnen (nicht im Comparator → O(Copies + n log n)).
      const ranked = entries.map(e => ({ e, r: rankOf(e) }));
      ranked.sort((a, b) => (a.r !== b.r ? a.r - b.r : byId(a.e, b.e)));
      return ranked.map(x => x.e);
    }
    if (mode === 'name') return entries.slice().sort(byName);
    return entries.slice().sort(byId);
  }

  function modifyDemand(key, delta) {
    const deck = currentDeck();
    if (!deck) return;
    const [cardId, variant] = key.split('|');
    Store.addToDeck(deck, cardId, variant, delta);
    // Wenn Soll unter den Zugewiesenen-Stand fällt, überzählige Slots freigeben.
    if (delta < 0 && !isListKind(deck.kind)) {
      const entry = deck.entries.find(e => e.cardId === cardId && e.variant === variant);
      const assigned = Store.assignedTo(collectionCache, deck.id, variant);
      const newCount = entry ? entry.count : 0;
      if (assigned > newCount) {
        Store.releaseN(collectionCache, deck.id, variant, assigned - newCount);
      }
    }
    Store.saveDecks(state.decksState);
    Store.saveCollection(collectionCache);
    renderDeckDetail();
    renderDeckList();
  }

  function modifySlot(key, delta) {
    const deck = currentDeck();
    if (!deck || isListKind(deck.kind)) return;
    const [cardId, variant] = key.split('|');
    if (delta > 0) {
      // Slot+ nur erlaubt wenn Bedarf noch nicht voll
      const entry = deck.entries.find(e => e.cardId === cardId && e.variant === variant);
      if (!entry) return;
      const assigned = Store.assignedTo(collectionCache, deck.id, variant);
      if (assigned >= entry.count) return;
      Store.autoClaim(collectionCache, deck.id, variant, 1);
    } else {
      Store.releaseN(collectionCache, deck.id, variant, 1);
    }
    Store.saveCollection(collectionCache);
    renderDeckDetail();
    renderDeckList();
  }

  // Color-/Level-Pills (gespiegelt aus der Collection). Re-rendern sich selbst
  // beim Toggle und stossen renderPicker() an.
  function renderPickerColorPills() {
    const wrap = rootEl.querySelector('#picker-color-pills');
    if (!wrap) return;
    const ordered = CardDB.colors.slice().sort((a, b) => {
      const ai = PICKER_COLOR_ORDER.indexOf(a), bi = PICKER_COLOR_ORDER.indexOf(b);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
    wrap.innerHTML = ordered.map(c => {
      const active = state.pickerColors.includes(c);
      return `<button data-picker-color="${c}" class="color-pill px-2 py-1 rounded text-xs font-bold color-${c} ${active ? 'ring-2 ring-amber-400' : 'opacity-60 hover:opacity-100'}">${c}</button>`;
    }).join('');
    wrap.querySelectorAll('[data-picker-color]').forEach(btn => {
      btn.addEventListener('click', () => {
        const c = btn.dataset.pickerColor;
        if (state.pickerColors.includes(c)) state.pickerColors = state.pickerColors.filter(x => x !== c);
        else state.pickerColors = state.pickerColors.concat([c]);
        renderPickerColorPills(); renderPicker();
      });
    });
  }

  function renderPickerLevelPills() {
    const wrap = rootEl.querySelector('#picker-level-pills');
    if (!wrap) return;
    wrap.innerHTML = PICKER_LEVELS.map(lv => {
      const active = state.pickerLevels.includes(lv);
      return `<button data-picker-level="${lv}" class="px-2 py-1 rounded text-xs font-bold border ${active ? 'bg-amber-500 text-slate-900 border-amber-500' : 'bg-slate-800 border-slate-600 text-slate-300 hover:bg-slate-700'}">${lv}</button>`;
    }).join('');
    wrap.querySelectorAll('[data-picker-level]').forEach(btn => {
      btn.addEventListener('click', () => {
        const lv = Number(btn.dataset.pickerLevel);
        if (state.pickerLevels.includes(lv)) state.pickerLevels = state.pickerLevels.filter(x => x !== lv);
        else state.pickerLevels = state.pickerLevels.concat([lv]);
        renderPickerLevelPills(); renderPicker();
      });
    });
  }

  // Besitz-Filter sind gegenseitig exklusiv (wie in der Collection): genau einer
  // oder keiner. Setzt State + synchronisiert die Checkboxen, dann Re-Render.
  function setPickerOwnership(mode) {
    state.pickerMissingOnly   = mode === 'missing';
    state.pickerOwnedOnly     = mode === 'owned';
    state.pickerOwnedRealOnly = mode === 'owned-real';
    state.pickerProxyOnly     = mode === 'proxy';
    state.pickerAvailableOnly = mode === 'available';
    const map = { 'picker-missing': 'missing', 'picker-owned': 'owned', 'picker-owned-real': 'owned-real', 'picker-proxy': 'proxy', 'picker-available': 'available' };
    for (const id in map) {
      const cb = rootEl.querySelector('#' + id);
      if (cb) cb.checked = (mode === map[id]);
    }
    renderPicker();
  }

  // Reine Filter-/Sammel-Logik. Liefert die ersten 100 Entries plus Flags fuer
  // die beiden Empty-States. Kein DOM-Zugriff — laesst sich isoliert testen.
  // Spiegelt Filter + Sortierung der Collection-Ansicht.
  function buildPickerCandidates(vIdx) {
    const q = state.pickerQuery.trim();
    const ownershipMode = state.pickerMissingOnly ? 'missing'
      : state.pickerOwnedOnly ? 'owned'
      : state.pickerOwnedRealOnly ? 'owned-real'
      : state.pickerProxyOnly ? 'proxy'
      : state.pickerAvailableOnly ? 'available'
      : null;
    const hasFilter = !!(q || state.pickerColors.length || state.pickerType || state.pickerRarity
      || state.pickerLevels.length || state.pickerTraitOwn || state.pickerTraitInEffect
      || ownershipMode || state.pickerAltOnly);

    let results = CardDB.search(q, {
      colors: state.pickerColors,
      type: state.pickerType,
      levels: state.pickerLevels,
      traitOwn: state.pickerTraitOwn,
      traitInEffect: state.pickerTraitInEffect,
      sortBy: state.pickerSortBy,
      sortDir: state.pickerSortDir
    });

    // Variant-Index-Helfer (analog Collection).
    const vOwned = k => { const s = vIdx[k]; return s ? (s.real + s.proxy) : 0; };
    const vReal  = k => { const s = vIdx[k]; return s ? s.real : 0; };
    const vProxy = k => { const s = vIdx[k]; return s ? s.proxy : 0; };
    const vFree  = k => { const s = vIdx[k]; return s ? s.freeReal : 0; };
    const anyVariant = (card, fn) => CardDB.variantsOf(card).some(v => fn(v.key));

    // Alt-Varianten als eigene Eintraege erzeugen, wenn showAlts, eine Card-ID in
    // der Suche, "Nur Alt-Arts" oder Rarity=Alt aktiv ist — sonst gaebe es keine
    // Alt-Eintraege, gegen die diese Filter greifen koennten.
    const queryHasCardId = /\b[A-Za-z]+\d*-\d+[A-Za-z]?\b/.test(state.pickerQuery || '');
    const expandAlts = state.pickerShowAlts || queryHasCardId || state.pickerAltOnly || state.pickerRarity === ALT_RARITY;
    let entries;
    if (expandAlts) {
      entries = [];
      for (const card of results) {
        CardDB.variantsOf(card).forEach((v, idx) => {
          entries.push({ card, variant: v.key, isAlt: v.isAlt, altIdx: idx });
        });
      }
    } else {
      entries = results.map(card => ({ card, variant: CardDB.mainVariantKey(card), isAlt: false, altIdx: 0 }));
    }

    // Rarity (entry-basiert: Alt-Arts zaehlen als "Alternative Art").
    if (state.pickerRarity) {
      entries = entries.filter(e => (e.isAlt ? ALT_RARITY : (e.card.rarity || '')) === state.pickerRarity);
    }
    // Nur Alt-Arts.
    if (state.pickerAltOnly) {
      entries = entries.filter(e => e.isAlt);
    }
    // Besitz-Filter. Bei showAlts pro Variante, sonst aggregiert ueber alle
    // Varianten der Karte (analog Collection).
    if (ownershipMode) {
      const perVariant = state.pickerShowAlts;
      entries = entries.filter(e => {
        switch (ownershipMode) {
          case 'missing':    return perVariant ? vOwned(e.variant) === 0 : !anyVariant(e.card, k => vOwned(k) > 0);
          case 'owned':      return perVariant ? vOwned(e.variant) > 0   : anyVariant(e.card, k => vOwned(k) > 0);
          case 'owned-real': return perVariant ? vReal(e.variant) > 0    : anyVariant(e.card, k => vReal(k) > 0);
          case 'proxy':      return perVariant ? vProxy(e.variant) > 0   : anyVariant(e.card, k => vProxy(k) > 0);
          case 'available':  return perVariant ? vFree(e.variant) > 0    : anyVariant(e.card, k => vFree(k) > 0);
          default: return true;
        }
      });
    }

    return { entries: entries.slice(0, 100), hasFilter };
  }

  // Einzelnes Picker-Tile. Reine Template-Funktion. inDeckCount = wie oft die
  // Variante schon in der aktiven Liste vorkommt (Demand, nicht Slot).
  function renderPickerTile(entry, vIdx, inDeckCount) {
    const { card, variant, isAlt, altIdx } = entry;
    const vsThis = vIdx[variant];
    const realThisVariant = vsThis ? vsThis.real : 0;
    const proxyThisVariant = vsThis ? vsThis.proxy : 0;
    let realShown, proxyShown;
    if (state.pickerShowAlts) {
      realShown = realThisVariant;
      proxyShown = proxyThisVariant;
    } else {
      let r = 0, p = 0;
      for (const v of CardDB.variantsOf(card)) {
        const vs = vIdx[v.key];
        if (vs) { r += vs.real; p += vs.proxy; }
      }
      realShown = r; proxyShown = p;
    }
    const ownedShown = realShown + proxyShown;
    let badge = '';
    if (state.pickerShowAlts) {
      badge = isAlt
        ? `<div class="absolute top-1 left-1 bg-amber-500 text-slate-900 text-[10px] font-bold rounded px-1.5 py-0.5">Alt ${altIdx}</div>`
        : `<div class="absolute top-1 left-1 bg-slate-700 text-slate-200 text-[10px] font-bold rounded px-1.5 py-0.5">Main</div>`;
    }
    const cName = CardDB.cleanDisplayName(card);
    const inDeck = inDeckCount || 0;
    return `<div data-pick-card-id="${escapeAttr(card.id)}" data-pick-variant="${escapeAttr(variant)}" data-card-id="${escapeAttr(card.id)}" data-variant-key="${escapeAttr(variant)}"
      class="card-tile cursor-pointer ${ownedShown === 0 ? 'missing' : ''} ${ownedShown >= 4 ? 'playset' : ''} ${inDeck > 0 ? 'tile-slottable' : ''} text-left flex flex-col">
      <img loading="lazy" src="${CardDB.imagePath(variant)}" alt="${escapeAttr(cName)}" />
      ${badge}
      <div class="p-2 flex items-center gap-2">
        <div class="min-w-0 flex-1">
          <div class="text-xs font-mono text-slate-400 truncate">${escapeHtml(card.id)}${card.rarity ? ` <span class="text-slate-300">${escapeHtml(CardDB.rarityShort(card.rarity))}</span>` : ''}</div>
          <div class="text-sm font-semibold truncate" title="${escapeAttr(cName)}">${escapeHtml(cName)}</div>
        </div>
        <div class="flex items-center gap-1 shrink-0">
          ${proxyShown > 0 ? `<div class="proxy-badge" title="${proxyShown} Proxy">+${proxyShown}P</div>` : ''}
          <div class="count-badge ${realShown === 0 && proxyShown === 0 ? 'zero' : (ownedShown >= 4 ? 'full' : '')}" title="Echte Kopien im Besitz">${realShown}</div>
        </div>
      </div>
      <div class="qty-controls mt-auto" title="Im Deck: Soll-Anzahl ${inDeck}">
        <button data-pick-dec="${card.id}|${variant}" ${inDeck === 0 ? 'disabled' : ''}>−</button>
        <span class="entry-count">${inDeck} im Deck</span>
        <button data-pick-inc="${card.id}|${variant}">+</button>
      </div>
    </div>`;
  }

  function wirePicker(scopeEl, deck) {
    scopeEl.querySelectorAll('[data-pick-inc]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const [cardId, variant] = btn.dataset.pickInc.split('|');
        modifyPickerEntry(cardId, variant, 1);
      });
    });
    scopeEl.querySelectorAll('[data-pick-dec]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const [cardId, variant] = btn.dataset.pickDec.split('|');
        modifyPickerEntry(cardId, variant, -1);
      });
    });
    scopeEl.querySelectorAll('[data-pick-card-id]').forEach(el => {
      el.addEventListener('click', e => {
        if (e.target.closest('[data-pick-inc], [data-pick-dec]')) return;
        window.Util.bus.emit('open-card-modal', { cardId: el.dataset.pickCardId, variantKey: el.dataset.pickVariant });
      });
    });
  }

  function modifyPickerEntry(cardId, variant, delta) {
    const deck = currentDeck();
    if (!deck) return;
    Store.addToDeck(deck, cardId, variant, delta);
    if (!isListKind(deck.kind)) {
      if (delta > 0) {
        Store.autoClaim(collectionCache, deck.id, variant, delta);
      } else if (delta < 0) {
        const entry = deck.entries.find(e => e.cardId === cardId && e.variant === variant);
        const assigned = Store.assignedTo(collectionCache, deck.id, variant);
        const newCount = entry ? entry.count : 0;
        if (assigned > newCount) {
          Store.releaseN(collectionCache, deck.id, variant, assigned - newCount);
        }
      }
    }
    Store.saveDecks(state.decksState);
    Store.saveCollection(collectionCache);
    // decks-changed-Event triggert die zentrale onExternalChange (rendert Picker
    // + Deck-Detail + Sidebar gebuendelt).
  }

  function renderPicker() {
    const el = rootEl.querySelector('#picker-results');
    if (!el) return;
    const deck = currentDeck();
    if (!deck) {
      el.innerHTML = `<div class="text-slate-500 text-sm">Erst Liste wählen.</div>`;
      return;
    }
    const vIdx = Store.getVariantIndex(collectionCache);
    const { entries, hasFilter } = buildPickerCandidates(vIdx);
    if (!hasFilter) {
      el.innerHTML = `<div class="text-slate-500 text-sm">Suche oder filtere, um Karten hinzuzufügen.</div>`;
      return;
    }
    if (!entries.length) {
      el.innerHTML = `<div class="text-slate-500 text-sm col-span-full">Keine Treffer.</div>`;
      return;
    }
    // Map<variantKey, count> der Eintraege in der aktiven Liste.
    const deckCounts = new Map();
    for (const e of deck.entries) deckCounts.set(e.variant, e.count);
    el.innerHTML = entries.map(e => renderPickerTile(e, vIdx, deckCounts.get(e.variant) || 0)).join('');
    wirePicker(el, deck);
  }

  function exportMissing(deck) {
    const isWants = isListKind(deck.kind);
    const da = Store.getDeckAssignedIndex(collectionCache)[deck.id] || {};
    const missingEntries = deck.entries
      .map(e => {
        const sa = da[e.variant];
        return {
          cardId: e.cardId,
          variant: e.variant,
          count: isWants ? e.count : Math.max(0, e.count - (sa ? sa.real : 0))
        };
      })
      .filter(e => e.count > 0);

    if (!missingEntries.length) {
      alert('In dieser Liste fehlen keine Karten.');
      return;
    }

    const lines = missingEntries.map(e => {
      const card = CardDB.byId.get(e.cardId);
      const cardName = card ? CardDB.cleanDisplayName(card) : e.cardId;
      const id = card ? card.id : e.cardId;
      const vSuffix = card ? versionSuffixForVariant(card, e.variant) : '';
      return `${e.count}x ${cardName} ${id}${vSuffix}`;
    });
    const text = lines.join('\n') + '\n';
    const total = missingEntries.reduce((s, e) => s + e.count, 0);

    const finish = ok => {
      const btn = rootEl.querySelector('#export-missing');
      if (!btn) return;
      const orig = btn.textContent;
      btn.textContent = ok ? `✓ ${total} fehlende kopiert` : 'Kopieren fehlgeschlagen';
      setTimeout(() => { btn.textContent = orig; }, 1800);
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => finish(true), () => fallbackCopy(text, finish));
    } else {
      fallbackCopy(text, finish);
    }
  }

  // Verfuegbare Export-Formate fuer die volle Liste. Das Label IST das Beispiel
  // inkl. Usecase in Klammern; build() erzeugt eine Zeile pro Entry.
  //   App:  "4 Name BT11-095 (V.1)"  — (V.N) nur bei Mehrfach-Varianten.
  //   DCGO: "4 Name BT11-095_P1"      — entry.variant ist die volle Variant-ID.
  const FULL_EXPORT_FORMATS = [
    {
      id: 'app',
      label: '4 Kartenname BT11-095 (V.1) (App)',
      build(e, card, cardName, id) {
        const vSuffix = card ? versionSuffixForVariant(card, e.variant) : '';
        return `${e.count} ${cardName} ${id}${vSuffix}`;
      }
    },
    {
      id: 'dcgo',
      label: '4 Kartenname BT11-095_P1 (DCGO)',
      build(e, card, cardName) {
        return `${e.count} ${cardName} ${e.variant}`;
      }
    }
  ];

  // Baut den Export-Text der vollen Liste im gewaehlten Format.
  function buildFullExportText(deck, fmt) {
    const lines = deck.entries.map(e => {
      const card = CardDB.byId.get(e.cardId);
      const cardName = card ? CardDB.cleanDisplayName(card) : e.cardId;
      const id = card ? card.id : e.cardId;
      return fmt.build(e, card, cardName, id);
    });
    return lines.join('\n') + '\n';
  }

  // Oeffnet ein Modal zur Format-Auswahl und kopiert die volle Liste.
  function exportFull(deck) {
    if (!deck.entries.length) { alert('Diese Liste ist leer.'); return; }
    const total = deck.entries.reduce((s, e) => s + e.count, 0);

    const contentHtml = `
      <div class="flex justify-between items-start mb-3">
        <div class="min-w-0">
          <h2 class="text-lg font-bold truncate">Exportieren: „${escapeHtml(deck.name)}"</h2>
          <div class="text-xs text-slate-400">${total} Karten — Format wählen und in die Zwischenablage kopieren.</div>
        </div>
        <button data-modal-close class="modal-close-x">×</button>
      </div>

      <label class="block mb-2">
        <span class="text-xs text-slate-400">Format</span>
        <select id="ef-format" class="bg-slate-900 border border-slate-600 rounded px-2 py-1 ml-2 text-sm font-mono">
          ${FULL_EXPORT_FORMATS.map((f, i) => `<option value="${f.id}" ${i === 0 ? 'selected' : ''}>${escapeHtml(f.label)}</option>`).join('')}
        </select>
      </label>

      <pre id="ef-preview" class="w-full bg-slate-900 border border-slate-600 rounded p-3 font-mono text-xs overflow-auto max-h-[40vh] whitespace-pre-wrap"></pre>

      <div class="flex justify-end gap-2 mt-3">
        <button data-modal-close class="btn-secondary">Abbrechen</button>
        <button id="ef-copy" class="btn-primary-emerald">Kopieren</button>
      </div>
    `;

    window.Util.openModal({
      host: 'export-full-root',
      id: 'export-full-modal',
      sizeClass: 'w-[640px] max-w-[95vw]',
      contentHtml,
      onMount: (content, close) => {
        content.querySelectorAll('[data-modal-close]').forEach(b => b.addEventListener('click', close));
        const sel = content.querySelector('#ef-format');
        const preview = content.querySelector('#ef-preview');
        const copyBtn = content.querySelector('#ef-copy');

        const currentFmt = () => FULL_EXPORT_FORMATS.find(f => f.id === sel.value) || FULL_EXPORT_FORMATS[0];
        const refresh = () => { preview.textContent = buildFullExportText(deck, currentFmt()); };
        sel.addEventListener('change', refresh);
        refresh();

        copyBtn.addEventListener('click', () => {
          const text = buildFullExportText(deck, currentFmt());
          const finish = ok => {
            const orig = copyBtn.textContent;
            copyBtn.textContent = ok ? `✓ ${total} kopiert` : 'Kopieren fehlgeschlagen';
            setTimeout(() => { copyBtn.textContent = orig; }, 1800);
          };
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(() => finish(true), () => fallbackCopy(text, finish));
          } else {
            fallbackCopy(text, finish);
          }
        });
      }
    });
  }

  // Sammelt die fehlenden Karten eines Decks (echter Slot-Bedarf in DIESEM Deck,
  // Proxies zaehlen als fehlend) und pumpt sie in eine bestehende oder neue
  // Wants-Liste. Alt-Arts bleiben dabei erhalten, weil wir die Entries direkt
  // mit ihren variantKeys uebernehmen — der Clipboard-Umweg waere durch die
  // (V.N)-Parsing-Luecke ungenau.
  //
  // Wichtig: missing = e.count - assignedReal(diesem Deck). Kopien im Frei-Pool
  // oder anderem Deck zaehlen als fehlend, weil sie diesem Deck nicht zugewiesen
  // sind. So bleibt der Export konsistent mit dem, was DIESES Deck zum Spielen
  // braucht — der User slottet vorher manuell, was er noch verteilen kann.
  function openMissingToWantsDialog(deck) {
    if (isListKind(deck.kind)) return;
    const da = Store.getDeckAssignedIndex(collectionCache)[deck.id] || {};
    const missingEntries = deck.entries
      .map(e => {
        const sa = da[e.variant];
        return { cardId: e.cardId, variant: e.variant, count: Math.max(0, e.count - (sa ? sa.real : 0)) };
      })
      .filter(e => e.count > 0);

    if (!missingEntries.length) {
      alert('In dieser Liste fehlen keine Karten.');
      return;
    }

    const wantsLists = state.decksState.decks.filter(d => d.kind === 'wants');
    const totalCopies = missingEntries.reduce((s, e) => s + e.count, 0);

    const contentHtml = `
      <div class="flex justify-between items-start mb-3">
        <h2 class="text-lg font-bold">Fehlende → Wants-Liste</h2>
        <button data-modal-close class="modal-close-x">×</button>
      </div>
      <div class="text-sm text-slate-400 mb-3">
        Aus „${escapeHtml(deck.name)}": <b>${missingEntries.length}</b> Karten · <b>${totalCopies}</b> Kopien fehlen.
        Mengen werden zu vorhandenen Wants-Eintraegen <b>addiert</b>.
      </div>
      <label class="block mb-3">
        <div class="text-xs text-slate-400 mb-1">Ziel</div>
        <select id="mtw-target" class="bg-slate-900 border border-slate-600 rounded px-2 py-2 w-full text-sm">
          <option value="__new__">— Neue Wants-Liste anlegen —</option>
          ${wantsLists.map(d => `<option value="${escapeAttr(d.id)}">${escapeHtml(d.name)}</option>`).join('')}
        </select>
      </label>
      <label class="block mb-3" id="mtw-name-wrap">
        <div class="text-xs text-slate-400 mb-1">Name der neuen Liste</div>
        <input id="mtw-name" type="text" value="${escapeAttr(deck.name + ' (Fehlend)')}"
          class="bg-slate-900 border border-slate-600 rounded px-3 py-2 w-full text-sm" />
      </label>
      <div class="flex justify-end gap-2">
        <button data-modal-close class="btn-secondary">Abbrechen</button>
        <button id="mtw-go" class="bg-purple-500 hover:bg-purple-400 text-white px-4 py-1.5 rounded text-sm font-semibold">Uebernehmen</button>
      </div>
    `;

    window.Util.openModal({
      host: 'missing-to-wants-root',
      id: 'mtw-modal',
      sizeClass: 'w-[480px] max-w-[95vw]',
      contentHtml,
      onMount: (content, close) => {
        content.querySelectorAll('[data-modal-close]').forEach(b => b.addEventListener('click', close));
        const targetSel = content.querySelector('#mtw-target');
        const nameWrap = content.querySelector('#mtw-name-wrap');
        const updateNameVisible = () => {
          nameWrap.style.display = targetSel.value === '__new__' ? '' : 'none';
        };
        targetSel.addEventListener('change', updateNameVisible);
        updateNameVisible();

        content.querySelector('#mtw-go').addEventListener('click', () => {
          const target = targetSel.value;
          let targetDeck;
          if (target === '__new__') {
            const name = content.querySelector('#mtw-name').value.trim();
            if (!name) { window.Util.toast('Name der neuen Liste fehlt.', 'warn'); return; }
            targetDeck = Store.createDeck(state.decksState, name, 'wants');
          } else {
            targetDeck = state.decksState.decks.find(d => d.id === target);
            if (!targetDeck) { window.Util.toast('Wants-Liste nicht gefunden.', 'error'); return; }
          }
          for (const e of missingEntries) {
            Store.addToDeck(targetDeck, e.cardId, e.variant, e.count);
          }
          Store.saveDecks(state.decksState);
          close();
          // Aktiv lassen wo wir sind — User sieht das Deck weiter. Sidebar wird neu
          // berechnet und reflektiert die neue Wants-Liste.
          renderDeckList();
          renderDeckDetail();
        });
      }
    });
  }

  function openImportIntoDeck(deck) {
    const formats = (window.IO_FORMATS || []);
    const defaultFmt = formats.find(f => f.id === 'dcgo-text') || formats.find(f => f.id === 'compact-text') || formats[0];

    const contentHtml = `
      <div class="flex justify-between items-start mb-3">
        <div class="min-w-0">
          <h2 class="text-lg font-bold truncate">Importieren in „${escapeHtml(deck.name)}"</h2>
          <div class="text-xs text-slate-400">Mengen werden zu vorhandenen Einträgen <b>addiert</b>.</div>
        </div>
        <button data-modal-close class="modal-close-x">×</button>
      </div>

      <label class="block mb-2">
        <span class="text-xs text-slate-400">Format</span>
        <select id="ii-format" class="bg-slate-900 border border-slate-600 rounded px-2 py-1 ml-2 text-sm">
          ${formats.map(f => `<option value="${f.id}" ${f.id === (defaultFmt && defaultFmt.id) ? 'selected' : ''}>${escapeHtml(f.label)}</option>`).join('')}
        </select>
      </label>

      <textarea id="ii-text" rows="14" placeholder="z.B. 4 Tsunomon ST21-01"
        class="w-full bg-slate-900 border border-slate-600 rounded p-3 font-mono text-xs"></textarea>

      <div id="ii-msg" class="text-sm mt-2 min-h-[1.25rem] text-slate-400"></div>

      <div class="flex justify-end gap-2 mt-3">
        <button data-modal-close class="btn-secondary">Abbrechen</button>
        <button id="ii-go" class="btn-primary-emerald">In Liste übernehmen</button>
      </div>
    `;

    window.Util.openModal({
      host: 'import-into-root',
      id: 'import-into-modal',
      sizeClass: 'w-[640px] max-w-[95vw]',
      contentHtml,
      onMount: (content, close) => {
        content.querySelectorAll('[data-modal-close]').forEach(b => b.addEventListener('click', close));
        content.querySelector('#ii-go').addEventListener('click', () => {
          const fmtId = content.querySelector('#ii-format').value;
          const fmt = formats.find(f => f.id === fmtId);
          const text = content.querySelector('#ii-text').value;
          const msgEl = content.querySelector('#ii-msg');
          if (!fmt) { msgEl.textContent = 'Format nicht gefunden.'; return; }
          if (!text.trim()) { msgEl.textContent = 'Textfeld ist leer.'; return; }

          let result;
          try { result = fmt.importDeck(text); }
          catch (e) { msgEl.textContent = 'Parse-Fehler: ' + e.message; return; }

          const validEntries = [];
          const unknownEntries = [];
          for (const e of result.entries || []) {
            const cardKnown = CardDB.byId.has(e.cardId);
            const variantKnown = CardDB.allVariants.has(e.variant);
            if (!cardKnown && !variantKnown) { unknownEntries.push(e); continue; }
            if (!variantKnown && cardKnown) {
              e.variant = CardDB.mainVariantKey(CardDB.byId.get(e.cardId));
            }
            validEntries.push(e);
          }
          const skippedFromFormat = (result.unknownIds || []).length;
          if (!validEntries.length) {
            msgEl.textContent = `Keine gültigen Einträge gefunden${skippedFromFormat ? ` (${skippedFromFormat} unbekannt)` : ''}.`;
            return;
          }
          const skipped = unknownEntries.length + skippedFromFormat;
          if (skipped > 0) {
            const samples = unknownEntries.slice(0, 5).map(e => e.cardId).concat((result.unknownIds || []).slice(0, 5));
            if (!confirm(`${skipped} unbekannte Einträge werden übersprungen, z.B.:\n${samples.join('\n')}\n\n${validEntries.length} Einträge in „${deck.name}" einfügen?`)) return;
          }

          for (const e of validEntries) {
            Store.addToDeck(deck, e.cardId, e.variant, Math.max(1, e.count || 1));
          }
          Store.saveDecks(state.decksState);
          close();
          renderDeckList();
          renderDeckDetail();
        });
      }
    });
  }

  function computeMainWants() {
    // Reiner Merge aller kind='wants'-Listen pro Variant. Kein Supply-Abgleich —
    // Wants sind bereits explizit gepflegte Fehlbestände. Tooltip zeigt
    // Quell-Listen mit ihren jeweiligen Counts.
    const merged = new Map(); // variant -> { cardId, variant, count, sources: [{listId, name, n}] }
    for (const d of state.decksState.decks) {
      if (d.kind !== 'wants') continue;
      for (const e of d.entries) {
        let slot = merged.get(e.variant);
        if (!slot) {
          slot = { cardId: e.cardId, variant: e.variant, count: 0, sources: [] };
          merged.set(e.variant, slot);
        }
        slot.count += e.count;
        slot.sources.push({ listId: d.id, name: d.name, n: e.count });
      }
    }
    const items = Array.from(merged.values());
    const mode = state.mainWantsSort || 'id';
    const cmLow = (cardId, variant) => {
      if (!window.CM || !CM.hasData()) return null;
      return CM.lowForEntry(cardId, variant);
    };
    if (mode === 'price-desc') {
      // Pre-compute lowForEntry: vermeidet O(n log n) teure CM-Lookups im Comparator.
      const work = items.map(it => ({ it, v: cmLow(it.cardId, it.variant) }));
      work.sort((a, b) => {
        if (a.v == null && b.v == null) return a.it.variant.localeCompare(b.it.variant);
        if (a.v == null) return 1;
        if (b.v == null) return -1;
        if (a.v !== b.v) return b.v - a.v;
        return a.it.variant.localeCompare(b.it.variant);
      });
      items.length = 0;
      for (const w of work) items.push(w.it);
    } else {
      items.sort((a, b) => a.variant.localeCompare(b.variant));
    }
    return {
      items,
      uniqueCount: items.length,
      totalCount: items.reduce((s, i) => s + i.count, 0)
    };
  }

  // Filtert MW-Items auf das aktive Set (state.mainWantsSetFilter). Bei null
  // unverändert. Reprint-aware: eine Karte erscheint unter dem Filter, wenn sie
  // dort als Origin ODER als Reprint erhältlich ist. setsPresent enthält daher
  // auch die Reprint-Sets der Wants-Karten.
  function filterMainWants(mw) {
    const setsPresent = new Set();
    for (const it of mw.items) {
      const card = CardDB.byId.get(it.cardId);
      if (!card) continue;
      if (card.set) setsPresent.add(card.set);
      for (const rc of CardDB.reprintSetsOf(card)) setsPresent.add(rc);
    }
    const filter = state.mainWantsSetFilter;
    if (!filter || !setsPresent.has(filter)) {
      // Falls der gespeicherte Filter durch Edits verschwindet, fallback auf alle.
      if (filter && !setsPresent.has(filter)) state.mainWantsSetFilter = null;
      const items = mw.items;
      return {
        items,
        uniqueCount: items.length,
        totalCount: items.reduce((s, i) => s + i.count, 0),
        setsPresent
      };
    }
    const items = mw.items.filter(it => {
      const card = CardDB.byId.get(it.cardId);
      return card && CardDB.appearsInSet(card, filter);
    });
    return {
      items,
      uniqueCount: items.length,
      totalCount: items.reduce((s, i) => s + i.count, 0),
      setsPresent
    };
  }

  function renderMainWantsDetail() {
    const el = rootEl.querySelector('#deck-detail');
    const prevScroll = (el.querySelector('#deck-entries') || {}).scrollTop || 0;
    const mwAll = computeMainWants();
    const mw = filterMainWants(mwAll);
    const setOptions = Array.from(mw.setsPresent).sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true })
    );
    el.innerHTML = `
      <div class="bg-slate-800 rounded p-3 mb-3 shrink-0">
        <div class="flex items-center gap-2 flex-wrap">
          <h2 class="text-xl font-bold flex-1">★ Main Wants</h2>
          <label class="text-xs text-slate-400 flex items-center gap-1">
            Set:
            <select id="mw-set-filter" class="bg-slate-900 border border-slate-600 rounded px-2 py-1 text-sm">
              <option value="">Alle Sets</option>
              ${setOptions.map(code => `<option value="${escapeAttr(code)}" ${state.mainWantsSetFilter === code ? 'selected' : ''}>${escapeHtml(code)}</option>`).join('')}
            </select>
          </label>
          <label class="text-xs text-slate-400 flex items-center gap-1">
            Sortieren:
            <select id="mw-sort" class="bg-slate-900 border border-slate-600 rounded px-2 py-1 text-sm">
              <option value="id"         ${state.mainWantsSort === 'id'         ? 'selected' : ''}>ID</option>
              <option value="price-desc" ${state.mainWantsSort === 'price-desc' ? 'selected' : ''}>Preis ↓</option>
            </select>
          </label>
          <button id="mw-copy" class="bg-emerald-500 hover:bg-emerald-400 text-slate-900 px-3 py-1.5 rounded text-sm font-semibold">In Clipboard kopieren</button>
        </div>
        <div class="text-xs text-slate-400 mt-1">
          Merge aller Wants-Listen${state.mainWantsSetFilter ? ` · Set <span class="font-mono text-amber-400">${escapeHtml(state.mainWantsSetFilter)}</span>` : ''}. ${mw.uniqueCount} Karten · ${mw.totalCount} Kopien${(() => {
            if (!window.CM || !CM.hasData()) return '';
            let lowSum = 0, trendSum = 0, noCm = 0;
            for (const it of mw.items) {
              const p = CM.pricesForEntry(it.cardId, it.variant);
              if (p.low != null || p.trend != null) {
                if (p.low != null) lowSum += p.low * it.count;
                if (p.trend != null) trendSum += p.trend * it.count;
              } else noCm += it.count;
            }
            return ` · <span class="text-amber-400" title="Cardmarket low / trend Summe">CM ≈ ${Fmt.eur(lowSum)} / ${Fmt.eur(trendSum)}</span>${noCm > 0 ? ` <span class="text-slate-500">(${noCm} ohne CM-Preis)</span>` : ''}`;
          })()}.
        </div>
      </div>
      <div id="deck-entries" class="space-y-4 max-h-[78vh] lg:max-h-none lg:flex-1 lg:min-h-0 overflow-y-auto pr-1"></div>
    `;
    rootEl.querySelector('#mw-set-filter').addEventListener('change', e => {
      state.mainWantsSetFilter = e.target.value || null;
      renderMainWantsDetail();
    });
    rootEl.querySelector('#mw-sort').addEventListener('change', e => {
      state.mainWantsSort = e.target.value;
      Prefs.set('mainWantsSort', state.mainWantsSort);
      renderMainWantsDetail();
    });
    rootEl.querySelector('#mw-copy').addEventListener('click', () => copyMainWantsToClipboard(mw));

    const entriesEl = rootEl.querySelector('#deck-entries');
    if (!mw.items.length) {
      entriesEl.innerHTML = `<div class="text-slate-500 text-sm">${state.mainWantsSetFilter ? `Keine Wants im Set ${escapeHtml(state.mainWantsSetFilter)}.` : 'Keine Wants-Listen mit Einträgen.'}</div>`;
      return;
    }
    entriesEl.innerHTML = `<div class="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
      ${mw.items.map(renderMainWantsTile).join('')}
    </div>`;
    if (prevScroll) entriesEl.scrollTop = prevScroll;

    entriesEl.querySelectorAll('[data-mw-dec]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const [cardId, variant] = btn.dataset.mwDec.split('|');
        removeFromMainWants(cardId, variant, 1);
      });
    });
    entriesEl.querySelectorAll('.entry-tile').forEach(row => {
      row.addEventListener('click', e => {
        if (e.target.closest('[data-note-trigger], [data-mw-dec]')) return;
        window.Util.bus.emit('open-card-modal', { cardId: row.dataset.entryCardId, variantKey: row.dataset.variantKey });
      });
    });
    entriesEl.querySelectorAll('[data-note-trigger]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const row = btn.closest('.entry-tile');
        const cardId = row.dataset.entryCardId;
        const card = CardDB.byId.get(cardId);
        Notes.openDialog({
          title: card ? CardDB.cleanDisplayName(card) : cardId,
          subtitle: cardId,
          value: Store.getCardNote(collectionCache, cardId),
          onSave: txt => {
            Store.setCardNote(collectionCache, cardId, txt);
            Store.saveCollection(collectionCache);
            renderMainWantsDetail();
          }
        });
      });
    });
  }

  function renderMainWantsTile(item) {
    const card = CardDB.byId.get(item.cardId);
    const name = card ? CardDB.cleanDisplayName(card) : item.cardId;
    const cmText = (window.CM && CM.hasData()) ? CM.fmtCheapest(item.cardId, item.variant) : null;
    const note = Store.getCardNote(collectionCache, item.cardId);
    const tooltip = item.sources.map(s => `${s.name}: ${s.n}`).join('\n');
    const reprintPills = card ? CardDB.reprintPillsHtml(card) : '';
    return `<div class="card-tile entry-tile cursor-pointer"
        data-entry-card-id="${escapeAttr(item.cardId)}" data-card-id="${escapeAttr(item.cardId)}" data-variant-key="${escapeAttr(item.variant)}">
      <img loading="lazy" src="${CardDB.imagePath(item.variant)}" alt="${escapeAttr(name)}" />
      <span class="tile-note">${Notes.iconHtml(!!note)}</span>
      <div class="px-2 pt-1 text-[11px] font-mono leading-tight flex justify-between gap-2">
        <span class="text-amber-400 truncate" title="Cardmarket low / trend">${cmText ? cmText : 'CM'}</span>
        <span class="text-rose-400" title="${escapeAttr(tooltip)}">fehlt <b>${item.count}</b></span>
      </div>
      <div class="p-2 pt-1">
        <div class="text-xs font-mono text-slate-400 truncate">${escapeHtml(item.variant)}${card && card.rarity ? ` <span class="text-slate-300">${escapeHtml(CardDB.rarityShort(card.rarity))}</span>` : ''}</div>
        <div class="text-sm font-semibold truncate" title="${escapeAttr(name)}">${escapeHtml(name)}</div>
        ${reprintPills ? `<div class="reprint-pills mt-1">${reprintPills}</div>` : ''}
      </div>
      <div class="qty-controls" title="Aus Wants-Listen entfernen (kleinste Liste zuerst)">
        <div class="qty-group">
          <button data-mw-dec="${escapeAttr(item.cardId + '|' + item.variant)}">− Wants</button>
        </div>
      </div>
    </div>`;
  }

  // Entfernt n Kopien einer Variant aus den Wants-Listen — kleinste Liste zuerst.
  // Wird vom −-Button im Main-Wants-Tile aufgerufen. Spiegelt das Verhalten von
  // Cardmarket.consumeFromWants, ist aber rein UI-getriggert (kein Collection-Update).
  function removeFromMainWants(cardId, variant, n) {
    let remaining = n;
    const matches = [];
    for (const d of state.decksState.decks) {
      if (d.kind !== 'wants') continue;
      const entry = d.entries.find(e => e.cardId === cardId && e.variant === variant);
      if (entry && entry.count > 0) matches.push({ deck: d, entry });
    }
    matches.sort((a, b) => a.entry.count - b.entry.count);
    for (const m of matches) {
      if (remaining <= 0) break;
      const k = Math.min(remaining, m.entry.count);
      Store.addToDeck(m.deck, cardId, variant, -k);
      remaining -= k;
    }
    Store.saveDecks(state.decksState);
    renderMainWantsDetail();
    renderDeckList();
  }

  function copyMainWantsToClipboard(mw) {
    if (!mw.items.length) { alert('Nichts zu kopieren.'); return; }
    const lines = mw.items.map(it => {
      const card = CardDB.byId.get(it.cardId);
      const cardName = card ? CardDB.cleanDisplayName(card) : it.cardId;
      const id = card ? card.id : it.cardId;
      const vSuffix = card ? versionSuffixForVariant(card, it.variant) : '';
      return `${it.count}x ${cardName} ${id}${vSuffix}`;
    });
    const text = lines.join('\n') + '\n';
    const flash = ok => {
      const btn = rootEl.querySelector('#mw-copy');
      if (!btn) return;
      const orig = btn.textContent;
      btn.textContent = ok ? `✓ ${mw.totalCount} kopiert` : 'Kopieren fehlgeschlagen';
      setTimeout(() => { btn.textContent = orig; }, 1500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => flash(true), () => fallbackCopy(text, flash));
    } else {
      fallbackCopy(text, flash);
    }
  }

  function computeDeckMissing(deck) {
    // Pro Eintrag: echter Slot-Fehlbestand (Proxies zählen als „fehlt", weil ersetzt).
    // Wants-/Trade-Listen sind explizit Listen fehlender Karten — der ganze Count zählt.
    const isWants = isListKind(deck.kind);
    const da = Store.getDeckAssignedIndex(collectionCache)[deck.id] || {};
    const out = [];
    for (const e of deck.entries) {
      const sa = da[e.variant];
      const need = isWants
        ? e.count
        : Math.max(0, e.count - (sa ? sa.real : 0));
      if (need > 0) out.push({ cardId: e.cardId, variant: e.variant, count: need });
    }
    return out;
  }

  function openBulkMissingDialog() {
    const decks = state.decksState.decks;
    if (!decks.length) {
      window.Util.toast('Noch keine Listen vorhanden.', 'warn');
      return;
    }

    // Pro Deck schon mal Missing berechnen für Anzeige.
    const perDeck = decks.map(d => ({
      deck: d,
      missing: computeDeckMissing(d),
      total: 0
    }));
    perDeck.forEach(x => { x.total = x.missing.reduce((s, e) => s + e.count, 0); });

    const renderRow = (x, idx) => {
      const checked = x.total > 0 ? 'checked' : '';
      const disabled = x.total === 0 ? 'disabled' : '';
      return `
        <label class="flex items-center gap-2 px-2 py-1 hover:bg-slate-800 rounded ${x.total === 0 ? 'opacity-50' : 'cursor-pointer'}">
          <input type="checkbox" data-deck-idx="${idx}" class="accent-amber-500" ${checked} ${disabled} />
          <span class="flex-1 text-sm truncate">${escapeHtml(x.deck.name)}</span>
          <span class="text-xs text-slate-500">${escapeHtml(x.deck.kind)}</span>
          <span class="text-xs font-mono ${x.total > 0 ? 'text-amber-400' : 'text-slate-500'}">fehlt ${x.total}</span>
        </label>
      `;
    };

    const contentHtml = `
      <div class="flex justify-between items-start mb-3">
        <h2 class="text-lg font-bold">Fehlende mehrerer Listen → Clipboard</h2>
        <button data-modal-close class="modal-close-x">×</button>
      </div>

      <div class="text-xs text-slate-400 mb-2">
        Mengen werden über die ausgewählten Listen summiert. Proxies werden <b>nicht</b> abgezogen — der Export listet alle echt fehlenden Karten.
      </div>

      <div class="flex gap-2 mb-2 text-xs">
        <button id="bm-all" class="text-amber-400 hover:underline">Alle aktivieren</button>
        <button id="bm-none" class="text-slate-400 hover:underline">Alle abwählen</button>
      </div>

      <div id="bm-decks" class="max-h-[50vh] overflow-y-auto border border-slate-700 rounded p-1 mb-3">
        ${perDeck.map(renderRow).join('')}
      </div>

      <div id="bm-summary" class="text-sm text-slate-400 mb-3"></div>

      <div class="flex justify-end gap-2">
        <button data-modal-close class="btn-secondary">Abbrechen</button>
        <button id="bm-copy" class="btn-primary-emerald">In Zwischenablage kopieren</button>
      </div>
    `;

    window.Util.openModal({
      host: 'bulk-missing-root',
      id: 'bulk-modal',
      sizeClass: 'w-[560px] max-w-[95vw]',
      contentHtml,
      onMount: (content, close) => {
        content.querySelectorAll('[data-modal-close]').forEach(b => b.addEventListener('click', close));
        const checkboxes = () => content.querySelectorAll('input[data-deck-idx]:not([disabled])');
        content.querySelector('#bm-all').addEventListener('click', () => {
          checkboxes().forEach(cb => { cb.checked = true; }); updateSummary();
        });
        content.querySelector('#bm-none').addEventListener('click', () => {
          content.querySelectorAll('input[data-deck-idx]').forEach(cb => { cb.checked = false; });
          updateSummary();
        });

        const aggregate = () => {
          const selected = Array.from(content.querySelectorAll('input[data-deck-idx]:checked'))
            .map(cb => perDeck[parseInt(cb.dataset.deckIdx, 10)])
            .filter(Boolean);
          const merged = new Map();
          for (const x of selected) {
            for (const m of x.missing) {
              const existing = merged.get(m.variant);
              if (existing) existing.count += m.count;
              else merged.set(m.variant, { ...m });
            }
          }
          return { selected, merged };
        };

        const updateSummary = () => {
          const { selected, merged } = aggregate();
          const totalCards = Array.from(merged.values()).reduce((s, e) => s + e.count, 0);
          const uniqueCards = merged.size;
          content.querySelector('#bm-summary').innerHTML = selected.length
            ? `<b>${selected.length}</b> Liste(n) · <b>${uniqueCards}</b> unterschiedliche Karten · <b>${totalCards}</b> Kopien insgesamt`
            : '<span class="text-slate-500">Keine Liste ausgewählt.</span>';
        };
        content.querySelector('#bm-decks').addEventListener('change', updateSummary);
        updateSummary();

        content.querySelector('#bm-copy').addEventListener('click', () => {
          const { selected, merged } = aggregate();
          if (!selected.length || !merged.size) {
            window.Util.toast('Nichts zu kopieren.', 'warn');
            return;
          }
          const lines = Array.from(merged.values()).map(e => {
            const card = CardDB.byId.get(e.cardId);
            const cardName = card ? CardDB.cleanDisplayName(card) : e.cardId;
            const id = card ? card.id : e.cardId;
            const vSuffix = card ? versionSuffixForVariant(card, e.variant) : '';
            return `${e.count}x ${cardName} ${id}${vSuffix}`;
          });
          const text = lines.join('\n') + '\n';
          const total = Array.from(merged.values()).reduce((s, e) => s + e.count, 0);

          const flash = ok => {
            const btn = content.querySelector('#bm-copy');
            if (!btn) return;
            const orig = btn.textContent;
            btn.textContent = ok ? `✓ ${total} Karten kopiert` : 'Kopieren fehlgeschlagen';
            setTimeout(() => { btn.textContent = orig; if (ok) close(); }, 1200);
          };
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(() => flash(true), () => fallbackCopy(text, flash));
          } else {
            fallbackCopy(text, flash);
          }
        });
      }
    });
  }

  // Wrapper auf CardDB.versionSuffix mit der Main-inclusive-Konvention
  // (Multi-Variant-Main bekommt (V.1)).
  function versionSuffixForVariant(card, variantKey) {
    return CardDB.versionSuffix(card, variantKey, true);
  }

  function fallbackCopy(text, finish) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    finish(ok);
  }

  function currentDeck() {
    return state.decksState.decks.find(d => d.id === state.activeDeckId) || null;
  }

  const { escapeHtml, escapeAttr, debounce } = window.Util;

  function refresh() {
    if (!rootEl) return;
    state.decksState = Store.loadDecks();
    collectionCache = Store.loadCollection();
    render();
  }

  let pendingRefresh = false;
  function onExternalChange() {
    if (!rootEl || !rootEl.querySelector('#deck-detail')) return;
    // Wenn der Tab nicht sichtbar ist: nur Cache invalidieren, kein DOM-Refresh.
    const panel = document.getElementById('tab-decks');
    if (panel && panel.classList.contains('hidden')) {
      collectionCache = null; // wird beim nächsten Tab-Aktivieren neu geladen
      return;
    }
    // Sichtbar: in einem RAF gebündelt rendern, damit mehrere Events nicht
    // mehrfach hintereinander rendern.
    if (pendingRefresh) return;
    pendingRefresh = true;
    requestAnimationFrame(() => {
      pendingRefresh = false;
      // Aus LS nachladen, weil andere Module (Card-Modal aus ui-collection,
      // ui-card-menu, ...) eigene Kopien mutieren. Die Saves sind synchron, also
      // ist LS in dem Moment immer aktuell.
      collectionCache = Store.loadCollection();
      state.decksState = Store.loadDecks();
      renderDeckList();
      renderDeckDetail();
      renderPicker();
    });
  }
  document.addEventListener('collection-changed', onExternalChange);
  document.addEventListener('decks-changed', onExternalChange);

  // Aktuell aktive Deck-Liste (nicht Main-Wants, nicht null). Nutzbar von
  // anderen Modulen (z.B. Card-Modal: 'zu aktiver Liste hinzufuegen').
  function getActiveDeck() {
    if (!state.activeDeckId || isMainWants(state.activeDeckId)) return null;
    const decks = (state.decksState && state.decksState.decks) || Store.loadDecks().decks || [];
    return decks.find(d => d.id === state.activeDeckId) || null;
  }

  // Karte direkt der aktiven Liste hinzufuegen. Persistiert + Auto-Claim
  // (nur bei Decks, nicht bei Wants/Trade). Refresh laeuft ueber das
  // decks-changed-Event.
  function addToActiveDeck(cardId, variantKey, n) {
    n = n || 1;
    if (!state.decksState) state.decksState = Store.loadDecks();
    if (!collectionCache) collectionCache = Store.loadCollection();
    const deck = state.decksState.decks.find(d => d.id === state.activeDeckId);
    if (!deck || isMainWants(state.activeDeckId)) return false;
    Store.addToDeck(deck, cardId, variantKey, n);
    if (!isListKind(deck.kind)) Store.autoClaim(collectionCache, deck.id, variantKey, n);
    Store.saveDecks(state.decksState);
    Store.saveCollection(collectionCache);
    return true;
  }

  window.UIDeckbuilder = { init, refresh, getActiveDeck, addToActiveDeck };
})();
