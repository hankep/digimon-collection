// Listen Import/Export-Tab. Format-Plugins kommen aus window.IO_FORMATS.
// Collection-/Backup-/Login-Funktionen liegen in ui-user.js; Proxy-Export im Collection-Tab.

(function () {
  const state = {
    formatId: null,
    activeDeckId: null,
    textValue: ''
  };
  let rootEl = null;

  function init(el) {
    rootEl = el;
    const formats = window.IO_FORMATS || [];
    if (formats.length && !state.formatId) state.formatId = formats[0].id;
    render();
  }

  function render() {
    const formats = window.IO_FORMATS || [];
    const decksState = Store.loadDecks();
    rootEl.innerHTML = `
      <div class="max-w-3xl mx-auto">
        <h2 class="text-lg font-bold mb-3">Listen Import / Export</h2>

        <div class="bg-slate-800 rounded p-4 mb-4 flex flex-wrap gap-3 items-end">
          <label class="block">
            <div class="text-xs text-slate-400 mb-1">Export-Format</div>
            <select id="format-select" class="bg-slate-900 border border-slate-600 rounded px-2 py-2">
              ${formats.map(f => `<option value="${f.id}" ${f.id === state.formatId ? 'selected' : ''}>${escapeHtml(f.label)}</option>`).join('')}
            </select>
          </label>
          <label class="block flex-1 min-w-[200px]">
            <div class="text-xs text-slate-400 mb-1">Liste (für Export)</div>
            <select id="deck-select" class="bg-slate-900 border border-slate-600 rounded px-2 py-2 w-full">
              <option value="">— wählen —</option>
              ${decksState.decks.map(d => `<option value="${d.id}" ${d.id === state.activeDeckId ? 'selected' : ''}>${escapeHtml(d.name)}</option>`).join('')}
            </select>
          </label>
          <button id="do-export" class="bg-amber-500 text-slate-900 px-4 py-2 rounded font-semibold">Export →</button>
          <label class="bg-slate-700 hover:bg-slate-600 text-slate-100 px-4 py-2 rounded cursor-pointer text-sm">
            Datei laden…
            <input id="io-file" type="file" accept=".txt,.json,text/plain,application/json" class="hidden" />
          </label>
        </div>

        <textarea id="io-text" rows="18"
          class="w-full bg-slate-900 border border-slate-600 rounded p-3 font-mono text-xs"
          placeholder="Hier erscheint der Export — oder füge Text zum Import ein.">${escapeHtml(state.textValue)}</textarea>

        <div class="flex gap-2 mt-3 flex-wrap items-center">
          <button id="do-import" class="bg-emerald-500 text-slate-900 px-4 py-2 rounded font-semibold">← Import (als neue Liste)</button>
          <input id="import-name" type="text" placeholder="Name der neuen Liste (optional)"
            class="bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm flex-1 min-w-[200px]" />
          <button id="do-copy" class="bg-slate-700 hover:bg-slate-600 text-slate-100 px-4 py-2 rounded">Kopieren</button>
          <button id="do-download" class="bg-slate-700 hover:bg-slate-600 text-slate-100 px-4 py-2 rounded">Download</button>
          <button id="do-clear" class="ml-auto text-slate-400 hover:text-slate-200 px-4 py-2">Leeren</button>
        </div>
        <div id="io-msg" class="mt-3 text-sm"></div>

        <hr class="border-slate-700 my-6" />

        <h2 class="text-lg font-bold mb-2">Cardmarket-Import</h2>
        <p class="text-sm text-slate-400 mb-3">
          Fügt Karten <b>inkl. Preis</b> zur Sammlung hinzu. Paste die Bestelldetails (Name + ID + V.X + Preis) aus Cardmarket.
        </p>
        <div class="flex flex-wrap gap-2 mb-2">
          <label class="bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded cursor-pointer text-sm">
            Datei laden…
            <input id="cm-file" type="file" accept=".txt,text/plain" class="hidden" />
          </label>
          <button id="cm-clear" class="text-slate-400 hover:text-slate-200 px-4 py-2 text-sm">Leeren</button>
        </div>
        <textarea id="cm-text" rows="10"
          class="w-full bg-slate-900 border border-slate-600 rounded p-3 font-mono text-xs mb-2"
          placeholder="1x  Taiki, Kiriha, &amp; Nene (BT11-095) (V.1)&#10;#BT11-095&#10;AD-01&#10;NM&#10;0,20 €&#10;&#10;..."></textarea>
        <div class="flex flex-wrap gap-2 mb-3">
          <button id="cm-preview" class="bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded font-semibold">Vorschau</button>
          <button id="cm-apply"   class="bg-emerald-500 text-slate-900 px-4 py-2 rounded font-semibold">In Sammlung übernehmen</button>
        </div>
        <div id="cm-preview-out"></div>
        <div id="cm-msg" class="mt-3 text-sm"></div>

        <hr class="border-slate-700 my-6" />

        <h2 class="text-lg font-bold mb-2">Wants beantworten / Trade</h2>
        <p class="text-sm text-slate-400 mb-3">
          Wants-Liste eines anderen Users einfügen, lieferbare Karten markieren und aus deiner Collection entfernen. Du bekommst danach einen App-Import-Text mit den abgegebenen Karten für den Sender.
        </p>
        <button id="trade-open" class="bg-sky-500 hover:bg-sky-400 text-slate-900 px-4 py-2 rounded font-semibold">Trade-Modal öffnen</button>
      </div>
    `;

    rootEl.querySelector('#format-select').addEventListener('change', e => { state.formatId = e.target.value; });
    rootEl.querySelector('#deck-select').addEventListener('change', e => { state.activeDeckId = e.target.value || null; });
    rootEl.querySelector('#io-text').addEventListener('input', e => { state.textValue = e.target.value; });
    rootEl.querySelector('#do-export').addEventListener('click', doExport);
    rootEl.querySelector('#do-import').addEventListener('click', doImport);
    rootEl.querySelector('#do-copy').addEventListener('click', doCopy);
    rootEl.querySelector('#do-download').addEventListener('click', doDownload);
    rootEl.querySelector('#do-clear').addEventListener('click', () => {
      state.textValue = '';
      rootEl.querySelector('#io-text').value = '';
      showMsg('', '');
    });
    rootEl.querySelector('#io-file').addEventListener('change', loadFile);

    rootEl.querySelector('#cm-file').addEventListener('change', cmLoadFile);
    rootEl.querySelector('#cm-clear').addEventListener('click', () => {
      rootEl.querySelector('#cm-text').value = '';
      rootEl.querySelector('#cm-preview-out').innerHTML = '';
      showCmMsg('', '');
    });
    rootEl.querySelector('#cm-preview').addEventListener('click', cmPreview);
    rootEl.querySelector('#cm-apply').addEventListener('click', cmApply);
    rootEl.querySelector('#trade-open').addEventListener('click', openTradeDialog);
  }

  // --- Cardmarket-Import ---------------------------------------------------

  function cmLoadFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      rootEl.querySelector('#cm-text').value = String(reader.result || '');
      cmPreview();
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  function cmPreview() {
    const text = rootEl.querySelector('#cm-text').value;
    const out = rootEl.querySelector('#cm-preview-out');
    if (!text.trim()) { out.innerHTML = '<div class="text-slate-500 text-sm">Textfeld ist leer.</div>'; return; }
    const { items, unknown } = Cardmarket.parse(text);
    const sum = Cardmarket.summarize(items);

    const rows = items.map(it => `
      <tr class="border-b border-slate-800">
        <td class="px-2 py-1">${it.qty}x</td>
        <td class="px-2 py-1">${escapeHtml(it.cardName)}</td>
        <td class="px-2 py-1 font-mono text-xs text-slate-400">${escapeHtml(it.variant)}${it.isAlt ? ' (Alt)' : ''}</td>
        <td class="px-2 py-1 font-mono text-xs ${it.originSet ? 'text-amber-400' : 'text-slate-600'}">${it.originSet ? escapeHtml(it.originSet) : '–'}</td>
        <td class="px-2 py-1 text-right">${it.unitPrice == null ? '–' : Fmt.eur(it.unitPrice)}</td>
        <td class="px-2 py-1 text-right">${it.unitPrice == null ? '–' : Fmt.eur(it.unitPrice * it.qty)}</td>
      </tr>
    `).join('');

    out.innerHTML = `
      <div class="bg-slate-800 rounded p-3 mb-3 flex flex-wrap gap-4 text-sm">
        <div><span class="text-slate-400">Karten:</span> <b>${sum.totalQty}</b></div>
        <div><span class="text-slate-400">Wert:</span> <b class="text-emerald-400">${Fmt.eur(sum.totalValue)}</b></div>
        ${sum.unpriced ? `<div><span class="text-slate-400">Ohne Preis:</span> <b>${sum.unpriced}</b></div>` : ''}
        ${unknown.length ? `<div><span class="text-red-400">Unbekannt:</span> <b>${unknown.length}</b></div>` : ''}
      </div>
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead><tr class="text-xs uppercase text-slate-400 text-left">
            <th class="px-2 py-1">Menge</th><th class="px-2 py-1">Name</th><th class="px-2 py-1">Variant</th>
            <th class="px-2 py-1">Set</th>
            <th class="px-2 py-1 text-right">Stk.-Preis</th><th class="px-2 py-1 text-right">Subtotal</th>
          </tr></thead>
          <tbody>${rows || '<tr><td class="text-slate-500 px-2 py-2" colspan="6">Keine erkannten Einträge.</td></tr>'}</tbody>
        </table>
      </div>
      ${unknown.length ? `
        <div class="mt-3 bg-red-900/20 border border-red-800 rounded p-3">
          <div class="text-red-400 font-bold text-sm mb-1">Unbekannte IDs (werden übersprungen):</div>
          <div class="text-xs font-mono text-slate-300">${unknown.map(u => `${u.qty}x ${escapeHtml(u.rawId)}${u.version > 1 ? ' (V.' + u.version + ')' : ''}`).join('<br>')}</div>
        </div>` : ''}
    `;
  }

  function cmApply() {
    const text = rootEl.querySelector('#cm-text').value;
    if (!text.trim()) { showCmMsg('Textfeld ist leer.', 'err'); return; }
    const { items, unknown } = Cardmarket.parse(text);
    if (!items.length) { showCmMsg('Keine erkennbaren Einträge.', 'err'); return; }
    const sum = Cardmarket.summarize(items);
    const msg = `${sum.totalQty} Karten (${Fmt.eur(sum.totalValue)}) zur Sammlung hinzufügen?`
      + (unknown.length ? `\n${unknown.length} unbekannte IDs werden übersprungen.` : '');
    if (!confirm(msg)) return;

    // Cross-Variant-Analyse: wenn ein Import die gleiche Card-ID in anderer
    // Variante als ein Wants-Eintrag hat, fragen wir per Modal nach. Exakte
    // Treffer werden ohnehin in apply() abgezogen.
    const impact = Cardmarket.analyzeWantsImpact(items);
    if (impact.crossVariant.length === 0) {
      finishCmApply(items, null);
    } else {
      openCrossVariantDialog(items, impact.crossVariant);
    }
  }

  function finishCmApply(items, decisions) {
    const res = Cardmarket.apply(items, decisions);
    const wantsNote = res.removedFromWants ? ` ${res.removedFromWants} von Wants-Listen abgezogen.` : '';
    const crossNote = res.crossVariantRemoved ? ` ${res.crossVariantRemoved} über andere Variante abgezogen.` : '';
    showCmMsg(`Hinzugefügt: ${res.addedCopies} Kopien, Wert ${Fmt.eur(res.addedValue)}.${wantsNote}${crossNote} Seite wird neu geladen…`, 'ok');
    if (window.Sync && Sync.flushThenReload) Sync.flushThenReload(800);
    else setTimeout(() => location.reload(), 800);
  }

  function openCrossVariantDialog(items, candidates) {
    let host = document.getElementById('cv-import-root');
    if (!host) {
      host = document.createElement('div');
      host.id = 'cv-import-root';
      document.body.appendChild(host);
    }

    const rows = candidates.map((c, idx) => {
      const wantsCard = CardDB.byId.get(c.cardId);
      const wantsName = wantsCard ? wantsCard.name : c.cardId;
      return `
        <label class="flex items-baseline gap-2 py-1.5 border-b border-slate-700 last:border-0 cursor-pointer">
          <input type="checkbox" data-cv-idx="${idx}" class="accent-amber-500" checked />
          <div class="flex-1 min-w-0 text-sm">
            <div><b>${escapeHtml(c.deckName)}</b> · <span class="text-amber-400">${c.wantsCount}× ${escapeHtml(c.wantsVariant)}</span> <span class="text-slate-500">(${escapeHtml(wantsName)})</span></div>
            <div class="text-xs text-slate-400 mt-0.5">
              Du importierst <span class="font-mono">${escapeHtml(c.importedVariant)}</span>. Bis zu <b>${c.maxTake}</b> davon hier abziehen?
            </div>
          </div>
        </label>
      `;
    }).join('');

    host.innerHTML = `
      <div class="modal-backdrop" id="cv-import-modal">
        <div class="modal-content w-[640px] max-w-[95vw]">
          <div class="flex justify-between items-start mb-3">
            <div>
              <h2 class="text-lg font-bold">Andere Varianten in Wants gefunden</h2>
              <div class="text-xs text-slate-400 mt-1">Exakte Treffer werden ohnehin abgezogen. Hier geht's um Wants-Einträge mit derselben Card-ID, aber anderer Variante.</div>
            </div>
            <button id="cv-close" class="text-slate-400 hover:text-white text-2xl leading-none">×</button>
          </div>

          <div class="max-h-[50vh] overflow-y-auto border border-slate-700 rounded p-2 mb-3">
            ${rows || '<div class="text-sm text-slate-500 px-2 py-1">Nichts zu fragen.</div>'}
          </div>

          <div class="flex gap-2 mb-3 text-xs">
            <button id="cv-all" class="text-amber-400 hover:underline">Alle aktivieren</button>
            <button id="cv-none" class="text-slate-400 hover:underline">Alle abwählen</button>
          </div>

          <div class="flex justify-end gap-2">
            <button id="cv-skip" class="bg-slate-700 hover:bg-slate-600 px-3 py-1.5 rounded text-sm">Überspringen</button>
            <button id="cv-go" class="bg-emerald-500 text-slate-900 hover:bg-emerald-400 px-4 py-1.5 rounded text-sm font-semibold">Übernehmen</button>
          </div>
        </div>
      </div>
    `;

    const close = () => { host.innerHTML = ''; document.removeEventListener('keydown', esc); };
    function esc(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', esc);
    host.querySelector('#cv-close').addEventListener('click', () => { close(); finishCmApply(items, null); });
    host.querySelector('#cv-skip').addEventListener('click', () => { close(); finishCmApply(items, null); });
    host.querySelector('#cv-import-modal').addEventListener('click', e => {
      if (e.target.id === 'cv-import-modal') { close(); finishCmApply(items, null); }
    });
    host.querySelector('#cv-all').addEventListener('click', () => {
      host.querySelectorAll('input[data-cv-idx]').forEach(cb => { cb.checked = true; });
    });
    host.querySelector('#cv-none').addEventListener('click', () => {
      host.querySelectorAll('input[data-cv-idx]').forEach(cb => { cb.checked = false; });
    });
    host.querySelector('#cv-go').addEventListener('click', () => {
      const accepted = Array.from(host.querySelectorAll('input[data-cv-idx]:checked'))
        .map(cb => {
          const c = candidates[parseInt(cb.dataset.cvIdx, 10)];
          return c ? { deckId: c.deckId, cardId: c.cardId, wantsVariant: c.wantsVariant, take: c.maxTake } : null;
        })
        .filter(Boolean);
      close();
      finishCmApply(items, { acceptCrossVariant: accepted });
    });
  }

  function showCmMsg(msg, kind) {
    const el = rootEl.querySelector('#cm-msg');
    el.textContent = msg;
    el.className = 'mt-3 text-sm ' + (kind === 'err' ? 'text-red-400' : kind === 'ok' ? 'text-emerald-400' : 'text-slate-400');
  }

  function getFormat() {
    return (window.IO_FORMATS || []).find(f => f.id === state.formatId);
  }

  function doExport() {
    const fmt = getFormat();
    if (!fmt) return showMsg('Kein Format gewählt.', 'err');
    if (!state.activeDeckId) return showMsg('Bitte Liste auswählen.', 'err');
    const decksState = Store.loadDecks();
    const deck = decksState.decks.find(d => d.id === state.activeDeckId);
    if (!deck) return showMsg('Liste nicht gefunden.', 'err');
    try {
      const text = fmt.exportDeck(deck);
      state.textValue = text;
      rootEl.querySelector('#io-text').value = text;
      showMsg(`Exportiert: ${deck.entries.length} Einträge.`, 'ok');
    } catch (e) {
      showMsg('Export-Fehler: ' + e.message, 'err');
    }
  }

  // Versucht jedes registrierte IO_FORMAT auf den Eingabetext anzuwenden und
  // waehlt das Format, das die meisten gueltigen Eintraege liefert (= Card-ID
  // oder Variant-Key in CardDB bekannt). JSON-Formate werden bevorzugt, wenn
  // der Text wie JSON aussieht; sonst alle Text-Formate.
  function autoDetectFormat(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) return null;
    const isJsonLike = trimmed.startsWith('{') || trimmed.startsWith('[');
    const all = window.IO_FORMATS || [];
    const candidates = isJsonLike
      ? all.filter(f => /json/i.test(f.id))
      : all.filter(f => !/json/i.test(f.id));
    let best = null;
    for (const fmt of candidates) {
      let result;
      try { result = fmt.importDeck(trimmed); }
      catch (e) { continue; }
      const entries = result && Array.isArray(result.entries) ? result.entries : [];
      let valid = 0;
      for (const e of entries) {
        if (CardDB.byId.has(e.cardId) || CardDB.allVariants.has(e.variant)) valid++;
      }
      const unknown = (result && result.unknownIds || []).length + (entries.length - valid);
      const score = valid - unknown * 0.5;
      if (!best || score > best.score) best = { fmt, result, score, valid, unknown };
    }
    return best;
  }

  function doImport() {
    const text = state.textValue.trim();
    if (!text) return showMsg('Textfeld ist leer.', 'err');

    const auto = autoDetectFormat(text);
    if (!auto || auto.valid === 0) {
      const sampleUnknown = auto && auto.result && auto.result.unknownIds
        ? auto.result.unknownIds.slice(0, 5).join(', ')
        : '';
      return showMsg(
        'Format nicht erkannt — keine gültigen Einträge gefunden.' +
        (sampleUnknown ? ` Unbekannt z.B.: ${sampleUnknown}` : ''),
        'err'
      );
    }
    const fmt = auto.fmt;
    const result = auto.result;

    // Validator: prüfe ob Card-IDs und Varianten existieren.
    const unknownEntries = [];
    const validEntries = [];
    for (const e of result.entries) {
      const cardKnown = CardDB.byId.has(e.cardId);
      const variantKnown = CardDB.allVariants.has(e.variant);
      if (!cardKnown && !variantKnown) {
        unknownEntries.push(e);
      } else {
        if (!variantKnown && cardKnown) {
          e.variant = CardDB.mainVariantKey(CardDB.byId.get(e.cardId));
        }
        validEntries.push(e);
      }
    }
    const unknownFromFormat = (result.unknownIds || []);

    if (unknownEntries.length || unknownFromFormat.length) {
      const samples = unknownEntries.slice(0, 8).map(e => e.cardId + (e.variant !== e.cardId ? ' / ' + e.variant : ''))
        .concat(unknownFromFormat.slice(0, 8));
      const ok = confirm(
        `Format erkannt: ${fmt.label}\n\n` +
        `${unknownEntries.length + unknownFromFormat.length} unbekannte Einträge gefunden, z.B.:\n` +
        samples.join('\n') +
        `\n\nTrotzdem importieren (${validEntries.length} gültige Einträge)?`
      );
      if (!ok) return showMsg('Import abgebrochen.', 'err');
    }

    const decksState = Store.loadDecks();
    const customName = rootEl.querySelector('#import-name').value.trim();
    const deck = Store.createDeck(decksState, customName || result.name, result.kind);
    deck.notes = result.notes || '';
    deck.entries = validEntries;
    Store.saveDecks(decksState);

    const skipped = unknownEntries.length + unknownFromFormat.length;
    showMsg(
      `Importiert (${fmt.label}): "${deck.name}" mit ${deck.entries.length} Einträgen` +
      (skipped ? ` (${skipped} übersprungen)` : '') +
      '. Sichtbar unter Decks & Lists.',
      'ok'
    );
  }

  function loadFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      state.textValue = String(reader.result || '');
      rootEl.querySelector('#io-text').value = state.textValue;
      // Export-Format aus der Dateiendung vorbelegen (rein zur Bequemlichkeit
      // beim spaeteren Re-Export). Der Import erkennt das Format selbststaendig.
      const ext = (file.name.match(/\.[^.]+$/) || [''])[0].toLowerCase();
      const match = (window.IO_FORMATS || []).find(f => (f.fileExtension || '').toLowerCase() === ext);
      if (match) {
        state.formatId = match.id;
        rootEl.querySelector('#format-select').value = match.id;
      }
      showMsg('Datei geladen. „Import" klicken — Format wird automatisch erkannt.', 'ok');
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  function doCopy() {
    const ta = rootEl.querySelector('#io-text');
    ta.select();
    try {
      document.execCommand('copy');
      showMsg('In Zwischenablage kopiert.', 'ok');
    } catch (e) {
      showMsg('Kopieren fehlgeschlagen.', 'err');
    }
  }

  function doDownload() {
    const fmt = getFormat();
    if (!fmt) return;
    const text = state.textValue;
    if (!text) return showMsg('Nichts zum Herunterladen.', 'err');
    const blob = new Blob([text], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'deck-export' + (fmt.fileExtension || '.txt');
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function showMsg(msg, kind) {
    const el = rootEl.querySelector('#io-msg');
    el.textContent = msg;
    el.className = 'mt-3 text-sm ' + (kind === 'err' ? 'text-red-400' : kind === 'ok' ? 'text-emerald-400' : 'text-slate-400');
  }

  const { escapeHtml } = window.Util;

  // ============================================================================
  // Trade-Modal: Wants-/Fehlende-Liste eines anderen Users beantworten.
  // Phase 1: Liste einfuegen. Phase 2: Lieferansicht (Bilder/Text), Variant-
  // Substitut, Liefermenge, Gesamtwert. Action: lieferbare Karten aus eigener
  // Collection entfernen + Antwort-Text exportieren.
  // ============================================================================

  const tradeState = {
    rawText: '',
    entries: [],  // pro Eintrag: {cardId, requestedVariant, wantsCount, deliverVariant, deliverCount, deliverableVariants}
    view: 'tiles' // 'tiles' | 'text'
  };

  function openTradeDialog() {
    tradeState.rawText = '';
    tradeState.entries = [];
    tradeState.view = Prefs.get('tradeView', 'tiles');
    tradeState.sort = Prefs.get('tradeSort', 'id');
    renderTradeModal();
  }

  // Sortiert tradeState.entries in-place. Wird vor jedem Re-Render aufgerufen,
  // damit DOM-Indizes (data-trade-inc) konsistent zum Array bleiben.
  function applyTradeSort() {
    const mode = tradeState.sort || 'id';
    const priceOf = e => {
      const p = (window.CM && CM.getForVariant) ? CM.getForVariant(e.deliverVariant) : null;
      return p && p.low != null ? p.low : 0;
    };
    const availRank = e => {
      if (e.deliverableVariants.length === 0) return 2;          // ✗
      return e.deliverVariant === e.requestedVariant ? 0 : 1;     // ✓ vs. ⚠
    };
    tradeState.entries.sort((a, b) => {
      if (mode === 'price') {
        const d = priceOf(b) - priceOf(a);
        if (d !== 0) return d;
      } else if (mode === 'available') {
        const d = availRank(a) - availRank(b);
        if (d !== 0) return d;
      }
      if (a.cardId !== b.cardId) return a.cardId.localeCompare(b.cardId);
      return a.requestedVariant.localeCompare(b.requestedVariant);
    });
  }

  function tradeHost() {
    let host = document.getElementById('trade-modal-root');
    if (!host) {
      host = document.createElement('div');
      host.id = 'trade-modal-root';
      document.body.appendChild(host);
    }
    return host;
  }

  function closeTradeModal() {
    const host = document.getElementById('trade-modal-root');
    if (host) host.innerHTML = '';
    document.removeEventListener('keydown', tradeEscListener);
  }

  function tradeEscListener(e) { if (e.key === 'Escape') closeTradeModal(); }

  function renderTradeModal() {
    const host = tradeHost();
    if (!tradeState.entries.length) renderTradePhase1(host);
    else renderTradePhase2(host);
    document.addEventListener('keydown', tradeEscListener);
  }

  function renderTradePhase1(host) {
    host.innerHTML = `
      <div class="modal-backdrop" id="trade-modal">
        <div class="modal-content w-[680px] max-w-[95vw]">
          <div class="flex justify-between items-start mb-3">
            <div>
              <h2 class="text-lg font-bold">Wants beantworten</h2>
              <div class="text-xs text-slate-400 mt-1">Liste des anderen Users hier einfügen — Cardmarket-Format, Plain-Text oder Compact (Format wird automatisch erkannt).</div>
            </div>
            <button id="trade-close" class="text-slate-400 hover:text-white text-2xl leading-none">×</button>
          </div>
          <textarea id="trade-text" rows="12"
            class="w-full bg-slate-900 border border-slate-600 rounded p-3 font-mono text-xs"
            placeholder="4x Agumon BT5-006&#10;3x Veedramon BT11-029 (V.2)&#10;..."></textarea>
          <div id="trade-msg" class="text-sm mt-2 min-h-[1.25rem] text-slate-400"></div>
          <div class="flex justify-end gap-2 mt-3">
            <button id="trade-cancel" class="bg-slate-700 hover:bg-slate-600 px-3 py-1.5 rounded text-sm">Abbrechen</button>
            <button id="trade-load" class="bg-sky-500 text-slate-900 hover:bg-sky-400 px-4 py-1.5 rounded text-sm font-semibold">Liste übernehmen</button>
          </div>
        </div>
      </div>
    `;
    host.querySelector('#trade-close').addEventListener('click', closeTradeModal);
    host.querySelector('#trade-cancel').addEventListener('click', closeTradeModal);
    host.querySelector('#trade-modal').addEventListener('click', e => {
      if (e.target.id === 'trade-modal') closeTradeModal();
    });
    host.querySelector('#trade-load').addEventListener('click', () => {
      const text = host.querySelector('#trade-text').value;
      if (!text.trim()) { host.querySelector('#trade-msg').textContent = 'Textfeld ist leer.'; return; }
      const auto = autoDetectFormat(text);
      if (!auto || auto.valid === 0) {
        host.querySelector('#trade-msg').textContent = 'Format nicht erkannt — keine gültigen Einträge.';
        return;
      }
      tradeState.rawText = text;
      tradeState.entries = buildTradeEntries(auto.result.entries);
      renderTradeModal();
    });
  }

  // Baut den vollständigen Trade-State aus Sender-Einträgen.
  function buildTradeEntries(entries) {
    const coll = Store.loadCollection();
    const vIdx = Store.buildVariantIndex(coll);
    return entries.map(e => {
      const card = CardDB.byId.get(e.cardId);
      const variants = card ? CardDB.variantsOf(card) : [];
      // Lieferbare Varianten: alle mit free > 0, exact zuerst, dann nach free desc.
      const deliverable = variants
        .map(v => {
          const ov = vIdx[v.key] || {};
          return { key: v.key, free: (ov.freeReal || 0) + (ov.freeProxy || 0), owned: (ov.real || 0) + (ov.proxy || 0), isExact: v.key === e.variant };
        })
        .filter(d => d.free > 0)
        .sort((a, b) => (a.isExact ? -1 : 1) - (b.isExact ? -1 : 1) || b.free - a.free);
      const chosen = deliverable[0] || { key: e.variant, free: 0, owned: 0, isExact: true };
      return {
        cardId: e.cardId,
        requestedVariant: e.variant,
        wantsCount: Math.max(1, e.count || 1),
        deliverVariant: chosen.key,
        deliverCount: Math.min(e.count || 1, chosen.free),
        deliverableVariants: deliverable
      };
    });
  }

  function tradeTotals() {
    let cardsDeliverable = 0;
    let cardsMissing = 0;
    let valueSum = 0;
    let noPriceCount = 0;
    for (const e of tradeState.entries) {
      const lieferbar = e.deliverableVariants.length > 0;
      if (lieferbar && e.deliverCount > 0) cardsDeliverable += e.deliverCount;
      const missing = e.wantsCount - (lieferbar ? e.deliverCount : 0);
      if (missing > 0) cardsMissing += missing;
      if (e.deliverCount > 0) {
        const p = (window.CM && CM.getForVariant) ? CM.getForVariant(e.deliverVariant) : null;
        if (p && p.low != null) valueSum += p.low * e.deliverCount;
        else noPriceCount += e.deliverCount;
      }
    }
    return { cardsDeliverable, cardsMissing, valueSum, noPriceCount };
  }

  function renderTradePhase2(host) {
    const totals = tradeTotals();
    host.innerHTML = `
      <div class="modal-backdrop" id="trade-modal">
        <div class="modal-content w-[960px] max-w-[95vw] max-h-[92vh] flex flex-col">
          <div class="flex justify-between items-start mb-3 shrink-0">
            <div>
              <h2 class="text-lg font-bold">Trade fulfillen</h2>
              <div class="text-xs text-slate-400 mt-1">${tradeState.entries.length} Karten in der Wants-Liste. Liefer-Variante und Menge pro Eintrag anpassbar; Cross-Variant-Substitute werden automatisch vorgeschlagen.</div>
            </div>
            <button id="trade-close" class="text-slate-400 hover:text-white text-2xl leading-none">×</button>
          </div>
          <div class="flex items-center gap-2 mb-3 text-sm shrink-0 flex-wrap">
            <span class="text-slate-400">Ansicht:</span>
            <select id="trade-view" class="bg-slate-800 border border-slate-600 rounded px-2 py-1">
              <option value="tiles" ${tradeState.view === 'tiles' ? 'selected' : ''}>Bilder</option>
              <option value="text"  ${tradeState.view === 'text'  ? 'selected' : ''}>Text</option>
            </select>
            <span class="text-slate-400">Sortierung:</span>
            <select id="trade-sort" class="bg-slate-800 border border-slate-600 rounded px-2 py-1">
              <option value="id"        ${tradeState.sort === 'id'        ? 'selected' : ''}>ID</option>
              <option value="price"     ${tradeState.sort === 'price'     ? 'selected' : ''}>Preis ↓</option>
              <option value="available" ${tradeState.sort === 'available' ? 'selected' : ''}>Verfügbarkeit</option>
            </select>
            <button id="trade-reset" class="ml-auto text-xs text-slate-400 hover:text-slate-200 underline">Liste zurücksetzen</button>
          </div>
          <div id="trade-body" class="overflow-y-auto flex-1 min-h-0 pr-1"></div>
          <div id="trade-totals" class="text-sm mt-3 shrink-0 bg-slate-900 rounded p-3"></div>
          <div class="flex justify-end gap-2 mt-3 shrink-0">
            <button id="trade-cancel" class="bg-slate-700 hover:bg-slate-600 px-3 py-1.5 rounded text-sm">Abbrechen</button>
            <button id="trade-remove" class="bg-red-600 hover:bg-red-500 text-white px-4 py-1.5 rounded text-sm font-semibold">Aus Collection entfernen</button>
          </div>
        </div>
      </div>
    `;
    renderTradeBody();
    renderTradeTotals();
    host.querySelector('#trade-close').addEventListener('click', closeTradeModal);
    host.querySelector('#trade-cancel').addEventListener('click', closeTradeModal);
    host.querySelector('#trade-modal').addEventListener('click', e => {
      if (e.target.id === 'trade-modal') closeTradeModal();
    });
    host.querySelector('#trade-sort').addEventListener('change', e => {
      tradeState.sort = e.target.value;
      Prefs.set('tradeSort', tradeState.sort);
      renderTradeBody();
    });
    host.querySelector('#trade-view').addEventListener('change', e => {
      tradeState.view = e.target.value;
      Prefs.set('tradeView', tradeState.view);
      renderTradeBody();
    });
    host.querySelector('#trade-reset').addEventListener('click', () => {
      tradeState.entries = [];
      renderTradeModal();
    });
    host.querySelector('#trade-remove').addEventListener('click', confirmRemoveFromCollection);
  }

  function renderTradeBody() {
    const body = document.querySelector('#trade-body');
    if (!body) return;
    applyTradeSort();
    const prevScroll = body.scrollTop;
    body.innerHTML = tradeState.view === 'text' ? renderTradeText() : renderTradeTiles();
    wireTradeEntries(body);
    body.scrollTop = prevScroll;
  }

  function renderTradeTotals() {
    const el = document.querySelector('#trade-totals');
    if (!el) return;
    const t = tradeTotals();
    el.innerHTML = `
      <div class="flex flex-wrap gap-x-6 gap-y-1">
        <div><span class="text-slate-400">Lieferbar:</span> <b class="text-emerald-400">${t.cardsDeliverable}</b></div>
        <div><span class="text-slate-400">Nicht abgedeckt:</span> <b class="${t.cardsMissing > 0 ? 'text-red-400' : 'text-slate-500'}">${t.cardsMissing}</b></div>
        <div class="ml-auto"><span class="text-slate-400">Gesamtwert (CM low):</span> <b class="text-amber-400">${Fmt.eur(t.valueSum)}</b>${t.noPriceCount > 0 ? ` <span class="text-slate-500 text-xs">(${t.noPriceCount} ohne CM-Preis)</span>` : ''}</div>
      </div>
    `;
  }

  function renderTradeTiles() {
    return `<div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">${tradeState.entries.map((e, i) => renderTradeTile(e, i)).join('')}</div>`;
  }

  function renderTradeTile(entry, idx) {
    const card = CardDB.byId.get(entry.cardId);
    const name = card ? CardDB.cleanDisplayName(card) : entry.cardId;
    const hasDeliverable = entry.deliverableVariants.length > 0;
    const isExact = hasDeliverable && entry.deliverVariant === entry.requestedVariant;
    const isSubstitute = hasDeliverable && !isExact;
    const statusBadge = !hasDeliverable
      ? `<span class="text-rose-400 text-[10px] font-semibold">✗ nicht lieferbar</span>`
      : isSubstitute
        ? `<span class="text-amber-300 text-[10px] font-semibold" title="Andere Variante als Sender wollte">⚠ Substitut</span>`
        : `<span class="text-emerald-400 text-[10px] font-semibold">✓ exakt</span>`;
    const chosen = entry.deliverableVariants.find(v => v.key === entry.deliverVariant) || { free: 0, owned: 0 };
    const cm = (window.CM && CM.getForVariant) ? CM.getForVariant(entry.deliverVariant) : null;
    const cmText = (window.CM && CM.fmtLowTrend) ? CM.fmtLowTrend(cm) : null;
    const max = chosen.free;
    const cls = !hasDeliverable ? 'opacity-50' : (isSubstitute ? 'ring-1 ring-amber-500/40' : '');
    const variantOptions = entry.deliverableVariants.length > 1
      ? `<select data-tradevar-idx="${idx}" class="bg-slate-900 border border-slate-600 rounded px-1 py-0.5 text-xs font-mono w-full">
          ${entry.deliverableVariants.map(d => `<option value="${escapeHtml(d.key)}" ${d.key === entry.deliverVariant ? 'selected' : ''}>${escapeHtml(d.key)} (${d.free} frei)</option>`).join('')}
        </select>`
      : `<div class="text-xs font-mono text-slate-400 truncate" title="${escapeHtml(entry.deliverVariant)}">${escapeHtml(entry.deliverVariant)}</div>`;
    return `<div class="bg-slate-900 rounded p-2 ${cls}">
      <img loading="lazy" src="${CardDB.imagePath(entry.deliverVariant)}" alt="" class="w-full aspect-[5/7] object-cover rounded mb-2" />
      <div class="flex items-center justify-between gap-2 mb-1">
        ${statusBadge}
        ${cmText ? `<span class="text-amber-400 text-[10px] font-semibold" title="Cardmarket low / trend">${cmText}</span>` : '<span class="text-slate-500 text-[10px]">CM</span>'}
      </div>
      <div class="text-sm font-semibold truncate" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
      <div class="text-[10px] text-slate-300 mt-0.5">Wants: ${entry.wantsCount}× ${escapeHtml(entry.requestedVariant)}</div>
      <div class="mt-1">${variantOptions}</div>
      <div class="text-[10px] text-slate-300 mt-0.5">${chosen.free} frei / ${chosen.owned} Besitz</div>
      <div class="flex items-center justify-center gap-2 mt-2">
        <button data-trade-dec="${idx}" class="wants-qty-btn" ${entry.deliverCount === 0 ? 'disabled' : ''}>−</button>
        <span class="font-bold text-emerald-400 tabular-nums w-10 text-center">${entry.deliverCount}/${entry.wantsCount}</span>
        <button data-trade-inc="${idx}" class="wants-qty-btn" ${entry.deliverCount >= max || entry.deliverCount >= entry.wantsCount ? 'disabled' : ''}>+</button>
      </div>
    </div>`;
  }

  function renderTradeText() {
    const rows = tradeState.entries.map((e, i) => renderTradeRow(e, i)).join('');
    return `<table class="wants-table w-full"><thead>
      <tr class="text-xs uppercase text-slate-500">
        <th class="py-2 pr-3 text-left">Status</th>
        <th class="py-2 pr-3 text-left">Karte</th>
        <th class="py-2 pr-3 text-left">Wants</th>
        <th class="py-2 pr-3 text-left">Liefer-Variante</th>
        <th class="py-2 pr-3 text-right">CM</th>
        <th class="py-2 pr-3 text-center">Liefermenge</th>
      </tr></thead><tbody>${rows}</tbody></table>`;
  }

  function renderTradeRow(entry, idx) {
    const card = CardDB.byId.get(entry.cardId);
    const name = card ? CardDB.cleanDisplayName(card) : entry.cardId;
    const hasDeliverable = entry.deliverableVariants.length > 0;
    const isExact = hasDeliverable && entry.deliverVariant === entry.requestedVariant;
    const isSubstitute = hasDeliverable && !isExact;
    const statusHtml = !hasDeliverable
      ? `<span class="text-rose-400 font-semibold">✗</span>`
      : isSubstitute
        ? `<span class="text-amber-300 font-semibold" title="Substitut-Variante">⚠</span>`
        : `<span class="text-emerald-400 font-semibold">✓</span>`;
    const chosen = entry.deliverableVariants.find(v => v.key === entry.deliverVariant) || { free: 0, owned: 0 };
    const cm = (window.CM && CM.getForVariant) ? CM.getForVariant(entry.deliverVariant) : null;
    const cmText = (window.CM && CM.fmtLowTrend) ? (CM.fmtLowTrend(cm) || 'CM') : '—';
    const max = chosen.free;
    const variantOptions = entry.deliverableVariants.length > 1
      ? `<select data-tradevar-idx="${idx}" class="bg-slate-900 border border-slate-600 rounded px-1 py-0.5 text-xs font-mono">
          ${entry.deliverableVariants.map(d => `<option value="${escapeHtml(d.key)}" ${d.key === entry.deliverVariant ? 'selected' : ''}>${escapeHtml(d.key)} (${d.free})</option>`).join('')}
        </select>`
      : `<span class="font-mono text-xs text-slate-400">${escapeHtml(entry.deliverVariant)}</span>`;
    const rowCls = !hasDeliverable ? 'opacity-50' : (isSubstitute ? 'bg-amber-900/15' : '');
    return `<tr class="hover:bg-slate-700/40 ${rowCls}">
      <td class="py-1 pr-3">${statusHtml}</td>
      <td class="py-1 pr-3 text-sm">${escapeHtml(name)}</td>
      <td class="py-1 pr-3 text-xs font-mono text-slate-300">${entry.wantsCount}× ${escapeHtml(entry.requestedVariant)}</td>
      <td class="py-1 pr-3">${variantOptions} <span class="text-[10px] text-slate-300">(${chosen.free} frei / ${chosen.owned} Besitz)</span></td>
      <td class="py-1 pr-3 text-amber-400 text-xs tabular-nums text-right whitespace-nowrap" title="Cardmarket low / trend">${cmText}</td>
      <td class="py-1 pr-3 text-center whitespace-nowrap">
        <span class="inline-flex items-center gap-1">
          <button data-trade-dec="${idx}" class="wants-qty-btn" ${entry.deliverCount === 0 ? 'disabled' : ''}>−</button>
          <span class="font-bold text-emerald-400 tabular-nums w-10 text-center">${entry.deliverCount}/${entry.wantsCount}</span>
          <button data-trade-inc="${idx}" class="wants-qty-btn" ${entry.deliverCount >= max || entry.deliverCount >= entry.wantsCount ? 'disabled' : ''}>+</button>
        </span>
      </td>
    </tr>`;
  }

  function wireTradeEntries(scope) {
    scope.querySelectorAll('[data-trade-inc]').forEach(btn => {
      btn.addEventListener('click', () => modifyTradeDeliver(parseInt(btn.dataset.tradeInc, 10), 1));
    });
    scope.querySelectorAll('[data-trade-dec]').forEach(btn => {
      btn.addEventListener('click', () => modifyTradeDeliver(parseInt(btn.dataset.tradeDec, 10), -1));
    });
    scope.querySelectorAll('[data-tradevar-idx]').forEach(sel => {
      sel.addEventListener('change', e => {
        const idx = parseInt(sel.dataset.tradevarIdx, 10);
        const entry = tradeState.entries[idx];
        if (!entry) return;
        entry.deliverVariant = e.target.value;
        const chosen = entry.deliverableVariants.find(v => v.key === entry.deliverVariant);
        const max = chosen ? chosen.free : 0;
        if (entry.deliverCount > max) entry.deliverCount = max;
        if (entry.deliverCount > entry.wantsCount) entry.deliverCount = entry.wantsCount;
        renderTradeBody();
        renderTradeTotals();
      });
    });
  }

  function modifyTradeDeliver(idx, delta) {
    const entry = tradeState.entries[idx];
    if (!entry) return;
    const chosen = entry.deliverableVariants.find(v => v.key === entry.deliverVariant);
    const max = Math.min(chosen ? chosen.free : 0, entry.wantsCount);
    const next = Math.max(0, Math.min(max, entry.deliverCount + delta));
    if (next === entry.deliverCount) return;
    entry.deliverCount = next;
    renderTradeBody();
    renderTradeTotals();
  }

  function confirmRemoveFromCollection() {
    const t = tradeTotals();
    if (t.cardsDeliverable === 0) {
      alert('Keine Karten zum Entfernen ausgewählt.');
      return;
    }
    const msg = `${t.cardsDeliverable} Karten (CM ≈ ${Fmt.eur(t.valueSum)}) werden aus deiner Collection entfernt. Fortfahren?`;
    if (!confirm(msg)) return;

    // Pro Variante: deliverCount freie reale Kopien loeschen.
    const coll = Store.loadCollection();
    const removedPerVariant = new Map();
    for (const e of tradeState.entries) {
      if (e.deliverCount <= 0) continue;
      const free = Store.copiesOfVariant(coll, e.deliverVariant)
        .filter(c => !c.isProxy && c.deckId === null)
        .sort((a, b) => (a.addedAt || '').localeCompare(b.addedAt || ''));
      let n = 0;
      for (const c of free) {
        if (n >= e.deliverCount) break;
        Store.deleteCopy(coll, c.id);
        n++;
      }
      if (n > 0) removedPerVariant.set(e.deliverVariant, (removedPerVariant.get(e.deliverVariant) || 0) + n);
    }
    Store.saveCollection(coll);

    // Antwort-Text aufbauen.
    const lines = [];
    for (const [variant, n] of removedPerVariant) {
      const info = CardDB.allVariants.get(variant);
      const card = info ? CardDB.byId.get(info.cardId) : null;
      const name = card ? CardDB.cleanDisplayName(card) : variant;
      lines.push(`${n} ${name} ${variant}`);
    }
    showTradeResult(lines.join('\n') + '\n', t.cardsDeliverable);
  }

  function showTradeResult(text, count) {
    const host = tradeHost();
    host.innerHTML = `
      <div class="modal-backdrop" id="trade-modal">
        <div class="modal-content w-[640px] max-w-[95vw]">
          <div class="flex justify-between items-start mb-3">
            <div>
              <h2 class="text-lg font-bold text-emerald-400">✓ ${count} Karten aus Collection entfernt</h2>
              <div class="text-xs text-slate-400 mt-1">Den Text unten an den Sender geben — er kann ihn im Listen-Import einlesen (Plain-Text, automatisch erkannt).</div>
            </div>
            <button id="trade-close" class="text-slate-400 hover:text-white text-2xl leading-none">×</button>
          </div>
          <textarea id="trade-result-text" rows="12" readonly class="w-full bg-slate-900 border border-slate-600 rounded p-3 font-mono text-xs">${escapeHtml(text)}</textarea>
          <div class="flex justify-end gap-2 mt-3">
            <button id="trade-result-copy" class="bg-emerald-500 text-slate-900 hover:bg-emerald-400 px-4 py-1.5 rounded text-sm font-semibold">In Zwischenablage kopieren</button>
            <button id="trade-result-close" class="bg-slate-700 hover:bg-slate-600 px-3 py-1.5 rounded text-sm">Schließen</button>
          </div>
        </div>
      </div>
    `;
    host.querySelector('#trade-close').addEventListener('click', closeTradeModal);
    host.querySelector('#trade-result-close').addEventListener('click', closeTradeModal);
    host.querySelector('#trade-result-copy').addEventListener('click', () => {
      const btn = host.querySelector('#trade-result-copy');
      const orig = btn.textContent;
      const finish = ok => { btn.textContent = ok ? '✓ Kopiert' : 'Kopieren fehlgeschlagen'; setTimeout(() => { btn.textContent = orig; }, 1500); };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => finish(true), () => finish(false));
      } else {
        const ta = host.querySelector('#trade-result-text');
        ta.select();
        try { finish(document.execCommand('copy')); } catch (e) { finish(false); }
      }
    });
  }

  window.UIImportExport = { init };
})();
