// User-Bereich: Cloud-Sync/Login, Collection Export/Import, Backup & Restore.
// Wird nicht mehr als Tab angezeigt — Header-Button 👤 oeffnet ein Modal mit
// diesen Sektionen. init() wired einmalig den Button.

(function () {
  // rootEl wird beim Oeffnen des Modals auf das Modal-Content-Element gesetzt,
  // damit die existierenden Funktionen (showCollMsg, backupRestore etc.) ihre
  // Query-Selektoren weiterhin gegen den richtigen Scope laufen lassen.
  let rootEl = null;
  let wired = false;

  function init() {
    if (wired) return;
    const btn = document.getElementById('user-btn');
    if (!btn) return;
    btn.addEventListener('click', openUserModal);
    wired = true;
  }

  function openUserModal() {
    const contentHtml = `
      <div class="flex justify-between items-start mb-3 shrink-0">
        <h2 class="text-lg font-bold">Account &amp; Daten</h2>
        <button data-modal-close class="modal-close-x">×</button>
      </div>
      <div class="overflow-y-auto flex-1 min-h-0 pr-1">
        <h3 class="text-sm font-bold uppercase text-slate-400 mb-2">Login &amp; Cloud-Sync</h3>
        <div id="sync-ui" class="mb-6"></div>

        <h3 class="text-sm font-bold uppercase text-slate-400 mb-2">Collection Export / Import</h3>
        <p class="text-sm text-slate-400 mb-3">
          Exportiert die Sammlung (ohne Decks). CSV: <code class="text-amber-400">copyId,variant,price,isProxy,deckId,addedAt</code> pro Zeile.
        </p>
        <div class="flex flex-wrap gap-2 mb-2">
          <button id="coll-export-csv"  class="bg-amber-500 text-slate-900 px-4 py-2 rounded font-semibold">Collection als CSV</button>
          <button id="coll-export-json" class="bg-amber-500 text-slate-900 px-4 py-2 rounded font-semibold">Collection als JSON</button>
          <label class="bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded cursor-pointer">
            Collection importieren…
            <input id="coll-import" type="file" accept=".csv,.json,text/csv,application/json" class="hidden" />
          </label>
          <div class="w-full text-xs text-slate-500">Beim CSV-Import werden vorhandene Counts <b>überschrieben</b>, nicht addiert.</div>
        </div>
        <div id="coll-msg" class="text-sm mb-6"></div>

        <h3 class="text-sm font-bold uppercase text-slate-400 mb-2">Backup &amp; Restore</h3>
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

    window.Util.openModal({
      host: 'user-modal-root',
      id: 'user-modal',
      sizeClass: 'w-[720px] max-w-[95vw] max-h-[90vh]',
      flex: true,
      contentHtml,
      onClose: () => { rootEl = null; },
      onMount: (content, close) => {
        rootEl = content;
        content.querySelectorAll('[data-modal-close]').forEach(b => b.addEventListener('click', close));
        content.querySelector('#coll-export-csv').addEventListener('click', () => collectionExport('csv'));
        content.querySelector('#coll-export-json').addEventListener('click', () => collectionExport('json'));
        content.querySelector('#coll-import').addEventListener('change', collectionImport);
        content.querySelector('#backup-download').addEventListener('click', backupDownload);
        content.querySelector('#backup-restore').addEventListener('change', backupRestore);
        content.querySelector('#backup-clear-all').addEventListener('click', clearAll);
        if (window.Sync && typeof Sync.mountLoginUI === 'function') {
          Sync.mountLoginUI(content.querySelector('#sync-ui'));
        }
      }
    });
  }

  // --- Collection Export / Import ------------------------------------------

  function collectionExport(kind) {
    const coll = Store.loadCollection();
    const copies = coll.copies || {};
    let text, filename, mime;
    const ts = new Date().toISOString().slice(0, 10);
    if (kind === 'csv') {
      const rows = ['copyId,variant,price,isProxy,deckId,addedAt,originSet'];
      for (const [id, c] of Object.entries(copies)) {
        const price = c.price == null ? '' : c.price.toFixed(2);
        rows.push(`${id},${c.variant},${price},${c.isProxy ? 1 : 0},${c.deckId || ''},${c.addedAt || ''},${c.originSet || ''}`);
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
        if (window.Sync && Sync.flushThenReload) Sync.flushThenReload(600);
        else setTimeout(() => location.reload(), 600);
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
          addedAt:  c.addedAt || new Date().toISOString(),
          originSet: c.originSet || null
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
        addedAt: parts[5] || new Date().toISOString(),
        originSet: parts[6] && parts[6] !== '' ? parts[6] : null
      };
    }
    return { copies, notes };
  }

  function showCollMsg(msg, kind) {
    const el = rootEl.querySelector('#coll-msg');
    el.textContent = msg;
    el.className = 'text-sm mb-6 ' + (kind === 'err' ? 'text-red-400' : kind === 'ok' ? 'text-emerald-400' : 'text-slate-400');
  }

  // --- Backup & Restore ----------------------------------------------------

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
        if (window.Sync && Sync.flushThenReload) Sync.flushThenReload(800);
        else setTimeout(() => location.reload(), 800);
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

  const { escapeHtml } = window.Util;

  window.UIUser = { init };
})();
