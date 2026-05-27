// Collection-Tab.

(function () {
  const state = {
    collection: null,
    selectedSet: null,        // null = alle
    query: '',
    colors: [],               // Multi-Select
    type: null,
    rarity: null,
    minCost: '',
    maxCost: '',
    sortBy: 'id',
    sortDir: 'asc',
    missingOnly: false,
    ownedOnly: false,
    showAlts: false,
    setGroups: { BT: true, EX: true, ST: true, Andere: true }
  };

  let rootEl = null;
  let renderedCount = 0;
  let lastFilteredCards = [];
  let scrollObserver = null;
  const BATCH_SIZE = 120;

  function init(el) {
    rootEl = el;
    state.collection = Store.loadCollection();
    state.showAlts = !!Prefs.get('showAlts', false);
    const sg = Prefs.get('setGroups', null);
    if (sg && typeof sg === 'object') state.setGroups = Object.assign({ BT: true, EX: true, ST: true, Andere: true }, sg);
    render();
  }

  function render() {
    state.variantIdx = Store.buildVariantIndex(state.collection);
    rootEl.innerHTML = `
      <div class="flex flex-col md:flex-row gap-4">
        <aside class="w-full md:w-64 md:shrink-0">
          <h2 class="text-sm font-bold uppercase text-slate-400 mb-2">Sets</h2>
          <div class="mb-2 flex flex-wrap gap-2 text-xs">
            ${['BT','EX','ST','Andere'].map(k => `
              <label class="flex items-center gap-1">
                <input type="checkbox" data-set-group="${k}" ${state.setGroups[k] ? 'checked' : ''} />
                ${k}
              </label>
            `).join('')}
          </div>
          <div id="set-list" class="space-y-1 max-h-[40vh] md:max-h-[78vh] overflow-y-auto pr-2"></div>
        </aside>
        <div class="flex-1 min-w-0">
          <div id="stats-bar" class="mb-3"></div>
          <details class="mb-3" open>
            <summary class="md:hidden cursor-pointer text-sm text-slate-400 mb-2 select-none">Filter</summary>
            <div class="flex flex-wrap gap-2 items-center">
            <input id="search" type="text" placeholder="Suche Name oder ID…" value="${escapeAttr(state.query)}"
              class="bg-slate-800 border border-slate-600 rounded px-3 py-2 min-h-[40px] flex-1 min-w-[140px]" />

            <div id="color-pills" class="flex gap-1 flex-wrap"></div>

            <select id="filter-type" class="bg-slate-800 border border-slate-600 rounded px-2 py-2 min-h-[40px]">
              <option value="">Typ: alle</option>
              ${CardDB.types.map(t => `<option value="${t}" ${state.type === t ? 'selected' : ''}>${t}</option>`).join('')}
            </select>
            <select id="filter-rarity" class="bg-slate-800 border border-slate-600 rounded px-2 py-2 min-h-[40px]">
              <option value="">Rarity: alle</option>
              ${CardDB.rarities.map(r => `<option value="${r}" ${state.rarity === r ? 'selected' : ''}>${r}</option>`).join('')}
            </select>

            <div class="flex items-center gap-1">
              <span class="text-xs text-slate-400">Cost</span>
              <input id="min-cost" type="number" min="0" placeholder="min" value="${escapeAttr(state.minCost)}"
                class="w-14 bg-slate-800 border border-slate-600 rounded px-2 py-2 min-h-[40px]" />
              <span class="text-slate-500">–</span>
              <input id="max-cost" type="number" min="0" placeholder="max" value="${escapeAttr(state.maxCost)}"
                class="w-14 bg-slate-800 border border-slate-600 rounded px-2 py-2 min-h-[40px]" />
            </div>

            <select id="sort-by" class="bg-slate-800 border border-slate-600 rounded px-2 py-2 min-h-[40px]">
              <option value="id"    ${state.sortBy === 'id' ? 'selected' : ''}>Sort: ID</option>
              <option value="name"  ${state.sortBy === 'name' ? 'selected' : ''}>Sort: Name</option>
              <option value="level" ${state.sortBy === 'level' ? 'selected' : ''}>Sort: Level</option>
              <option value="cost"  ${state.sortBy === 'cost' ? 'selected' : ''}>Sort: Cost</option>
              <option value="price" ${state.sortBy === 'price' ? 'selected' : ''}>Sort: Preis (CM low)</option>
            </select>
            <button id="sort-dir" class="bg-slate-800 border border-slate-600 rounded px-2 py-2 min-h-[40px] w-10" title="Richtung">
              ${state.sortDir === 'asc' ? '▲' : '▼'}
            </button>

            <label class="flex items-center gap-2 text-sm">
              <input id="missing-only" type="checkbox" ${state.missingOnly ? 'checked' : ''} />
              Nur fehlende
            </label>
            <label class="flex items-center gap-2 text-sm">
              <input id="owned-only" type="checkbox" ${state.ownedOnly ? 'checked' : ''} />
              Nur im Besitz
            </label>
            <label class="flex items-center gap-2 text-sm" title="Alt-Arts als eigene Karten im Grid anzeigen">
              <input id="show-alts" type="checkbox" ${state.showAlts ? 'checked' : ''} />
              Alt-Arts einzeln
            </label>

            <button id="reset-filters" class="text-slate-400 hover:text-slate-200 text-sm ml-auto">Filter zurücksetzen</button>
            </div>
          </details>

          <div id="bulk-bar" class="mb-3"></div>

          <div id="card-grid" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-2 md:gap-3"></div>
          <div id="result-info" class="text-sm text-slate-400 mt-3"></div>
        </div>
      </div>
    `;

    renderSetList();
    renderColorPills();
    renderStats();
    renderBulkBar();
    renderGrid();
    wireFilters();
  }

  function wireFilters() {
    rootEl.querySelector('#search').addEventListener('input', debounce(e => {
      state.query = e.target.value;
      renderGrid(); renderStats();
    }, 200));
    rootEl.querySelector('#filter-type').addEventListener('change', e => {
      state.type = e.target.value || null; renderGrid(); renderStats();
    });
    rootEl.querySelector('#filter-rarity').addEventListener('change', e => {
      state.rarity = e.target.value || null; renderGrid(); renderStats();
    });
    rootEl.querySelector('#min-cost').addEventListener('input', debounce(e => {
      state.minCost = e.target.value; renderGrid(); renderStats();
    }, 200));
    rootEl.querySelector('#max-cost').addEventListener('input', debounce(e => {
      state.maxCost = e.target.value; renderGrid(); renderStats();
    }, 200));
    rootEl.querySelector('#sort-by').addEventListener('change', e => {
      state.sortBy = e.target.value; renderGrid();
    });
    rootEl.querySelector('#sort-dir').addEventListener('click', () => {
      state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      render();
    });
    rootEl.querySelector('#missing-only').addEventListener('change', e => {
      state.missingOnly = e.target.checked;
      if (state.missingOnly) {
        state.ownedOnly = false;
        rootEl.querySelector('#owned-only').checked = false;
      }
      renderGrid(); renderStats();
    });
    rootEl.querySelector('#owned-only').addEventListener('change', e => {
      state.ownedOnly = e.target.checked;
      if (state.ownedOnly) {
        state.missingOnly = false;
        rootEl.querySelector('#missing-only').checked = false;
      }
      renderGrid(); renderStats();
    });
    rootEl.querySelector('#show-alts').addEventListener('change', e => {
      state.showAlts = e.target.checked;
      Prefs.set('showAlts', state.showAlts);
      renderGrid(); renderStats();
    });
    rootEl.querySelector('#reset-filters').addEventListener('click', () => {
      state.query = '';
      state.colors = [];
      state.type = null;
      state.rarity = null;
      state.minCost = '';
      state.maxCost = '';
      state.missingOnly = false;
      state.ownedOnly = false;
      render();
    });
  }

  function renderColorPills() {
    const wrap = rootEl.querySelector('#color-pills');
    wrap.innerHTML = CardDB.colors.map(c => {
      const active = state.colors.includes(c);
      return `<button data-color="${c}" class="color-pill px-2 py-1 rounded text-xs font-bold color-${c} ${active ? 'ring-2 ring-amber-400' : 'opacity-60 hover:opacity-100'}">${c}</button>`;
    }).join('');
    wrap.querySelectorAll('.color-pill').forEach(btn => {
      btn.addEventListener('click', () => {
        const c = btn.dataset.color;
        if (state.colors.includes(c)) state.colors = state.colors.filter(x => x !== c);
        else state.colors = state.colors.concat([c]);
        renderColorPills(); renderGrid(); renderStats();
      });
    });
  }

  function setGroupOf(code) {
    if (!code) return null;
    if (/^BT/i.test(code)) return 'BT';
    if (/^EX/i.test(code)) return 'EX';
    if (/^ST/i.test(code)) return 'ST';
    return 'Andere';
  }

  function renderSetList() {
    // Checkbox-Listener (delegiert in der Sidebar)
    rootEl.querySelectorAll('[data-set-group]').forEach(cb => {
      if (cb.dataset.wired) return;
      cb.dataset.wired = '1';
      cb.addEventListener('change', e => {
        state.setGroups[cb.dataset.setGroup] = e.target.checked;
        Prefs.set('setGroups', state.setGroups);
        renderSetList();
      });
    });

    const setListEl = rootEl.querySelector('#set-list');
    const filtered = CardDB.sets.filter(s => state.setGroups[setGroupOf(s.code)] !== false);
    const items = [{ code: null, name: 'Alle Karten', count: CardDB.all.length }].concat(filtered);

    setListEl.innerHTML = items.map(s => {
      const active = state.selectedSet === s.code;
      const owned = ownedInSet(s.code);
      return `<button data-set="${s.code === null ? '' : s.code}"
        class="set-item w-full text-left px-3 py-2 rounded text-sm ${active ? 'bg-amber-500 text-slate-900' : 'hover:bg-slate-800'}">
        <div class="font-semibold flex justify-between"><span>${escapeHtml(s.code || 'ALL')}</span><span class="text-xs">${owned}/${s.count}</span></div>
        <div class="text-xs opacity-75 truncate" title="${escapeAttr(s.name)}">${escapeHtml(s.name)}</div>
      </button>`;
    }).join('');

    setListEl.querySelectorAll('.set-item').forEach(btn => {
      btn.addEventListener('click', () => {
        state.selectedSet = btn.dataset.set || null;
        render();
      });
    });
  }

  function ownedInSet(setCode) {
    const cards = setCode ? (CardDB.bySet.get(setCode) || []) : CardDB.all;
    const idx = state.variantIdx || Store.buildVariantIndex(state.collection);
    let owned = 0;
    for (const c of cards) {
      for (const v of CardDB.variantsOf(c)) {
        const s = idx[v.key];
        if (s && (s.real + s.proxy) > 0) { owned++; break; }
      }
    }
    return owned;
  }

  function renderStats() {
    const el = rootEl.querySelector('#stats-bar');
    const cards = filteredCards();
    const idx = state.variantIdx || Store.buildVariantIndex(state.collection);
    let ownedUnique = 0, totalCopies = 0, totalProxies = 0;
    for (const c of cards) {
      let realCopies = 0, proxyCopies = 0;
      for (const v of CardDB.variantsOf(c)) {
        const s = idx[v.key];
        if (s) { realCopies += s.real; proxyCopies += s.proxy; }
      }
      if (realCopies + proxyCopies > 0) ownedUnique++;
      totalCopies += realCopies;
      totalProxies += proxyCopies;
    }
    const setLabel = state.selectedSet || 'Alle Karten';
    el.innerHTML = `
      <div class="bg-slate-800 rounded p-3 flex flex-wrap gap-4 text-sm">
        <div><span class="text-slate-400">Set:</span> <span class="font-semibold">${escapeHtml(setLabel)}</span></div>
        <div><span class="text-slate-400">Sichtbar:</span> <span class="font-semibold">${cards.length}</span></div>
        <div><span class="text-slate-400">Davon besessen:</span> <span class="font-semibold text-amber-400">${ownedUnique}</span> <span class="text-slate-500">(${cards.length ? Math.round(ownedUnique / cards.length * 100) : 0}%)</span></div>
        <div><span class="text-slate-400">Kopien gesamt:</span> <span class="font-semibold">${totalCopies}</span></div>
        ${totalProxies > 0 ? `<div><span class="text-slate-400">Davon Proxy:</span> <span class="font-semibold text-purple-400">${totalProxies}</span></div>` : ''}
      </div>
    `;
  }

  function renderBulkBar() {
    const el = rootEl.querySelector('#bulk-bar');
    if (!state.selectedSet) { el.innerHTML = ''; return; }
    el.innerHTML = `
      <div class="bg-slate-800/50 border border-slate-700 rounded p-2 flex flex-wrap gap-2 items-center text-sm">
        <span class="text-slate-400">Bulk für Set <b>${escapeHtml(state.selectedSet)}</b>:</span>
        <button id="bulk-add"      class="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1 rounded">Alle +1 (Hauptvariante)</button>
        <button id="bulk-sub"      class="bg-slate-700 hover:bg-slate-600 px-3 py-1 rounded">Alle −1</button>
        <button id="bulk-clear"    class="bg-red-700 hover:bg-red-600 text-white px-3 py-1 rounded">Alle auf 0</button>
        <span class="text-xs text-slate-500 ml-2">Wirkt nur auf die im Set sichtbaren Hauptvarianten.</span>
      </div>
    `;
    el.querySelector('#bulk-add').addEventListener('click', () => bulk('add'));
    el.querySelector('#bulk-sub').addEventListener('click', () => bulk('sub'));
    el.querySelector('#bulk-clear').addEventListener('click', () => {
      if (!confirm(`Wirklich alle Hauptvarianten in ${state.selectedSet} auf 0 setzen?`)) return;
      bulk('clear');
    });
  }

  function bulk(op) {
    const cards = CardDB.bySet.get(state.selectedSet) || [];
    for (const c of cards) {
      const v = CardDB.mainVariantKey(c);
      const cur = Store.getCount(state.collection, v);
      if (op === 'add')      Store.setCount(state.collection, v, cur + 1);
      else if (op === 'sub') Store.setCount(state.collection, v, Math.max(0, cur - 1));
      else if (op === 'clear') Store.setCount(state.collection, v, 0);
    }
    Store.saveCollection(state.collection);
    renderGrid(); renderStats(); renderSetList();
  }

  function filteredCards() {
    return CardDB.search(state.query, {
      set: state.selectedSet,
      colors: state.colors,
      type: state.type,
      rarity: state.rarity,
      minCost: state.minCost,
      maxCost: state.maxCost,
      sortBy: state.sortBy,
      sortDir: state.sortDir
    });
  }

  // Erzeugt Render-Entries: bei showAlts eine Zeile pro Variant, sonst nur Main.
  function expandToEntries(cards) {
    const out = [];
    for (const card of cards) {
      if (state.showAlts) {
        const variants = CardDB.variantsOf(card);
        variants.forEach((v, idx) => {
          out.push({ card, variantKey: v.key, isAlt: v.isAlt, altIdx: idx });
        });
      } else {
        out.push({ card, variantKey: CardDB.mainVariantKey(card), isAlt: false, altIdx: 0 });
      }
    }
    const idx = state.variantIdx || Store.buildVariantIndex(state.collection);
    const variantOwned = k => { const s = idx[k]; return s ? (s.real + s.proxy) : 0; };
    if (state.missingOnly) {
      if (state.showAlts) {
        return out.filter(e => variantOwned(e.variantKey) === 0);
      }
      return out.filter(e => {
        for (const v of CardDB.variantsOf(e.card)) {
          if (variantOwned(v.key) > 0) return false;
        }
        return true;
      });
    }
    if (state.ownedOnly) {
      if (state.showAlts) {
        return out.filter(e => variantOwned(e.variantKey) > 0);
      }
      return out.filter(e => {
        for (const v of CardDB.variantsOf(e.card)) {
          if (variantOwned(v.key) > 0) return true;
        }
        return false;
      });
    }
    return out;
  }

  function renderGrid() {
    state.variantIdx = Store.buildVariantIndex(state.collection);
    lastFilteredCards = expandToEntries(filteredCards());
    renderedCount = 0;
    const grid = rootEl.querySelector('#card-grid');
    grid.innerHTML = '';
    appendNextBatch();
    setupScrollObserver();
  }

  function appendNextBatch() {
    const grid = rootEl.querySelector('#card-grid');
    const info = rootEl.querySelector('#result-info');
    if (!grid) return;

    const next = lastFilteredCards.slice(renderedCount, renderedCount + BATCH_SIZE);
    if (!next.length) {
      info.textContent = `${lastFilteredCards.length} ${state.showAlts ? 'Varianten' : 'Karten'}.`;
      return;
    }

    const frag = document.createElement('div');
    frag.innerHTML = next.map(entry => renderTile(entry)).join('');
    while (frag.firstChild) grid.appendChild(frag.firstChild);
    renderedCount += next.length;

    const label = state.showAlts ? 'Varianten' : 'Karten';
    info.textContent = renderedCount < lastFilteredCards.length
      ? `Zeige ${renderedCount} von ${lastFilteredCards.length} ${label} — scrolle für mehr.`
      : `${lastFilteredCards.length} ${label}.`;

    wireTileEvents(grid);
  }

  function wireTileEvents(grid) {
    grid.querySelectorAll('[data-action]:not([data-wired])').forEach(btn => {
      btn.dataset.wired = '1';
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const action = btn.dataset.action;
        const variant = btn.dataset.variant;
        if (action === 'proxy-inc' || action === 'proxy-dec') {
          const current = Store.getProxyCount(state.collection, variant);
          const delta = action === 'proxy-inc' ? 1 : -1;
          Store.setProxyCount(state.collection, variant, Math.max(0, current + delta));
        } else {
          const current = Store.getCount(state.collection, variant);
          const delta = action === 'inc' ? 1 : -1;
          Store.setCount(state.collection, variant, current + delta);
        }
        Store.saveCollection(state.collection);
        state.variantIdx = Store.buildVariantIndex(state.collection);
        updateTileCount(btn.closest('.card-tile'), variant);
        renderStats(); renderSetList();
      });
    });
    grid.querySelectorAll('[data-card-id]:not([data-tile-wired])').forEach(el => {
      el.dataset.tileWired = '1';
      el.addEventListener('click', e => {
        if (e.target.closest('[data-action]')) return;
        if (e.target.closest('[data-note-trigger]')) return;
        openCardModal(el.dataset.cardId);
      });
    });
    grid.querySelectorAll('[data-note-trigger]:not([data-note-wired])').forEach(btn => {
      btn.dataset.noteWired = '1';
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const tile = btn.closest('[data-card-id]');
        if (!tile) return;
        const cardId = tile.dataset.cardId;
        const card = CardDB.byId.get(cardId);
        Notes.openDialog({
          title: card ? card.name : cardId,
          subtitle: cardId,
          value: Store.getCardNote(state.collection, cardId),
          onSave: txt => {
            Store.setCardNote(state.collection, cardId, txt);
            Store.saveCollection(state.collection);
            document.dispatchEvent(new CustomEvent('collection-changed'));
            renderGrid();
          }
        });
      });
    });
  }

  function updateTileCount(tile, variantKey) {
    if (!tile) return;
    const count = Store.getCount(state.collection, variantKey);
    const proxy = Store.getProxyCount(state.collection, variantKey);
    const ownedTotal = count + proxy;

    const badge = tile.querySelector('.count-badge');
    if (badge) {
      badge.textContent = count;
      badge.classList.toggle('zero', count === 0 && proxy === 0);
      badge.classList.toggle('full', ownedTotal >= 4);
      const pillContainer = badge.parentElement;
      let proxyEl = pillContainer ? pillContainer.querySelector('.proxy-badge') : null;
      if (proxy > 0) {
        if (!proxyEl) {
          proxyEl = document.createElement('div');
          proxyEl.className = 'proxy-badge';
          pillContainer.insertBefore(proxyEl, badge);
        }
        proxyEl.textContent = `+${proxy}P`;
        proxyEl.title = `${proxy} Proxy`;
      } else if (proxyEl) {
        proxyEl.remove();
      }
    }

    if (state.showAlts) {
      tile.classList.toggle('missing', ownedTotal === 0);
      tile.classList.toggle('playset', ownedTotal >= 4);
    } else {
      const cardId = tile.dataset.cardId;
      const card = CardDB.byId.get(cardId);
      if (card) {
        let total = 0;
        for (const v of CardDB.variantsOf(card)) total += Store.getOwnedTotal(state.collection, v.key);
        tile.classList.toggle('missing', total === 0);
        tile.classList.toggle('playset', total >= 4);
      }
    }
  }

  function setupScrollObserver() {
    if (scrollObserver) scrollObserver.disconnect();
    const sentinel = ensureSentinel();
    scrollObserver = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) appendNextBatch();
      }
    }, { rootMargin: '600px' });
    scrollObserver.observe(sentinel);
  }

  function ensureSentinel() {
    let s = rootEl.querySelector('#grid-sentinel');
    if (!s) {
      s = document.createElement('div');
      s.id = 'grid-sentinel';
      s.style.height = '1px';
      rootEl.querySelector('#card-grid').after(s);
    }
    return s;
  }

  function renderPriceRow(cardId) {
    if (!window.CM || !CM.hasData()) return '';
    const p = CM.get(cardId);
    if (!p || p.low == null) return '';
    return `
      <div class="px-2 pt-1 text-[11px] font-mono leading-tight text-amber-400" title="Cardmarket low">
        CM: ${CM.fmt(p.low)}
      </div>
    `;
  }

  function renderTile(entry) {
    const card = entry.card;
    const variant = entry.variantKey;
    const idx = state.variantIdx || Store.buildVariantIndex(state.collection);
    const s = idx[variant] || { real: 0, proxy: 0, freeReal: 0, freeProxy: 0, assignedReal: 0, assignedProxy: 0 };
    const count = s.real;
    const proxy = s.proxy;
    const allVariants = CardDB.variantsOf(card);
    const altCount = allVariants.length - 1;

    let badge = '';
    if (state.showAlts) {
      if (entry.isAlt) {
        badge = `<div class="absolute top-1 left-1 bg-amber-500 text-slate-900 text-[10px] font-bold rounded px-1.5 py-0.5">Alt ${entry.altIdx}</div>`;
      } else {
        badge = `<div class="absolute top-1 left-1 bg-slate-700 text-slate-200 text-[10px] font-bold rounded px-1.5 py-0.5">Main</div>`;
      }
    } else if (altCount > 0) {
      badge = `<div class="absolute top-1 left-1 bg-slate-900/80 text-amber-400 text-[10px] font-bold rounded px-1.5 py-0.5">+${altCount} alt</div>`;
    }

    const ownedTileTotal = count + proxy;
    let totalOwnedAllVariants = 0;
    for (const v of allVariants) {
      const vs = idx[v.key];
      if (vs) totalOwnedAllVariants += vs.real + vs.proxy;
    }
    const missing = state.showAlts ? (ownedTileTotal === 0) : (totalOwnedAllVariants === 0);
    const playset = state.showAlts ? (ownedTileTotal >= 4) : (totalOwnedAllVariants >= 4);

    const note = Store.getCardNote(state.collection, card.id);
    const freeReal = s.freeReal;
    const inUseReal = Math.max(0, count - freeReal);
    return `
      <div class="card-tile ${missing ? 'missing' : ''} ${playset ? 'playset' : ''}" data-card-id="${escapeAttr(card.id)}" data-variant-key="${escapeAttr(variant)}">
        <img loading="lazy" src="${CardDB.imagePath(variant)}" alt="${escapeAttr(card.name)}" />
        ${badge}
        <span class="tile-note">${Notes.iconHtml(!!note)}</span>
        ${renderPriceRow(card.id)}
        <div class="p-2 pt-1 flex items-center gap-2">
          <div class="min-w-0 flex-1">
            <div class="text-xs font-mono text-slate-400 truncate">${escapeHtml(card.id)}${card.rarity ? ` <span class="text-slate-300">${escapeHtml(card.rarity)}</span>` : ''}${state.showAlts && entry.isAlt ? ` <span class="text-amber-400">·${entry.altIdx}</span>` : ''}</div>
            <div class="text-sm font-semibold truncate" title="${escapeAttr(card.name)}">${escapeHtml(card.name)}</div>
            ${count > 0 ? `<div class="text-[10px] text-slate-500" title="frei / in Decks">${freeReal} frei${inUseReal > 0 ? ` · ${inUseReal} in Decks` : ''}</div>` : ''}
          </div>
          <div class="flex items-center gap-1 shrink-0">
            ${proxy > 0 ? `<div class="proxy-badge" title="${proxy} Proxy">+${proxy}P</div>` : ''}
            <div class="count-badge ${count === 0 && proxy === 0 ? 'zero' : (ownedTileTotal >= 4 ? 'full' : '')}">${count}</div>
          </div>
        </div>
        <div class="qty-controls">
          <div class="qty-group proxy">
            <button data-action="proxy-dec" data-variant="${variant}" title="Proxy −">−</button>
            <button data-action="proxy-inc" data-variant="${variant}" title="Proxy +">+</button>
          </div>
          <div class="qty-group">
            <button data-action="dec" data-variant="${variant}" title="Echte Kopie −">−</button>
            <button data-action="inc" data-variant="${variant}" title="Echte Kopie +">+</button>
          </div>
        </div>
      </div>
    `;
  }

  function renderDeckUsage(card) {
    const decksState = Store.loadDecks();
    if (!decksState || !decksState.decks || !decksState.decks.length) return '';
    // Pro Deck eine Zeile mit allen Einträgen dieser Card (alle Varianten zusammen).
    const rows = [];
    for (const d of decksState.decks) {
      const matching = (d.entries || []).filter(e => e.cardId === card.id);
      if (!matching.length) continue;
      const lines = matching.map(e => {
        const assigned = (d.kind === 'wants') ? null : Store.assignedTo(state.collection, d.id, e.variant);
        const assignedReal = (d.kind === 'wants') ? null : Store.assignedRealTo(state.collection, d.id, e.variant);
        const assignedProxy = (d.kind === 'wants') ? null : Store.assignedProxyTo(state.collection, d.id, e.variant);
        if (d.kind === 'wants') {
          return `<span class="text-amber-400">${e.count}×</span> <span class="font-mono text-slate-400">${escapeHtml(e.variant)}</span>`;
        }
        const cls = assigned >= e.count ? 'text-emerald-400' : 'text-amber-400';
        const proxyTag = assignedProxy > 0 ? ` <span class="text-purple-400">+${assignedProxy}P</span>` : '';
        return `<span class="${cls}">${assignedReal}/${e.count}</span>${proxyTag} <span class="font-mono text-slate-400">${escapeHtml(e.variant)}</span>`;
      });
      const kindBadge = d.kind === 'wants'
        ? `<span class="bg-purple-700 text-purple-100 text-[10px] uppercase font-bold px-1.5 py-0.5 rounded">wants</span>`
        : d.kind === 'trade'
          ? `<span class="bg-slate-600 text-slate-100 text-[10px] uppercase font-bold px-1.5 py-0.5 rounded">trade</span>`
          : '';
      rows.push(`
        <div class="flex items-baseline gap-2 py-1 border-b border-slate-700 last:border-0">
          <span class="font-semibold flex-1 truncate" title="${escapeAttr(d.name)}">${escapeHtml(d.name)}</span>
          ${kindBadge}
          <span class="text-sm">${lines.join(' · ')}</span>
        </div>
      `);
    }
    if (!rows.length) {
      return `<div class="bg-slate-900 rounded p-3 mb-3 text-sm text-slate-500">In keinem Deck.</div>`;
    }
    return `
      <div class="bg-slate-900 rounded p-3 mb-3">
        <div class="text-xs uppercase text-slate-400 font-bold mb-2">In Decks (${rows.length})</div>
        ${rows.join('')}
      </div>
    `;
  }

  function openCardModal(cardId) {
    const card = CardDB.byId.get(cardId);
    if (!card) return;
    // Falls von anderen Tabs aufgerufen: aktuellen Sammlungs-Stand laden.
    if (!state.collection) state.collection = Store.loadCollection();
    const variants = CardDB.variantsOf(card);
    const colorPills = (card.color || []).map(c => `<span class="color-${c} px-2 py-0.5 rounded text-xs font-bold">${c}</span>`).join(' ');
    const effect = card.effect || (card.raw && card.raw.main_effect) || '';

    const cols = Math.min(variants.length, 3);
    const html = `
      <div class="modal-backdrop" id="card-modal">
        <div class="modal-content w-[920px] max-w-[95vw]">
          <div class="flex justify-between items-start mb-3">
            <div>
              <div class="text-xs font-mono text-slate-400">${escapeHtml(card.id)} · ${escapeHtml(card.set)} · ${escapeHtml(card.rarity || '')}</div>
              <h2 class="text-2xl font-bold">${escapeHtml(card.name)}</h2>
              <div class="flex gap-2 mt-1 text-xs flex-wrap">
                ${colorPills}
                ${card.type ? `<span class="bg-slate-700 px-2 py-0.5 rounded">${escapeHtml(card.type)}</span>` : ''}
                ${card.level != null ? `<span class="bg-slate-700 px-2 py-0.5 rounded">Lv ${card.level}</span>` : ''}
                ${card.cost != null ? `<span class="bg-slate-700 px-2 py-0.5 rounded">Cost ${card.cost}</span>` : ''}
              </div>
            </div>
            <button id="modal-close" class="text-slate-400 hover:text-white text-2xl leading-none">×</button>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-${cols} gap-3 mb-4" id="variants-grid">
            ${variants.map(v => `
              <div class="bg-slate-900 rounded p-2" data-variant-block="${escapeAttr(v.key)}">
                <img src="${CardDB.imagePath(v.key)}" loading="lazy" class="w-1/2 mx-auto aspect-[5/7] object-cover rounded mb-2" alt="" />
                <div class="text-xs font-mono text-slate-400 mb-2">${escapeHtml(v.key)} ${v.isAlt ? '· Alt' : '· Main'}</div>
                <div data-variant-body="${escapeAttr(v.key)}">${renderVariantBody(v.key)}</div>
              </div>
            `).join('')}
          </div>

          ${renderDeckUsage(card)}
          ${effect ? `<div class="bg-slate-900 rounded p-3 text-sm whitespace-pre-wrap leading-relaxed">${escapeHtml(effect)}</div>` : ''}
        </div>
      </div>
    `;

    const modalRoot = document.getElementById('modal-root');
    modalRoot.innerHTML = html;

    const close = () => {
      modalRoot.innerHTML = '';
      if (rootEl && rootEl.querySelector('#card-grid')) {
        renderGrid(); renderStats(); renderSetList();
      }
      document.dispatchEvent(new CustomEvent('collection-changed'));
    };
    modalRoot.querySelector('#modal-close').addEventListener('click', close);
    modalRoot.querySelector('#card-modal').addEventListener('click', e => {
      if (e.target.id === 'card-modal') close();
    });

    wireVariantBlocks(modalRoot);
  }

  function renderVariantBody(variantKey) {
    const prices = Store.getPrices(state.collection, variantKey);
    const count = prices.length;
    const proxy = Store.getProxyCount(state.collection, variantKey);
    const pricedSum = prices.reduce((s, p) => s + (p || 0), 0);
    const unknown = prices.filter(p => p == null).length;

    const rows = prices.map((p, i) => `
      <div class="flex items-center gap-1">
        <input type="text" data-price-edit="${i}" value="${p == null ? '' : p.toFixed(2).replace('.', ',')}"
          placeholder="–"
          class="bg-slate-800 border border-slate-700 rounded px-2 py-1 w-20 text-sm text-right font-mono" />
        <span class="text-xs text-slate-500">€</span>
        <button data-price-del="${i}" class="ml-auto text-slate-500 hover:text-red-400 px-1" title="Kopie entfernen">×</button>
      </div>
    `).join('');

    return `
      <div class="text-xs text-slate-300 mb-2">
        <span class="font-bold text-base text-amber-400">${count}</span> Kopien
        ${count > 0 ? ` · ${Fmt.eur(pricedSum)}${unknown ? ` (${unknown} unbekannt)` : ''}` : ''}
      </div>
      <div class="space-y-1 mb-2">${rows}</div>
      <div class="flex items-center gap-1 mb-3">
        <input type="text" data-price-new placeholder="Preis"
          class="bg-slate-800 border border-slate-700 rounded px-2 py-1 w-20 text-sm text-right font-mono" />
        <span class="text-xs text-slate-500">€</span>
        <button data-price-add class="ml-auto bg-emerald-600 hover:bg-emerald-500 text-white px-2 py-1 rounded text-xs font-semibold">+ Kopie</button>
      </div>
      <div class="border-t border-slate-700 pt-2 flex items-center gap-2">
        <span class="text-xs text-slate-400">Proxies:</span>
        <button data-proxy-dec class="bg-slate-700 hover:bg-slate-600 w-7 h-7 rounded font-bold">−</button>
        <span class="font-bold text-base ${proxy > 0 ? 'text-purple-400' : 'text-slate-500'}">${proxy}</span>
        <button data-proxy-inc class="bg-slate-700 hover:bg-slate-600 w-7 h-7 rounded font-bold">+</button>
      </div>
    `;
  }

  function wireVariantBlocks(modalRoot) {
    modalRoot.querySelectorAll('[data-variant-block]').forEach(block => {
      const variantKey = block.dataset.variantBlock;
      wireBlock(block, variantKey);
    });
  }

  function wireBlock(block, variantKey) {
    const body = block.querySelector(`[data-variant-body="${cssEscape(variantKey)}"]`);
    if (!body) return;

    body.querySelectorAll('[data-price-del]').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.dataset.priceDel);
        Store.removePriceAt(state.collection, variantKey, idx);
        Store.saveCollection(state.collection);
        refreshVariant(block, variantKey);
      });
    });

    body.querySelectorAll('[data-price-edit]').forEach(input => {
      input.addEventListener('change', () => {
        const idx = Number(input.dataset.priceEdit);
        const price = Fmt.parseEUR(input.value);
        Store.setPriceAt(state.collection, variantKey, idx, price);
        Store.saveCollection(state.collection);
        refreshVariant(block, variantKey);
      });
    });

    const addBtn = body.querySelector('[data-price-add]');
    const newInput = body.querySelector('[data-price-new]');
    if (addBtn && newInput) {
      const doAdd = () => {
        const price = Fmt.parseEUR(newInput.value);
        Store.addPrice(state.collection, variantKey, price);
        Store.saveCollection(state.collection);
        refreshVariant(block, variantKey);
      };
      addBtn.addEventListener('click', doAdd);
      newInput.addEventListener('keydown', e => { if (e.key === 'Enter') doAdd(); });
    }

    const proxyInc = body.querySelector('[data-proxy-inc]');
    const proxyDec = body.querySelector('[data-proxy-dec]');
    if (proxyInc) proxyInc.addEventListener('click', () => {
      const cur = Store.getProxyCount(state.collection, variantKey);
      Store.setProxyCount(state.collection, variantKey, cur + 1);
      Store.saveCollection(state.collection);
      refreshVariant(block, variantKey);
    });
    if (proxyDec) proxyDec.addEventListener('click', () => {
      const cur = Store.getProxyCount(state.collection, variantKey);
      Store.setProxyCount(state.collection, variantKey, Math.max(0, cur - 1));
      Store.saveCollection(state.collection);
      refreshVariant(block, variantKey);
    });
  }

  function refreshVariant(block, variantKey) {
    state.variantIdx = Store.buildVariantIndex(state.collection);
    const body = block.querySelector(`[data-variant-body="${cssEscape(variantKey)}"]`);
    body.innerHTML = renderVariantBody(variantKey);
    wireBlock(block, variantKey);
    // Hintergrund-Tiles aktualisieren — bei showAlts kann's mehrere Tiles pro Card geben.
    const info = CardDB.allVariants.get(variantKey);
    if (info) {
      rootEl.querySelectorAll('.card-tile').forEach(t => {
        if (t.dataset.cardId === info.cardId) {
          const tileVariant = t.dataset.variantKey || variantKey;
          updateTileCount(t, tileVariant);
        }
      });
    }
    renderStats();
    renderSetList();
  }

  function cssEscape(s) {
    return String(s).replace(/[^a-zA-Z0-9_-]/g, ch => '\\' + ch);
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

  window.UICollection = { init, openCardModal };
})();
