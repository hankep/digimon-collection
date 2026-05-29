// Rechtsklick-Menü auf Karten: "Zu Listen hinzufügen".
// Funktioniert per delegiertem contextmenu-Listener überall, wo eine Karte
// gerendert wird (Collection-Grid, Card-Modal-Varianten, Deckbuilder-Picker,
// Deck-Einträge).

(function () {
  function findCardContext(target) {
    // 1) Collection-Tile / generische Container mit data-card-id + data-variant-key
    const tile = target.closest('[data-card-id][data-variant-key]');
    if (tile) {
      return { cardId: tile.dataset.cardId, variantKey: tile.dataset.variantKey };
    }
    // 2) Card-Modal: pro Variante existiert ein [data-variant-block="<key>"]
    const vBlock = target.closest('[data-variant-block]');
    if (vBlock) {
      const variantKey = vBlock.dataset.variantBlock;
      const info = CardDB.allVariants.get(variantKey);
      if (info) return { cardId: info.cardId, variantKey };
    }
    // 3) Picker-Button: data-add="cardId|variant"
    const pickerBtn = target.closest('[data-add]');
    if (pickerBtn) {
      const [cardId, variantKey] = pickerBtn.dataset.add.split('|');
      if (cardId && variantKey) return { cardId, variantKey };
    }
    // 4) Deck-Entry-Row: enthält Buttons mit data-entry-inc="cardId|variant"
    const entryBtn = target.closest('[data-entry-inc], [data-entry-dec]');
    if (entryBtn) {
      const raw = entryBtn.dataset.entryInc || entryBtn.dataset.entryDec;
      const [cardId, variantKey] = raw.split('|');
      if (cardId && variantKey) return { cardId, variantKey };
    }
    return null;
  }

  function init() {
    // Trigger (Rechtsklick / Long-Press) bewusst deaktiviert. Das Modal
    // (openAddToListsDialog) bleibt im Export erhalten, kann also weiterhin
    // programmatisch via window.UICardMenu.open(cardId, variantKey) geoeffnet
    // werden. Zum Reaktivieren: die Listener unten entkommentieren.
    /*
    document.addEventListener('contextmenu', e => {
      const ctx = findCardContext(e.target);
      if (!ctx) return;
      e.preventDefault();
      openAddToListsDialog(ctx.cardId, ctx.variantKey);
    });

    // Touch: contextmenu existiert auf dem Handy nicht → Long-Press (~500ms) als Ersatz.
    let pressTimer = null;
    let startXY = null;
    const MOVE_THRESHOLD = 10;
    const cancelPress = () => {
      if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
      startXY = null;
    };
    document.addEventListener('touchstart', e => {
      const ctx = findCardContext(e.target);
      if (!ctx) return;
      const t = e.touches[0];
      startXY = t ? { x: t.clientX, y: t.clientY } : null;
      pressTimer = setTimeout(() => {
        pressTimer = null;
        openAddToListsDialog(ctx.cardId, ctx.variantKey);
      }, 500);
    }, { passive: true });
    document.addEventListener('touchmove', e => {
      if (!pressTimer || !startXY) return;
      const t = e.touches[0];
      if (!t) return;
      if (Math.abs(t.clientX - startXY.x) > MOVE_THRESHOLD ||
          Math.abs(t.clientY - startXY.y) > MOVE_THRESHOLD) {
        cancelPress();
      }
    }, { passive: true });
    document.addEventListener('touchend', cancelPress);
    document.addEventListener('touchcancel', cancelPress);
    */
  }

  function openAddToListsDialog(cardId, variantKey) {
    const card = CardDB.byId.get(cardId);
    if (!card) return;
    const decksState = Store.loadDecks();

    // Verschachtelung mit anderem Modal vermeiden: an eigenen Knoten anhängen.
    let host = document.getElementById('cardmenu-root');
    if (!host) {
      host = document.createElement('div');
      host.id = 'cardmenu-root';
      document.body.appendChild(host);
    }

    const inDeckCount = deck => {
      const e = deck.entries.find(x => x.cardId === cardId && x.variant === variantKey);
      return e ? e.count : 0;
    };

    const decksByKind = { deck: [], wants: [], trade: [] };
    for (const d of decksState.decks) {
      (decksByKind[d.kind] || (decksByKind[d.kind] = [])).push(d);
    }

    const renderDeckRow = d => {
      const have = inDeckCount(d);
      return `
        <label class="flex items-center gap-2 px-2 py-2 hover:bg-slate-800 rounded cursor-pointer">
          <input type="checkbox" data-deck-id="${escapeAttr(d.id)}" class="accent-amber-500" />
          <span class="flex-1 text-sm truncate">${escapeHtml(d.name)}</span>
          ${have > 0 ? `<span class="text-xs text-amber-400 font-mono">× ${have}</span>` : ''}
        </label>
      `;
    };

    const kindSection = (label, decks) => {
      if (!decks.length) return '';
      return `
        <div class="mb-2">
          <div class="text-xs uppercase text-slate-500 font-bold px-2 mb-1">${escapeHtml(label)}</div>
          ${decks.map(renderDeckRow).join('')}
        </div>
      `;
    };

    const hasAnyDeck = decksState.decks.length > 0;

    const contentHtml = `
      <div class="flex justify-between items-start mb-3">
        <h2 class="text-lg font-bold">Zu Listen hinzufügen</h2>
        <button data-modal-close class="text-slate-400 hover:text-white text-2xl leading-none">×</button>
      </div>

      <div class="flex gap-3 mb-3">
        <img src="${CardDB.imagePath(variantKey)}" alt="" class="w-20 aspect-[5/7] object-cover rounded" />
        <div class="min-w-0 flex-1">
          <div class="text-xs font-mono text-slate-400">${escapeHtml(card.id)}</div>
          <div class="text-sm font-semibold truncate">${escapeHtml(CardDB.cleanDisplayName(card))}</div>
          <div class="text-xs font-mono text-slate-500 mt-1">${escapeHtml(variantKey)}</div>
        </div>
        <div class="shrink-0">
          <label class="text-xs text-slate-400 block mb-1">Anzahl</label>
          <input id="cm-qty" type="number" min="1" value="1"
            class="bg-slate-800 border border-slate-600 rounded px-2 py-1 w-16 text-right" />
        </div>
      </div>

      <div id="cm-decks" class="max-h-[40vh] overflow-y-auto border border-slate-700 rounded p-1 mb-3">
        ${hasAnyDeck
          ? kindSection('Decks', decksByKind.deck || []) +
            kindSection('Wants', decksByKind.wants || []) +
            kindSection('Trade', decksByKind.trade || []) +
            Object.keys(decksByKind).filter(k => !['deck','wants','trade'].includes(k))
              .map(k => kindSection(k, decksByKind[k])).join('')
          : `<div class="text-sm text-slate-500 px-2 py-1">Noch keine Listen vorhanden.</div>`
        }
      </div>

      <div class="bg-slate-800/60 border border-slate-700 rounded p-2 mb-3">
        <div class="text-xs uppercase text-slate-500 font-bold mb-1">+ Neue Liste</div>
        <div class="flex gap-2">
          <input id="cm-new-name" type="text" placeholder="Name (leer = nicht anlegen)"
            class="bg-slate-900 border border-slate-600 rounded px-2 py-1 flex-1 text-sm" />
          <select id="cm-new-kind" class="bg-slate-900 border border-slate-600 rounded px-2 py-1 text-sm">
            <option value="deck">deck</option>
            <option value="wants">wants</option>
            <option value="trade">trade</option>
          </select>
        </div>
      </div>

      <div class="flex justify-end gap-2">
        <button data-modal-close class="bg-slate-700 hover:bg-slate-600 px-3 py-1.5 rounded text-sm">Abbrechen</button>
        <button id="cm-confirm" class="bg-amber-500 text-slate-900 hover:bg-amber-400 px-3 py-1.5 rounded text-sm font-semibold">Hinzufügen</button>
      </div>
    `;

    window.Util.openModal({
      host: 'cardmenu-root',
      id: 'cardmenu-modal',
      sizeClass: 'w-[480px] max-w-[95vw]',
      contentHtml,
      onMount: (content, close) => {
        content.querySelectorAll('[data-modal-close]').forEach(btn => btn.addEventListener('click', close));
        content.querySelector('#cm-confirm').addEventListener('click', () => {
          const qty = Math.max(1, parseInt(content.querySelector('#cm-qty').value, 10) || 1);
          const checked = Array.from(content.querySelectorAll('input[data-deck-id]:checked'))
            .map(cb => cb.dataset.deckId);
          const newName = content.querySelector('#cm-new-name').value.trim();
          const newKind = content.querySelector('#cm-new-kind').value;

          if (!checked.length && !newName) return;

          for (const id of checked) {
            const d = decksState.decks.find(x => x.id === id);
            if (d) Store.addToDeck(d, cardId, variantKey, qty);
          }
          if (newName) {
            const d = Store.createDeck(decksState, newName, newKind);
            Store.addToDeck(d, cardId, variantKey, qty);
          }
          Store.saveDecks(decksState);
          close();

          if (window.UIDeckbuilder && typeof window.UIDeckbuilder.refresh === 'function') {
            window.UIDeckbuilder.refresh();
          }
        });
      }
    });
  }

  const { escapeHtml, escapeAttr } = window.Util;

  window.UICardMenu = { init, open: openAddToListsDialog };
})();
