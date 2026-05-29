// App-Bootstrap: Tab-Switching, Initialisierung der Tabs on-demand.

(function () {
  const tabs = {
    collection: { panel: 'tab-collection', initFn: () => UICollection.init(document.getElementById('tab-collection')) },
    decks:      { panel: 'tab-decks',      initFn: () => UIDeckbuilder.init(document.getElementById('tab-decks')) },
    wants:      { panel: 'tab-wants',      initFn: () => UIWants.init(document.getElementById('tab-wants')) },
    trade:      { panel: 'tab-trade',      initFn: () => UITrade.init(document.getElementById('tab-trade')) },
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

  let appShellWired = false;

  function wireAppShell() {
    if (appShellWired) return;
    appShellWired = true;

    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => activateTab(btn.dataset.tab));
    });

    if (window.UICardMenu && typeof window.UICardMenu.init === 'function') {
      window.UICardMenu.init();
    }
  }

  function showAuthGate(reason) {
    const gate = document.getElementById('auth-gate');
    const shell = document.getElementById('app-shell');
    if (gate) gate.classList.remove('hidden');
    if (shell) shell.classList.add('hidden');
    const host = document.getElementById('auth-gate-login');
    if (!host) return;
    if (reason === 'not-configured') {
      host.innerHTML = '<p class="text-sm text-red-400">Cloud-Sync ist nicht konfiguriert. Bitte den Betreiber kontaktieren.</p>';
      return;
    }
    if (window.Sync && typeof Sync.mountLoginUI === 'function') {
      Sync.mountLoginUI(host);
    }
  }

  function hideAuthGate() {
    const gate = document.getElementById('auth-gate');
    const shell = document.getElementById('app-shell');
    if (gate) gate.classList.add('hidden');
    if (shell) shell.classList.remove('hidden');
  }

  function onLoggedIn() {
    hideAuthGate();
    wireAppShell();
    const statusEl = document.getElementById('status-line');
    if (statusEl && window.CARDS) {
      statusEl.textContent = `${window.CARDS.length.toLocaleString('de-DE')} Karten geladen`;
    }
    activateTab(activeTab || 'collection');
    if (window.UIReports && typeof window.UIReports.init === 'function') {
      window.UIReports.init();
    }
  }

  function onLoggedOut() {
    // Lokale Daten verwerfen — Cloud ist die Quelle der Wahrheit. Beim
    // naechsten Login werden sie frisch reingepulled.
    try {
      localStorage.removeItem('digimon.collection');
      localStorage.removeItem('digimon.decks');
    } catch (e) {}
    showAuthGate();
  }

  function init() {
    if (!window.CARDS || !Array.isArray(window.CARDS) || !window.CARDS.length) {
      const statusEl = document.getElementById('status-line');
      if (statusEl) statusEl.textContent = 'cards.data.js fehlt oder ist leer. Siehe README.';
      // Trotzdem das Auth-Gate zeigen, damit der Screen nicht leer wirkt.
      showAuthGate();
      return;
    }

    // Initial: Gate zeigen, App-Shell bleibt versteckt bis Login bestaetigt.
    showAuthGate(window.Sync && Sync.isConfigured && !Sync.isConfigured() ? 'not-configured' : null);

    if (window.Sync) {
      Sync.init({
        onRemoteApplied: () => refreshActiveTab(),
        onAuthStateChange: loggedIn => { loggedIn ? onLoggedIn() : onLoggedOut(); }
      });
    } else {
      showAuthGate('not-configured');
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
