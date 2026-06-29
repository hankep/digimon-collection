// Zentrale Utilities: HTML-Escapes, Debounce, Modal-Pattern, Toasts, Event-Bus,
// LocalStorage-/Prefs-Key-Konstanten. Alle UI-Module konsumieren von hier statt
// eigene Kopien zu halten.

(function () {
  // ── String-Helpers ────────────────────────────────────────────────────────

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // Alias - escapeHtml deckt Attribute mit ab.
  const escapeAttr = escapeHtml;

  function debounce(fn, ms) {
    let t;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  // ── Key-Konstanten ────────────────────────────────────────────────────────

  const LS_KEYS = Object.freeze({
    collection: 'digimon.collection',
    decks:      'digimon.decks',
    prefs:      'digimon.uiPrefs'
  });

  const PREF_KEYS = Object.freeze({
    deckView:          'deckView',          // 'tiles' | 'text'
    wantsView:         'wantsView',         // 'text' | 'images'
    wantsSort:         'wantsSort',         // 'id' | 'price-desc' | 'rarity'
    wantsGroup:        'wantsGroup',        // 'source' | 'rarity'
    wantsShowReprints: 'wantsShowReprints', // bool
    tradeView:         'tradeView',         // 'text' | 'images'
    tradeSort:         'tradeSort',         // 'id' | 'price-desc' | 'rarity'
    showAlts:          'showAlts',          // bool, Picker Alt-Arts einzeln
    mainWantsSort:     'mainWantsSort',     // 'id' | 'price-desc'
    setGroups:         'setGroups',         // {BT,EX,ST,Andere: bool}
    deckPickerSplit:   'deckPickerSplit',   // 0..1 — Anteil Picker an Detail+Picker im Decks-Tab (Desktop)
    wantsTradeSubTab:  'wantsTradeSubTab',  // 'wants' | 'trade' — Sub-Tab im Header-Tab 'Wants & Trade'
    sharedSubTab:      'sharedSubTab',      // 'deck' | 'wants' | 'trade' — Sub-Tab im Shared Space
    cardImportMode:    'cardImportMode',    // 'cardmarket' | 'standard' — Modus im Karten-Import
    deckCatCollapsed:  'deckCatCollapsed',  // { '<catId>'|'uncat:<kind>': true } — eingeklappte Kategorien (lokal, nicht gesynct)
    rapidEntrySet:     'rapidEntrySet'       // zuletzt in der Schnellerfassung gewähltes Set (z.B. 'BT26')
  });

  // ── Event-Bus ─────────────────────────────────────────────────────────────
  // Lose Kopplung statt direkter window.UICollection.openCardModal()-Calls.

  const bus = {
    emit(name, detail) {
      document.dispatchEvent(new CustomEvent('app:' + name, { detail }));
    },
    on(name, handler) {
      const wrapped = e => handler(e.detail || {});
      document.addEventListener('app:' + name, wrapped);
      return () => document.removeEventListener('app:' + name, wrapped);
    }
  };

  // ── Modal-Utility ─────────────────────────────────────────────────────────
  // Standardisiertes Modal-Pattern. Backdrop schliesst per Klick, ESC schliesst.
  // Aufrufer liefern HTML; bekommen den Wrapper + close() zurueck. onMount() wird
  // gerufen nachdem das DOM steht (zum Wiren der Buttons).

  function openModal(opts) {
    const id = opts.id || ('modal-' + Math.random().toString(36).slice(2, 8));
    const hostId = opts.host || 'modal-root';
    let host = document.getElementById(hostId);
    if (!host) {
      // Eigenen Host-Knoten on-demand anlegen, damit Module wie Reports/Notes
      // keinen Setup-Schritt vorab brauchen.
      host = document.createElement('div');
      host.id = hostId;
      document.body.appendChild(host);
    } else {
      // Beim Re-Open / verschachtelten Modal: Host ans Ende des Bodys verschieben,
      // damit das neue Modal bei gleicher z-index ueber bereits offenen Modals
      // anderer Hosts liegt (DOM-Reihenfolge entscheidet bei gleichem z-index).
      document.body.appendChild(host);
    }

    // Falls schon ein Modal mit gleicher ID offen ist: dessen close() aufrufen,
    // damit ESC-Listener nicht leaken.
    const existing = host.querySelector('[data-modal-id="' + id + '"]');
    if (existing) {
      if (typeof existing._modalClose === 'function') existing._modalClose();
      else existing.remove();
    }

    const sizeClass = opts.sizeClass || 'w-[640px] max-w-[95vw]';
    const heightClass = opts.flex ? ' max-h-[92vh] flex flex-col' : '';
    const wrapper = document.createElement('div');
    wrapper.className = 'modal-backdrop';
    wrapper.dataset.modalId = id;
    wrapper.innerHTML = `<div class="modal-content ${sizeClass}${heightClass}">${opts.contentHtml}</div>`;
    host.appendChild(wrapper);

    const content = wrapper.firstElementChild;

    function close() {
      document.removeEventListener('keydown', onEsc);
      wrapper.remove();
      if (typeof opts.onClose === 'function') opts.onClose();
    }

    function onEsc(e) {
      if (e.key === 'Escape') close();
    }

    document.addEventListener('keydown', onEsc);
    wrapper.addEventListener('click', e => {
      if (e.target === wrapper) close();
    });
    wrapper._modalClose = close;

    if (typeof opts.onMount === 'function') {
      try { opts.onMount(content, close); }
      catch (err) { console.error('Modal onMount-Fehler:', err); }
    }

    return { close, wrapper, content };
  }

  // ── Toast / Error ─────────────────────────────────────────────────────────

  let toastHost = null;
  function ensureToastHost() {
    if (toastHost && document.body.contains(toastHost)) return toastHost;
    toastHost = document.createElement('div');
    toastHost.id = 'toast-host';
    toastHost.className = 'fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] flex flex-col gap-2 pointer-events-none';
    document.body.appendChild(toastHost);
    return toastHost;
  }

  function toast(msg, type, timeout) {
    if (!msg) return;
    type = type || 'info';
    timeout = timeout == null ? 3500 : timeout;
    const host = ensureToastHost();
    const colors = {
      info:    'bg-slate-800 border-slate-600 text-slate-100',
      success: 'bg-emerald-700 border-emerald-500 text-emerald-50',
      error:   'bg-red-700 border-red-500 text-red-50',
      warn:    'bg-amber-600 border-amber-400 text-amber-50'
    };
    const el = document.createElement('div');
    el.className = `pointer-events-auto px-4 py-2 rounded border shadow-lg text-sm transition-opacity duration-200 ${colors[type] || colors.info}`;
    el.textContent = msg;
    host.appendChild(el);
    if (timeout > 0) {
      setTimeout(() => { el.style.opacity = '0'; }, timeout - 200);
      setTimeout(() => el.remove(), timeout);
    }
    return el;
  }

  function handleError(e, ctx) {
    console.warn('[' + (ctx || 'app') + ']', e);
    const text = (ctx ? ctx + ': ' : '') + (e && e.message ? e.message : String(e));
    toast(text, 'error', 5000);
  }

  // ── Export ────────────────────────────────────────────────────────────────

  window.Util = {
    escapeHtml, escapeAttr, debounce,
    LS_KEYS, PREF_KEYS,
    bus,
    openModal,
    toast, handleError
  };
})();
