// Wants-Tab: Auswertung von Wants-Quellen (explizite kind='wants'-Listen sowie
// die berechneten „Main Wants").
//
// Aggregiert die Einträge ausgewählter Quellen direkt pro Set, gruppiert nach
// Rarity und nach Preis-Buckets (Cardmarket low). Anzeige als Textliste oder
// Bilder-Grid. Export pro Set als einfache Textliste ("4x Agumon (BT24-011)").

(function () {
  let rootEl = null;
  let query = '';   // freie Textsuche (Name / ID / Variant), nicht persistiert
  const PREF_KEY = 'wantsSelectedLists';
  const SORT_KEY = 'wantsSort';
  const VIEW_KEY = 'wantsView';
  const BUCKET_KEY = 'wantsBuckets';
  const GROUP_KEY = 'wantsGroupBy';   // 'source' (Quell-Liste) | 'rarity'

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

  function wantsLists() {
    const decks = Store.loadDecks().decks || [];
    return decks.filter(d => d.kind === 'wants');
  }

  // Alle ankreuzbaren Quellen sind die expliziten Wants-Listen.
  // Main Wants ist nur noch ein Merge dieser Listen und wird im Decks-Tab gezeigt.
  function candidateLists() {
    return wantsLists();
  }

  // Default-Selection: alle Wants-Listen.
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

  // Gesamtsumme (€) und Kartenzahl je Preisspanne über alle ausgewählten
  // Quellen — unabhängig vom aktiven Filter (damit der Tag den Gesamtwert zeigt).
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

  // Aktiv gefilterte Preisspannen (Default: alle).
  function activeBuckets() {
    const stored = Prefs.get(BUCKET_KEY, null);
    const all = BUCKETS.map(b => b.key);
    if (!Array.isArray(stored)) return new Set(all);
    return new Set(stored.filter(k => all.includes(k)));
  }

  // Rarity-Rang (höher = seltener). Deckt Kurz- und Langformen ab.
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

  // Aggregiert die Einträge der ausgewählten Quellen pro Set.
  function collectBySet(lists, selected) {
    const setOrder = new Map(CardDB.sets.map((s, i) => [s.code, i]));
    const setName = new Map(CardDB.sets.map(s => [s.code, s.name]));

    // Pro Set: Statistik (aggregiert), Gruppen je Quell-Liste, und eine
    // variantenaggregierte Flachliste für Export/Bild-Export.
    const active = activeBuckets();
    const showReprints = Prefs.get('wantsShowReprints', true);
    const sets = new Map(); // setCode -> block
    const getBlock = (code) => {
      let b = sets.get(code);
      if (!b) {
        b = { code, name: setName.get(code) || code, total: 0, perRarity: new Map(), perBucket: new Map(), groups: new Map(), _agg: new Map(), _reprintAgg: new Map() };
        sets.set(code, b);
      }
      return b;
    };
    lists.forEach((list, listIdx) => {
      if (!selected.has(list.id)) return;
      const editable = true;
      for (const e of (list.entries || [])) {
        const card = CardDB.byId.get(e.cardId);
        const setCode = card ? card.set : '—';
        const rarity = (card && card.rarity) || '—';
        const name = displayName(card, e.cardId);
        if (!matchesQuery(name, e.cardId, e.variant)) continue; // Textsuche
        const price = cmLow(e.cardId);
        const bk = bucketOf(price);
        if (!active.has(bk)) continue; // ausgeblendete Preisspanne

        const block = getBlock(setCode);
        block.total += e.count;
        block.perRarity.set(rarity, (block.perRarity.get(rarity) || 0) + e.count);
        block.perBucket.set(bk, (block.perBucket.get(bk) || 0) + e.count);

        // Gruppe je Quell-Liste
        let g = block.groups.get(list.id);
        if (!g) { g = { listId: list.id, listName: list.name, editable, order: listIdx, items: [] }; block.groups.set(list.id, g); }
        g.items.push({ cardId: e.cardId, variant: e.variant, count: e.count, name, rarity, price });

        // Variantenaggregat für Export
        let a = block._agg.get(e.variant);
        if (!a) { a = { cardId: e.cardId, variant: e.variant, count: 0, name, rarity, price }; block._agg.set(e.variant, a); }
        a.count += e.count;

        // Reprint-Referenzen: dieselbe Karte ist (teils unter alter ID) auch in
        // anderen Sets erhältlich → in deren Block anzeigen, aber NICHT zählen.
        if (showReprints && card) {
          for (const rc of CardDB.reprintSetsOf(card)) {
            const rb = getBlock(rc);
            let ra = rb._reprintAgg.get(e.variant);
            if (!ra) { ra = { cardId: e.cardId, variant: e.variant, count: 0, name, rarity, price, originSet: setCode }; rb._reprintAgg.set(e.variant, ra); }
            ra.count += e.count;
          }
        }
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
        // Seltenste zuerst; gleiche Rarity nach ID.
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
      b.reprints = Array.from(b._reprintAgg.values()).sort(itemCmp); // Reprint-Refs (ungezählt)
      delete b._reprintAgg;
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
          <h2 class="text-xl font-bold">Wants</h2>
          <input id="wants-search" type="text" placeholder="Suche Name / ID…" value="${escapeAttr(query)}"
            class="bg-slate-900 border border-slate-600 rounded px-3 py-1.5 text-sm flex-1 min-w-[160px]" />
          <label class="text-xs text-slate-400 flex items-center gap-1">
            Ansicht:
            <select id="wants-view" class="bg-slate-900 border border-slate-600 rounded px-2 py-1 text-sm">
              <option value="text"   ${Prefs.get(VIEW_KEY, 'text') === 'text'   ? 'selected' : ''}>Text</option>
              <option value="images" ${Prefs.get(VIEW_KEY, 'text') === 'images' ? 'selected' : ''}>Bilder</option>
            </select>
          </label>
          <label class="text-xs text-slate-400 flex items-center gap-1">
            Sortieren:
            <select id="wants-sort" class="bg-slate-900 border border-slate-600 rounded px-2 py-1 text-sm">
              <option value="id"         ${Prefs.get(SORT_KEY, 'price-desc') === 'id'         ? 'selected' : ''}>ID</option>
              <option value="price-desc" ${Prefs.get(SORT_KEY, 'price-desc') === 'price-desc' ? 'selected' : ''}>Preis ↓</option>
              <option value="rarity"     ${Prefs.get(SORT_KEY, 'price-desc') === 'rarity'     ? 'selected' : ''}>Rarity</option>
            </select>
          </label>
          <label class="text-xs text-slate-400 flex items-center gap-1">
            Gruppieren:
            <select id="wants-group" class="bg-slate-900 border border-slate-600 rounded px-2 py-1 text-sm">
              <option value="source" ${Prefs.get(GROUP_KEY, 'source') === 'source' ? 'selected' : ''}>Nach Liste</option>
              <option value="rarity" ${Prefs.get(GROUP_KEY, 'source') === 'rarity' ? 'selected' : ''}>Nach Rarity</option>
            </select>
          </label>
          <label class="text-xs text-slate-400 flex items-center gap-1" title="Karten, die auch in anderen Sets als Reprint erhältlich sind, dort zusätzlich (ungezählt) anzeigen">
            <input type="checkbox" id="wants-reprints" ${Prefs.get('wantsShowReprints', true) ? 'checked' : ''} />
            Reprints
          </label>
          <div class="text-sm text-slate-400" id="wants-count"></div>
          <button id="wants-export-all" class="bg-emerald-500 hover:bg-emerald-400 text-slate-900 px-3 py-1.5 rounded text-sm font-semibold" title="Alle sichtbaren Karten über alle Sets (mit aktiven Quellen-/Preisfiltern) als Cardmarket-kompatible Liste kopieren">Alles → Cardmarket</button>
        </div>
        <div class="text-xs text-slate-400 mt-2 mb-1">Einbezogene Quellen:</div>
        <div class="flex flex-wrap gap-2" id="wants-lists">${listChips}</div>
        <div class="text-xs text-slate-400 mt-2 mb-1">Preisspannen:</div>
        <div class="flex flex-wrap gap-2" id="wants-buckets">${bucketChips}</div>
        <div class="text-xs text-slate-400 mt-2 mb-1">Nach Rarity:</div>
        <div class="flex flex-wrap gap-1.5" id="wants-rarity-totals"></div>
      </div>
      <div id="wants-sets" class="columns-1 lg:columns-2 [column-gap:0.75rem]"></div>`;

    wire();
    renderSets();
  }

  // Rendert nur den Karten-Bereich (#wants-sets) + Zähler. Wird auch bei
  // Sucheingabe aufgerufen, ohne die Toolbar (und das Suchfeld) neu zu bauen.
  function renderSets() {
    const lists = candidateLists();
    const selected = selectedIds(lists);
    const blocks = collectBySet(lists, selected);
    const grandTotal = blocks.reduce((s, b) => s + b.total, 0);
    const grandUnique = blocks.reduce((s, b) => s + (b.items ? b.items.length : 0), 0);
    const realSets = blocks.reduce((n, b) => n + (b.total > 0 ? 1 : 0), 0);
    const cnt = rootEl.querySelector('#wants-count');
    if (cnt) cnt.textContent = `${realSets} Sets · ${grandTotal} Karten · ${grandUnique} unique`;

    // Aggregat Rarity-Counts ueber alle Set-Bloecke.
    const grandPerRarity = new Map();
    for (const b of blocks) {
      for (const [r, n] of b.perRarity) {
        grandPerRarity.set(r, (grandPerRarity.get(r) || 0) + n);
      }
    }
    const rarityHost = rootEl.querySelector('#wants-rarity-totals');
    if (rarityHost) {
      const entries = Array.from(grandPerRarity.entries())
        .sort((a, b) => (rarityRank(b[0]) - rarityRank(a[0])) || a[0].localeCompare(b[0]));
      rarityHost.innerHTML = entries.length
        ? entries.map(([r, n]) => `<span class="inline-block bg-slate-900 border border-slate-600 rounded px-2 py-0.5 text-xs">${escapeHtml(r)}: <span class="font-semibold text-amber-400">${n}</span></span>`).join('')
        : '<span class="text-xs text-slate-500">—</span>';
    }

    const host = rootEl.querySelector('#wants-sets');
    if (host) host.innerHTML = blocks.length
      ? blocks.map(renderSetBlock).join('')
      : `<div class="bg-slate-800 rounded p-4 text-slate-400">${query ? 'Keine Treffer für die Suche.' : 'Keine Karten in der Auswahl.'}</div>`;
    wireSets();
  }

  function renderSetBlock(block) {
    const view = Prefs.get(VIEW_KEY, 'text');
    const groupBy = Prefs.get(GROUP_KEY, 'source');
    const hasReal = block.total > 0;

    const rarityPills = !hasReal ? '' : Array.from(block.perRarity.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([r, n]) => `<span class="inline-block bg-slate-700 rounded px-2 py-0.5 text-xs">${escapeHtml(r)}: <span class="font-semibold">${n}</span></span>`)
      .join(' ');

    const bucketPills = !hasReal ? '' : BUCKETS
      .filter(b => (block.perBucket.get(b.key) || 0) > 0)
      .map(b => `<span class="inline-block bg-slate-700 rounded px-2 py-0.5 text-xs">${b.label}: <span class="font-semibold">${block.perBucket.get(b.key)}</span></span>`)
      .join(' ');

    const groupsHtml = !hasReal ? '' : (groupBy === 'rarity'
      ? renderRarityGroups(block, view)
      : block.groups.map(g => renderGroup(g, view)).join(''));

    const reprintsHtml = (block.reprints && block.reprints.length)
      ? `<div class="mt-3 pt-2 border-t border-slate-700/60">
           <div class="text-xs text-slate-500 italic mb-1">Auch hier erhältlich · Reprint, nicht gezählt</div>
           ${renderReprintBody(block.reprints, view, block.code)}
         </div>`
      : '';

    // Anzahl Reprint-Kandidaten, die sich aus diesem Set decken liessen.
    // Wird nicht in block.total mitgezaehlt, aber als Zusatzzahl angezeigt:
    // "23 Karten +5 als Reprint moeglich".
    const reprintTotal = (block.reprints || []).reduce((s, it) => s + it.count, 0);
    const reprintSpan = reprintTotal > 0
      ? `<span class="text-xs text-slate-500" title="Wants aus anderen Sets, die als Reprint aus ${escapeAttr(block.code)} gekauft werden koennten">+${reprintTotal} Reprint${reprintTotal === 1 ? '' : 's'} moeglich</span>`
      : '';

    return `
      <div class="bg-slate-800 rounded p-3 mb-3 break-inside-avoid" data-set-block="${escapeAttr(block.code)}">
        <div class="flex items-center gap-2 flex-wrap mb-2">
          <h3 class="text-lg font-bold">
            <span class="font-mono text-amber-400">${escapeHtml(block.code)}</span>
            <span class="text-slate-300 font-normal text-sm">${escapeHtml(block.name)}</span>
          </h3>
          ${hasReal
            ? `<span class="text-sm text-slate-400">${block.total} Karten <span class="text-slate-500">(${block.items.length} unique)</span></span>
               ${reprintSpan}
               <div class="ml-auto flex gap-2"><button data-export-list="${escapeAttr(block.code)}" class="bg-emerald-500 hover:bg-emerald-400 text-slate-900 px-3 py-1.5 rounded text-sm font-semibold">Als Liste</button></div>`
            : `<span class="text-xs text-slate-500 italic">nur Reprints (${reprintTotal})</span>`}
        </div>
        ${hasReal ? `<div class="flex flex-wrap gap-1.5 mb-1"><span class="text-xs text-slate-500 mr-1">Rarity:</span>${rarityPills}</div>
        <div class="flex flex-wrap gap-1.5 mb-3"><span class="text-xs text-slate-500 mr-1">Preis:</span>${bucketPills}</div>` : ''}
        ${groupsHtml}
        ${reprintsHtml}
      </div>`;
  }

  // Reprint-Referenzen (gedämpft, ohne +/-): zeigen, dass eine anderswo gewünschte
  // Karte auch in diesem Set erhältlich ist. blockCode = setCode dieses Blocks,
  // damit wir den Reprint-spezifischen Low-Preis aus CM.getForSet ziehen können.
  function renderReprintBody(items, view, blockCode) {
    const priceForBlock = it => {
      if (!window.CM || !CM.hasData()) return null;
      const p = CM.getForSet(it.cardId, blockCode);
      return (p && p.low != null) ? p.low : null;
    };
    if (view === 'images') {
      return `<div class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-6 gap-2">${items.map(it => {
        const price = priceForBlock(it);
        const priceRow = price != null
          ? `<div class="px-2 pt-1 text-[11px] font-mono leading-tight text-amber-400" title="Cardmarket low (${escapeHtml(blockCode || '')})">CM: ${CM.fmt(price)}</div>`
          : '';
        return `
        <div class="card-tile cursor-pointer opacity-60" data-card-id="${escapeAttr(it.cardId)}" data-variant-key="${escapeAttr(it.variant)}" title="Reprint – kommt aus ${escapeAttr(it.originSet)}, nicht gezählt">
          <img loading="lazy" src="${CardDB.imagePath(it.variant)}" alt="${escapeAttr(it.name)}" />
          ${priceRow}
          <div class="p-2 pt-1">
            <div class="text-xs font-mono text-slate-400 truncate">${escapeHtml(it.variant)}</div>
            <div class="text-sm font-semibold truncate" title="${escapeAttr(it.name)}">${escapeHtml(it.name)}</div>
          </div>
        </div>`;
      }).join('')}</div>`;
    }
    // opacity-60 nicht aufs <tr> setzen — sonst erbt die absolut positionierte
    // .wants-preview die Transparenz mit. Stattdessen jede Textzelle in ein
    // span.reprint-fade einwickeln, das die Bild-Preview NICHT umschließt.
    return `<table class="wants-table"><tbody>${items.map(it => {
      const price = priceForBlock(it);
      const priceTxt = price != null ? CM.fmt(price) : (it.price != null ? (window.CM ? CM.fmt(it.price) : it.price + ' €') : '—');
      return `
      <tr class="wants-row wants-reprint-row group cursor-pointer hover:bg-slate-700/60" data-card-id="${escapeAttr(it.cardId)}" title="Reprint – kommt aus ${escapeAttr(it.originSet)}, nicht gezählt">
        <td class="py-1 pr-4 whitespace-nowrap"><span class="reprint-fade font-bold text-slate-400 tabular-nums">${it.count}×</span></td>
        <td class="py-1 pr-4 relative"><span class="reprint-fade block truncate max-w-[22rem]" title="${escapeAttr(it.name)}">${escapeHtml(it.name)}</span><img class="wants-preview" loading="lazy" src="${CardDB.imagePath(it.variant)}" alt="" /></td>
        <td class="py-1 pr-4 font-mono text-slate-400 text-xs whitespace-nowrap"><span class="reprint-fade">${escapeHtml(it.variant)}</span></td>
        <td class="py-1 pr-4 text-slate-500 text-xs whitespace-nowrap"><span class="reprint-fade">aus ${escapeHtml(it.originSet)}</span></td>
        <td class="py-1 text-slate-400 text-xs tabular-nums text-right whitespace-nowrap"><span class="reprint-fade">${priceTxt}</span></td>
      </tr>`;
    }).join('')}</tbody></table>`;
  }

  // Rendert die Item-Liste (Tabelle oder Bilder-Grid). group liefert listId/editable
  // für die +/- Buttons (read-only via editable:false, z.B. bei Rarity-Gruppierung).
  function renderItemsBody(items, view, group) {
    if (view === 'images') {
      return `<div class="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 xl:grid-cols-6 gap-2">${items.map(it => renderImageTile(it, group)).join('')}</div>`;
    }
    // Bei Preis-Sortierung: Trennlinie am Übergang in ein neues Preis-Bracket einfärben.
    const markBrackets = Prefs.get(SORT_KEY, 'price-desc') === 'price-desc';
    let prevBucket = null;
    return `<table class="wants-table"><tbody>${items.map((it, i) => {
      let color = null;
      if (markBrackets) {
        const bk = bucketOf(it.price);
        if (i > 0 && bk !== prevBucket) color = BUCKET_COLOR[bk];
        prevBucket = bk;
      }
      return renderTextRow(it, group, color);
    }).join('')}</tbody></table>`;
  }

  // Eine Quell-Gruppe (Wants-Liste) innerhalb eines Set-Blocks.
  function renderGroup(group, view) {
    const groupTotal = group.items.reduce((s, it) => s + it.count, 0);
    const head = `<div class="flex items-center gap-2 mt-3 mb-1">
        <span class="text-sm font-semibold text-slate-200">${escapeHtml(group.listName)}</span>
        <span class="text-xs text-slate-500">${groupTotal} Karten</span>
      </div>`;
    return head + renderItemsBody(group.items, view, group);
  }

  // Alternative Gruppierung: die set-aggregierten Items nach Rarity (seltenste
  // zuerst). Quellenübergreifend aggregiert → read-only (keine +/- Buttons).
  function renderRarityGroups(block, view) {
    const roGroup = { listId: '', listName: '', editable: false };
    const byRarity = new Map();
    for (const it of block.items) {
      const r = it.rarity || '—';
      if (!byRarity.has(r)) byRarity.set(r, []);
      byRarity.get(r).push(it);
    }
    return Array.from(byRarity.entries())
      .sort((a, b) => (rarityRank(b[0]) - rarityRank(a[0])) || a[0].localeCompare(b[0]))
      .map(([r, items]) => {
        const total = items.reduce((s, it) => s + it.count, 0);
        const head = `<div class="flex items-center gap-2 mt-3 mb-1">
            <span class="text-sm font-semibold text-slate-200">${escapeHtml(r)}</span>
            <span class="text-xs text-slate-500">${total} Karten</span>
          </div>`;
        return head + renderItemsBody(items, view, roGroup);
      }).join('');
  }

  // Bilder-Ansicht im Collection-Stil: Bild, Preis, ID/Rarity, Name, Count-Badge
  // und (bei editierbaren Listen) −/+ zum Anpassen der Wants-Anzahl.
  function renderImageTile(it, group) {
    const priceRow = it.price != null
      ? `<div class="px-2 pt-1 text-[11px] font-mono leading-tight text-amber-400" title="Cardmarket low">CM: ${window.CM ? CM.fmt(it.price) : it.price + ' €'}</div>`
      : '';
    const key = `${group.listId}|${it.cardId}|${it.variant}`;
    const controls = group.editable
      ? `<div class="qty-controls"><div class="qty-group">
          <button data-want-dec="${escapeAttr(key)}" title="Wants −">−</button>
          <button data-want-inc="${escapeAttr(key)}" title="Wants +">+</button>
        </div></div>`
      : '';
    const card = CardDB.byId.get(it.cardId);
    const reprintPills = card ? CardDB.reprintPillsHtml(card) : '';
    return `
      <div class="card-tile cursor-pointer" data-card-id="${escapeAttr(it.cardId)}" data-variant-key="${escapeAttr(it.variant)}">
        <img loading="lazy" src="${CardDB.imagePath(it.variant)}" alt="${escapeAttr(it.name)}" />
        ${priceRow}
        <div class="p-2 pt-1 flex items-center gap-2">
          <div class="min-w-0 flex-1">
            <div class="text-xs font-mono text-slate-400 truncate">${escapeHtml(it.variant)}${it.rarity ? ` <span class="text-slate-300">${escapeHtml(it.rarity)}</span>` : ''}</div>
            <div class="text-sm font-semibold truncate" title="${escapeAttr(it.name)}">${escapeHtml(it.name)}</div>
            ${reprintPills ? `<div class="reprint-pills mt-1">${reprintPills}</div>` : ''}
          </div>
          <div class="count-badge shrink-0">${it.count}</div>
        </div>
        ${controls}
      </div>`;
  }

  // Text-Ansicht: Tabellenzeile (gleiche Spalten-Einrückung über alle Zeilen),
  // Hover-Bild; bei editierbaren Listen −/+.
  function renderTextRow(it, group, bracketColor) {
    const priceTxt = it.price != null ? (window.CM ? CM.fmt(it.price) : it.price + ' €') : '—';
    const key = `${group.listId}|${it.cardId}|${it.variant}`;
    const qty = group.editable
      ? `<span class="inline-flex items-center gap-1">
          <button data-want-dec="${escapeAttr(key)}" class="wants-qty-btn" title="Wants −">−</button>
          <span class="font-bold text-amber-400 w-6 text-center tabular-nums">${it.count}</span>
          <button data-want-inc="${escapeAttr(key)}" class="wants-qty-btn" title="Wants +">+</button>
        </span>`
      : `<span class="font-bold text-amber-400 tabular-nums">${it.count}×</span>`;
    const rowCls = bracketColor ? ' wants-bracket-start' : '';
    const rowStyle = bracketColor ? ` style="--bracket-color:${bracketColor}"` : '';
    const card = CardDB.byId.get(it.cardId);
    const reprintPills = card ? CardDB.reprintPillsHtml(card) : '';
    return `<tr class="wants-row group cursor-pointer hover:bg-slate-700/60${rowCls}" data-card-id="${escapeAttr(it.cardId)}"${rowStyle}>
        <td class="py-1 pr-4 whitespace-nowrap">${qty}</td>
        <td class="py-1 pr-4 relative"><span class="block truncate max-w-[22rem]" title="${escapeAttr(it.name)}">${escapeHtml(it.name)}</span><img class="wants-preview" loading="lazy" src="${CardDB.imagePath(it.variant)}" alt="${escapeAttr(it.name)}" /></td>
        <td class="py-1 pr-4 font-mono text-slate-400 text-xs whitespace-nowrap">${escapeHtml(it.variant)}</td>
        <td class="py-1 pr-4 text-slate-500 text-xs whitespace-nowrap">${escapeHtml(it.rarity)}</td>
        <td class="py-1 pr-4">${reprintPills ? `<span class="reprint-pills">${reprintPills}</span>` : ''}</td>
        <td class="py-1 text-slate-400 text-xs tabular-nums text-right whitespace-nowrap">${priceTxt}</td>
      </tr>`;
  }

  // --- Events --------------------------------------------------------------

  function wire() {
    const viewSel = rootEl.querySelector('#wants-view');
    if (viewSel) viewSel.addEventListener('change', e => {
      Prefs.set(VIEW_KEY, e.target.value);
      render();
    });

    const sortSel = rootEl.querySelector('#wants-sort');
    if (sortSel) sortSel.addEventListener('change', e => {
      Prefs.set(SORT_KEY, e.target.value);
      render();
    });

    const groupSel = rootEl.querySelector('#wants-group');
    if (groupSel) groupSel.addEventListener('change', e => {
      Prefs.set(GROUP_KEY, e.target.value);
      render();
    });

    const reprintsCb = rootEl.querySelector('#wants-reprints');
    if (reprintsCb) reprintsCb.addEventListener('change', e => {
      Prefs.set('wantsShowReprints', e.target.checked);
      renderSets(); // betrifft nur den Karten-Bereich
    });

    const exportAllBtn = rootEl.querySelector('#wants-export-all');
    if (exportAllBtn) exportAllBtn.addEventListener('click', exportAllForCardmarket);

    rootEl.querySelectorAll('#wants-lists input[data-list-id]').forEach(cb => {
      cb.addEventListener('change', () => {
        const checked = Array.from(rootEl.querySelectorAll('#wants-lists input[data-list-id]'))
          .filter(c => c.checked).map(c => c.dataset.listId);
        Prefs.set(PREF_KEY, checked);
        render();
      });
    });

    rootEl.querySelectorAll('#wants-buckets input[data-bucket]').forEach(cb => {
      cb.addEventListener('change', () => {
        const checked = Array.from(rootEl.querySelectorAll('#wants-buckets input[data-bucket]'))
          .filter(c => c.checked).map(c => c.dataset.bucket);
        Prefs.set(BUCKET_KEY, checked);
        render();
      });
    });

    const searchEl = rootEl.querySelector('#wants-search');
    if (searchEl) searchEl.addEventListener('input', debounce(() => {
      query = searchEl.value;
      renderSets(); // nur Karten-Bereich neu rendern → Suchfeld behält Fokus
    }, 200));
  }

  // Listener innerhalb von #wants-sets (bei jedem renderSets() neu gesetzt).
  function wireSets() {
    rootEl.querySelectorAll('[data-want-inc]').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); modifyWant(btn.dataset.wantInc, 1); });
    });
    rootEl.querySelectorAll('[data-want-dec]').forEach(btn => {
      btn.addEventListener('click', e => { e.stopPropagation(); modifyWant(btn.dataset.wantDec, -1); });
    });

    rootEl.querySelectorAll('.card-tile[data-card-id], .wants-row[data-card-id]').forEach(el => {
      el.addEventListener('click', e => {
        if (e.target.closest('[data-want-inc], [data-want-dec]')) return; // +/- nicht als Detailklick
        if (window.UICollection && typeof UICollection.openCardModal === 'function') {
          UICollection.openCardModal(el.dataset.cardId, el.dataset.variantKey);
        }
      });
    });

    rootEl.querySelectorAll('[data-export-list]').forEach(btn => {
      btn.addEventListener('click', () => exportSetAsList(btn.dataset.exportList));
    });
  }

  // Passt die Wants-Anzahl in einer konkreten Wants-Liste an (Main Wants ist
  // readonly und liefert daher keine Buttons). key = "listId|cardId|variant".
  function modifyWant(key, delta) {
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
    const text = block.items.map(it => `${it.count}x ${it.name} ${it.cardId}${altVersion(it.cardId, it.variant)}`).join('\n') + '\n';
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text)
        .then(() => alert(`Liste „${setCode}" (${block.items.length} Karten) in die Zwischenablage kopiert.`))
        .catch(() => fallbackCopy(text));
    } else {
      fallbackCopy(text);
    }
  }

  // Full-Export über ALLE Sets, mit aktiven Filtern (ausgewählte Quellen +
  // aktive Preisspannen — beides steckt bereits in collectBySet). Cardmarket-
  // kompatibles Format: "Nx Name (CARDID) (V.M)".
  function exportAllForCardmarket() {
    const lists = candidateLists();
    const selected = selectedIds(lists);
    const blocks = collectBySet(lists, selected);
    const lines = [];
    let total = 0;
    for (const block of blocks) {
      for (const it of block.items) {
        lines.push(`${it.count}x ${it.name} ${it.cardId}${altVersion(it.cardId, it.variant)}`);
        total += it.count;
      }
    }
    if (!lines.length) { alert('Nichts zu exportieren — prüfe die aktiven Filter (Quellen/Preisspannen).'); return; }
    const text = lines.join('\n') + '\n';
    const done = () => alert(`${total} Karten über ${blocks.length} Set(s) als Cardmarket-Liste kopiert.`);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, () => fallbackCopy(text));
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

  // Vollständiger Anzeigename: bevorzugt raw.tcgplayer_name (enthält Doppelnamen
  // wie "BeelStarmon // Fly Bullet"), "//" → "/", und entfernt den
  // Disambiguierungs-Suffix " - <cardId>" (z.B. "Machinedramon - BT19-065").
  function displayName(card, fallback) {
    if (card) return CardDB.cleanDisplayName(card);
    return fallback;
  }

  // " (V.N)" wenn die Karte mehrere Varianten hat — N startet bei 1 (Main), 2
  // für die erste Alt-Art, … (entspricht der Cardmarket-Konvention). Karten mit
  // nur einer Variante bekommen keinen V-Marker.
  function altVersion(cardId, variant) {
    const card = CardDB.byId.get(cardId);
    if (!card) return '';
    const variants = CardDB.variantsOf(card);
    if (variants.length <= 1) return '';
    const idx = variants.findIndex(v => v.key === variant);
    if (idx < 0) return '';
    return ` (V.${idx + 1})`;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s).replace(/'/g, '&#39;'); }

  // Textsuche: matcht Name, Card-ID oder Variant (case-insensitive).
  function matchesQuery(name, cardId, variant) {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (name + ' ' + cardId + ' ' + variant).toLowerCase().includes(q);
  }
  function debounce(fn, ms) {
    let t;
    return function (...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), ms); };
  }

  // Live-Refresh: Main Wants hängt vom Besitz ab (collection-changed), die
  // Wants-Listen sind Decks (decks-changed). Nur neu rendern, wenn der Tab
  // sichtbar ist — bei verstecktem Tab rendert app.js beim nächsten Wechsel neu.
  // RAF-gebündelt, damit mehrere Edits (z.B. im offenen Karten-Modal) nicht
  // mehrfach hintereinander rendern.
  let pendingRefresh = false;
  function scheduleRefresh() {
    if (!rootEl) return;
    const panel = document.getElementById('tab-wants');
    if (panel && panel.classList.contains('hidden')) return;
    if (pendingRefresh) return;
    pendingRefresh = true;
    requestAnimationFrame(() => { pendingRefresh = false; render(); });
  }
  document.addEventListener('collection-changed', scheduleRefresh);
  document.addEventListener('decks-changed', scheduleRefresh);

  window.UIWants = { init };
})();
