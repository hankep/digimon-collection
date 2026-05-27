// App-Bootstrap: Tab-Switching, Initialisierung der Tabs on-demand.

(function () {
  const tabs = {
    collection: { panel: 'tab-collection', initFn: () => UICollection.init(document.getElementById('tab-collection')) },
    decks:      { panel: 'tab-decks',      initFn: () => UIDeckbuilder.init(document.getElementById('tab-decks')) },
    wants:      { panel: 'tab-wants',      initFn: () => UIWants.init(document.getElementById('tab-wants')) },
    stats:      { panel: 'tab-stats',      initFn: () => UIStats.init(document.getElementById('tab-stats')) },
    io:         { panel: 'tab-io',         initFn: () => UIImportExport.init(document.getElementById('tab-io')) },
    user:       { panel: 'tab-user',       initFn: () => UIUser.init(document.getElementById('tab-user')) }
  };

  const initialised = new Set();
  let activeTab = null;

  function activateTab(name) {
    if (!tabs[name]) return;
    activeTab = name;
    Object.entries(tabs).forEach(([key, def]) => {
      document.getElementById(def.panel).classList.toggle('hidden', key !== name);
    });
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === name);
    });
    // Beim Wechsel neu rendern, damit z.B. Decks-Tab Änderungen aus IO-Tab sieht.
    tabs[name].initFn();
    initialised.add(name);
  }

  function init() {
    if (!window.CARDS || !Array.isArray(window.CARDS) || !window.CARDS.length) {
      document.getElementById('status-line').textContent =
        'cards.data.js fehlt oder ist leer. Siehe README.';
      return;
    }
    document.getElementById('status-line').textContent =
      `${window.CARDS.length.toLocaleString('de-DE')} Karten geladen`;

    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => activateTab(btn.dataset.tab));
    });

    if (window.UICardMenu && typeof window.UICardMenu.init === 'function') {
      window.UICardMenu.init();
    }

    activateTab('collection');

    if (window.Sync) {
      Sync.init({ onRemoteApplied: () => refreshActiveTab() });
    }
  }

  // Rendert den aktuell sichtbaren Tab neu (z.B. nachdem Sync Remote-Daten angewandt hat).
  function refreshActiveTab() {
    if (activeTab && tabs[activeTab]) tabs[activeTab].initFn();
  }

  window.App = { refreshActiveTab };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
