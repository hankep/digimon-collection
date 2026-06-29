// Schnellerfassung ("Display öffnen"): Massen-Eingabe neuer Karten.
//
// Ein Booster-Display ist genau EIN Set → das Set wird einmal gewählt, danach
// genügt pro Karte die Nummer (Enter = +1). Alt-Arts werden über Varianten-Chips
// unterschieden. Tastatur- UND touch-tauglich.
//
// Performance/Sync: pro Commit wird SILENT in LocalStorage gespeichert (durabel,
// kein 'collection-changed'-Event → kein Re-Render, kein Sync-Push pro Karte).
// Erst beim Schließen feuert EIN nicht-silent Save → Sync.debouncedPush + Tab-
// Refresh greifen wie gewohnt.

(function () {
  const { escapeHtml, escapeAttr } = window.Util;

  const state = {
    coll: null,        // in-memory Collection (wird live mutiert)
    setCode: null,     // gewähltes Set, z.B. 'BT26'
    numMap: null,      // Map<int, card> für das gewählte Set
    card: null,        // aktuell aufgelöste Karte (Vorschau)
    variants: [],      // CardDB.variantsOf(card) der Vorschau-Karte
    variantIdx: 0,     // gewählte Variante (0 = Main)
    qty: 1,            // Menge, die der nächste Enter bucht (↑/↓ stellt sie ein)
    log: [],           // [{ copyIds:[], variant, cardId, count }] — neueste zuerst
    committed: 0       // Anzahl gebuchter Karten (für finalen Save/Toast)
  };
  let modal = null;

  // ── Auflösung Nummer/ID → Karte ────────────────────────────────────────────

  function buildNumMap(setCode) {
    const map = new Map();
    const cards = (window.CardDB && CardDB.bySet.get(setCode)) || [];
    for (const c of cards) {
      const tail = String(c.id).split('-').pop() || '';
      const n = parseInt(tail, 10);
      if (!Number.isNaN(n) && !map.has(n)) map.set(n, c);
    }
    return map;
  }

  // Liefert die Karte zu einer Roh-Eingabe (Nummer ODER vollständige ID), oder null.
  // Andockpunkt für späteres OCR: "Nummer/ID kommt von außen".
  function resolveCard(raw) {
    const s = String(raw || '').trim();
    if (!s) return null;
    // Sieht nach voller ID aus (Set-Präfix + Nummer, z.B. "P-001", "BT26-025")?
    if (/^[A-Za-z]+\d*-\d+/.test(s)) {
      return CardDB.byId.get(s.toUpperCase()) || null;
    }
    const n = parseInt(s, 10);
    if (Number.isNaN(n)) return null;
    return (state.numMap && state.numMap.get(n)) || null;
  }

  function variantLabel(idx) {
    if (idx === 0) return 'Standard';
    const v = state.variants[idx];
    if (!v) return 'Alt';
    const suffix = String(v.key).split('_')[1];
    return suffix || ('Alt ' + idx);
  }

  // ── Aktionen ────────────────────────────────────────────────────────────────

  function setSelectedCard(card) {
    state.card = card;
    state.variants = card ? CardDB.variantsOf(card) : [];
    state.variantIdx = 0;
    state.qty = 1; // Menge bei jeder neuen Karte zurücksetzen.
  }

  function commit() {
    if (!state.card || !state.variants.length) { flashInput(); return; }
    const variant = state.variants[state.variantIdx].key;
    const count = Math.max(1, state.qty | 0);
    const copyIds = [];
    for (let i = 0; i < count; i++) {
      copyIds.push(Store.createCopy(state.coll, variant, { isProxy: false, originSet: state.setCode }));
    }
    Store.saveCollection(state.coll, { silent: true });
    state.log.unshift({ copyIds, variant, cardId: state.card.id, count });
    state.committed += count;
    // Eingabe leeren + Vorschau zurücksetzen, Fokus zurück ins Feld.
    setSelectedCard(null);
    const inp = inputEl();
    if (inp) { inp.value = ''; inp.focus(); }
    renderPreview();
    renderLog();
    renderSummary();
  }

  // Menge für den nächsten Enter ändern (nur sinnvoll, wenn eine Karte aufgelöst ist).
  function adjustQty(delta) {
    if (!state.card) return;
    state.qty = Math.max(1, (state.qty | 0) + delta);
    renderPreview();
  }

  function undo(idx) {
    const entry = state.log[idx];
    if (!entry) return;
    (entry.copyIds || []).forEach(id => Store.deleteCopy(state.coll, id));
    Store.saveCollection(state.coll, { silent: true });
    state.log.splice(idx, 1);
    state.committed = Math.max(0, state.committed - (entry.count || 1));
    renderPreview(); // Besitz-Count der ggf. sichtbaren Karte aktualisieren
    renderLog();
    renderSummary();
  }

  function changeSet(code) {
    state.setCode = code;
    state.numMap = buildNumMap(code);
    Prefs.set(window.Util.PREF_KEYS.rapidEntrySet, code);
    setSelectedCard(null);
    const inp = inputEl();
    if (inp) { inp.value = ''; inp.focus(); }
    renderPreview();
  }

  function cycleVariant(dir) {
    if (state.variants.length <= 1) return;
    const n = state.variants.length;
    state.variantIdx = (state.variantIdx + dir + n) % n;
    renderPreview();
  }

  // ── DOM-Helfer ────────────────────────────────────────────────────────────

  function inputEl() { return modal && modal.content.querySelector('#re-number'); }

  function flashInput() {
    const inp = inputEl();
    if (!inp) return;
    inp.classList.add('ring-2', 'ring-red-500');
    setTimeout(() => inp.classList.remove('ring-2', 'ring-red-500'), 350);
  }

  function renderPreview() {
    const host = modal && modal.content.querySelector('#re-preview');
    if (!host) return;
    // "+N"-Button an die aktuelle Menge anpassen (oder +1, wenn keine Karte).
    const addBtn = modal.content.querySelector('#re-add');
    if (addBtn) addBtn.textContent = state.card ? ('+' + Math.max(1, state.qty | 0)) : '+1';
    if (!state.card) {
      host.innerHTML = `<div class="text-slate-500 text-sm flex items-center justify-center h-full text-center px-3">
        Nummer eingeben, ggf. Menge mit <b class="mx-1">↑ / ↓</b> wählen, dann <b class="mx-1">Enter</b> …</div>`;
      return;
    }
    const card = state.card;
    const variant = state.variants[state.variantIdx];
    const owned = variant ? Store.ownedTotalReal(state.coll, variant.key) : 0;
    const chips = state.variants.map((v, i) => {
      const on = i === state.variantIdx;
      return `<button type="button" data-re-variant="${i}"
        class="px-2 py-1 rounded text-xs font-semibold border ${on
          ? 'bg-amber-500 border-amber-400 text-slate-900'
          : 'bg-slate-700 border-slate-600 text-slate-200 hover:bg-slate-600'}">${escapeHtml(variantLabel(i))}</button>`;
    }).join('');
    host.innerHTML = `
      <div class="flex gap-3">
        <img src="${variant ? CardDB.imagePath(variant.key) : ''}" loading="lazy"
          onerror="this.style.visibility='hidden'"
          class="w-20 shrink-0 aspect-[5/7] object-cover rounded bg-slate-900" alt="" />
        <div class="min-w-0 flex-1">
          <div class="font-bold leading-tight">${escapeHtml(CardDB.cleanDisplayName(card))}</div>
          <div class="font-mono text-xs text-slate-400 mt-0.5">${escapeHtml(card.id)}
            ${card.rarity ? '· ' + escapeHtml(CardDB.rarityShort(card.rarity)) : ''}</div>
          <div class="text-xs text-slate-400 mt-1">Im Besitz (dieser Variante): <b class="text-emerald-400">${owned}</b></div>
          <div class="flex items-center gap-2 mt-2">
            <span class="text-xs text-slate-400">Menge:</span>
            <button type="button" data-re-qty="-1" class="w-7 h-7 rounded bg-slate-700 hover:bg-slate-600 text-slate-100 font-bold leading-none">−</button>
            <span class="font-bold text-amber-400 w-6 text-center">${Math.max(1, state.qty | 0)}</span>
            <button type="button" data-re-qty="1" class="w-7 h-7 rounded bg-slate-700 hover:bg-slate-600 text-slate-100 font-bold leading-none">+</button>
            <span class="text-[11px] text-slate-500">(↑ / ↓ · Enter bucht ${Math.max(1, state.qty | 0)})</span>
          </div>
          ${state.variants.length > 1
            ? `<div class="flex flex-wrap gap-1 mt-2">${chips}</div>
               <div class="text-[11px] text-slate-500 mt-1">Alt-Art: Chip antippen oder ← / → drücken.</div>`
            : ''}
        </div>
      </div>`;
    host.querySelectorAll('[data-re-variant]').forEach(b => {
      b.addEventListener('click', () => { state.variantIdx = parseInt(b.dataset.reVariant, 10) || 0; renderPreview(); inputEl() && inputEl().focus(); });
    });
    host.querySelectorAll('[data-re-qty]').forEach(b => {
      b.addEventListener('click', () => { adjustQty(parseInt(b.dataset.reQty, 10) || 0); inputEl() && inputEl().focus(); });
    });
  }

  function renderSummary() {
    const el = modal && modal.content.querySelector('#re-summary');
    if (!el) return;
    let main = 0, alt = 0;
    for (const e of state.log) {
      const info = CardDB.allVariants.get(e.variant);
      if (info && info.isAlt) alt += (e.count || 1); else main += (e.count || 1);
    }
    el.innerHTML = `Erfasst: <b class="text-emerald-400">${state.committed}</b>
      <span class="text-slate-500">(Standard: ${main} · Alt: ${alt})</span>`;
  }

  function renderLog() {
    const host = modal && modal.content.querySelector('#re-log');
    if (!host) return;
    if (!state.log.length) {
      host.innerHTML = `<div class="text-slate-600 text-sm px-1 py-2">Noch nichts erfasst.</div>`;
      return;
    }
    host.innerHTML = state.log.map((e, i) => {
      const card = CardDB.byId.get(e.cardId);
      const info = CardDB.allVariants.get(e.variant);
      const altTag = info && info.isAlt ? ` <span class="text-amber-400">(${escapeHtml(String(e.variant).split('_')[1] || 'Alt')})</span>` : '';
      return `
        <div class="flex items-center gap-2 py-1 border-b border-slate-800 last:border-0 text-sm">
          <span class="text-emerald-400 font-semibold">+${e.count || 1}</span>
          <span class="font-mono text-xs text-slate-400">${escapeHtml(e.cardId)}</span>
          <span class="truncate flex-1 min-w-0">${escapeHtml(card ? CardDB.cleanDisplayName(card) : e.cardId)}${altTag}</span>
          <button type="button" data-re-undo="${i}" title="Rückgängig"
            class="text-slate-500 hover:text-red-400 px-1.5 shrink-0">✕</button>
        </div>`;
    }).join('');
    host.querySelectorAll('[data-re-undo]').forEach(b => {
      b.addEventListener('click', () => undo(parseInt(b.dataset.reUndo, 10)));
    });
  }

  // ── Öffnen ──────────────────────────────────────────────────────────────────

  function open() {
    if (!window.CardDB || !window.Store) return;
    state.coll = Store.loadCollection();
    state.log = [];
    state.committed = 0;
    setSelectedCard(null);

    const sets = (CardDB.sets || []);
    const stored = Prefs.get(window.Util.PREF_KEYS.rapidEntrySet, null);
    const valid = stored && sets.some(s => s.code === stored);
    state.setCode = valid ? stored : (sets[0] && sets[0].code) || null;
    state.numMap = state.setCode ? buildNumMap(state.setCode) : new Map();

    const setOptions = sets.map(s =>
      `<option value="${escapeAttr(s.code)}" ${s.code === state.setCode ? 'selected' : ''}>${escapeHtml(s.code)} — ${escapeHtml(s.name)}</option>`
    ).join('');

    const kbd = k => `<span class="inline-block px-1.5 py-0.5 rounded bg-slate-700 text-slate-100 font-mono text-[11px] leading-none">${k}</span>`;

    const contentHtml = `
      <div class="flex justify-between items-start mb-2 shrink-0">
        <div class="min-w-0">
          <h2 class="text-lg font-bold">⚡ Schnellerfassung</h2>
          <div class="text-xs text-slate-400 mt-1">Ideal beim Display-Öffnen: oben das <b>Set</b> wählen, dann pro Karte die Nummer ins Feld tippen (z.&nbsp;B. <span class="font-mono">25</span> oder volle ID <span class="font-mono">BT26-025</span>).</div>
        </div>
        <button data-re-close class="modal-close-x">×</button>
      </div>
      <div class="bg-slate-900/60 border border-slate-700 rounded px-3 py-2 mb-3 shrink-0">
        <div class="text-[11px] uppercase tracking-wide text-slate-500 mb-1 font-semibold">Steuerung</div>
        <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-300">
          <span>${kbd('Enter')} bucht die Menge (+N)</span>
          <span>${kbd('↑')} / ${kbd('↓')} Menge erhöhen / verringern</span>
          <span>${kbd('←')} / ${kbd('→')} Variante wechseln (Alt-Arts)</span>
          <span>${kbd('✕')} in der Liste = Buchung rückgängig</span>
          <span>${kbd('Esc')} oder „Fertig" = schließen (speichert &amp; synct)</span>
        </div>
      </div>

      <div class="flex flex-col sm:flex-row gap-2 mb-3 shrink-0">
        <label class="flex items-center gap-2 text-sm flex-1 min-w-0">
          <span class="text-slate-400 shrink-0">Set:</span>
          <select id="re-set" class="bg-slate-900 border border-slate-600 rounded px-2 py-2 min-h-[40px] flex-1 min-w-0">${setOptions}</select>
        </label>
        <div class="flex gap-2">
          <input id="re-number" type="text" inputmode="numeric" autocomplete="off"
            placeholder="Nr. (z.B. 25)"
            class="bg-slate-900 border border-slate-600 rounded px-3 py-2 min-h-[40px] w-32 font-mono text-lg" />
          <button id="re-add" class="bg-emerald-500 hover:bg-emerald-400 text-slate-900 px-4 py-2 rounded font-bold min-h-[40px] whitespace-nowrap">+1</button>
        </div>
      </div>

      <div id="re-preview" class="bg-slate-900 border border-slate-700 rounded p-3 mb-3 min-h-[120px] shrink-0"></div>

      <div class="flex items-center justify-between mb-1 shrink-0">
        <div id="re-summary" class="text-sm"></div>
        <div class="text-xs text-slate-500">Erfasste Karten ↓</div>
      </div>
      <div id="re-log" class="overflow-y-auto flex-1 min-h-[80px] border border-slate-800 rounded px-2"></div>

      <div class="flex justify-end gap-2 mt-3 shrink-0">
        <button data-re-close class="btn-primary-emerald">Fertig</button>
      </div>
    `;

    modal = window.Util.openModal({
      host: 'rapid-entry-root',
      id: 'rapid-entry-modal',
      sizeClass: 'w-[680px] max-w-[95vw]',
      flex: true,
      contentHtml,
      onClose: () => {
        // Finaler, nicht-silenter Save → feuert 'collection-changed' (Sync-Push +
        // Tab-Refresh). Nur wenn überhaupt etwas erfasst wurde.
        if (state.committed > 0) {
          Store.saveCollection(state.coll);
          window.Util.toast(`${state.committed} Karte(n) erfasst.`, 'success');
        }
        modal = null;
      },
      onMount: (content, close) => {
        content.querySelectorAll('[data-re-close]').forEach(b => b.addEventListener('click', close));
        content.querySelector('#re-set').addEventListener('change', e => changeSet(e.target.value));
        content.querySelector('#re-add').addEventListener('click', commit);

        const inp = content.querySelector('#re-number');
        inp.addEventListener('input', () => { setSelectedCard(resolveCard(inp.value)); renderPreview(); });
        inp.addEventListener('keydown', e => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          else if (e.key === 'ArrowRight') { e.preventDefault(); cycleVariant(1); }
          else if (e.key === 'ArrowLeft') { e.preventDefault(); cycleVariant(-1); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); adjustQty(1); }
          else if (e.key === 'ArrowDown') { e.preventDefault(); adjustQty(-1); }
        });

        renderPreview();
        renderLog();
        renderSummary();
        setTimeout(() => inp.focus(), 50);
      }
    });
  }

  window.UIRapidEntry = { open };
})();
