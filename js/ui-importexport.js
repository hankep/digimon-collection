// Listen Import/Export-Tab. Format-Plugins kommen aus window.IO_FORMATS.
// Collection-/Backup-/Login-Funktionen liegen in ui-user.js; Proxy-Export im Collection-Tab.

(function () {
  // Export laeuft direkt aus der Deckliste (Toolbar "Exportieren"); dieser Tab
  // ist nur noch fuer Import von Listen-Text und Cardmarket-Daten.
  const state = {
    textValue: '',
    cardImportMode: 'cardmarket' // 'cardmarket' | 'standard'
  };
  let rootEl = null;

  function init(el) {
    rootEl = el;
    const stored = Prefs.get(window.Util.PREF_KEYS.cardImportMode, 'cardmarket');
    state.cardImportMode = stored === 'standard' ? 'standard' : 'cardmarket';
    render();
  }

  function render() {
    rootEl.innerHTML = `
      <div class="max-w-3xl mx-auto">
        <h2 class="text-lg font-bold mb-3">Listen-Import</h2>
        <p class="text-sm text-slate-400 mb-3">
          Text einer Liste hier einfuegen — Format wird automatisch erkannt. Export laeuft direkt aus der Deckliste (Decks-Tab → Exportieren).
        </p>

        <textarea id="io-text" rows="18"
          class="w-full bg-slate-900 border border-slate-600 rounded p-3 font-mono text-xs"
          placeholder="Text zum Import einfuegen…">${escapeHtml(state.textValue)}</textarea>

        <div class="flex gap-2 mt-3 flex-wrap items-center">
          <button id="do-import" class="bg-emerald-500 text-slate-900 px-4 py-2 rounded font-semibold">← Import (als neue Liste)</button>
          <input id="import-name" type="text" placeholder="Name der neuen Liste (optional)"
            class="bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm flex-1 min-w-[200px]" />
          <button id="do-clear" class="ml-auto text-slate-400 hover:text-slate-200 px-4 py-2">Leeren</button>
        </div>
        <div id="io-msg" class="mt-3 text-sm"></div>

        <hr class="border-slate-700 my-6" />

        <h2 class="text-lg font-bold mb-2">Karten-Import</h2>
        <div class="flex gap-2 mb-3" id="cm-mode-tabs">
          <button data-cm-mode="cardmarket" class="px-3 py-1.5 rounded text-sm font-semibold cm-mode-btn">Cardmarket</button>
          <button data-cm-mode="standard" class="px-3 py-1.5 rounded text-sm font-semibold cm-mode-btn">Standard</button>
        </div>
        <p id="cm-desc" class="text-sm text-slate-400 mb-3"></p>
        <div class="flex flex-wrap gap-2 mb-2 items-center">
          <label class="bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded cursor-pointer text-sm">
            Datei laden…
            <input id="cm-file" type="file" accept=".txt,text/plain" class="hidden" />
          </label>
          <label id="cm-price-wrap" class="hidden items-center gap-2 text-sm">
            <span class="text-slate-400">Preis je Karte:</span>
            <input id="cm-price" type="number" step="0.01" min="0" value="0.05"
              class="bg-slate-900 border border-slate-600 rounded px-2 py-1.5 text-sm w-24" />
            <span class="text-slate-400">€</span>
          </label>
          <button id="cm-clear" class="text-slate-400 hover:text-slate-200 px-4 py-2 text-sm">Leeren</button>
        </div>
        <textarea id="cm-text" rows="10"
          class="w-full bg-slate-900 border border-slate-600 rounded p-3 font-mono text-xs mb-2"></textarea>
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

    rootEl.querySelector('#io-text').addEventListener('input', e => { state.textValue = e.target.value; });
    rootEl.querySelector('#do-import').addEventListener('click', doImport);
    rootEl.querySelector('#do-clear').addEventListener('click', () => {
      state.textValue = '';
      rootEl.querySelector('#io-text').value = '';
      showMsg('', '');
    });

    rootEl.querySelector('#cm-file').addEventListener('change', cmLoadFile);
    rootEl.querySelector('#cm-clear').addEventListener('click', () => {
      rootEl.querySelector('#cm-text').value = '';
      rootEl.querySelector('#cm-preview-out').innerHTML = '';
      showCmMsg('', '');
    });
    rootEl.querySelector('#cm-preview').addEventListener('click', cmPreview);
    rootEl.querySelector('#cm-apply').addEventListener('click', cmApply);
    rootEl.querySelector('#trade-open').addEventListener('click', openTradeDialog);

    rootEl.querySelectorAll('#cm-mode-tabs [data-cm-mode]').forEach(btn => {
      btn.addEventListener('click', () => setCardImportMode(btn.dataset.cmMode));
    });
    applyCardImportModeUI();
  }

  // --- Karten-Import (Cardmarket / Standard) -------------------------------

  // Modus persistieren, UI (Tabs, Beschreibung, Placeholder, Preisfeld) neu
  // synchronisieren und alte Vorschau verwerfen.
  function setCardImportMode(mode) {
    state.cardImportMode = mode === 'standard' ? 'standard' : 'cardmarket';
    Prefs.set(window.Util.PREF_KEYS.cardImportMode, state.cardImportMode);
    rootEl.querySelector('#cm-preview-out').innerHTML = '';
    showCmMsg('', '');
    applyCardImportModeUI();
  }

  function applyCardImportModeUI() {
    const standard = state.cardImportMode === 'standard';
    rootEl.querySelectorAll('#cm-mode-tabs [data-cm-mode]').forEach(b => {
      const on = b.dataset.cmMode === state.cardImportMode;
      b.classList.toggle('bg-amber-500', on);
      b.classList.toggle('text-slate-900', on);
      b.classList.toggle('bg-slate-700', !on);
      b.classList.toggle('hover:bg-slate-600', !on);
      b.classList.toggle('text-slate-100', !on);
    });
    const desc = rootEl.querySelector('#cm-desc');
    if (desc) {
      desc.innerHTML = standard
        ? 'Fügt Karten mit <b>Pauschalpreis</b> zur Sammlung hinzu. Eine Karte pro Zeile, z.B. <span class="font-mono">4x Agumon BT26-02</span> oder <span class="font-mono">3 BT1-001</span>.'
        : 'Fügt Karten <b>inkl. Preis</b> zur Sammlung hinzu. Paste die Bestelldetails (Name + ID + V.X + Preis) aus Cardmarket.';
    }
    const priceWrap = rootEl.querySelector('#cm-price-wrap');
    if (priceWrap) {
      priceWrap.classList.toggle('hidden', !standard);
      priceWrap.classList.toggle('flex', standard);
    }
    const ta = rootEl.querySelector('#cm-text');
    if (ta) {
      ta.placeholder = standard
        ? '4x Agumon BT26-02\n3 BT1-001\n2x ST1-007'
        : '1x  Taiki, Kiriha, & Nene (BT11-095) (V.1)\n#BT11-095\nAD-01\nNM\n0,20 €\n\n...';
    }
  }

  // Liest das Pauschalpreis-Feld; leer/ungültig → Fallback 0,05 €.
  function cmStandardPrice() {
    const el = rootEl.querySelector('#cm-price');
    const v = el ? Number(el.value) : NaN;
    return (el && el.value.trim() !== '' && !Number.isNaN(v) && v >= 0) ? v : 0.05;
  }

  // Parst den Eingabetext gemäß aktivem Modus → { items, unknown }.
  function cmParseCurrent(text) {
    return state.cardImportMode === 'standard'
      ? Cardmarket.parseStandard(text, cmStandardPrice())
      : Cardmarket.parse(text);
  }

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
    const { items, unknown } = cmParseCurrent(text);
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
    const { items, unknown } = cmParseCurrent(text);
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

    const contentHtml = `
      <div class="flex justify-between items-start mb-3">
        <div>
          <h2 class="text-lg font-bold">Andere Varianten in Wants gefunden</h2>
          <div class="text-xs text-slate-400 mt-1">Exakte Treffer werden ohnehin abgezogen. Hier geht's um Wants-Einträge mit derselben Card-ID, aber anderer Variante.</div>
        </div>
        <button data-modal-cancel class="modal-close-x">×</button>
      </div>

      <div class="max-h-[50vh] overflow-y-auto border border-slate-700 rounded p-2 mb-3">
        ${rows || '<div class="text-sm text-slate-500 px-2 py-1">Nichts zu fragen.</div>'}
      </div>

      <div class="flex gap-2 mb-3 text-xs">
        <button id="cv-all" class="text-amber-400 hover:underline">Alle aktivieren</button>
        <button id="cv-none" class="text-slate-400 hover:underline">Alle abwählen</button>
      </div>

      <div class="flex justify-end gap-2">
        <button data-modal-cancel class="btn-secondary">Überspringen</button>
        <button id="cv-go" class="btn-primary-emerald">Übernehmen</button>
      </div>
    `;

    let confirmed = false;
    window.Util.openModal({
      host: 'cv-import-root',
      id: 'cv-import-modal',
      sizeClass: 'w-[640px] max-w-[95vw]',
      contentHtml,
      onClose: () => { if (!confirmed) finishCmApply(items, null); },
      onMount: (content, close) => {
        content.querySelectorAll('[data-modal-cancel]').forEach(btn => btn.addEventListener('click', close));
        content.querySelector('#cv-all').addEventListener('click', () => {
          content.querySelectorAll('input[data-cv-idx]').forEach(cb => { cb.checked = true; });
        });
        content.querySelector('#cv-none').addEventListener('click', () => {
          content.querySelectorAll('input[data-cv-idx]').forEach(cb => { cb.checked = false; });
        });
        content.querySelector('#cv-go').addEventListener('click', () => {
          const accepted = Array.from(content.querySelectorAll('input[data-cv-idx]:checked'))
            .map(cb => {
              const c = candidates[parseInt(cb.dataset.cvIdx, 10)];
              return c ? { deckId: c.deckId, cardId: c.cardId, wantsVariant: c.wantsVariant, take: c.maxTake } : null;
            })
            .filter(Boolean);
          confirmed = true;
          close();
          finishCmApply(items, { acceptCrossVariant: accepted });
        });
      }
    });
  }

  function showCmMsg(msg, kind) {
    const el = rootEl.querySelector('#cm-msg');
    el.textContent = msg;
    el.className = 'mt-3 text-sm ' + (kind === 'err' ? 'text-red-400' : kind === 'ok' ? 'text-emerald-400' : 'text-slate-400');
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

  // Trade-Flow als State-Machine: 'input' (Phase 1, Textarea) → 'review'
  // (Phase 2, Lieferansicht) → 'result' (Text fuer den Sender + Kopier-Button).
  const tradeState = {
    phase: 'input',
    rawText: '',
    source: 'own',    // 'own' | 'others' — gegen welche Pool-Quelle gecheckt wird
    entries: [],  // pro Eintrag: {cardId, requestedVariant, wantsCount, deliverVariant, deliverCount, deliverableVariants}
    othersGroups: [], // [{ownerId, displayName, email, deliverable: [{cardId, variant, requestedVariant, requestedCount, deliverCount, isExact}], totals}]
    othersLoading: false,
    othersError: null,
    view: 'tiles', // 'tiles' | 'text'
    sort: 'id',
    resultText: '',
    resultCount: 0
  };

  function openTradeDialog() {
    tradeState.phase = 'input';
    tradeState.rawText = '';
    tradeState.source = Prefs.get('tradeSource', 'own');
    if (tradeState.source !== 'others') tradeState.source = 'own';
    tradeState.entries = [];
    tradeState.othersGroups = [];
    tradeState.othersLoading = false;
    tradeState.othersError = null;
    tradeState.view = Prefs.get('tradeView', 'tiles');
    tradeState.sort = Prefs.get('tradeSort', 'id');
    tradeState.resultText = '';
    tradeState.resultCount = 0;
    renderTradeModal();
  }

  function setTradePhase(phase) {
    tradeState.phase = phase;
    renderTradeModal();
  }

  // Sortiert tradeState.entries in-place. Wird vor jedem Re-Render aufgerufen,
  // damit DOM-Indizes (data-trade-inc) konsistent zum Array bleiben.
  function applyTradeSort() {
    const mode = tradeState.sort || 'id';
    const priceOf = e => {
      const low = (window.CM && CM.lowForEntry) ? CM.lowForEntry(e.cardId, e.deliverVariant) : null;
      return low != null ? low : 0;
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

  // Aktuelles Modal-Handle (close-Funktion + content-Element), damit Phasenwechsel
  // sauber das alte ESC-Listener-Geruest schliesst, bevor das neue geoeffnet wird.
  let tradeModal = null;

  function closeTradeModal() {
    if (tradeModal) { tradeModal.close(); tradeModal = null; }
  }

  function renderTradeModal() {
    if (tradeState.phase === 'result') {
      renderTradePhaseResult();
    } else if (tradeState.phase === 'review') {
      renderTradePhase2();
    } else if (tradeState.phase === 'review-others') {
      renderTradePhaseOthers();
    } else {
      renderTradePhase1();
    }
  }

  function renderTradePhase1() {
    const contentHtml = `
      <div class="flex justify-between items-start mb-3">
        <div>
          <h2 class="text-lg font-bold">Wants beantworten</h2>
          <div class="text-xs text-slate-400 mt-1">Liste des anderen Users hier einfügen — Cardmarket-Format, Plain-Text oder Compact (Format wird automatisch erkannt).</div>
        </div>
        <button data-modal-close class="modal-close-x">×</button>
      </div>
      <div class="flex items-center gap-2 mb-3 text-sm flex-wrap">
        <span class="text-slate-400">Pool:</span>
        <label class="inline-flex items-center gap-1.5 cursor-pointer">
          <input type="radio" name="trade-source" value="own" ${tradeState.source === 'own' ? 'checked' : ''} class="accent-sky-500" />
          <span>Eigene Collection</span>
        </label>
        <label class="inline-flex items-center gap-1.5 cursor-pointer">
          <input type="radio" name="trade-source" value="others" ${tradeState.source === 'others' ? 'checked' : ''} class="accent-sky-500" />
          <span>Andere User (Collections)</span>
        </label>
      </div>
      <textarea id="trade-text" rows="12"
        class="w-full bg-slate-900 border border-slate-600 rounded p-3 font-mono text-xs"
        placeholder="4x Agumon BT5-006&#10;3x Veedramon BT11-029 (V.2)&#10;..."></textarea>
      <div id="trade-msg" class="text-sm mt-2 min-h-[1.25rem] text-slate-400"></div>
      <div class="flex justify-end gap-2 mt-3">
        <button data-modal-close class="btn-secondary">Abbrechen</button>
        <button id="trade-load" class="bg-sky-500 text-slate-900 hover:bg-sky-400 px-4 py-1.5 rounded text-sm font-semibold">${tradeState.source === 'others' ? 'Pruefen (read-only)' : 'Liste übernehmen'}</button>
      </div>
    `;
    tradeModal = window.Util.openModal({
      host: 'trade-modal-root',
      id: 'trade-modal',
      sizeClass: 'w-[680px] max-w-[95vw]',
      contentHtml,
      onClose: () => { tradeModal = null; },
      onMount: (content, close) => {
        content.querySelectorAll('[data-modal-close]').forEach(b => b.addEventListener('click', close));
        content.querySelectorAll('input[name="trade-source"]').forEach(r => {
          r.addEventListener('change', e => {
            tradeState.source = e.target.value;
            Prefs.set('tradeSource', tradeState.source);
            const loadBtn = content.querySelector('#trade-load');
            if (loadBtn) loadBtn.textContent = tradeState.source === 'others' ? 'Pruefen (read-only)' : 'Liste übernehmen';
          });
        });
        content.querySelector('#trade-load').addEventListener('click', async () => {
          const text = content.querySelector('#trade-text').value;
          const msg = content.querySelector('#trade-msg');
          if (!text.trim()) { msg.textContent = 'Textfeld ist leer.'; return; }
          const auto = autoDetectFormat(text);
          if (!auto || auto.valid === 0) {
            msg.textContent = 'Format nicht erkannt — keine gültigen Einträge.';
            return;
          }
          tradeState.rawText = text;
          if (tradeState.source === 'others') {
            if (!window.Sync || !Sync.isConfigured || !Sync.isConfigured() || !Sync.isLoggedIn()) {
              msg.textContent = 'Shared-Space-Sync nicht verfügbar (nicht eingeloggt).';
              return;
            }
            msg.textContent = 'Lade Collections der anderen User…';
            try {
              tradeState.othersGroups = await buildOthersTradeGroups(auto.result.entries);
              setTradePhase('review-others');
            } catch (err) {
              console.warn('trade others load failed:', err);
              msg.textContent = 'Fehler beim Laden der geteilten Collections.';
            }
          } else {
            tradeState.entries = buildTradeEntries(auto.result.entries);
            setTradePhase('review');
          }
        });
      }
    });
  }

  // Baut den vollständigen Trade-State aus Sender-Einträgen.
  // Proxies zaehlen hier bewusst NICHT als verfuegbar — beim Trade gibt man
  // physische Karten weg, Proxies passen dafuer nicht.
  function buildTradeEntries(entries) {
    const coll = Store.loadCollection();
    const vIdx = Store.getVariantIndex(coll);
    return entries.map(e => {
      const card = CardDB.byId.get(e.cardId);
      const variants = card ? CardDB.variantsOf(card) : [];
      // Lieferbare Varianten: alle mit free > 0, exact zuerst, dann nach free desc.
      const deliverable = variants
        .map(v => {
          const ov = vIdx[v.key] || {};
          return { key: v.key, free: (ov.freeReal || 0), owned: (ov.real || 0), isExact: v.key === e.variant };
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

  // Laedt die geteilten Collection-Rows (kind='collection') aller anderen User
  // und matched die Wants-Einträge dagegen. Liefert ein Array von Gruppen —
  // eine pro User, der mind. eine matching-Variante besitzt.
  //
  // Unterschied zur Trade-Listen-Logik:
  // - Keine Pool-Dekrementierung: gezeigt wird, was der User insgesamt besitzt.
  //   (Wenn er 1 Kopie hat und die Wants-Liste sie 3x will, bedeutet das nicht,
  //    dass er die 3 nicht liefern kann — er hat halt 1.)
  // - Frei und geslotted werden getrennt ausgewiesen: 'frei: X, geslotted: Y'.
  // - Auch nicht-exakte Varianten werden gezeigt, mit Substitut-Markierung.
  async function buildOthersTradeGroups(wantsEntries) {
    const me = Sync.getUserId();
    const { decks } = await Sync.loadSharedDecks('collection');
    const byOwner = new Map();
    for (const d of (decks || [])) {
      if (!d || d.owner_id === me) continue;
      if (!byOwner.has(d.owner_id)) {
        byOwner.set(d.owner_id, {
          ownerId: d.owner_id,
          email: d.owner_email || '',
          variantInfo: new Map()  // variantKey → { freeReal, freeProxy, slottedReal, slottedProxy }
        });
      }
      const rec = byOwner.get(d.owner_id);
      for (const e of (d.entries || [])) {
        if (!e || !e.variant) continue;
        rec.variantInfo.set(e.variant, {
          freeReal: Math.max(0, parseInt(e.freeReal, 10) || 0),
          freeProxy: Math.max(0, parseInt(e.freeProxy, 10) || 0),
          slottedReal: Math.max(0, parseInt(e.slottedReal, 10) || 0),
          slottedProxy: Math.max(0, parseInt(e.slottedProxy, 10) || 0)
        });
      }
    }
    if (!byOwner.size) return [];

    // Profile fuer Anzeigenamen.
    let profiles = new Map();
    try { profiles = await Sync.loadProfilesFor(Array.from(byOwner.keys())); }
    catch (err) { console.warn('loadProfilesFor failed:', err); }

    const groups = [];
    for (const rec of byOwner.values()) {
      const matches = [];
      let totalFree = 0, totalSlotted = 0;
      let totalLow = 0, totalTrend = 0;

      for (const w of wantsEntries) {
        const need = Math.max(1, w.count || 1);
        const card = CardDB.byId.get(w.cardId);
        const variantKeys = card ? CardDB.variantsOf(card).map(v => v.key) : [w.variant];
        // Exakte Variante zuerst pruefen, dann andere — fuer Sortierung im Tile.
        const ordered = [w.variant, ...variantKeys.filter(k => k !== w.variant)];
        for (const vk of ordered) {
          const info = rec.variantInfo.get(vk);
          if (!info) continue;
          const freeTotal = info.freeReal + info.freeProxy;
          const slottedTotal = info.slottedReal + info.slottedProxy;
          if (freeTotal + slottedTotal === 0) continue;
          const isExact = vk === w.variant;
          const p = (window.CM && CM.pricesForEntry) ? CM.pricesForEntry(w.cardId, vk) : { low: null, trend: null };
          // Wertbeitrag: gewichtet mit min(need, free+slotted) — fuer Anzeigesumme.
          const weight = Math.min(need, freeTotal + slottedTotal);
          if (p.low != null) totalLow += p.low * weight;
          if (p.trend != null) totalTrend += p.trend * weight;
          totalFree += freeTotal;
          totalSlotted += slottedTotal;
          matches.push({
            cardId: w.cardId,
            variant: vk,
            requestedVariant: w.variant,
            requestedCount: need,
            freeReal: info.freeReal,
            freeProxy: info.freeProxy,
            slottedReal: info.slottedReal,
            slottedProxy: info.slottedProxy,
            isExact
          });
        }
      }

      if (!matches.length) continue;
      const profileName = profiles.get(rec.ownerId);
      const fallback = (rec.email || '').split('@')[0] || '— ohne Anzeigename —';
      groups.push({
        ownerId: rec.ownerId,
        displayName: profileName || fallback,
        email: rec.email,
        matches,
        totals: { free: totalFree, slotted: totalSlotted, low: totalLow, trend: totalTrend }
      });
    }
    // Sortiere groups: User mit den meisten freien Treffern zuerst.
    groups.sort((a, b) => (b.totals.free - a.totals.free) || (b.totals.slotted - a.totals.slotted));
    return groups;
  }

  function tradeTotals() {
    let cardsDeliverable = 0;
    let cardsMissing = 0;
    let lowSum = 0, trendSum = 0;
    let noPriceCount = 0;
    for (const e of tradeState.entries) {
      const lieferbar = e.deliverableVariants.length > 0;
      if (lieferbar && e.deliverCount > 0) cardsDeliverable += e.deliverCount;
      const missing = e.wantsCount - (lieferbar ? e.deliverCount : 0);
      if (missing > 0) cardsMissing += missing;
      if (e.deliverCount > 0) {
        const p = (window.CM && CM.pricesForEntry) ? CM.pricesForEntry(e.cardId, e.deliverVariant) : { low: null, trend: null };
        if (p.low != null) lowSum += p.low * e.deliverCount;
        if (p.trend != null) trendSum += p.trend * e.deliverCount;
        if (p.low == null && p.trend == null) noPriceCount += e.deliverCount;
      }
    }
    return { cardsDeliverable, cardsMissing, lowSum, trendSum, noPriceCount };
  }

  function renderTradePhase2() {
    const contentHtml = `
      <div class="flex justify-between items-start mb-3 shrink-0">
        <div>
          <h2 class="text-lg font-bold">Trade fulfillen</h2>
          <div class="text-xs text-slate-400 mt-1">${tradeState.entries.length} Karten in der Wants-Liste. Liefer-Variante und Menge pro Eintrag anpassbar; Cross-Variant-Substitute werden automatisch vorgeschlagen.</div>
        </div>
        <button data-modal-close class="modal-close-x">×</button>
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
        <button data-modal-close class="btn-secondary">Abbrechen</button>
        <button id="trade-remove" class="bg-red-600 hover:bg-red-500 text-white px-4 py-1.5 rounded text-sm font-semibold">Aus Collection entfernen</button>
      </div>
    `;
    tradeModal = window.Util.openModal({
      host: 'trade-modal-root',
      id: 'trade-modal',
      sizeClass: 'w-[960px] max-w-[95vw]',
      flex: true,
      contentHtml,
      onClose: () => { tradeModal = null; },
      onMount: (content, close) => {
        content.querySelectorAll('[data-modal-close]').forEach(b => b.addEventListener('click', close));
        renderTradeBody();
        renderTradeTotals();
        content.querySelector('#trade-sort').addEventListener('change', e => {
          tradeState.sort = e.target.value;
          Prefs.set('tradeSort', tradeState.sort);
          renderTradeBody();
        });
        content.querySelector('#trade-view').addEventListener('change', e => {
          tradeState.view = e.target.value;
          Prefs.set('tradeView', tradeState.view);
          renderTradeBody();
        });
        content.querySelector('#trade-reset').addEventListener('click', () => {
          tradeState.entries = [];
          setTradePhase('input');
        });
        content.querySelector('#trade-remove').addEventListener('click', confirmRemoveFromCollection);
      }
    });
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
        <div class="ml-auto"><span class="text-slate-400">Gesamtwert (CM low / trend):</span> <b class="text-amber-400">${Fmt.eur(t.lowSum)} / ${Fmt.eur(t.trendSum)}</b>${t.noPriceCount > 0 ? ` <span class="text-slate-500 text-xs">(${t.noPriceCount} ohne CM-Preis)</span>` : ''}</div>
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
    const cmText = (window.CM && CM.fmtCheapest) ? CM.fmtCheapest(entry.cardId, entry.deliverVariant) : null;
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
    const cmText = (window.CM && CM.fmtCheapest) ? (CM.fmtCheapest(entry.cardId, entry.deliverVariant) || 'CM') : '—';
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

  // Render: Andere-User-Collections (read-only, gruppiert pro User). Zeigt
  // ALLE Treffer (frei + geslotted) — geslottete sind aktuell in Decks
  // gebunden, koennten aber nach Release verfuegbar sein.
  function renderTradePhaseOthers() {
    const groups = tradeState.othersGroups || [];
    const totalGroups = groups.length;
    const totalFree = groups.reduce((s, g) => s + g.totals.free, 0);
    const totalSlotted = groups.reduce((s, g) => s + g.totals.slotted, 0);
    const body = totalGroups === 0
      ? `<div class="text-sm text-slate-400 bg-slate-900 rounded p-4">Keine andere User-Collection enthaelt eine der gesuchten Karten.</div>`
      : groups.map((g, gi) => renderOthersGroup(g, gi)).join('');
    const contentHtml = `
      <div class="flex justify-between items-start mb-3 shrink-0">
        <div>
          <h2 class="text-lg font-bold">Andere User — Collections</h2>
          <div class="text-xs text-slate-400 mt-1">${totalGroups} User mit Treffern · <span class="text-emerald-400">${totalFree} frei</span> · <span class="text-amber-300">${totalSlotted} geslottet</span>. Quelle: geteilte Collections.</div>
        </div>
        <button data-modal-close class="modal-close-x">×</button>
      </div>
      <div class="overflow-y-auto flex-1 min-h-0 pr-1 space-y-4">${body}</div>
      <div class="flex justify-end gap-2 mt-3 shrink-0">
        <button id="trade-others-back" class="btn-secondary">Zurueck</button>
        <button data-modal-close class="btn-secondary">Schliessen</button>
      </div>
    `;
    tradeModal = window.Util.openModal({
      host: 'trade-modal-root',
      id: 'trade-modal',
      sizeClass: 'w-[960px] max-w-[95vw]',
      flex: true,
      contentHtml,
      onClose: () => { tradeModal = null; },
      onMount: (content, close) => {
        content.querySelectorAll('[data-modal-close]').forEach(b => b.addEventListener('click', close));
        content.querySelector('#trade-others-back').addEventListener('click', () => setTradePhase('input'));
        content.querySelectorAll('[data-others-copy]').forEach(btn => {
          btn.addEventListener('click', () => {
            const gi = parseInt(btn.dataset.othersCopy, 10);
            const g = tradeState.othersGroups[gi];
            if (!g) return;
            const txt = othersGroupAsText(g);
            const orig = btn.textContent;
            const finish = ok => { btn.textContent = ok ? '✓ Kopiert' : 'Fehler'; setTimeout(() => { btn.textContent = orig; }, 1500); };
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(txt).then(() => finish(true), () => finish(false));
            } else finish(false);
          });
        });
      }
    });
  }

  function renderOthersGroup(g, gi) {
    const tiles = g.matches.map(m => renderOthersTile(m)).join('');
    const lowFmt = Fmt.eur(g.totals.low);
    const trendFmt = Fmt.eur(g.totals.trend);
    return `<div class="bg-slate-800/60 border border-slate-700 rounded p-3">
      <div class="flex items-center gap-3 mb-3 flex-wrap">
        <div class="font-semibold text-slate-100">${escapeHtml(g.displayName)}</div>
        <div class="text-xs text-slate-400">
          <span class="text-emerald-400">${g.totals.free} frei</span> ·
          <span class="text-amber-300">${g.totals.slotted} geslottet</span> ·
          CM low/trend: <span class="text-amber-400">${lowFmt} / ${trendFmt}</span>
        </div>
        <button data-others-copy="${gi}" class="ml-auto text-xs bg-slate-700 hover:bg-slate-600 px-2 py-1 rounded">Text kopieren</button>
      </div>
      <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">${tiles}</div>
    </div>`;
  }

  function renderOthersTile(m) {
    const card = CardDB.byId.get(m.cardId);
    const name = card ? CardDB.cleanDisplayName(card) : m.cardId;
    const cmText = (window.CM && CM.fmtCheapest) ? (CM.fmtCheapest(m.cardId, m.variant) || '') : '';
    const status = m.isExact
      ? `<span class="text-emerald-400 text-[10px] font-semibold">✓ exakt</span>`
      : `<span class="text-amber-300 text-[10px] font-semibold" title="Andere Variante als gewollt">⚠ Substitut</span>`;
    const freeTotal = m.freeReal + m.freeProxy;
    const slottedTotal = m.slottedReal + m.slottedProxy;
    const totalOwned = freeTotal + slottedTotal;
    // Ring-Farbe: gruen wenn frei vorhanden, gelb wenn nur slotted, neutral sonst.
    let ringCls = '';
    if (freeTotal === 0 && slottedTotal > 0) ringCls = 'ring-1 ring-amber-500/40';
    else if (!m.isExact) ringCls = 'ring-1 ring-amber-500/30';
    // x/y: frei / angefragt. Farbe: gruen wenn frei >= angefragt, gelb wenn 0<frei<angefragt, rot wenn 0 frei.
    let freeCls = 'text-emerald-400';
    if (freeTotal === 0) freeCls = 'text-rose-400';
    else if (freeTotal < m.requestedCount) freeCls = 'text-amber-300';
    return `<div class="bg-slate-900 rounded p-2 ${ringCls}">
      <img loading="lazy" src="${CardDB.imagePath(m.variant)}" alt="" class="w-full aspect-[5/7] object-cover rounded mb-2" />
      <div class="flex items-center justify-between gap-2 mb-1">
        ${status}
        ${cmText ? `<span class="text-amber-400 text-[10px] font-semibold" title="Cardmarket low / trend">${cmText}</span>` : '<span class="text-slate-500 text-[10px]">CM</span>'}
      </div>
      <div class="text-sm font-semibold truncate" title="${escapeHtml(name)}">${escapeHtml(name)}</div>
      <div class="text-[10px] text-slate-300 mt-0.5 font-mono truncate" title="${escapeHtml(m.variant)}">${escapeHtml(m.variant)}</div>
      <div class="text-center mt-1 font-bold tabular-nums ${freeCls}" title="frei / angefragt">${freeTotal}/${m.requestedCount}</div>
      <div class="text-center text-[11px] text-slate-300 tabular-nums" title="insgesamt im Besitz (frei + geslottet)">${totalOwned} im Besitz</div>
    </div>`;
  }

  function othersGroupAsText(g) {
    const lines = [];
    for (const m of g.matches) {
      const card = CardDB.byId.get(m.cardId);
      const name = card ? CardDB.cleanDisplayName(card) : m.cardId;
      const totalOwned = m.freeReal + m.freeProxy + m.slottedReal + m.slottedProxy;
      const slottedTotal = m.slottedReal + m.slottedProxy;
      const note = slottedTotal > 0 ? `  # davon ${slottedTotal} geslottet` : '';
      lines.push(`${totalOwned} ${name} ${m.variant}${note}`);
    }
    return lines.join('\n') + '\n';
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
    const msg = `${t.cardsDeliverable} Karten (CM low ≈ ${Fmt.eur(t.lowSum)} / trend ≈ ${Fmt.eur(t.trendSum)}) werden aus deiner Collection entfernt. Fortfahren?`;
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
    tradeState.resultText = lines.join('\n') + '\n';
    tradeState.resultCount = t.cardsDeliverable;
    setTradePhase('result');
  }

  function renderTradePhaseResult() {
    const text = tradeState.resultText;
    const count = tradeState.resultCount;
    const contentHtml = `
      <div class="flex justify-between items-start mb-3">
        <div>
          <h2 class="text-lg font-bold text-emerald-400">✓ ${count} Karten aus Collection entfernt</h2>
          <div class="text-xs text-slate-400 mt-1">Den Text unten an den Sender geben — er kann ihn im Listen-Import einlesen (Plain-Text, automatisch erkannt).</div>
        </div>
        <button data-modal-close class="modal-close-x">×</button>
      </div>
      <textarea id="trade-result-text" rows="12" readonly class="w-full bg-slate-900 border border-slate-600 rounded p-3 font-mono text-xs">${escapeHtml(text)}</textarea>
      <div class="flex justify-end gap-2 mt-3">
        <button id="trade-result-copy" class="btn-primary-emerald">In Zwischenablage kopieren</button>
        <button data-modal-close class="btn-secondary">Schließen</button>
      </div>
    `;
    tradeModal = window.Util.openModal({
      host: 'trade-modal-root',
      id: 'trade-modal',
      sizeClass: 'w-[640px] max-w-[95vw]',
      contentHtml,
      onClose: () => { tradeModal = null; },
      onMount: (content, close) => {
        content.querySelectorAll('[data-modal-close]').forEach(b => b.addEventListener('click', close));
        content.querySelector('#trade-result-copy').addEventListener('click', () => {
          const btn = content.querySelector('#trade-result-copy');
          const orig = btn.textContent;
          const finish = ok => { btn.textContent = ok ? '✓ Kopiert' : 'Kopieren fehlgeschlagen'; setTimeout(() => { btn.textContent = orig; }, 1500); };
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text).then(() => finish(true), () => finish(false));
          } else {
            const ta = content.querySelector('#trade-result-text');
            ta.select();
            try { finish(document.execCommand('copy')); } catch (e) { finish(false); }
          }
        });
      }
    });
  }

  window.UIImportExport = { init };
})();
