// Trade-Tab: Auswertung der als Trade markierten Listen (kind='trade').
// Aufbau analog zum Wants-Tab, aber ohne Main Wants — nur explizite Trade-Listen.

(function () {
  let rootEl = null;
  let query = '';   // freie Textsuche (Name / ID / Variant), nicht persistiert
  const PREF_KEY = 'tradeSelectedLists';
  const SORT_KEY = 'tradeSort';
  const VIEW_KEY = 'tradeView';
  const BUCKET_KEY = 'tradeBuckets';

  // Preis-Buckets auf Basis Cardmarket low.
  const BUCKETS = [
    { key: 'lt20', label: '0–0,20 €', color: '#10b981', test: p => p != null && p <= 0.20 },
    { key: 'lt1',  label: '0,20–1 €', color: '#eab308', test: p => p != null && p <= 1.00 },
    { key: 'lt5',  label: '1–5 €',    color: '#f97316', test: p => p != null && p <= 5.00 },
    { key: 'ge5',  label: '5 €+',     color: '#ef4444', test: p => p != null && p > 5.00 },
    { key: 'none', label: 'ohne Preis', color: '#64748b', test: p => p == null }
  ];
  const BUCKET_COLOR = Object.fromEntries(BUCKETS.map(b => [b.key, b.color]));

  function init(el) {
    rootEl = el;
    render();
  }

  // --- Quellen -------------------------------------------------------------

  function tradeLists() {
    const decks = Store.loadDecks().decks || [];
    return decks.filter(d => d.kind === 'trade');
  }

  function candidateLists() {
    return tradeLists();
  }

  // Ausgewählte Quellen-IDs (Default: alle Trade-Listen).
  function selectedIds(lists) {
    const stored = Prefs.get(PREF_KEY, null);
    const existing = new Set(lists.map(l => l.id));
    if (!Array.isArray(stored)) return new Set(existing);
    return new Set(stored.filter(id => existing.has(id)));
  }

  function cmLow(cardId) {
    if (!window.CM || !CM.hasData()) return null;
    const p = CM.get(cardId);
    return (p && p.low != null) ? p.low : null;
  }

  function bucketOf(price) {
    return (BUCKETS.find(b => b.test(price)) || BUCKETS[BUCKETS.length - 1]).key;
  }

  function bucketTotals(lists, selected) {
    const totals = {};
    for (const b of BUCKETS) totals[b.key] = { value: 0, count: 0 };
    for (const list of lists) {
      if (!selected.has(list.id)) continue;
      for (const e of (list.entries || [])) {
        const price = cmLow(e.cardId);
        const t = totals[bucketOf(price)];
        t.count += e.count;
        if (price != null) t.value += price * e.count;
      }
    }
    return totals;
  }

  function activeBuckets() {
    const stored = Prefs.get(BUCKET_KEY, null);
    const all = BUCKETS.map(b => b.key);
    if (!Array.isArray(stored)) return new Set(all);
    return new Set(stored.filter(k => all.includes(k)));
  }

  const RARITY_RANK = {
    c: 1, common: 1,
    u: 2, uncommon: 2,
    r: 3, rare: 3,
    sr: 4, 'super rare': 4,
    sec: 5, 'secret rare': 5,
    ur: 6, 'ultra rare': 6,
    p: 7, promo: 7
  };
  function rarityRank(r) {
    return RARITY_RANK[String(r || '').toLowerCase()] || 0;
  }

  // Aggregiert die Einträge der ausgewählten Trade-Listen pro Set.
  function collectBySet(lists, selected) {
    const setOrder = new Map(CardDB.sets.map((s, i) => [s.code, i]));
    const setName = new Map(CardDB.sets.map(s => [s.code, s.name]));

    const active = activeBuckets();
    const sets = new Map(); // setCode -> block
    lists.forEach((list, listIdx) => {
      if (!selected.has(list.id)) return;
      for (const e of (list.entries || [])) {
        const card = CardDB.byId.get(e.cardId);
        const setCode = card ? card.set : '—';
        const rarity = (card && card.rarity) || '—';
        const name = displayName(card, e.cardId);
        if (!matchesQuery(name, e.cardId, e.variant)) continue; // Textsuche
        const price = cmLow(e.cardId);
        const bk = bucketOf(price);
        if (!active.has(bk)) continue; // ausgeblendete Preisspanne

        let block = sets.get(setCode);
        if (!block) {
          block = { code: setCode, name: setName.get(setCode) || setCode, total: 0, perRarity: new Map(), perBucket: new Map(), groups: new Map(), _agg: new Map() };
          sets.set(setCode, block);
        }
        block.total += e.count;
        block.perRarity.set(rarity, (block.perRarity.get(rarity) || 0) + e.count);
        block.perBucket.set(bk, (block.perBucket.get(bk) || 0) + e.count);

        let g = block.groups.get(list.id);
        if (!g) { g = { listId: list.id, listName: list.name, editable: true, order: listIdx, items: [] }; block.groups.set(list.id, g); }
        g.items.push({ cardId: e.cardId, variant: e.variant, count: e.count, name, rarity, price });

        let a = block._agg.get(e.variant);
        if (!a) { a = { cardId: e.cardId, variant: e.variant, count: 0, name, rarity, price }; block._agg.set(e.variant, a); }
        a.count += e.count;
      }
    });

    const sortMode = Prefs.get(SORT_KEY, 'price-desc');
    const itemCmp = (a, c) => {
      if (sortMode === 'price-desc') {
        if (a.price == null && c.price == null) return a.variant.localeCompare(c.variant);
        if (a.price == null) return 1;
        if (c.price == null) return -1;
        if (a.price !== c.price) return c.price - a.price;
        return a.variant.localeCompare(c.variant);
      }
      if (sortMode === 'rarity') {
        const ra = rarityRank(a.rarity), rc = rarityRank(c.rarity);
        if (ra !== rc) return rc - ra;
        return a.variant.localeCompare(c.variant);
      }
      return a.variant.localeCompare(c.variant);
    };

    const blocks = Array.from(sets.values());
    for (const b of blocks) {
      b.groups = Array.from(b.groups.values()).sort((x, y) => x.order - y.order);
      b.groups.forEach(g => g.items.sort(itemCmp));
      b.items = Array.from(b._agg.values()).sort(itemCmp); // für Export
      delete b._agg;
    }
    blocks.sort((a, b) => {
      const ai = setOrder.has(a.code) ? setOrder.get(a.code) : Infinity;
      const bi = setOrder.has(b.code) ? setOrder.get(b.code) : Infinity;
      if (ai !== bi) return ai - bi;
      return a.code.localeCompare(b.code);
    });
    return blocks;
  }

  // --- Rendering -----------------------------------------------------------

  function render() {
    const lists = candidateLists();
    const selected = selectedIds(lists);

    if (!lists.length) {
      rootEl.innerHTML = `
        <div class="bg-slate-800 rounded p-4 text-slate-300">
          Keine Trade-Listen vorhanden. Lege im Tab „Decks &amp; Lists" eine Liste
          vom Typ <span class="font-mono">trade</span> an, um hier eine Auswertung zu sehen.
        </div>`;
      return;
    }

    const listChips = lists.map(l => {
      const n = (l.entries || []).reduce((s, e) => s + e.count, 0);
      return `<label class="flex items-center gap-2 bg-slate-900 border border-slate-600 rounded px-2 py-1 text-sm cursor-pointer">
        <input type="checkbox" data-list-id="${escapeAttr(l.id)}" ${selected.has(l.id) ? 'checked' : ''} />
        <span>${escapeHtml(l.name)}</span>
        <span class="text-slate-500 text-xs">${n}</span>
      </label>`;
    }).join('');

    const active = activeBuckets();
    const totals = bucketTotals(lists, selected);
    const bucketChips = BUCKETS.map(b => {
      const t = totals[b.key];
      const sum = b.key === 'none' ? `(${t.count})` : `${Fmt.eur(t.value)} (${t.count})`;
      return `<label class="flex items-center gap-1.5 bg-slate-900 border border-slate-600 rounded px-2 py-1 text-xs cursor-pointer">
        <input type="checkbox" data-bucket="${b.key}" ${active.has(b.key) ? 'checked' : ''} />
        <span class="inline-block w-2.5 h-2.5 rounded-full" style="background:${b.color}"></span>
        <span class="flex flex-col leading-tight">
          <span>${b.label}</span>
          <span class="text-slate-500">${sum}</span>
        </span>
      </label>`;
    }).join('');

    rootEl.innerHTML = `
      <div class="bg-slate-800 rounded p-3 mb-3">
        <div class="flex items-center gap-2 flex-wrap">
          <h2 class="text-xl font-bold">Trade</h2>
          <input id="trade-search" type="text" placeholder="Suche Name / ID…" value="${escapeAttr(query)}"
            class="bg-slate-900 border border-slate-600 rounded px-3 py-1.5 text-sm flex-1 min-w-[160px]" />
          <label class="text-xs text-slate-400 flex items-center gap-1">
            Ansicht:
            <select id="trade-view" class="bg-slate-900 border border-slate-600 rounded px-2 py-1 text-sm">
              <option value="text"   ${Prefs.get(VIEW_KEY, 'text') === 'text'   ? 'selected' : ''}>Text</option>
              <option value="images" ${Prefs.get(VIEW_KEY, 'text') === 'images' ? 'selected' : ''}>Bilder</option>
            </select>
          </label>
          <label class="text-xs text-slate-400 flex items-center gap-1">
            Sortieren:
            <select id="trade-sort" class="bg-slate-900 border border-slate-600 rounded px-2 py-1 text-sm">
              <option value="id"         ${Prefs.get(SORT_KEY, 'price-desc') === 'id'         ? 'selected' : ''}>ID</option>
              <option value="price-desc" ${Prefs.get(SORT_KEY, 'price-desc') === 'price-desc' ? 'selected' : ''}>Preis ↓</option>
              <option value="rarity"     ${Prefs.get(SORT_KEY, 'price-desc') === 'rarity'     ? 'selected' : ''}>Rarity</option>
            </select>
          </label>
          <div class="text-sm text-slate-400" id="trade-count"></div>
        </div>
        <div class="text-xs text-slate-400 mt-2 mb-1">Einbezogene Trade-Listen:</div>
        <div class="flex flex-wrap gap-2" id="trade-lists">${listChips}</div>
        <div class="text-xs text-slate-400 mt-2 mb-1">Preisspannen:</div>
        <div class="flex flex-wrap gap-2" id="trade-buckets">${bucketChips}</div>
      </div>
      <div id="trade-sets" class="columns-1 lg:columns-2 [column-gap:0.75rem]"></div>`;

    wire();
    renderSets();
  }

  // Rendert nur den Karten-Bereich (#trade-sets) + Zähler. Auch bei Sucheingabe,
  // ohne die Toolbar (und das Suchfeld) neu zu bauen.
  function renderSets() {
    const lists = candidateLists();
    const selected = selectedIds(lists);
    const blocks = collectBySet(lists, selected);
    const grandTotal = blocks.reduce((s, b) => s + b.total, 0);
    const cnt = rootEl.querySelector('#trade-count');
    if (cnt) cnt.textContent = `${blocks.length} Sets · ${grandTotal} Karten`;
    const host = rootEl.querySelector('#trade-sets');
    if (host) host.innerHTML = blocks.length
      ? blocks.map(renderSetBlock).join('')
      : `<div class="bg-slate-800 rounded p-4 text-slate-400">${query ? 'Keine Treffer für die Suche.' : 'Keine Karten in der Auswahl.'}</div>`;
    wireSets();
  }

  function renderSetBlock(block) {
    const rarityPills = Array.from(block.perRarity.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([r, n]) => `<span class="inline-block bg-slate-700 rounded px-2 py-0.5 text-xs">${escapeHtml(CardDB.rarityShort(r))}: <span class="font-semibold">${n}</span></span>`)
      .join(' ');

    const bucketPills = BUCKETS
      .filter(b => (block.perBucket.get(b.key) || 0) > 0)
      .map(b => `<span class="inline-block bg-slate-700 rounded px-2 py-0.5 text-xs">${b.label}: <span class="font-semibold">${block.perBucket.get(b.key)}</span></span>`)
      .join(' ');

    const view = Prefs.get(VIEW_KEY, 'text');
    const groupsHtml = block.groups.map(g => renderGroup(g, view)).join('');

    return `
      <div class="bg-slate-800 rounded p-3 mb-3 break-inside-avoid" data-set-block="${escapeAttr(block.code)}">
        <div class="flex items-center gap-2 flex-wrap mb-2">
          <h3 class="text-lg font-bold">
            <span class="font-mono text-amber-400">${escapeHtml(block.code)}</span>
            <span class="text-slate-300 font-normal text-sm">${escapeHtml(block.name)}</span>
          </h3>
          <span class="text-sm text-slate-400">${block.total} Karten</span>
          <div class="ml-auto flex gap-2">
            <button data-export-list="${escapeAttr(block.code)}" class="bg-emerald-500 hover:bg-emerald-400 text-slate-900 px-3 py-1.5 rounded text-sm font-semibold">Als Liste</button>
          </div>
        </div>
        <div class="flex flex-wrap gap-1.5 mb-1"><span class="text-xs text-slate-500 mr-1">Rarity:</span>${rarityPills}</div>
        <div class="flex flex-wrap gap-1.5 mb-3"><span class="text-xs text-slate-500 mr-1">Preis:</span>${bucketPills}</div>
        ${groupsHtml}
      </div>`;
  }

  function renderGroup(group, view) {
    const groupTotal = group.items.reduce((s, it) => s + it.count, 0);
    const head = `<div class="flex items-center gap-2 mt-3 mb-1">
        <span class="text-sm font-semibold text-slate-200">${escapeHtml(group.listName)}</span>
        <span class="text-xs text-slate-500">${groupTotal} Karten</span>
      </div>`;

    const markBrackets = Prefs.get(SORT_KEY, 'price-desc') === 'price-desc';
    let prevBucket = null;
    const body = view === 'images'
      ? `<div class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-6 gap-2">${group.items.map(it => renderImageTile(it, group)).join('')}</div>`
      : `<table class="wants-table"><tbody>${group.items.map((it, i) => {
          let color = null;
          if (markBrackets) {
            const bk = bucketOf(it.price);
            if (i > 0 && bk !== prevBucket) color = BUCKET_COLOR[bk];
            prevBucket = bk;
          }
          return renderTextRow(it, group, color);
        }).join('')}</tbody></table>`;

    return head + body;
  }

  function renderImageTile(it, group) {
    const pText = (window.CM && CM.fmtLowTrend) ? CM.fmtLowTrend(CM.getForVariant(it.variant)) : null;
    const priceRow = pText
      ? `<div class="px-2 pt-1 text-[11px] font-mono leading-tight text-amber-400" title="Cardmarket low / trend">${pText}</div>`
      : `<div class="px-2 pt-1 text-[11px] font-mono leading-tight text-slate-500" title="Kein Cardmarket-Preis">CM</div>`;
    const key = `${group.listId}|${it.cardId}|${it.variant}`;
    const controls = group.editable
      ? `<div class="qty-controls"><div class="qty-group">
          <button data-trade-dec="${escapeAttr(key)}" title="Anzahl −">−</button>
          <button data-trade-inc="${escapeAttr(key)}" title="Anzahl +">+</button>
        </div></div>`
      : '';
    return `
      <div class="card-tile cursor-pointer" data-card-id="${escapeAttr(it.cardId)}" data-variant-key="${escapeAttr(it.variant)}">
        <img loading="lazy" src="${CardDB.imagePath(it.variant)}" alt="${escapeAttr(it.name)}" />
        ${priceRow}
        <div class="p-2 pt-1 flex items-center gap-2">
          <div class="min-w-0 flex-1">
            <div class="text-xs font-mono text-slate-400 truncate">${escapeHtml(it.variant)}${it.rarity ? ` <span class="text-slate-300">${escapeHtml(CardDB.rarityShort(it.rarity))}</span>` : ''}</div>
            <div class="text-sm font-semibold truncate" title="${escapeAttr(it.name)}">${escapeHtml(it.name)}</div>
          </div>
          <div class="count-badge shrink-0">${it.count}</div>
        </div>
        ${controls}
      </div>`;
  }

  function renderTextRow(it, group, bracketColor) {
    const priceTxt = (window.CM && CM.fmtLowTrend) ? (CM.fmtLowTrend(CM.getForVariant(it.variant)) || 'CM') : (it.price != null ? CM.fmt(it.price) : '—');
    const key = `${group.listId}|${it.cardId}|${it.variant}`;
    const qty = group.editable
      ? `<span class="inline-flex items-center gap-1">
          <button data-trade-dec="${escapeAttr(key)}" class="wants-qty-btn" title="Anzahl −">−</button>
          <span class="font-bold text-amber-400 w-6 text-center tabular-nums">${it.count}</span>
          <button data-trade-inc="${escapeAttr(key)}" class="wants-qty-btn" title="Anzahl +">+</button>
        </span>`
      : `<span class="font-bold text-amber-400 tabular-nums">${it.count}×</span>`;
    const rowCls = bracketColor ? ' wants-bracket-start' : '';
    const rowStyle = bracketColor ? ` style="--bracket-color:${bracketColor}"` : '';
    return `<tr class="wants-row group cursor-pointer hover:bg-slate-700/60${rowCls}" data-card-id="${escapeAttr(it.cardId)}"${rowStyle}>
        <td class="py-1 pr-4 whitespace-nowrap">${qty}</td>
        <td class="py-1 pr-4 relative"><span class="block truncate max-w-[22rem]" title="${escapeAttr(it.name)}">${escapeHtml(it.name)}</span><img class="wants-preview" loading="lazy" src="${CardDB.imagePath(it.variant)}" alt="${escapeAttr(it.name)}" /></td>
        <td class="py-1 pr-4 font-mono text-slate-400 text-xs whitespace-nowrap">${escapeHtml(it.variant)}</td>
        <td class="py-1 pr-4 text-slate-500 text-xs whitespace-nowrap">${escapeHtml(CardDB.rarityShort(it.rarity))}</td>
        <td class="py-1 text-slate-400 text-xs tabular-nums text-right whitespace-nowrap">${priceTxt}</td>
      </tr>`;
  }

  // --- Events --------------------------------------------------------------

  function wire() {
    const viewSel = rootEl.querySelector('#trade-view');
    if (viewSel) viewSel.addEventListener('change', e => {
      Prefs.set(VIEW_KEY, e.target.value);
      render();
    });

    const sortSel = rootEl.querySelector('#trade-sort');
    if (sortSel) sortSel.addEventListener('change', e => {
      Prefs.set(SORT_KEY, e.target.value);
      render();
    });

    rootEl.querySelectorAll('#trade-lists input[data-list-id]').forEach(cb => {
      cb.addEventListener('change', () => {
        const checked = Array.from(rootEl.querySelectorAll('#trade-lists input[data-list-id]'))
          .filter(c => c.checked).map(c => c.dataset.listId);
        Prefs.set(PREF_KEY, checked);
        render();
      });
    });

    rootEl.querySelectorAll('#trade-buckets input[data-bucket]').forEach(cb => {
      cb.addEventListener('change', () => {
        const checked = Array.from(rootEl.querySelectorAll('#trade-buckets input[data-bucket]'))
          .filter(c => c.checked).map(c => c.dataset.bucket);
        Prefs.set(BUCKET_KEY, checked);
        render();
      });
    });

    const searchEl = rootEl.querySelector('#trade-search');
    if (searchEl) searchEl.addEventListener('input', debounce(() => {
      query = searchEl.value;
      renderSets(); // nur Karten-Bereich neu rendern → Suchfeld behält Fokus
    }, 200));
  }

  // Listener innerhalb von #trade-sets (bei jedem renderSets() neu gesetzt).
  function wireSets() {
    rootEl.querySelectorAll('[data-trade-inc]').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); modifyTrade(btn.dataset.tradeInc, 1); });
    });
    rootEl.querySelectorAll('[data-trade-dec]').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); modifyTrade(btn.dataset.tradeDec, -1); });
    });

    rootEl.querySelectorAll('.card-tile[data-card-id], .wants-row[data-card-id]').forEach(el => {
      el.addEventListener('click', e => {
        if (e.target.closest('[data-trade-inc], [data-trade-dec]')) return;
        if (window.UICollection && typeof UICollection.openCardModal === 'function') {
          UICollection.openCardModal(el.dataset.cardId, el.dataset.variantKey);
        }
      });
    });

    rootEl.querySelectorAll('[data-export-list]').forEach(btn => {
      btn.addEventListener('click', () => exportSetAsList(btn.dataset.exportList));
    });
  }

  // Passt die Anzahl in einer konkreten Trade-Liste an. key = "listId|cardId|variant".
  function modifyTrade(key, delta) {
    const sep = key.indexOf('|');
    const listId = key.slice(0, sep);
    const rest = key.slice(sep + 1);
    const sep2 = rest.indexOf('|');
    const cardId = rest.slice(0, sep2);
    const variant = rest.slice(sep2 + 1);

    const decksState = Store.loadDecks();
    const deck = (decksState.decks || []).find(d => d.id === listId);
    if (!deck) return;
    Store.addToDeck(deck, cardId, variant, delta);
    Store.saveDecks(decksState);
    render();
  }

  // --- Export --------------------------------------------------------------

  function blockFor(setCode) {
    const lists = candidateLists();
    const selected = selectedIds(lists);
    return collectBySet(lists, selected).find(b => b.code === setCode) || null;
  }

  function exportSetAsList(setCode) {
    const block = blockFor(setCode);
    if (!block) return;
    const text = block.items.map(it => `${it.count}x ${it.name} (${it.variant})`).join('\n') + '\n';
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => alert(`Liste „${setCode}" (${block.items.length} Karten) in die Zwischenablage kopiert.`))
        .catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
  }

  function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); alert('In die Zwischenablage kopiert.'); }
    catch (e) { alert('Kopieren fehlgeschlagen. Bitte manuell markieren:\n\n' + text); }
    document.body.removeChild(ta);
  }

  // --- Helpers -------------------------------------------------------------

  function displayName(card, fallback) {
    if (card) return CardDB.cleanDisplayName(card);
    return fallback;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s).replace(/'/g, '&#39;'); }

  function matchesQuery(name, cardId, variant) {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (name + ' ' + cardId + ' ' + variant).toLowerCase().includes(q);
  }
  function debounce(fn, ms) {
    let t;
    return function (...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); };
  }

  // Live-Refresh: Trade-Listen sind Decks (decks-changed). Besitz ist hier
  // irrelevant, daher kein collection-changed. Nur bei sichtbarem Tab rendern,
  // RAF-gebündelt gegen Mehrfach-Renders.
  let pendingRefresh = false;
  document.addEventListener('decks-changed', () => {
    if (!rootEl) return;
    const panel = document.getElementById('tab-trade');
    if (panel && panel.classList.contains('hidden')) return;
    if (pendingRefresh) return;
    pendingRefresh = true;
    requestAnimationFrame(() => { pendingRefresh = false; render(); });
  });

  window.UITrade = { init };
})();
