// Import/Export-Tab. Format-Plugins kommen aus window.IO_FORMATS.

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
        <h2 class="text-lg font-bold mb-3">Import / Export</h2>

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

        <h2 class="text-lg font-bold mb-2">Collection Export / Import</h2>
        <p class="text-sm text-slate-400 mb-3">
          Exportiert die Sammlung (ohne Decks). CSV: <code class="text-amber-400">copyId,variant,price,isProxy,deckId,addedAt</code> pro Zeile.
        </p>
        <div class="flex flex-wrap gap-2 mb-6">
          <button id="coll-export-csv"  class="bg-amber-500 text-slate-900 px-4 py-2 rounded font-semibold">Collection als CSV</button>
          <button id="coll-export-json" class="bg-amber-500 text-slate-900 px-4 py-2 rounded font-semibold">Collection als JSON</button>
          <button id="proxies-export"   class="bg-purple-500 hover:bg-purple-400 text-white px-4 py-2 rounded font-semibold">Proxies → Clipboard</button>
          <label class="bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded cursor-pointer">
            Collection importieren…
            <input id="coll-import" type="file" accept=".csv,.json,text/csv,application/json" class="hidden" />
          </label>
          <div class="w-full text-xs text-slate-500">Beim CSV-Import werden vorhandene Counts <b>überschrieben</b>, nicht addiert.</div>
        </div>
        <div id="coll-msg" class="text-sm mb-6"></div>

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
          placeholder="1x  Bind Red Trigger (P-180)&#10;Bind Red Trigger (P-180)&#10;#180&#10;P&#10;NM&#10;0,30 €&#10;&#10;..."></textarea>
        <div class="flex flex-wrap gap-2 mb-3">
          <button id="cm-preview" class="bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded font-semibold">Vorschau</button>
          <button id="cm-apply"   class="bg-emerald-500 text-slate-900 px-4 py-2 rounded font-semibold">In Sammlung übernehmen</button>
        </div>
        <div id="cm-preview-out" class="mb-6"></div>

        <h2 class="text-lg font-bold mb-2">Cloud-Sync</h2>
        <div id="sync-ui" class="mb-6"></div>

        <h2 class="text-lg font-bold mb-2">Backup &amp; Restore</h2>
        <p class="text-sm text-slate-400 mb-3">
          Sichert alle deine Daten (Collection + alle Listen) als JSON-Datei. Restore überschreibt vorhandene Daten.
        </p>
        <div class="flex flex-wrap gap-2">
          <button id="backup-download" class="bg-emerald-500 text-slate-900 px-4 py-2 rounded font-semibold">Backup herunterladen</button>
          <label class="bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded cursor-pointer">
            Backup einspielen…
            <input id="backup-restore" type="file" accept=".json,application/json" class="hidden" />
          </label>
          <button id="backup-clear-all" class="bg-red-700 hover:bg-red-600 text-white px-4 py-2 rounded ml-auto">Alle Daten löschen</button>
        </div>
        <div id="backup-msg" class="mt-3 text-sm"></div>
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
    });
    rootEl.querySelector('#cm-preview').addEventListener('click', cmPreview);
    rootEl.querySelector('#cm-apply').addEventListener('click', cmApply);

    rootEl.querySelector('#coll-export-csv').addEventListener('click', () => collectionExport('csv'));
    rootEl.querySelector('#coll-export-json').addEventListener('click', () => collectionExport('json'));
    rootEl.querySelector('#proxies-export').addEventListener('click', exportProxies);
    rootEl.querySelector('#coll-import').addEventListener('change', collectionImport);
    rootEl.querySelector('#backup-download').addEventListener('click', backupDownload);
    rootEl.querySelector('#backup-restore').addEventListener('change', backupRestore);
    rootEl.querySelector('#backup-clear-all').addEventListener('click', clearAll);

    if (window.Sync && typeof Sync.mountLoginUI === 'function') {
      Sync.mountLoginUI(rootEl.querySelector('#sync-ui'));
    }
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
    const { items, unknown } = Cardmarket.parse(text);
    const sum = Cardmarket.summarize(items);

    const rows = items.map(it => `
      <tr class="border-b border-slate-800">
        <td class="px-2 py-1">${it.qty}x</td>
        <td class="px-2 py-1">${escapeHtml(it.cardName)}</td>
        <td class="px-2 py-1 font-mono text-xs text-slate-400">${escapeHtml(it.variant)}${it.isAlt ? ' (Alt)' : ''}</td>
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
            <th class="px-2 py-1 text-right">Stk.-Preis</th><th class="px-2 py-1 text-right">Subtotal</th>
          </tr></thead>
          <tbody>${rows || '<tr><td class="text-slate-500 px-2 py-2" colspan="5">Keine erkannten Einträge.</td></tr>'}</tbody>
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
    if (!text.trim()) { showCollMsg('Textfeld ist leer.', 'err'); return; }
    const { items, unknown } = Cardmarket.parse(text);
    if (!items.length) { showCollMsg('Keine erkennbaren Einträge.', 'err'); return; }
    const sum = Cardmarket.summarize(items);
    const msg = `${sum.totalQty} Karten (${Fmt.eur(sum.totalValue)}) zur Sammlung hinzufügen?`
      + (unknown.length ? `\n${unknown.length} unbekannte IDs werden übersprungen.` : '');
    if (!confirm(msg)) return;
    const res = Cardmarket.apply(items);
    showCollMsg(`Hinzugefügt: ${res.addedCopies} Kopien, Wert ${Fmt.eur(res.addedValue)}. Seite wird neu geladen…`, 'ok');
    setTimeout(() => location.reload(), 800);
  }

  function collectionExport(kind) {
    const coll = Store.loadCollection();
    const copies = coll.copies || {};
    let text, filename, mime;
    const ts = new Date().toISOString().slice(0, 10);
    if (kind === 'csv') {
      const rows = ['copyId,variant,price,isProxy,deckId,addedAt'];
      for (const [id, c] of Object.entries(copies)) {
        const price = c.price == null ? '' : c.price.toFixed(2);
        rows.push(`${id},${c.variant},${price},${c.isProxy ? 1 : 0},${c.deckId || ''},${c.addedAt || ''}`);
      }
      text = rows.join('\n') + '\n';
      filename = `digimon-collection-${ts}.csv`;
      mime = 'text/csv';
    } else {
      text = JSON.stringify({ version: 3, copies, notes: coll.notes || {} }, null, 2);
      filename = `digimon-collection-${ts}.json`;
      mime = 'application/json';
    }
    const blob = new Blob([text], { type: mime });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
    showCollMsg(`Collection exportiert (${Object.keys(copies).length} Copies).`, 'ok');
  }

  function collectionImport(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result || '');
        const parsed = parseCollectionImport(text, file.name);
        const n = Object.keys(parsed.copies).length;
        if (!confirm(`${n} Copies gefunden. Vorhandene Collection wird überschrieben. Fortfahren?`)) return;
        Store.saveCollection({ version: 3, copies: parsed.copies, notes: parsed.notes || {} });
        showCollMsg('Collection eingespielt. Seite wird neu geladen…', 'ok');
        setTimeout(() => location.reload(), 600);
      } catch (err) {
        showCollMsg('Import-Fehler: ' + err.message, 'err');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  // Liefert { copies, notes } für v3-Schema. Akzeptiert v3-JSON oder per-Copy-CSV.
  function parseCollectionImport(text, filename) {
    const trimmed = text.trim();
    const copies = {};
    const notes = {};

    if (trimmed.startsWith('{') || filename.toLowerCase().endsWith('.json')) {
      const data = JSON.parse(trimmed);
      if (!data.copies || typeof data.copies !== 'object') {
        throw new Error('Kein gültiges v3-Collection-JSON (erwarte "copies").');
      }
      for (const [id, c] of Object.entries(data.copies)) {
        if (!c || !CardDB.allVariants.has(c.variant)) continue;
        copies[id] = {
          variant:  c.variant,
          price:    (c.price == null || Number.isNaN(Number(c.price))) ? null : Number(c.price),
          isProxy:  !!c.isProxy,
          deckId:   c.deckId || null,
          addedAt:  c.addedAt || new Date().toISOString()
        };
      }
      if (data.notes && typeof data.notes === 'object') {
        for (const [k, v] of Object.entries(data.notes)) {
          if (typeof v === 'string' && v.trim()) notes[k] = v;
        }
      }
      return { copies, notes };
    }

    // CSV: copyId,variant,price,isProxy,deckId,addedAt
    const lines = trimmed.split(/\r?\n/);
    for (const line of lines) {
      const row = line.trim();
      if (!row) continue;
      if (/^copyId\s*,/i.test(row)) continue; // Header skip
      const parts = row.split(',').map(s => s.trim());
      const id = parts[0];
      const variant = parts[1];
      if (!id || !variant || !CardDB.allVariants.has(variant)) continue;
      const priceRaw = parts[2];
      const price = priceRaw === '' || priceRaw == null
        ? null
        : (Number.isNaN(Number(priceRaw.replace(',', '.'))) ? null : Number(priceRaw.replace(',', '.')));
      copies[id] = {
        variant,
        price,
        isProxy: parts[3] === '1' || parts[3] === 'true',
        deckId: parts[4] && parts[4] !== '' ? parts[4] : null,
        addedAt: parts[5] || new Date().toISOString()
      };
    }
    return { copies, notes };
  }

  function exportProxies() {
    const coll = Store.loadCollection();
    // Aggregiere alle Proxy-Kopien pro Variante.
    const counts = new Map();
    for (const c of Object.values(coll.copies || {})) {
      if (!c.isProxy) continue;
      counts.set(c.variant, (counts.get(c.variant) || 0) + 1);
    }
    if (!counts.size) {
      showCollMsg('Keine Proxies in der Sammlung.', 'err');
      return;
    }
    // Sortiert nach Variant-Key für deterministische Ausgabe.
    const lines = [];
    let total = 0;
    for (const [variant, n] of Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
      const info = CardDB.allVariants.get(variant);
      const card = info ? CardDB.byId.get(info.cardId) : null;
      const name = card ? card.name : variant;
      const id = card ? card.id : variant;
      lines.push(`${n} ${name} ${id}`);
      total += n;
    }
    const text = lines.join('\n') + '\n';

    const finish = ok => {
      showCollMsg(ok ? `${total} Proxies (${counts.size} unique) in Zwischenablage kopiert.` : 'Kopieren fehlgeschlagen.', ok ? 'ok' : 'err');
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => finish(true), () => proxyFallbackCopy(text, finish));
    } else {
      proxyFallbackCopy(text, finish);
    }
  }

  function proxyFallbackCopy(text, finish) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    finish(ok);
  }

  function showCollMsg(msg, kind) {
    const el = rootEl.querySelector('#coll-msg');
    el.textContent = msg;
    el.className = 'text-sm mb-6 ' + (kind === 'err' ? 'text-red-400' : kind === 'ok' ? 'text-emerald-400' : 'text-slate-400');
  }

  function backupDownload() {
    const payload = {
      app: 'digimon-collection',
      version: 1,
      exportedAt: new Date().toISOString(),
      collection: Store.loadCollection(),
      decks: Store.loadDecks()
    };
    const text = JSON.stringify(payload, null, 2);
    const blob = new Blob([text], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const ts = new Date().toISOString().slice(0, 10);
    a.download = `digimon-backup-${ts}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
    showBackupMsg('Backup heruntergeladen.', 'ok');
  }

  function backupRestore(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data || data.app !== 'digimon-collection') {
          throw new Error('Datei ist kein gültiges Digimon-Collection-Backup.');
        }
        if (!confirm('Vorhandene Collection und Listen werden überschrieben. Fortfahren?')) return;
        if (data.collection) Store.saveCollection(data.collection);
        if (data.decks) Store.saveDecks(data.decks);
        showBackupMsg('Backup eingespielt. Seite wird neu geladen…', 'ok');
        setTimeout(() => location.reload(), 800);
      } catch (err) {
        showBackupMsg('Restore-Fehler: ' + err.message, 'err');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  function clearAll() {
    if (!confirm('Wirklich ALLE Sammlungs- und Deck-Daten löschen?')) return;
    if (!confirm('Diese Aktion ist nicht umkehrbar. Sicher?')) return;
    localStorage.removeItem('digimon.collection');
    localStorage.removeItem('digimon.decks');
    showBackupMsg('Alles gelöscht. Seite wird neu geladen…', 'ok');
    setTimeout(() => location.reload(), 600);
  }

  function showBackupMsg(msg, kind) {
    const el = rootEl.querySelector('#backup-msg');
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
