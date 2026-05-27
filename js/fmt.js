// Formatter-Helpers.
(function () {
  const eurFmt = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });

  function eur(n) {
    if (n == null || Number.isNaN(n)) return '–';
    return eurFmt.format(n);
  }

  // Akzeptiert "0,30", "0.30", "0,3", "0.3", oder leer.
  function parseEUR(input) {
    if (input == null) return null;
    const s = String(input).trim().replace(/\s*€\s*$/, '').replace(',', '.');
    if (!s) return null;
    const n = Number(s);
    if (Number.isNaN(n) || n < 0) return null;
    return n;
  }

  window.Fmt = { eur, parseEUR };

  // Geteilte UI-Preferences in localStorage.
  const PREF_KEY = 'digimon.uiPrefs';
  function loadPrefs() {
    try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{}'); }
    catch (e) { return {}; }
  }
  function savePrefs(p) {
    localStorage.setItem(PREF_KEY, JSON.stringify(p));
  }
  function getPref(key, fallback) {
    const p = loadPrefs();
    return (key in p) ? p[key] : fallback;
  }
  function setPref(key, value) {
    const p = loadPrefs();
    p[key] = value;
    savePrefs(p);
  }
  window.Prefs = { get: getPref, set: setPref };
})();
