// Shared-Space-Tab: Platzhalter fuer geteilte, nicht-user-spezifische Inhalte
// (z.B. oeffentliche Decklisten, Community-Inhalte). Wird schrittweise gefuellt.

(function () {
  function init(el) {
    el.innerHTML = `
      <div class="max-w-3xl mx-auto">
        <div class="bg-slate-800 rounded p-6 text-center">
          <div class="text-4xl mb-2">🌐</div>
          <h2 class="text-xl font-bold mb-2">Shared Space</h2>
          <p class="text-sm text-slate-400">
            Hier landen bald geteilte Inhalte zwischen allen Spielern — z.B. Decklisten zum Anschauen, gemeinsame Wantlisten oder Community-Vorlagen.
          </p>
          <p class="text-xs text-slate-500 mt-3">Noch nichts hier. Wir bauen das schrittweise aus.</p>
        </div>
      </div>
    `;
  }

  window.UIShared = { init };
})();
