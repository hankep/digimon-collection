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
            <div class="text-xs text-slate-400 mb-1">Format</div>
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

  function doImport() {
    const fmt = getFormat();
    if (!fmt) return showMsg('Kein Format gewählt.', 'err');
    const text = state.textValue.trim();
    if (!text) return showMsg('Textfeld ist leer.', 'err');
    try {
      const result = fmt.importDeck(text);

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
        const samples = unknownEntries.slice(0, 5).map(e => e.cardId + (e.variant !== e.cardId ? ' / ' + e.variant : ''))
          .concat(unknownFromFormat.slice(0, 5));
        const ok = confirm(
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
        `Importiert: "${deck.name}" mit ${deck.entries.length} Einträgen` +
        (skipped ? ` (${skipped} übersprungen)` : '') +
        '. Sichtbar unter Decks & Lists.',
        'ok'
      );
    } catch (e) {
      showMsg('Import-Fehler: ' + e.message, 'err');
    }
  }

  function loadFile(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      state.textValue = String(reader.result || '');
      rootEl.querySelector('#io-text').value = state.textValue;
      const ext = (file.name.match(/\.[^.]+$/) || [''])[0].toLowerCase();
      const match = (window.IO_FORMATS || []).find(f => (f.fileExtension || '').toLowerCase() === ext);
      if (match) {
        state.formatId = match.id;
        rootEl.querySelector('#format-select').value = match.id;
        showMsg(`Datei geladen, Format auf "${match.label}" gesetzt. Jetzt "Import" klicken.`, 'ok');
      } else {
        showMsg('Datei geladen. Format ggf. manuell wählen, dann "Import".', 'ok');
      }
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

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  window.UIImportExport = { init };
})();
