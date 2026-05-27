// Wants-Tab: Auswertung explizit gepflegter Wants-Listen (kind === 'wants').
//
// Aggregiert die Einträge ausgewählter Wants-Listen direkt (eine Wants-Liste
// enthält bereits exakt das, was fehlt — kein Abgleich mit der Collection).
// Pro Set: Gesamtzahl, Gruppierung nach Rarity und nach Preis-Buckets
// (Cardmarket low). Export pro Set als Bild (Karten-Grid) oder als einfache
// Textliste ("4x Agumon BT24-011").

(function () {
  let rootEl = null;
  const PREF_KEY = 'wantsSelectedLists';

  // Preis-Buckets auf Basis Cardmarket low.
  const BUCKETS = [
    { key: 'lt20', label: '< 20 ct', test: p => p != null && p < 0.20 },
    { key: 'lt1',  label: '< 1 €',   test: p => p != null && p < 1 },
    { key: 'lt5',  label: '< 5 €',   test: p => p != null && p < 5 },
    { key: 'ge5',  label: '5 €+',    test: p => p != null && p >= 5 },
    { key: 'none', label: 'ohne Preis', test: p => p == null }
  ];

  function init(el) {
    rootEl = el;
    render();
  }

  // --- Daten ---------------------------------------------------------------

  function wantsLists() {
    const decks = Store.loadDecks().decks || [];
    return decks.filter(d => d.kind === 'wants');
  }

  // Ausgewählte Listen-IDs: Default = alle vorhandenen Wants-Listen.
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

  // Aggregiert die Einträge der ausgewählten Listen pro Set.
  // Rückgabe: Array von Set-Blöcken, sortiert nach CardDB-Set-Reihenfolge.
  function collectBySet(lists, selected) {
    const setOrder = new Map(CardDB.sets.map((s, i) => [s.code, i]));
    const setName = new Map(CardDB.sets.map(s => [s.code, s.name]));

    // variant -> aggregierter Slot (über alle ausgewählten Listen summiert)
    const perVariant = new Map();
    for (const list of lists) {
      if (!selected.has(list.id)) continue;
      for (const e of (list.entries || [])) {
        let slot = perVariant.get(e.variant);
        if (!slot) {
          slot = { cardId: e.cardId, variant: e.variant, count: 0 };
          perVariant.set(e.variant, slot);
        }
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
        block = {
          code: setCode,
          name: setName.get(setCode) || setCode,
          total: 0,
          items: [],
          perRarity: new Map(),
          perBucket: new Map()
        };
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
    const lists = wantsLists();
    const selected = selectedIds(lists);

    if (!lists.length) {
      rootEl.innerHTML = `
        <div class="bg-slate-800 rounded p-4 text-slate-300">
          Keine Wants-Listen vorhanden. Lege im Tab „Decks &amp; Lists" eine Liste
          vom Typ <span class="font-mono">wants</span> an, um hier eine Auswertung
          zu sehen.
        </div>`;
      return;
    }

    const blocks = collectBySet(lists, selected);
    const grandTotal = blocks.reduce((s, b) => s + b.total, 0);

    const listChips = lists.map(l => {
      const n = (l.entries || []).reduce((s, e) => s + e.count, 0);
      return `<label class="flex items-center gap-2 bg-slate-900 border border-slate-600 rounded px-2 py-1 text-sm cursor-pointer">
        <input type="checkbox" data-list-id="${escapeAttr(l.id)}" ${selected.has(l.id) ? 'checked' : ''} />
        <span>${escapeHtml(l.name)}</span>
        <span class="text-slate-500 text-xs">${n}</span>
      </label>`;
    }).join('');

    rootEl.innerHTML = `
      <div class="bg-slate-800 rounded p-3 mb-3">
        <div class="flex items-center gap-2 flex-wrap">
          <h2 class="text-xl font-bold flex-1">Wants</h2>
          <div class="text-sm text-slate-400">${blocks.length} Sets · ${grandTotal} Karten</div>
        </div>
        <div class="text-xs text-slate-400 mt-2 mb-1">Einbezogene Listen:</div>
        <div class="flex flex-wrap gap-2" id="wants-lists">${listChips}</div>
      </div>
      <div id="wants-sets" class="space-y-3">
        ${blocks.length ? blocks.map(renderSetBlock).join('') : `<div class="bg-slate-800 rounded p-4 text-slate-400">Keine Karten in der Auswahl.</div>`}
      </div>`;

    wire(lists);
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

    const tiles = block.items.map(it => `
      <div class="wants-tile relative">
        <img loading="lazy" src="${CardDB.imagePath(it.variant)}" alt="${escapeAttr(it.name)}"
             class="w-full rounded block" />
        <span class="absolute top-1 right-1 bg-amber-500 text-slate-900 font-bold text-sm rounded px-1.5 py-0.5 leading-none">${it.count}×</span>
      </div>`).join('');

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
        <div class="wants-grid grid grid-cols-3 sm:grid-cols-5 md:grid-cols-8 gap-2" data-set-grid="${escapeAttr(block.code)}">
          ${tiles}
        </div>
      </div>`;
  }

  // --- Events --------------------------------------------------------------

  function wire(lists) {
    rootEl.querySelectorAll('#wants-lists input[data-list-id]').forEach(cb => {
      cb.addEventListener('change', () => {
        const checked = Array.from(rootEl.querySelectorAll('#wants-lists input[data-list-id]'))
          .filter(c => c.checked).map(c => c.dataset.listId);
        Prefs.set(PREF_KEY, checked);
        render();
      });
    });

    rootEl.querySelectorAll('[data-export-list]').forEach(btn => {
      btn.addEventListener('click', () => exportSetAsList(lists, btn.dataset.exportList));
    });
    rootEl.querySelectorAll('[data-export-img]').forEach(btn => {
      btn.addEventListener('click', () => exportSetAsImage(btn.dataset.exportImg, btn));
    });
  }

  // --- Export --------------------------------------------------------------

  function blockFor(setCode) {
    const lists = wantsLists();
    const selected = selectedIds(lists);
    return collectBySet(lists, selected).find(b => b.code === setCode) || null;
  }

  function exportSetAsList(_lists, setCode) {
    const block = blockFor(setCode);
    if (!block) return;
    const text = block.items
      .map(it => `${it.count}x ${it.name} ${it.variant}`)
      .join('\n') + '\n';
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

  function exportSetAsImage(setCode, btn) {
    if (!window.html2canvas) {
      alert('Bild-Export nicht verfügbar (html2canvas konnte nicht geladen werden). Bitte „Als Liste" verwenden.');
      return;
    }
    const grid = rootEl.querySelector(`[data-set-grid="${cssEsc(setCode)}"]`);
    if (!grid) return;
    const orig = btn.textContent;
    btn.textContent = 'Erzeuge…';
    btn.disabled = true;
    html2canvas(grid, { useCORS: true, backgroundColor: '#0f172a', scale: 2 })
      .then(canvas => {
        canvas.toBlob(blob => {
          if (!blob) { alert('Bild konnte nicht erzeugt werden.'); return; }
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = `wants-${setCode}.png`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }, 'image/png');
      })
      .catch(err => {
        console.error('html2canvas-Fehler', err);
        alert('Bild-Export fehlgeschlagen. Möglicherweise blockieren die Kartenbilder das Rendern (CORS). Bitte „Als Liste" verwenden.');
      })
      .finally(() => { btn.textContent = orig; btn.disabled = false; });
  }

  // --- Helpers -------------------------------------------------------------

  function escapeHtml(s) {
    return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
  function escapeAttr(s) { return escapeHtml(s).replace(/'/g, '&#39;'); }
  function cssEsc(s) {
    return window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&');
  }

  window.UIWants = { init };
})();
