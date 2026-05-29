// Deckbuilder / Wants-List Tab. Keine Regelvalidierung.

(function () {
  const state = {
    decksState: null,
    activeDeckId: null,
    pickerQuery: '',
    pickerColor: null,
    pickerType: null,
    pickerOwnedOnly: false,
    pickerShowAlts: false,
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

  function init(el) {
    rootEl = el;
    state.decksState = Store.loadDecks();
    collectionCache = Store.loadCollection();
    state.pickerShowAlts = !!Prefs.get('showAlts', false);
    state.mainWantsSort = Prefs.get('mainWantsSort', 'id');
    state.deckView = Prefs.get('deckView', 'tiles');
    if (!state.activeDeckId) {
      state.activeDeckId = MAIN_WANTS_ID;
    }
    render();
  }

  function render() {
    rootEl.innerHTML = `
      <div class="flex flex-col lg:flex-row gap-4 lg:h-[calc(100vh-7rem)]">
        <aside class="w-full lg:w-48 lg:shrink-0 flex flex-col lg:min-h-0">
          <div class="flex items-center justify-between mb-2 shrink-0">
            <h2 class="text-sm font-bold uppercase text-slate-400">Listen</h2>
            <button id="new-deck" class="bg-amber-500 text-slate-900 px-2 py-1 rounded text-sm font-semibold">+ Neu</button>
          </div>
          <button id="bulk-missing" class="w-full bg-emerald-500 hover:bg-emerald-400 text-slate-900 px-2 py-2 rounded font-semibold mb-3 text-xs shrink-0">
            Fehlende → Clipboard
          </button>
          <div id="deck-list" class="space-y-1 max-h-[50vh] lg:max-h-none lg:flex-1 lg:min-h-0 overflow-y-auto"></div>
        </aside>
        <div class="flex-1 min-w-0 lg:min-h-0 lg:flex lg:flex-col">
          <div id="deck-detail" class="lg:flex lg:flex-col lg:flex-1 lg:min-h-0"></div>
        </div>
        <div class="flex-1 min-w-0 lg:min-h-0 lg:flex lg:flex-col">
          <h2 class="text-sm font-bold uppercase text-slate-400 mb-2 shrink-0">Karten hinzufügen</h2>
          <div class="space-y-2 mb-2 shrink-0">
            <input id="picker-search" type="text" placeholder="Name oder ID…" value="${escapeAttr(state.pickerQuery)}"
              class="bg-slate-800 border border-slate-600 rounded px-3 py-2 w-full" />
            <div class="flex gap-2 flex-wrap">
              <select id="picker-color" class="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm min-h-[40px]">
                <option value="">Farbe: alle</option>
                ${CardDB.colors.map(c => `<option value="${c}" ${state.pickerColor === c ? 'selected' : ''}>${c}</option>`).join('')}
              </select>
              <select id="picker-type" class="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm min-h-[40px]">
                <option value="">Typ: alle</option>
                ${CardDB.types.map(t => `<option value="${t}" ${state.pickerType === t ? 'selected' : ''}>${t}</option>`).join('')}
              </select>
              <label class="flex items-center gap-1 text-xs">
                <input id="picker-owned" type="checkbox" ${state.pickerOwnedOnly ? 'checked' : ''} />
                Im Besitz
              </label>
              <label class="flex items-center gap-1 text-xs" title="Alt-Arts als eigene Einträge im Picker">
                <input id="picker-alts" type="checkbox" ${state.pickerShowAlts ? 'checked' : ''} />
                Alt-Arts einzeln
              </label>
            </div>
          </div>
          <div id="picker-results" class="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3 max-h-[50vh] lg:max-h-none lg:flex-1 lg:min-h-0 overflow-y-auto pr-1"></div>
        </div>
      </div>
    `;

    renderDeckList();
    renderDeckDetail();
    renderPicker();

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
    rootEl.querySelector('#picker-color').addEventListener('change', e => {
      state.pickerColor = e.target.value || null; renderPicker();
    });
    rootEl.querySelector('#picker-type').addEventListener('change', e => {
      state.pickerType = e.target.value || null; renderPicker();
    });
    rootEl.querySelector('#picker-owned').addEventListener('change', e => {
      state.pickerOwnedOnly = e.target.checked; renderPicker();
    });
    rootEl.querySelector('#picker-alts').addEventListener('change', e => {
      state.pickerShowAlts = e.target.checked;
      Prefs.set('showAlts', state.pickerShowAlts);
      renderPicker();
    });
  }

  // Wants- und Trade-Listen sind reine Kartenlisten (kein Besitz-/Slot-Abgleich).
  function isListKind(kind) { return kind === 'wants' || kind === 'trade'; }

  function renderDeckList() {
    const el = rootEl.querySelector('#deck-list');
    // Pinned "Main Wants" oben
    const mw = computeMainWants();
    const mwActive = isMainWants(state.activeDeckId);
    const mainWantsHtml = `<div class="flex items-center gap-1 mb-2">
      <button data-deck="${MAIN_WANTS_ID}" class="deck-item flex-1 text-left px-3 py-2 rounded ${mwActive ? 'bg-amber-500 text-slate-900' : 'bg-slate-800 hover:bg-slate-700'}">
        <div class="font-semibold text-sm">★ Main Wants</div>
        <div class="text-xs opacity-75">${mw.totalCount} fehlend · ${mw.uniqueCount} unique</div>
      </button>
    </div>`;

    if (!state.decksState.decks.length) {
      el.innerHTML = mainWantsHtml + `<div class="text-sm text-slate-500">Noch keine Listen.</div>`;
      el.querySelectorAll('.deck-item').forEach(btn => {
        btn.addEventListener('click', () => {
          state.activeDeckId = btn.dataset.deck;
          render();
        });
      });
      return;
    }
    const idx = Store.buildVariantIndex(collectionCache);
    const dIdx = Store.buildDeckAssignedIndex(collectionCache);

    const renderItem = d => {
      const active = d.id === state.activeDeckId;
      const total = d.entries.reduce((s, e) => s + e.count, 0);
      const da = dIdx[d.id] || {};   // variant -> { real, proxy } für dieses Deck
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
      // Vollständig, aber mit zugewiesenen Proxies → Name lila markieren.
      const hasSlottedProxy = complete && d.entries.some(e => {
        const s = da[e.variant];
        return s && s.proxy > 0;
      });
      const cls = active
        ? 'bg-amber-500 text-slate-900'
        : (complete
            ? 'bg-emerald-600/30 border border-emerald-500 hover:bg-emerald-600/50'
            : (slottable
                ? 'bg-yellow-500/15 border border-yellow-400 hover:bg-yellow-500/25 deck-slottable'
                : 'hover:bg-slate-800'));
      const nameCls = (hasSlottedProxy && !active) ? 'text-purple-400' : '';
      const fav = !!d.favorite;
      const starTitle = fav ? 'Aus Favoriten entfernen' : 'Als Favorit markieren';
      const starColor = fav ? 'text-amber-400' : 'text-slate-500 hover:text-amber-300';
      return `<div class="flex items-center gap-1">
        <button data-fav="${d.id}" class="${starColor} px-1 text-base leading-none" title="${starTitle}">${fav ? '★' : '☆'}</button>
        <button data-deck="${d.id}" class="deck-item flex-1 text-left px-3 py-2 rounded ${cls}">
          <div class="font-semibold text-sm ${nameCls}">${escapeHtml(d.name)}${complete && !active ? ` <span class="${hasSlottedProxy ? 'text-purple-300' : 'text-emerald-300'}">✓</span>` : ''}</div>
          <div class="text-xs opacity-75">${escapeHtml(d.kind)} · ${total} Karten</div>
        </button>
        <button data-del="${d.id}" class="text-slate-500 hover:text-red-400 px-2">✕</button>
      </div>`;
    };

    // Favoriten zuerst, sonst Reihenfolge bleibt.
    const favFirst = arr => arr.slice().sort((a, b) => (b.favorite ? 1 : 0) - (a.favorite ? 1 : 0));

    // Gruppiert nach Art: Decks / Wants / Trades.
    const GROUPS = [
      { kind: 'wants', label: 'Wants' },
      { kind: 'trade', label: 'Trades' },
      { kind: 'deck',  label: 'Decks' }
    ];
    let groupedHtml = '';
    for (const g of GROUPS) {
      const items = favFirst(state.decksState.decks.filter(d => d.kind === g.kind));
      if (!items.length) continue;
      groupedHtml += `<div class="text-[11px] font-bold uppercase tracking-wide text-slate-500 mt-3 mb-1">${g.label} · ${items.length}</div>`
        + `<div class="space-y-1">${items.map(renderItem).join('')}</div>`;
    }
    // Unbekannte Arten (Fallback) ans Ende.
    const known = new Set(GROUPS.map(g => g.kind));
    const rest = favFirst(state.decksState.decks.filter(d => !known.has(d.kind)));
    if (rest.length) {
      groupedHtml += `<div class="text-[11px] font-bold uppercase tracking-wide text-slate-500 mt-3 mb-1">Sonstige · ${rest.length}</div>`
        + `<div class="space-y-1">${rest.map(renderItem).join('')}</div>`;
    }
    el.innerHTML = mainWantsHtml + groupedHtml;

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
    const total = deck.entries.reduce((s, e) => s + e.count, 0);
    const cost = Store.computeDeckCost(deck, collectionCache);
    let missingCmSum = 0;
    let missingCmCount = 0;
    let missingNoCm = 0;
    const isWants = isListKind(deck.kind);
    // Wants-Coverage: wie viele der fehlenden Slots stehen schon in einer Wants-Liste?
    // Aggregat pro variant ueber alle kind='wants'-Listen.
    const wantsByVariant = new Map();
    if (!isWants) {
      for (const d of state.decksState.decks) {
        if (d.kind !== 'wants') continue;
        for (const e of d.entries) {
          wantsByVariant.set(e.variant, (wantsByVariant.get(e.variant) || 0) + e.count);
        }
      }
    }
    let missingInWants = 0;
    if (window.CM && CM.hasData()) {
      const da = Store.buildDeckAssignedIndex(collectionCache)[deck.id] || {};
      for (const entry of deck.entries) {
        const sa = da[entry.variant];
        const need = isWants
          ? entry.count
          : Math.max(0, entry.count - (sa ? sa.real : 0));
        if (!need) continue;
        if (!isWants) {
          const want = wantsByVariant.get(entry.variant) || 0;
          missingInWants += Math.min(need, want);
        }
        const p = CM.get(entry.cardId);
        if (p && p.low != null) {
          missingCmSum += p.low * need;
          missingCmCount += need;
        } else {
          missingNoCm += need;
        }
      }
    } else if (!isWants) {
      // Auch ohne CM-Daten Wants-Coverage zaehlen.
      const da = Store.buildDeckAssignedIndex(collectionCache)[deck.id] || {};
      for (const entry of deck.entries) {
        const sa = da[entry.variant];
        const need = Math.max(0, entry.count - (sa ? sa.real : 0));
        if (!need) continue;
        const want = wantsByVariant.get(entry.variant) || 0;
        missingInWants += Math.min(need, want);
      }
    }
    const costLine = total > 0
      ? `<span class="text-emerald-400 font-bold">${Fmt.eur(cost.total)}</span> <span class="text-slate-500">(bereits bezahlt)</span>`
        + (cost.missing ? ` · <span class="text-red-400">${cost.missing} fehlen</span>${missingInWants > 0 ? ` <span class="text-sky-400" title="Davon stehen so viele bereits in einer Wants-Liste">(${missingInWants} in Wants)</span>` : ''}` : '')
        + (cost.unknown ? ` · <span class="text-slate-400">${cost.unknown} ohne Preis</span>` : '')
        + (missingCmCount > 0
            ? ` · <span class="text-amber-400">fehlend CM: ${Fmt.eur(missingCmSum)}</span>${missingNoCm ? ` <span class="text-slate-500">(${missingNoCm} ohne CM-Preis)</span>` : ''}`
            : '')
      : '';
    el.innerHTML = `
      <div class="bg-slate-800 rounded p-3 mb-3 shrink-0">
        <div class="flex items-center gap-2">
          <input id="deck-name" type="text" value="${escapeAttr(deck.name)}"
            class="bg-transparent text-xl font-bold flex-1 focus:outline-none focus:bg-slate-700 rounded px-1" />
          <span id="deck-note-host">${Notes.iconHtml(!!(deck.notes && deck.notes.trim()))}</span>
          <select id="deck-kind" class="bg-slate-900 border border-slate-600 rounded px-2 py-1 text-sm">
            ${['deck','wants','trade'].map(k => `<option value="${k}" ${deck.kind === k ? 'selected' : ''}>${k}</option>`).join('')}
          </select>
        </div>
        <div class="text-xs text-slate-400 mt-1">${total} Karten · ${deck.entries.length} Einträge</div>
        ${costLine ? `<div class="text-sm mt-1">${costLine}</div>` : ''}
        <div id="color-balance" class="mt-2"></div>
      </div>

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
        ${!isListKind(deck.kind) ? `<label class="flex items-center gap-1 text-slate-300" title="Nur Karten mit fehlenden echten Kopien (Proxies zählen als fehlend)">
          <input id="deck-missing-only" type="checkbox" ${state.deckMissingOnly ? 'checked' : ''} />
          Nur fehlende
        </label>` : ''}
        <button id="import-into" class="ml-auto bg-sky-500 hover:bg-sky-400 text-slate-900 px-3 py-1 rounded font-semibold"
          title="Karten direkt in diese Liste einfügen (mengen werden addiert)">Importieren</button>
        ${!isListKind(deck.kind) ? `<button id="missing-to-wants" class="bg-purple-500 hover:bg-purple-400 text-white px-3 py-1 rounded font-semibold"
          title="Fehlende Karten direkt in eine Wants-Liste übernehmen (Alt-Arts bleiben erhalten)">Fehlende → Wants</button>` : ''}
        <button id="export-missing" class="bg-amber-500 text-slate-900 px-3 py-1 rounded font-semibold"
          title="Exportiert nur Karten/Mengen, die in dieser Liste fehlen (Cardmarket-kompatibel)">Fehlende exportieren</button>
        <button id="export-full" class="bg-emerald-500 hover:bg-emerald-400 text-slate-900 px-3 py-1 rounded font-semibold"
          title="Kopiert die vollständige Liste (Anzahl Name ID) in die Zwischenablage">Exportieren</button>
      </div>

      <div id="deck-entries" class="space-y-4 max-h-[78vh] lg:max-h-none lg:flex-1 lg:min-h-0 overflow-y-auto pr-1"></div>
    `;

    rootEl.querySelector('#deck-name').addEventListener('change', e => {
      deck.name = e.target.value.trim() || 'Untitled';
      deck.updatedAt = new Date().toISOString();
      Store.saveDecks(state.decksState);
      renderDeckList();
    });
    rootEl.querySelector('#deck-kind').addEventListener('change', e => {
      deck.kind = e.target.value;
      deck.updatedAt = new Date().toISOString();
      Store.saveDecks(state.decksState);
      renderDeckList();
    });
    rootEl.querySelector('#deck-view').addEventListener('change', e => {
      state.deckView = e.target.value;
      Prefs.set('deckView', state.deckView);
      renderDeckDetail();
    });
    rootEl.querySelector('#group-by').addEventListener('change', e => {
      state.deckGroupBy = e.target.value;
      renderDeckDetail();
    });
    rootEl.querySelector('#sort-by').addEventListener('change', e => {
      state.deckSortBy = e.target.value;
      renderDeckDetail();
    });
    const deckMissingCb = rootEl.querySelector('#deck-missing-only');
    if (deckMissingCb) deckMissingCb.addEventListener('change', e => {
      state.deckMissingOnly = e.target.checked;
      renderDeckEntries(deck);
    });
    rootEl.querySelector('#export-missing').addEventListener('click', () => exportMissing(deck));
    rootEl.querySelector('#export-full').addEventListener('click', () => exportFull(deck));
    rootEl.querySelector('#import-into').addEventListener('click', () => openImportIntoDeck(deck));
    const mtwBtn = rootEl.querySelector('#missing-to-wants');
    if (mtwBtn) mtwBtn.addEventListener('click', () => openMissingToWantsDialog(deck));
    rootEl.querySelector('#deck-note-host [data-note-trigger]').addEventListener('click', () => {
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
      vIdx: Store.buildVariantIndex(collectionCache),
      da: Store.buildDeckAssignedIndex(collectionCache)[deck.id] || {}
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
        if (window.UICollection && typeof window.UICollection.openCardModal === 'function') {
          window.UICollection.openCardModal(row.dataset.entryCardId, row.dataset.variantKey);
        }
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
    const cm = (window.CM && CM.hasData()) ? CM.getForVariant(entry.variant) : null;
    const cmLow = (cm && cm.low != null) ? CM.fmt(cm.low) : null;
    const note = Store.getCardNote(collectionCache, entry.cardId);

    if (isWants) {
      // Wants-Liste = explizite Liste fehlender Karten. Kein Besitzt-/Fehlt-Vergleich.
      return `<div class="card-tile entry-tile cursor-pointer"
          data-entry-card-id="${escapeAttr(entry.cardId)}" data-card-id="${escapeAttr(entry.cardId)}" data-variant-key="${escapeAttr(entry.variant)}">
        <img loading="lazy" src="${CardDB.imagePath(entry.variant)}" alt="${escapeAttr(name)}" />
        <span class="tile-note">${Notes.iconHtml(!!note)}</span>
        <div class="px-2 pt-1 text-[11px] font-mono leading-tight">
          <span class="text-amber-400" title="Cardmarket low">${cmLow ? 'CM: ' + cmLow : ''}</span>
        </div>
        <div class="p-2 pt-1">
          <div class="text-xs font-mono text-slate-400 truncate">${escapeHtml(entry.variant)}${card && card.rarity ? ` <span class="text-slate-300">${escapeHtml(card.rarity)}</span>` : ''}</div>
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

    const totalFree = freeReal + freeProxy;
    // Cross-Variant-Hinweis: andere Varianten derselben Card-ID, die frei
    // verfuegbar sind. Reine Info — Slotten bleibt variant-genau, User entscheidet.
    let freeOtherTotal = 0;
    const otherBreakdown = [];
    if (card) {
      for (const v of CardDB.variantsOf(card)) {
        if (v.key === entry.variant) continue;
        const ov = ctx.vIdx[v.key];
        if (!ov) continue;
        const f = ov.freeReal + ov.freeProxy;
        if (f > 0) {
          otherBreakdown.push(`${f}× ${v.key}`);
          freeOtherTotal += f;
        }
      }
    }

    let ownedClass = 'text-slate-500';
    let needText = '';
    let needTitle = '';
    if (complete) {
      ownedClass = 'text-emerald-400';
      needText = '✓';
    } else if (totalFree > 0) {
      ownedClass = 'text-sky-400';
      needText = freeOtherTotal > 0
        ? `${totalFree} verfügbar <span class="text-amber-300">+${freeOtherTotal} andere Variante</span>`
        : `${totalFree} verfügbar`;
      needTitle = freeOtherTotal > 0
        ? `${totalFree} exakt frei · ${freeOtherTotal} in anderer Variante: ${otherBreakdown.join(', ')}`
        : `${totalFree} exakt frei`;
    } else if (freeOtherTotal > 0) {
      ownedClass = 'text-amber-300';
      needText = `${freeOtherTotal} andere Variante`;
      needTitle = `${freeOtherTotal} in anderer Variante verfügbar: ${otherBreakdown.join(', ')}`;
    }

    const badgeCls = (assignedReal === 0 && assignedProxy === 0)
      ? 'zero'
      : (complete ? 'full' : '');
    const slottable = !complete && totalFree > 0;
    return `<div class="card-tile entry-tile cursor-pointer ${complete ? 'playset' : ''} ${assignedTotal === 0 ? 'missing' : ''} ${slottable ? 'tile-slottable' : ''} ${assignedProxy > 0 ? 'tile-proxy-slotted' : ''}"
        data-entry-card-id="${escapeAttr(entry.cardId)}" data-card-id="${escapeAttr(entry.cardId)}" data-variant-key="${escapeAttr(entry.variant)}">
      <img loading="lazy" src="${CardDB.imagePath(entry.variant)}" alt="${escapeAttr(name)}" />
      <span class="tile-note">${Notes.iconHtml(!!note)}</span>
      <div class="px-2 pt-1 text-[11px] font-mono leading-tight flex justify-between gap-2">
        <span class="text-amber-400 truncate" title="Cardmarket low">${cmLow ? 'CM: ' + cmLow : ''}</span>
        <span class="${ownedClass}"${needTitle ? ` title="${escapeAttr(needTitle)}"` : ''}>${needText}</span>
      </div>
      <div class="p-2 pt-1 flex items-center gap-2">
        <div class="min-w-0 flex-1">
          <div class="text-xs font-mono text-slate-400 truncate">${escapeHtml(entry.variant)}${card && card.rarity ? ` <span class="text-slate-300">${escapeHtml(card.rarity)}</span>` : ''}</div>
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
        <button data-slot-inc="${entry.cardId}|${entry.variant}" ${freeReal + freeProxy === 0 || assignedTotal >= entry.count ? 'disabled' : ''}>+ Slot</button>
      </div>
    </div>`;
  }

  // Kompakte Tabellen-Zeile fuer Deck-Eintraege (Text-Ansicht). Verzichtet auf
  // Slot-Buttons im Layout zugunsten Lesbarkeit, behaelt aber +/-Demand-Buttons
  // und Klick auf die Zeile (Detail-Modal). Wants-/Trade-Listen rendern ohne
  // Slot-Statusspalte (eine reine Wunsch-/Tauschliste).
  function renderEntryRow(entry, ctx) {
    const deck = currentDeck();
    const isWants = deck && isListKind(deck.kind);
    const card = CardDB.byId.get(entry.cardId);
    const name = card ? CardDB.cleanDisplayName(card) : entry.cardId;
    const cm = (window.CM && CM.hasData()) ? CM.getForVariant(entry.variant) : null;
    const cmLow = (cm && cm.low != null) ? CM.fmt(cm.low) : null;
    const note = Store.getCardNote(collectionCache, entry.cardId);
    const rarity = card && card.rarity ? card.rarity : '';

    const sa = ctx.da[entry.variant];
    const assignedReal = sa ? sa.real : 0;
    const assignedProxy = sa ? sa.proxy : 0;
    const assignedTotal = assignedReal + assignedProxy;
    const complete = !isWants && assignedTotal >= entry.count;

    const slotCell = isWants
      ? ''
      : (() => {
          const cls = complete ? 'text-emerald-400' : (assignedTotal === 0 ? 'text-slate-500' : 'text-amber-400');
          const proxy = assignedProxy > 0 ? ` <span class="text-purple-400">+${assignedProxy}P</span>` : '';
          return `<td class="py-1 pr-4 text-xs tabular-nums whitespace-nowrap"><span class="${cls}"><b>${assignedReal}</b>/${entry.count}</span>${proxy}</td>`;
        })();

    const qty = `<span class="inline-flex items-center gap-1">
      <button data-demand-dec="${entry.cardId}|${entry.variant}" class="wants-qty-btn" title="Soll −">−</button>
      <span class="font-bold text-amber-400 w-6 text-center tabular-nums">${entry.count}</span>
      <button data-demand-inc="${entry.cardId}|${entry.variant}" class="wants-qty-btn" title="Soll +">+</button>
    </span>`;

    return `<tr class="wants-row entry-row group cursor-pointer hover:bg-slate-700/60" data-entry-card-id="${escapeAttr(entry.cardId)}" data-card-id="${escapeAttr(entry.cardId)}" data-variant-key="${escapeAttr(entry.variant)}">
        <td class="py-1 pr-3 whitespace-nowrap">${qty}</td>
        ${slotCell}
        <td class="py-1 pr-3 relative">
          <span class="block truncate max-w-[22rem]" title="${escapeAttr(name)}">${escapeHtml(name)}</span>
          <img class="wants-preview" loading="lazy" src="${CardDB.imagePath(entry.variant)}" alt="" />
        </td>
        <td class="py-1 pr-3 font-mono text-slate-400 text-xs whitespace-nowrap">${escapeHtml(entry.variant)}</td>
        <td class="py-1 pr-3 text-slate-500 text-xs whitespace-nowrap">${escapeHtml(rarity)}</td>
        <td class="py-1 pr-3 text-slate-400 text-xs tabular-nums text-right whitespace-nowrap">${cmLow ? 'CM ' + cmLow : '—'}</td>
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
    const cmLow = id => {
      if (!window.CM || !CM.hasData()) return null;
      const p = CM.get(id);
      return (p && p.low != null) ? p.low : null;
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
      return entries.slice().sort((a, b) => {
        const av = cmLow(a.cardId);
        const bv = cmLow(b.cardId);
        if (av == null && bv == null) return byId(a, b);
        if (av == null) return 1;
        if (bv == null) return -1;
        if (av !== bv) return (av - bv) * dir;
        return byId(a, b);
      });
    }
    if (mode === 'status') {
      const deck = currentDeck();
      const idx = Store.buildVariantIndex(collectionCache);
      const da = deck ? (Store.buildDeckAssignedIndex(collectionCache)[deck.id] || {}) : {};
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

  function renderPicker() {
    const el = rootEl.querySelector('#picker-results');
    if (!el) return;
    const deck = currentDeck();
    if (!deck) {
      el.innerHTML = `<div class="text-slate-500 text-sm">Erst Liste wählen.</div>`;
      return;
    }
    const q = state.pickerQuery.trim();
    let results = CardDB.search(q, {
      color: state.pickerColor,
      type: state.pickerType,
      sortBy: 'name'
    });
    // Einmal pro Render bauen — für den Owned-Filter UND die Tile-Counts unten.
    const vIdx = Store.buildVariantIndex(collectionCache);
    if (state.pickerOwnedOnly) {
      results = results.filter(c => {
        for (const v of CardDB.variantsOf(c)) {
          const s = vIdx[v.key];
          if (s && (s.real + s.proxy) > 0) return true;
        }
        return false;
      });
    }

    // Bei showAlts pro Variant einen Eintrag erzeugen
    let entries = [];
    if (state.pickerShowAlts) {
      for (const card of results) {
        CardDB.variantsOf(card).forEach((v, idx) => {
          entries.push({ card, variant: v.key, isAlt: v.isAlt, altIdx: idx });
        });
      }
    } else {
      entries = results.map(card => ({ card, variant: CardDB.mainVariantKey(card), isAlt: false, altIdx: 0 }));
    }
    const limited = entries.slice(0, 100);

    if (!q && !state.pickerColor && !state.pickerType && !state.pickerOwnedOnly) {
      el.innerHTML = `<div class="text-slate-500 text-sm">Suche oder filtere, um Karten hinzuzufügen.</div>`;
      return;
    }

    if (!limited.length) {
      el.innerHTML = `<div class="text-slate-500 text-sm col-span-full">Keine Treffer.</div>`;
    } else {
      el.innerHTML = limited.map(entry => {
        const { card, variant, isAlt, altIdx } = entry;
        const vsThis = vIdx[variant];
        const realThisVariant = vsThis ? vsThis.real : 0;
        const proxyThisVariant = vsThis ? vsThis.proxy : 0;
        let realShown, proxyShown, ownedShown;
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
        ownedShown = realShown + proxyShown;
        let badge = '';
        if (state.pickerShowAlts) {
          badge = isAlt
            ? `<div class="absolute top-1 left-1 bg-amber-500 text-slate-900 text-[10px] font-bold rounded px-1.5 py-0.5">Alt ${altIdx}</div>`
            : `<div class="absolute top-1 left-1 bg-slate-700 text-slate-200 text-[10px] font-bold rounded px-1.5 py-0.5">Main</div>`;
        }
        const cName = CardDB.cleanDisplayName(card);
        return `<button data-add="${card.id}|${variant}" data-card-id="${escapeAttr(card.id)}" data-variant-key="${escapeAttr(variant)}"
          class="card-tile ${ownedShown === 0 ? 'missing' : ''} ${ownedShown >= 4 ? 'playset' : ''} text-left">
          <img loading="lazy" src="${CardDB.imagePath(variant)}" alt="${escapeAttr(cName)}" />
          ${badge}
          <div class="p-2 flex items-center gap-2">
            <div class="min-w-0 flex-1">
              <div class="text-xs font-mono text-slate-400 truncate">${escapeHtml(card.id)}${card.rarity ? ` <span class="text-slate-300">${escapeHtml(card.rarity)}</span>` : ''}</div>
              <div class="text-sm font-semibold truncate" title="${escapeAttr(cName)}">${escapeHtml(cName)}</div>
            </div>
            <div class="flex items-center gap-1 shrink-0">
              ${proxyShown > 0 ? `<div class="proxy-badge" title="${proxyShown} Proxy">+${proxyShown}P</div>` : ''}
              <div class="count-badge ${realShown === 0 && proxyShown === 0 ? 'zero' : (ownedShown >= 4 ? 'full' : '')}">${realShown}</div>
            </div>
          </div>
        </button>`;
      }).join('');
    }

    el.querySelectorAll('[data-add]').forEach(btn => {
      btn.addEventListener('click', () => {
        const [cardId, variant] = btn.dataset.add.split('|');
        Store.addToDeck(deck, cardId, variant, 1);
        if (!isListKind(deck.kind)) {
          Store.autoClaim(collectionCache, deck.id, variant, 1);
        }
        Store.saveDecks(state.decksState);
        Store.saveCollection(collectionCache);
        renderDeckDetail();
        renderDeckList();
      });
    });
  }

  function exportMissing(deck) {
    const isWants = isListKind(deck.kind);
    const da = Store.buildDeckAssignedIndex(collectionCache)[deck.id] || {};
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

  // Kopiert die vollständige Liste im Standard-Textformat: "Anzahl Name ID".
  function exportFull(deck) {
    if (!deck.entries.length) { alert('Diese Liste ist leer.'); return; }
    const lines = deck.entries.map(e => {
      const card = CardDB.byId.get(e.cardId);
      const cardName = card ? CardDB.cleanDisplayName(card) : e.cardId;
      const id = card ? card.id : e.cardId;
      const vSuffix = card ? versionSuffixForVariant(card, e.variant) : '';
      return `${e.count} ${cardName} ${id}${vSuffix}`;
    });
    const text = lines.join('\n') + '\n';
    const total = deck.entries.reduce((s, e) => s + e.count, 0);

    const finish = ok => {
      const btn = rootEl.querySelector('#export-full');
      if (!btn) return;
      const orig = btn.textContent;
      btn.textContent = ok ? `✓ ${total} kopiert` : 'Kopieren fehlgeschlagen';
      setTimeout(() => { btn.textContent = orig; }, 1800);
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => finish(true), () => fallbackCopy(text, finish));
    } else {
      fallbackCopy(text, finish);
    }
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
    const da = Store.buildDeckAssignedIndex(collectionCache)[deck.id] || {};
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

    let host = document.getElementById('missing-to-wants-root');
    if (!host) {
      host = document.createElement('div');
      host.id = 'missing-to-wants-root';
      document.body.appendChild(host);
    }

    const wantsLists = state.decksState.decks.filter(d => d.kind === 'wants');
    const totalCopies = missingEntries.reduce((s, e) => s + e.count, 0);

    host.innerHTML = `
      <div class="modal-backdrop" id="mtw-modal">
        <div class="modal-content w-[480px] max-w-[95vw]">
          <div class="flex justify-between items-start mb-3">
            <h2 class="text-lg font-bold">Fehlende → Wants-Liste</h2>
            <button id="mtw-close" class="text-slate-400 hover:text-white text-2xl leading-none">×</button>
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
            <button id="mtw-cancel" class="bg-slate-700 hover:bg-slate-600 px-3 py-1.5 rounded text-sm">Abbrechen</button>
            <button id="mtw-go" class="bg-purple-500 hover:bg-purple-400 text-white px-4 py-1.5 rounded text-sm font-semibold">Uebernehmen</button>
          </div>
        </div>
      </div>
    `;

    const targetSel = host.querySelector('#mtw-target');
    const nameWrap = host.querySelector('#mtw-name-wrap');
    const updateNameVisible = () => {
      nameWrap.style.display = targetSel.value === '__new__' ? '' : 'none';
    };
    targetSel.addEventListener('change', updateNameVisible);
    updateNameVisible();

    const close = () => { host.innerHTML = ''; document.removeEventListener('keydown', esc); };
    function esc(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', esc);
    host.querySelector('#mtw-close').addEventListener('click', close);
    host.querySelector('#mtw-cancel').addEventListener('click', close);
    host.querySelector('#mtw-modal').addEventListener('click', e => {
      if (e.target.id === 'mtw-modal') close();
    });

    host.querySelector('#mtw-go').addEventListener('click', () => {
      const target = targetSel.value;
      let targetDeck;
      if (target === '__new__') {
        const name = host.querySelector('#mtw-name').value.trim();
        if (!name) { alert('Name der neuen Liste fehlt.'); return; }
        targetDeck = Store.createDeck(state.decksState, name, 'wants');
      } else {
        targetDeck = state.decksState.decks.find(d => d.id === target);
        if (!targetDeck) { alert('Wants-Liste nicht gefunden.'); return; }
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

  function openImportIntoDeck(deck) {
    let host = document.getElementById('import-into-root');
    if (!host) {
      host = document.createElement('div');
      host.id = 'import-into-root';
      document.body.appendChild(host);
    }
    const formats = (window.IO_FORMATS || []);
    const defaultFmt = formats.find(f => f.id === 'dcgo-text') || formats.find(f => f.id === 'compact-text') || formats[0];

    host.innerHTML = `
      <div class="modal-backdrop" id="import-into-modal">
        <div class="modal-content w-[640px] max-w-[95vw]">
          <div class="flex justify-between items-start mb-3">
            <div class="min-w-0">
              <h2 class="text-lg font-bold truncate">Importieren in „${escapeHtml(deck.name)}"</h2>
              <div class="text-xs text-slate-400">Mengen werden zu vorhandenen Einträgen <b>addiert</b>.</div>
            </div>
            <button id="ii-close" class="text-slate-400 hover:text-white text-2xl leading-none">×</button>
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
            <button id="ii-cancel" class="bg-slate-700 hover:bg-slate-600 px-3 py-1.5 rounded text-sm">Abbrechen</button>
            <button id="ii-go" class="bg-emerald-500 text-slate-900 hover:bg-emerald-400 px-4 py-1.5 rounded text-sm font-semibold">In Liste übernehmen</button>
          </div>
        </div>
      </div>
    `;

    const close = () => { host.innerHTML = ''; document.removeEventListener('keydown', esc); };
    function esc(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', esc);

    host.querySelector('#ii-close').addEventListener('click', close);
    host.querySelector('#ii-cancel').addEventListener('click', close);
    host.querySelector('#import-into-modal').addEventListener('click', e => {
      if (e.target.id === 'import-into-modal') close();
    });

    host.querySelector('#ii-go').addEventListener('click', () => {
      const fmtId = host.querySelector('#ii-format').value;
      const fmt = formats.find(f => f.id === fmtId);
      const text = host.querySelector('#ii-text').value;
      const msgEl = host.querySelector('#ii-msg');
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

      let added = 0;
      for (const e of validEntries) {
        Store.addToDeck(deck, e.cardId, e.variant, Math.max(1, e.count || 1));
        added += Math.max(1, e.count || 1);
      }
      Store.saveDecks(state.decksState);
      close();
      renderDeckList();
      renderDeckDetail();
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
    const cmLow = id => {
      if (!window.CM || !CM.hasData()) return null;
      const p = CM.get(id);
      return (p && p.low != null) ? p.low : null;
    };
    if (mode === 'price-desc') {
      items.sort((a, b) => {
        const av = cmLow(a.cardId);
        const bv = cmLow(b.cardId);
        if (av == null && bv == null) return a.variant.localeCompare(b.variant);
        if (av == null) return 1;
        if (bv == null) return -1;
        if (av !== bv) return bv - av;
        return a.variant.localeCompare(b.variant);
      });
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
            let sum = 0, noCm = 0;
            for (const it of mw.items) {
              const p = CM.get(it.cardId);
              if (p && p.low != null) sum += p.low * it.count;
              else noCm += it.count;
            }
            return ` · <span class="text-amber-400">CM ≈ ${Fmt.eur(sum)}</span>${noCm > 0 ? ` <span class="text-slate-500">(${noCm} ohne CM-Preis)</span>` : ''}`;
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
        if (window.UICollection && typeof window.UICollection.openCardModal === 'function') {
          window.UICollection.openCardModal(row.dataset.entryCardId, row.dataset.variantKey);
        }
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
    const cm = (window.CM && CM.hasData()) ? CM.getForVariant(item.variant) : null;
    const cmLow = (cm && cm.low != null) ? CM.fmt(cm.low) : null;
    const note = Store.getCardNote(collectionCache, item.cardId);
    const tooltip = item.sources.map(s => `${s.name}: ${s.n}`).join('\n');
    const reprintPills = card ? CardDB.reprintPillsHtml(card) : '';
    return `<div class="card-tile entry-tile cursor-pointer"
        data-entry-card-id="${escapeAttr(item.cardId)}" data-card-id="${escapeAttr(item.cardId)}" data-variant-key="${escapeAttr(item.variant)}">
      <img loading="lazy" src="${CardDB.imagePath(item.variant)}" alt="${escapeAttr(name)}" />
      <span class="tile-note">${Notes.iconHtml(!!note)}</span>
      <div class="px-2 pt-1 text-[11px] font-mono leading-tight flex justify-between gap-2">
        <span class="text-amber-400 truncate" title="Cardmarket low">${cmLow ? 'CM: ' + cmLow : ''}</span>
        <span class="text-rose-400" title="${escapeAttr(tooltip)}">fehlt <b>${item.count}</b></span>
      </div>
      <div class="p-2 pt-1">
        <div class="text-xs font-mono text-slate-400 truncate">${escapeHtml(item.variant)}${card && card.rarity ? ` <span class="text-slate-300">${escapeHtml(card.rarity)}</span>` : ''}</div>
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
    const da = Store.buildDeckAssignedIndex(collectionCache)[deck.id] || {};
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
      alert('Noch keine Listen vorhanden.');
      return;
    }

    let host = document.getElementById('bulk-missing-root');
    if (!host) {
      host = document.createElement('div');
      host.id = 'bulk-missing-root';
      document.body.appendChild(host);
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

    host.innerHTML = `
      <div class="modal-backdrop" id="bulk-modal">
        <div class="modal-content w-[560px] max-w-[95vw]">
          <div class="flex justify-between items-start mb-3">
            <h2 class="text-lg font-bold">Fehlende mehrerer Listen → Clipboard</h2>
            <button id="bm-close" class="text-slate-400 hover:text-white text-2xl leading-none">×</button>
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
            <button id="bm-cancel" class="bg-slate-700 hover:bg-slate-600 px-3 py-1.5 rounded text-sm">Abbrechen</button>
            <button id="bm-copy" class="bg-emerald-500 text-slate-900 hover:bg-emerald-400 px-4 py-1.5 rounded text-sm font-semibold">In Zwischenablage kopieren</button>
          </div>
        </div>
      </div>
    `;

    const close = () => { host.innerHTML = ''; };
    host.querySelector('#bm-close').addEventListener('click', close);
    host.querySelector('#bm-cancel').addEventListener('click', close);
    host.querySelector('#bulk-modal').addEventListener('click', e => {
      if (e.target.id === 'bulk-modal') close();
    });

    const checkboxes = () => host.querySelectorAll('input[data-deck-idx]:not([disabled])');
    host.querySelector('#bm-all').addEventListener('click', () => {
      checkboxes().forEach(cb => { cb.checked = true; }); updateSummary();
    });
    host.querySelector('#bm-none').addEventListener('click', () => {
      host.querySelectorAll('input[data-deck-idx]').forEach(cb => { cb.checked = false; });
      updateSummary();
    });

    const aggregate = () => {
      const selected = Array.from(host.querySelectorAll('input[data-deck-idx]:checked'))
        .map(cb => perDeck[parseInt(cb.dataset.deckIdx, 10)])
        .filter(Boolean);
      const merged = new Map(); // variant -> { cardId, variant, count }
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
      host.querySelector('#bm-summary').innerHTML = selected.length
        ? `<b>${selected.length}</b> Liste(n) · <b>${uniqueCards}</b> unterschiedliche Karten · <b>${totalCards}</b> Kopien insgesamt`
        : '<span class="text-slate-500">Keine Liste ausgewählt.</span>';
    };
    host.querySelector('#bm-decks').addEventListener('change', updateSummary);
    updateSummary();

    host.querySelector('#bm-copy').addEventListener('click', () => {
      const { selected, merged } = aggregate();
      if (!selected.length || !merged.size) {
        alert('Nichts zu kopieren.');
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
        const btn = host.querySelector('#bm-copy');
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

  // " (V.N)" wenn die Karte mehrere Varianten hat. N startet bei 1 (Main), 2 für
  // die erste Alt-Art usw. Karten mit nur einer Variante bekommen keinen V-Marker.
  function versionSuffixForVariant(card, variantKey) {
    if (!card) return '';
    const variants = CardDB.variantsOf(card);
    if (variants.length <= 1) return '';
    const idx = variants.findIndex(v => v.key === variantKey);
    if (idx < 0) return '';
    return ` (V.${idx + 1})`;
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

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, '&quot;');
  }
  function debounce(fn, ms) {
    let t;
    return function (...args) { clearTimeout(t); t = setTimeout(() => fn.apply(this, args), ms); };
  }

  function refresh() {
    if (!rootEl) return;
    state.decksState = Store.loadDecks();
    collectionCache = Store.loadCollection();
    render();
  }

  let pendingRefresh = false;
  document.addEventListener('collection-changed', () => {
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
      collectionCache = Store.loadCollection();
      renderDeckList();
      renderDeckDetail();
      renderPicker();
    });
  });

  window.UIDeckbuilder = { init, refresh };
})();
