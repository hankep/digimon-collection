// Shared-Space-Tab: listet alle als 'shared=true' markierten Listen aller User.
// Sub-Tabs trennen nach kind (Decks / Wants / Trade). Listen sind read-only;
// per Modal kann man eine Liste ansehen und als eigene Kopie uebernehmen.

(function () {
  const SUB_KINDS = [
    { key: 'deck',  label: 'Decks' },
    { key: 'wants', label: 'Wants' },
    { key: 'trade', label: 'Trade' }
  ];

  const state = {
    activeKind: 'deck',
    cache: { deck: null, wants: null, trade: null },     // null = noch nicht geladen
    profiles: new Map(),                                  // userId → displayName
    loadError: null,
    bodyEl: null
  };

  let rootEl = null;

  function init(el) {
    rootEl = el;
    const stored = (window.Util && Util.PREF_KEYS) ? Prefs.get(Util.PREF_KEYS.sharedSubTab, 'deck') : 'deck';
    state.activeKind = SUB_KINDS.some(k => k.key === stored) ? stored : 'deck';
    render();
    loadCurrent();
  }

  function render() {
    rootEl.innerHTML = `
      <div class="max-w-5xl mx-auto">
        <div class="flex items-center gap-2 mb-3 flex-wrap">
          <h2 class="text-xl font-bold">🌐 Shared Space</h2>
          <span class="text-xs text-slate-500">Geteilte Listen aller eingeloggten Spieler.</span>
          <button id="shared-refresh" class="ml-auto bg-slate-700 hover:bg-slate-600 text-slate-100 text-sm px-3 py-1 rounded">⟳ Neu laden</button>
        </div>
        <div class="flex gap-2 mb-4" id="shared-subtabs">
          ${SUB_KINDS.map(k => `<button data-shared-kind="${k.key}" class="px-3 py-1.5 rounded text-sm font-semibold subtab-btn">${k.label}</button>`).join('')}
        </div>
        <div id="shared-body"></div>
      </div>
    `;
    state.bodyEl = rootEl.querySelector('#shared-body');
    rootEl.querySelectorAll('#shared-subtabs [data-shared-kind]').forEach(btn => {
      btn.addEventListener('click', () => {
        state.activeKind = btn.dataset.sharedKind;
        Prefs.set(Util.PREF_KEYS.sharedSubTab, state.activeKind);
        updateSubTabHighlight();
        renderBody();
        loadCurrent();
      });
    });
    rootEl.querySelector('#shared-refresh').addEventListener('click', () => {
      state.cache[state.activeKind] = null;
      renderBody();
      loadCurrent();
    });
    updateSubTabHighlight();
  }

  function updateSubTabHighlight() {
    rootEl.querySelectorAll('#shared-subtabs [data-shared-kind]').forEach(b => {
      const on = b.dataset.sharedKind === state.activeKind;
      b.classList.toggle('bg-amber-500', on);
      b.classList.toggle('text-slate-900', on);
      b.classList.toggle('bg-slate-700', !on);
      b.classList.toggle('hover:bg-slate-600', !on);
      b.classList.toggle('text-slate-100', !on);
    });
  }

  async function loadCurrent() {
    const kind = state.activeKind;
    if (!window.Sync || !Sync.loadSharedDecks) {
      state.loadError = 'Sync nicht verfügbar.';
      renderBody();
      return;
    }
    state.loadError = null;
    renderBody();  // 'Lade…' zeigen
    const { decks, error } = await Sync.loadSharedDecks(kind);
    if (error) {
      state.loadError = error;
      renderBody();
      return;
    }
    // Profile fuer alle Owner laden (cached in sync.js).
    const userIds = Array.from(new Set(decks.map(d => d.owner_id)));
    const profiles = await Sync.loadProfilesFor(userIds);
    for (const [id, name] of profiles) state.profiles.set(id, name);
    state.cache[kind] = decks;
    renderBody();
  }

  // Completion-Status eines geteilten Decks aus den Slot-Daten ableiten:
  //   'complete' = jeder Eintrag voll mit ECHTEN Kopien geslottet (gruen)
  //   'proxy'    = jeder Eintrag voll, aber mind. 1 Proxy im Spiel (lila)
  //   'none'     = es fehlt noch was / keine Slot-Daten / keine Deck-Liste
  // Spiegelt das Color-Coding der Deck-Listen (deckItemHtml in ui-deckbuilder).
  function deckCompletionState(d) {
    if ((d.kind || 'deck') !== 'deck') return 'none';     // Wants/Trade = reine Listen
    const entries = d.entries || [];
    if (!entries.length) return 'none';
    const hasInfo = entries.some(e => ('slottedReal' in e) || ('slottedProxy' in e));
    if (!hasInfo) return 'none';                           // alter Upload ohne Slot-Daten
    let usesProxy = false;
    for (const e of entries) {
      const real = Math.max(0, parseInt(e.slottedReal, 10) || 0);
      const proxy = Math.max(0, parseInt(e.slottedProxy, 10) || 0);
      if (real + proxy < (e.count || 0)) return 'none';    // etwas fehlt
      if (proxy > 0) usesProxy = true;
    }
    return usesProxy ? 'proxy' : 'complete';
  }

  function renderBody() {
    if (!state.bodyEl) return;
    if (state.loadError) {
      state.bodyEl.innerHTML = `<div class="bg-red-900/20 border border-red-700 rounded p-4 text-sm text-red-300">Fehler: ${escapeHtml(state.loadError)}</div>`;
      return;
    }
    const decks = state.cache[state.activeKind];
    if (decks === null) {
      state.bodyEl.innerHTML = `<div class="text-sm text-slate-400">Lade…</div>`;
      return;
    }
    if (!decks.length) {
      state.bodyEl.innerHTML = `<div class="bg-slate-800 rounded p-4 text-sm text-slate-400">Noch keine Listen in dieser Kategorie geteilt.</div>`;
      return;
    }
    // Gruppieren nach Owner (Anzeigename), alphabetisch.
    const ownerEmailHint = (window.Sync && Sync.getUserId) ? Sync.getUserId() : null;
    const buckets = new Map();
    for (const d of decks) {
      let name = state.profiles.get(d.owner_id);
      if (!name) name = (d.owner_email || '').split('@')[0] || '— ohne Anzeigename —';
      if (!buckets.has(name)) buckets.set(name, []);
      buckets.get(name).push(d);
    }
    const groups = Array.from(buckets.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    state.bodyEl.innerHTML = groups.map(([owner, list]) => {
      const cards = list.sort((a, b) => a.name.localeCompare(b.name)).map(d => {
        const total = (d.entries || []).reduce((s, e) => s + (e.count || 0), 0);
        const youMark = d.owner_id === ownerEmailHint ? `<span class="text-xs text-amber-400">(du)</span>` : '';
        // Color-Coding wie in den Deck-Listen: gruen = komplett (real),
        // lila = komplett aber mit Proxy, neutral = es fehlt noch was.
        const st = deckCompletionState(d);
        const tileCls = st === 'complete'
          ? 'bg-emerald-600/30 border border-emerald-500 hover:bg-emerald-600/50'
          : st === 'proxy'
            ? 'bg-purple-600/30 border border-purple-500 hover:bg-purple-600/50'
            : 'bg-slate-900 hover:bg-slate-800';
        const nameCls = st === 'proxy' ? 'text-purple-300' : '';
        const check = st === 'complete'
          ? ' <span class="text-emerald-300" title="komplett geslottet">✓</span>'
          : st === 'proxy'
            ? ' <span class="text-purple-300" title="komplett, mit Proxies">✓</span>'
            : '';
        return `<div data-shared-row="${escapeAttr(d.id)}" class="${tileCls} cursor-pointer rounded p-3 flex items-center gap-3">
          <div class="min-w-0 flex-1">
            <div class="font-semibold truncate ${nameCls}">${escapeHtml(d.name)}${check} ${youMark}</div>
            <div class="text-xs text-slate-400">${total} Karten · ${(d.entries || []).length} Eintraege</div>
          </div>
          <span class="text-xl shrink-0">📋</span>
        </div>`;
      }).join('');
      return `<div class="mb-4">
        <div class="text-sm font-bold uppercase tracking-wide text-slate-400 mb-2">${escapeHtml(owner)} <span class="text-slate-600 text-xs">· ${list.length}</span></div>
        <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">${cards}</div>
      </div>`;
    }).join('');
    state.bodyEl.querySelectorAll('[data-shared-row]').forEach(row => {
      row.addEventListener('click', () => {
        const id = row.dataset.sharedRow;
        const d = decks.find(x => x.id === id);
        if (d) openSharedDeckModal(d);
      });
    });
  }

  function openSharedDeckModal(d) {
    const ownerName = state.profiles.get(d.owner_id) || (d.owner_email || '').split('@')[0] || '— ohne Anzeigename —';
    const total = (d.entries || []).reduce((s, e) => s + (e.count || 0), 0);
    const notes = (d.notes || '').trim();
    // Such-Eingabe nur fuer Wants & Trade (groessere Listen) — Decks sind kompakt.
    const showSearch = d.kind === 'wants' || d.kind === 'trade';

    const isDeckKind = (d.kind || 'deck') === 'deck';

    // Pre-build pro-Entry-Metadaten fuer Suche + Render. Vermeidet wiederholte
    // Card-Lookups bei jedem Tastendruck.
    const meta = (d.entries || []).map(e => {
      const card = CardDB.byId.get(e.cardId);
      const name = card ? CardDB.cleanDisplayName(card) : e.cardId;
      const rarity = card && card.rarity ? CardDB.rarityShort(card.rarity) : '';
      const slottedReal = Math.max(0, parseInt(e.slottedReal, 10) || 0);
      const slottedProxy = Math.max(0, parseInt(e.slottedProxy, 10) || 0);
      const slottedTotal = slottedReal + slottedProxy;
      const missing = isDeckKind ? Math.max(0, (e.count || 0) - slottedTotal) : 0;
      return {
        entry: e,
        name,
        rarity,
        level: card && card.level != null ? card.level : null,
        slottedReal,
        slottedProxy,
        slottedTotal,
        missing,
        hasSlottedInfo: isDeckKind && ('slottedReal' in e || 'slottedProxy' in e),
        haystack: (name + ' ' + e.cardId + ' ' + e.variant).toLowerCase()
      };
    });

    // Sortierung immer nach Level (aufsteigend, ohne Level ans Ende), dann Name.
    meta.sort((a, b) => {
      const al = a.level == null ? Infinity : a.level;
      const bl = b.level == null ? Infinity : b.level;
      if (al !== bl) return al - bl;
      return a.name.localeCompare(b.name);
    });

    const anySlottedInfo = isDeckKind && meta.some(m => m.hasSlottedInfo);
    const totalMissing = isDeckKind ? meta.reduce((s, m) => s + m.missing, 0) : 0;

    function tileHtml(m) {
      const e = m.entry;
      let slotInfo = '';
      if (isDeckKind && m.hasSlottedInfo) {
        const full = m.slottedTotal >= (e.count || 0);
        // Lila hat Vorrang: signalisiert, dass Proxies mit reingeslottet sind.
        const cls = m.slottedProxy > 0
          ? 'text-purple-400'
          : (full ? 'text-emerald-400' : (m.slottedTotal === 0 ? 'text-rose-400' : 'text-amber-300'));
        const proxyHint = m.slottedProxy > 0 ? ` <span class="text-slate-500" title="davon Proxies">(${m.slottedProxy}p)</span>` : '';
        slotInfo = `<div class="text-[10px] ${cls} font-semibold" title="Owner hat ${m.slottedReal} real + ${m.slottedProxy} Proxy geslottet">geslottet: ${m.slottedTotal}/${e.count || 0}${proxyHint}</div>`;
      }
      return `<div class="bg-slate-900 hover:bg-slate-800 rounded p-1.5 cursor-pointer" data-card-id="${escapeAttr(e.cardId)}" data-variant-key="${escapeAttr(e.variant)}" title="Detail-Ansicht oeffnen">
        <img loading="lazy" src="${CardDB.imagePath(e.variant)}" alt="${escapeAttr(m.name)}" class="w-full aspect-[5/7] object-cover rounded mb-1" />
        <div class="text-xs font-mono text-slate-400 truncate" title="${escapeAttr(e.variant)}">${escapeHtml(e.variant)}${m.rarity ? ` <span class="text-slate-500">${escapeHtml(m.rarity)}</span>` : ''}</div>
        <div class="text-sm font-semibold truncate" title="${escapeAttr(m.name)}">${escapeHtml(m.name)}</div>
        <div class="text-xs text-amber-400 font-bold">${e.count}×</div>
        ${slotInfo}
      </div>`;
    }

    const initialTiles = meta.map(tileHtml).join('');
    const searchBar = showSearch
      ? `<div class="mb-2 shrink-0 flex items-center gap-2">
          <input id="shared-deck-search" type="text" placeholder="Suche Name / ID / Variant…"
            class="bg-slate-900 border border-slate-600 rounded px-3 py-1.5 text-sm flex-1" />
          <span id="shared-deck-search-count" class="text-xs text-slate-500"></span>
        </div>`
      : '';

    const missingBadge = (anySlottedInfo && totalMissing > 0)
      ? ` · <span class="text-rose-300">${totalMissing} fehlen</span>`
      : (anySlottedInfo ? ` · <span class="text-emerald-400">komplett</span>` : '');
    const exportMissingBtn = (anySlottedInfo && totalMissing > 0)
      ? `<button id="shared-export-missing" class="bg-slate-700 hover:bg-slate-600 text-slate-100 px-3 py-1.5 rounded text-sm" title="Fehlende Karten als Plain-Text-Liste kopieren">Fehlende exportieren</button>`
      : '';

    const contentHtml = `
      <div class="flex justify-between items-start mb-3 shrink-0">
        <div class="min-w-0">
          <h2 class="text-lg font-bold truncate">${escapeHtml(d.name)}</h2>
          <div class="text-xs text-slate-400 mt-1">von <b>${escapeHtml(ownerName)}</b> · ${escapeHtml(d.kind)} · ${total} Karten · ${(d.entries || []).length} Eintraege${missingBadge}</div>
        </div>
        <button data-modal-close class="modal-close-x">×</button>
      </div>
      ${notes ? `<div class="bg-slate-900 rounded p-3 text-sm whitespace-pre-wrap mb-3 shrink-0">${escapeHtml(notes)}</div>` : ''}
      ${searchBar}
      <div class="overflow-y-auto flex-1 min-h-0 pr-1">
        <div id="shared-deck-tiles" class="grid gap-2">${initialTiles}</div>
      </div>
      <div class="flex justify-end gap-2 mt-3 shrink-0 flex-wrap">
        <button data-modal-close class="btn-secondary">Schliessen</button>
        ${exportMissingBtn}
        <button id="shared-copy-to-own" class="btn-primary-emerald">Als meine Liste kopieren</button>
      </div>
    `;
    window.Util.openModal({
      host: 'shared-modal-root',
      id: 'shared-modal',
      sizeClass: 'w-[1200px] max-w-[95vw] max-h-[92vh]',
      flex: true,
      contentHtml,
      onMount: (content, close) => {
        content.querySelectorAll('[data-modal-close]').forEach(b => b.addEventListener('click', close));
        content.querySelector('#shared-copy-to-own').addEventListener('click', () => {
          copySharedDeck(d, ownerName);
          close();
        });
        const exportBtn = content.querySelector('#shared-export-missing');
        if (exportBtn) {
          exportBtn.addEventListener('click', () => {
            const lines = [];
            for (const m of meta) {
              if (m.missing <= 0) continue;
              lines.push(`${m.missing} ${m.name} ${m.entry.cardId}`);
            }
            const text = lines.join('\n') + '\n';
            const orig = exportBtn.textContent;
            const finish = ok => { exportBtn.textContent = ok ? `✓ ${lines.length} Zeilen kopiert` : 'Kopieren fehlgeschlagen'; setTimeout(() => { exportBtn.textContent = orig; }, 1800); };
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(text).then(() => finish(true), () => finish(false));
            } else finish(false);
          });
        }

        const tilesEl = content.querySelector('#shared-deck-tiles');
        const scrollWrap = tilesEl.parentElement;

        // Spaltenzahl so waehlen, dass das komplette Grid in die verfuegbare
        // Hoehe passt -> kein Scrollbalken, alles auf einen Blick sichtbar.
        // Wenige Spalten = grosse Karten; bei vielen Karten wird schrittweise
        // auf mehr (kleinere) Spalten erhoeht, bis es in der Hoehe passt.
        function layoutTiles() {
          // Modal geschlossen -> Listener abmelden (kein Leak).
          if (!tilesEl.isConnected) { window.removeEventListener('resize', layoutTiles); return; }
          const n = tilesEl.childElementCount;
          if (!n) return;
          const maxCols = Math.min(n, 12);
          let cols = 1;
          for (cols = 1; cols <= maxCols; cols++) {
            tilesEl.style.gridTemplateColumns = `repeat(${cols}, minmax(0,1fr))`;
            if (tilesEl.scrollHeight <= scrollWrap.clientHeight) break;
          }
        }
        layoutTiles();
        window.addEventListener('resize', layoutTiles);

        function wireTileClicks() {
          tilesEl.querySelectorAll('[data-card-id][data-variant-key]').forEach(tile => {
            tile.addEventListener('click', () => {
              window.Util.bus.emit('open-card-modal', { cardId: tile.dataset.cardId, variantKey: tile.dataset.variantKey });
            });
          });
        }
        wireTileClicks();

        const search = content.querySelector('#shared-deck-search');
        if (search) {
          const cntEl = content.querySelector('#shared-deck-search-count');
          const applyFilter = () => {
            const q = search.value.trim().toLowerCase();
            const filtered = q ? meta.filter(m => m.haystack.includes(q)) : meta;
            tilesEl.innerHTML = filtered.map(tileHtml).join('');
            layoutTiles();
            wireTileClicks();
            if (cntEl) cntEl.textContent = q ? `${filtered.length} / ${meta.length}` : '';
          };
          search.addEventListener('input', applyFilter);
        }
      }
    });
  }

  function copySharedDeck(d, ownerName) {
    const decksState = Store.loadDecks();
    const newDeck = Store.createDeck(decksState, `${d.name} (von ${ownerName})`, d.kind || 'deck');
    newDeck.notes = d.notes || '';
    newDeck.shared = false;
    newDeck.entries = (d.entries || []).map(e => ({ cardId: e.cardId, variant: e.variant, count: e.count }));
    newDeck.updatedAt = new Date().toISOString();
    Store.saveDecks(decksState);
    window.Util.toast(`„${newDeck.name}" als eigene Liste angelegt.`, 'success', 2400);
  }

  const { escapeHtml, escapeAttr } = window.Util;

  window.UIShared = { init };
})();
