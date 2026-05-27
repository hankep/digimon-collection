// Generischer Notiz-Dialog. Wird sowohl für Deck-Notes als auch für Card-Notes
// verwendet.
//
// API:
//   Notes.openDialog({ title, subtitle, value, onSave })
//   Notes.iconHtml(hasNote) -> SVG-Markup als String
//
// Der Aufrufer kümmert sich um Persistenz und Re-Render.

(function () {
  function svgIcon(hasNote) {
    const fill = hasNote ? '#f59e0b' : 'none';
    const stroke = hasNote ? '#f59e0b' : '#94a3b8';
    return `<svg viewBox="0 0 24 24" width="16" height="16" fill="${fill}" stroke="${stroke}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>`;
  }

  function iconHtml(hasNote, extraClass) {
    const cls = 'note-icon inline-flex items-center justify-center' + (extraClass ? ' ' + extraClass : '');
    return `<button type="button" data-note-trigger class="${cls}" title="${hasNote ? 'Notiz bearbeiten' : 'Notiz hinzufügen'}">${svgIcon(hasNote)}</button>`;
  }

  function openDialog(opts) {
    const { title, subtitle, value, onSave } = opts || {};
    let host = document.getElementById('notes-root');
    if (!host) {
      host = document.createElement('div');
      host.id = 'notes-root';
      document.body.appendChild(host);
    }

    host.innerHTML = `
      <div class="modal-backdrop" id="notes-modal">
        <div class="modal-content w-[520px] max-w-[95vw]">
          <div class="flex justify-between items-start mb-3">
            <div class="min-w-0">
              <h2 class="text-lg font-bold truncate">${escapeHtml(title || 'Notiz')}</h2>
              ${subtitle ? `<div class="text-xs text-slate-400 truncate">${escapeHtml(subtitle)}</div>` : ''}
            </div>
            <button id="notes-close" class="text-slate-400 hover:text-white text-2xl leading-none">×</button>
          </div>

          <textarea id="notes-text" rows="8" placeholder="Notiz eingeben…"
            class="w-full bg-slate-900 border border-slate-600 rounded p-3 font-mono text-sm">${escapeHtml(value || '')}</textarea>

          <div class="flex justify-end gap-2 mt-3">
            <button id="notes-cancel" class="bg-slate-700 hover:bg-slate-600 px-3 py-1.5 rounded text-sm">Abbrechen</button>
            <button id="notes-save" class="bg-amber-500 text-slate-900 hover:bg-amber-400 px-4 py-1.5 rounded text-sm font-semibold">Speichern</button>
          </div>
        </div>
      </div>
    `;

    const ta = host.querySelector('#notes-text');
    setTimeout(() => ta && ta.focus(), 30);

    const close = () => { host.innerHTML = ''; document.removeEventListener('keydown', esc); };
    function esc(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', esc);

    host.querySelector('#notes-close').addEventListener('click', close);
    host.querySelector('#notes-cancel').addEventListener('click', close);
    host.querySelector('#notes-modal').addEventListener('click', e => {
      if (e.target.id === 'notes-modal') close();
    });
    host.querySelector('#notes-save').addEventListener('click', () => {
      const txt = ta.value;
      if (typeof onSave === 'function') onSave(txt);
      close();
    });
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  window.Notes = { openDialog, iconHtml };
})();
