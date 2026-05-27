// Wants-Tab: Auswertung von Wants-Quellen (explizite kind='wants'-Listen sowie
// die berechneten „Main Wants").
//
// Aggregiert die Einträge ausgewählter Quellen direkt pro Set, gruppiert nach
// Rarity und nach Preis-Buckets (Cardmarket low). Anzeige ist eine Textliste
// (Kartenbild als Hover-Vorschau). Export pro Set: als Bild (Karten-Grid via
// html2canvas, nur für den Export gerendert) oder als einfache Textliste
// ("4x Agumon BT24-011").

(function () {
  let rootEl = null;
  const PREF_KEY = 'wantsSelectedLists';
  const MAIN_ID = '__main_wants__';

  // Preis-Buckets auf Basis Cardmarket low.
  const BUCKETS = [
    { key: 'lt20', label: 'bis 0,20', test: p => p != null && p <= 0.20 },
    { key: 'lt1',  label: 'bis 1,00', test: p => p != null && p <= 1.00 },
    { key: 'lt5',  label: 'bis 5,00', test: p => p != null && p <= 5.00 },
    { key: 'ge5',  label: 'ab 5,01',  test: p => p != null && p > 5.00 },
    { key: 'none', label: 'ohne Preis', test: p => p == null }
  ];

  function init(el) {
    rootEl = el;
    render();
  }

  // --- Quellen -------------------------------------------------------------

  function wantsLists() {
    const decks = Store.loadDecks().decks || [];
    return decks.filter(d => d.kind === 'wants');
  }

  // Berechnet „Main Wants" als Pseudo-Liste mit entries (gleiche Logik wie
  // computeMainWants im Deckbuilder): Demand aller kind='deck'-Listen minus
  // global vorhandene Kopien. mainWantsProxy-Pref steuert Proxy-Behandlung.
  function mainWantsList() {
    const includeProxy = Prefs.get('mainWantsProxy', true);
    const coll = Store.loadCollection();
    const decks = Store.loadDecks().decks || [];
    const demand = new Map(); // variant -> { cardId, variant, count }
    for (const d of decks) {
      if (d.kind !== 'deck') continue;
      for (const e of (d.entries || [])) {
        let slot = demand.get(e.variant);
        if (!slot) { slot = { cardId: e.cardId, variant: e.variant, count: 0 }; demand.set(e.variant, slot); }
        slot.count += e.count;
      }
    }
    const entries = [];
    for (const slot of demand.values()) {
      const ownedReal = Store.ownedTotalReal(coll, slot.variant);
      const supply = includeProxy ? ownedReal : ownedReal + Store.ownedTotalProxy(coll, slot.variant);
      const missing = Math.max(0, slot.count - supply);
      if (missing > 0) entries.push({ cardId: slot.cardId, variant: slot.variant, count: missing });
    }
    return { id: MAIN_ID, name: '★ Main Wants', kind: 'wants', entries };
  }

  // Alle ankreuzbaren Quellen: Main Wants zuerst, dann explizite Wants-Listen.
  function candidateLists() {
    return [mainWantsList(), ...wantsLists()];
  }

  // Ausgewählte Quellen-IDs: Default = alle vorhandenen Quellen.
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

  // Aggregiert die Einträge der ausgewählten Quellen pro Set.
  function collectBySet(lists, selected) {
    const setOrder = new Map(CardDB.sets.map((s, i) => [s.code, i]));
    const setName = new Map(CardDB.sets.map(s => [s.code, s.name]));

    const perVariant = new Map(); // variant -> { cardId, variant, count }
    for (const list of lists) {
      if (!selected.has(list.id)) continue;
      for (const e of (list.entries || [])) {
        let slot = perVariant.get(e.variant);
        if (!slot) { slot = { cardId: e.cardId, variant: e.variant, count: 0 }; perVariant.set(e.variant, slot); }
        slot.count += e.count;
      }
    }

    const sets = new Map(); // setCode -> block
    for (const slot of perVariant.values()) {
      const card = CardDB.byId.get(slot.cardId);
      const setCode = card ? card.set : '—';
      const rarity = (card && card.rarity) || '—';
      const name = card ? card.name : slot.cardId;
      const price = cmLow(slot.cardId);

      let block = sets.get(setCode);
      if (!block) {
        block = { code: setCode, name: setName.get(setCode) || setCode, total: 0, items: [], perRarity: new Map(), perBucket: new Map() };
        sets.set(setCode, block);
      }
      block.total += slot.count;
      block.items.push({ ...slot, name, rarity, price });
      block.perRarity.set(rarity, (block.perRarity.get(rarity) || 0) + slot.count);
      const bk = bucketOf(price);
      block.perBucket.set(bk, (block.perBucket.get(bk) || 0) + slot.count);
    }

    const blocks = Array.from(sets.values());
    blocks.forEach(b => b.items.sort((a, c) => a.variant.localeCompare(c.variant)));
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
    const blocks = collectBySet(lists, selected);
    const grandTotal = blocks.reduce((s, b) => s + b.total, 0);

    const listChips = lists.map(l => {
      const n = (l.entries || []).reduce((s, e) => s + e.count, 0);
      const isMain = l.id === MAIN_ID;
      return `<label class="flex items-center gap-2 bg-slate-900 border ${isMain ? 'border-amber-500/60' : 'border-slate-600'} rounded px-2 py-1 text-sm cursor-pointer">
        <input type="checkbox" data-list-id="${escapeAttr(l.id)}" ${selected.has(l.id) ? 'checked' : ''} />
        <span class="${isMain ? 'text-amber-400 font-semibold' : ''}">${escapeHtml(l.name)}</span>
        <span class="text-slate-500 text-xs">${n}</span>
      </label>`;
    }).join('');

    rootEl.innerHTML = `
      <div class="bg-slate-800 rounded p-3 mb-3">
        <div class="flex items-center gap-2 flex-wrap">
          <h2 class="text-xl font-bold flex-1">Wants</h2>
          <div class="text-sm text-slate-400">${blocks.length} Sets · ${grandTotal} Karten</div>
        </div>
        <div class="text-xs text-slate-400 mt-2 mb-1">Einbezogene Quellen:</div>
        <div class="flex flex-wrap gap-2" id="wants-lists">${listChips}</div>
      </div>
      <div id="wants-sets" class="space-y-3">
        ${blocks.length ? blocks.map(renderSetBlock).join('') : `<div class="bg-slate-800 rounded p-4 text-slate-400">Keine Karten in der Auswahl.</div>`}
      </div>`;

    wire();
  }

  function renderSetBlock(block) {
    const rarityPills = Array.from(block.perRarity.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([r, n]) => `<span class="inline-block bg-slate-700 rounded px-2 py-0.5 text-xs">${escapeHtml(r)}: <span class="font-semibold">${n}</span></span>`)
      .join(' ');

    const bucketPills = BUCKETS
      .filter(b => (block.perBucket.get(b.key) || 0) > 0)
      .map(b => `<span class="inline-block bg-slate-700 rounded px-2 py-0.5 text-xs">${b.label}: <span class="font-semibold">${block.perBucket.get(b.key)}</span></span>`)
      .join(' ');

    const rows = block.items.map(it => {
      const priceTxt = it.price != null ? (window.CM ? CM.fmt(it.price) : it.price + ' €') : '—';
      return `<div class="wants-row group relative flex items-center gap-3 px-2 py-1 rounded hover:bg-slate-700/60 text-sm">
        <span class="font-bold text-amber-400 w-8 text-right tabular-nums">${it.count}×</span>
        <span class="flex-1 truncate" title="${escapeAttr(it.name)}">${escapeHtml(it.name)}</span>
        <span class="font-mono text-slate-400 text-xs">${escapeHtml(it.variant)}</span>
        <span class="text-slate-500 text-xs w-16 truncate">${escapeHtml(it.rarity)}</span>
        <span class="text-slate-400 text-xs w-16 text-right tabular-nums">${priceTxt}</span>
        <img class="wants-preview" loading="lazy" src="${CardDB.imagePath(it.variant)}" alt="${escapeAttr(it.name)}" />
      </div>`;
    }).join('');

    return `
      <div class="bg-slate-800 rounded p-3" data-set-block="${escapeAttr(block.code)}">
        <div class="flex items-center gap-2 flex-wrap mb-2">
          <h3 class="text-lg font-bold">
            <span class="font-mono text-amber-400">${escapeHtml(block.code)}</span>
            <span class="text-slate-300 font-normal text-sm">${escapeHtml(block.name)}</span>
          </h3>
          <span class="text-sm text-slate-400">${block.total} Karten</span>
          <div class="ml-auto flex gap-2">
            <button data-export-img="${escapeAttr(block.code)}" class="bg-slate-600 hover:bg-slate-500 px-3 py-1.5 rounded text-sm font-medium">Als Bild</button>
            <button data-export-list="${escapeAttr(block.code)}" class="bg-emerald-500 hover:bg-emerald-400 text-slate-900 px-3 py-1.5 rounded text-sm font-semibold">Als Liste</button>
          </div>
        </div>
        <div class="flex flex-wrap gap-1.5 mb-1"><span class="text-xs text-slate-500 mr-1">Rarity:</span>${rarityPills}</div>
        <div class="flex flex-wrap gap-1.5 mb-3"><span class="text-xs text-slate-500 mr-1">Preis:</span>${bucketPills}</div>
        <div class="divide-y divide-slate-700/50">${rows}</div>
      </div>`;
  }

  // --- Events --------------------------------------------------------------

  function wire() {
    rootEl.querySelectorAll('#wants-lists input[data-list-id]').forEach(cb => {
      cb.addEventListener('change', () => {
        const checked = Array.from(rootEl.querySelectorAll('#wants-lists input[data-list-id]'))
          .filter(c => c.checked).map(c => c.dataset.listId);
        Prefs.set(PREF_KEY, checked);
        render();
      });
    });

    rootEl.querySelectorAll('[data-export-list]').forEach(btn => {
      btn.addEventListener('click', () => exportSetAsList(btn.dataset.exportList));
    });
    rootEl.querySelectorAll('[data-export-img]').forEach(btn => {
      btn.addEventListener('click', () => exportSetAsImage(btn.dataset.exportImg, btn));
    });
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
    const text = block.items.map(it => `${it.count}x ${it.name} ${it.variant}`).join('\n') + '\n';
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

  // Baut das Karten-Grid nur für den Export off-screen, rendert es und räumt auf.
  function exportSetAsImage(setCode, btn) {
    if (!window.html2canvas) {
      alert('Bild-Export nicht verfügbar (html2canvas konnte nicht geladen werden). Bitte „Als Liste" verwenden.');
      return;
    }
    const block = blockFor(setCode);
    if (!block) return;

    const orig = btn.textContent;
    btn.textContent = 'Erzeuge…';
    btn.disabled = true;

    const grid = document.createElement('div');
    grid.style.cssText = 'position:fixed;left:-99999px;top:0;width:1000px;background:#0f172a;padding:12px;';
    grid.innerHTML = `
      <div style="color:#fbbf24;font:bold 20px sans-serif;margin-bottom:8px;">${escapeHtml(block.code)} — ${escapeHtml(block.name)} · ${block.total} Karten</div>
      <div style="display:grid;grid-template-columns:repeat(8,1fr);gap:8px;">
        ${block.items.map(it => `
          <div style="position:relative;">
            <img src="${CardDB.imagePath(it.variant)}" style="width:100%;border-radius:6px;display:block;" />
            <span style="position:absolute;top:4px;right:4px;background:#f59e0b;color:#0f172a;font:bold 14px sans-serif;border-radius:4px;padding:2px 6px;">${it.count}×</span>
          </div>`).join('')}
      </div>`;
    document.body.appendChild(grid);

    waitImages(grid)
      .then(() => html2canvas(grid, { useCORS: true, backgroundColor: '#0f172a', scale: 2 }))
      .then(canvas => new Promise(res => canvas.toBlob(res, 'image/png')))
      .then(blob => {
        if (!blob) { alert('Bild konnte nicht erzeugt werden.'); return; }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `wants-${setCode}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
      })
      .catch(err => {
        console.error('html2canvas-Fehler', err);
        alert('Bild-Export fehlgeschlagen. Möglicherweise blockieren die Kartenbilder das Rendern (CORS). Bitte „Als Liste" verwenden.');
      })
      .finally(() => {
        document.body.removeChild(grid);
        btn.textContent = orig;
        btn.disabled = false;
      });
  }

  function waitImages(container) {
    const imgs = Array.from(container.querySelectorAll('img'));
    return Promise.all(imgs.map(img => img.complete
      ? Promise.resolve()
      : new Promise(res => { img.onload = res; img.onerror = res; })));
  }

  // --- Helpers -------------------------------------------------------------

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s).replace(/'/g, '&#39;'); }

  window.UIWants = { init };
})();
