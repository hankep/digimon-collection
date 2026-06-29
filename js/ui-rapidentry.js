// Schnellerfassung ("Display öffnen"): Massen-Eingabe neuer Karten.
//
// Ein Booster-Display ist genau EIN Set → das Set wird einmal gewählt, danach
// genügt pro Karte die Nummer (Enter = +1). Alt-Arts werden über Varianten-Chips
// unterschieden. Tastatur- UND touch-tauglich.
//
// Performance/Sync: pro Commit wird SILENT in LocalStorage gespeichert (durabel,
// kein 'collection-changed'-Event → kein Re-Render, kein Sync-Push pro Karte).
// Erst beim Schließen feuert EIN nicht-silent Save → Sync.debouncedPush + Tab-
// Refresh greifen wie gewohnt.

(function () {
  const { escapeHtml, escapeAttr } = window.Util;

  const state = {
    coll: null,        // in-memory Collection (wird live mutiert)
    setCode: null,     // gewähltes Set, z.B. 'BT26'
    numMap: null,      // Map<int, card> für das gewählte Set
    card: null,        // aktuell aufgelöste Karte (Vorschau)
    variants: [],      // CardDB.variantsOf(card) der Vorschau-Karte
    variantIdx: 0,     // gewählte Variante (0 = Main)
    qty: 1,            // Menge, die der nächste Enter bucht (↑/↓ stellt sie ein)
    log: [],           // [{ copyIds:[], variant, cardId, count }] — neueste zuerst
    committed: 0,      // Anzahl gebuchter Karten (für finalen Save/Toast)

    // ── Kamera-Scan-Modus ──
    scanActive: false,
    scanStream: null,      // MediaStream der Kamera
    scanLoop: null,        // setInterval-Handle der OCR-Schleife
    scanBusy: false,       // OCR läuft gerade → Frame überspringen
    scanStaging: [],       // [{ cardId, variant(Main), count }] — noch NICHT in der Collection
    scanStableKey: null,   // zuletzt gelesene Karten-ID (für Stabilitäts-Check)
    scanStableCount: 0,    // wie oft in Folge gelesen
    scanCommittedKey: null,// zuletzt in die Staging gelegte Karte (Anti-Doppel)
    scanEmpty: 0,          // aufeinanderfolgende Leer-/Kein-Treffer-Frames (Lücken-Erkennung)
    nameIdx: [],           // [{ card, n }] normalisierte Namen des gewählten Sets (für Namens-Match)
    _scanCanvas: null      // wiederverwendetes Crop-Canvas
  };
  let modal = null;

  // OCR liest den OBEREN Karten-Block (Namens-Banner mit Name + Nummer + Level).
  // Werte als Bruchteil der Videogröße; der gelbe Rahmen im UI deckt sich damit.
  const STRIP = { x: 0.05, y: 0.05, w: 0.90, h: 0.30 };

  function normName(s) { return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }

  function buildNameIndex(setCode) {
    const out = [];
    const cards = (window.CardDB && CardDB.bySet.get(setCode)) || [];
    for (const c of cards) {
      const n = normName(CardDB.cleanDisplayName(c) || c.name);
      if (n.length >= 4) out.push({ card: c, n });
    }
    return out;
  }

  // ── Auflösung Nummer/ID → Karte ────────────────────────────────────────────

  function buildNumMap(setCode) {
    const map = new Map();
    const cards = (window.CardDB && CardDB.bySet.get(setCode)) || [];
    for (const c of cards) {
      const tail = String(c.id).split('-').pop() || '';
      const n = parseInt(tail, 10);
      if (!Number.isNaN(n) && !map.has(n)) map.set(n, c);
    }
    return map;
  }

  // Liefert die Karte zu einer Roh-Eingabe (Nummer ODER vollständige ID), oder null.
  // Andockpunkt für späteres OCR: "Nummer/ID kommt von außen".
  function resolveCard(raw) {
    const s = String(raw || '').trim();
    if (!s) return null;
    // Sieht nach voller ID aus (Set-Präfix + Nummer, z.B. "P-001", "BT26-025")?
    if (/^[A-Za-z]+\d*-\d+/.test(s)) {
      return CardDB.byId.get(s.toUpperCase()) || null;
    }
    const n = parseInt(s, 10);
    if (Number.isNaN(n)) return null;
    return (state.numMap && state.numMap.get(n)) || null;
  }

  function variantLabel(idx) {
    if (idx === 0) return 'Standard';
    const v = state.variants[idx];
    if (!v) return 'Alt';
    const suffix = String(v.key).split('_')[1];
    return suffix || ('Alt ' + idx);
  }

  // ── Aktionen ────────────────────────────────────────────────────────────────

  function setSelectedCard(card) {
    state.card = card;
    state.variants = card ? CardDB.variantsOf(card) : [];
    state.variantIdx = 0;
    state.qty = 1; // Menge bei jeder neuen Karte zurücksetzen.
  }

  function commit() {
    if (!state.card || !state.variants.length) { flashInput(); return; }
    const variant = state.variants[state.variantIdx].key;
    const count = Math.max(1, state.qty | 0);
    const copyIds = [];
    for (let i = 0; i < count; i++) {
      copyIds.push(Store.createCopy(state.coll, variant, { isProxy: false, originSet: state.setCode }));
    }
    Store.saveCollection(state.coll, { silent: true });
    state.log.unshift({ copyIds, variant, cardId: state.card.id, count });
    state.committed += count;
    // Eingabe leeren + Vorschau zurücksetzen, Fokus zurück ins Feld.
    setSelectedCard(null);
    const inp = inputEl();
    if (inp) { inp.value = ''; inp.focus(); }
    renderPreview();
    renderLog();
    renderSummary();
  }

  // Menge für den nächsten Enter ändern (nur sinnvoll, wenn eine Karte aufgelöst ist).
  function adjustQty(delta) {
    if (!state.card) return;
    state.qty = Math.max(1, (state.qty | 0) + delta);
    renderPreview();
  }

  function undo(idx) {
    const entry = state.log[idx];
    if (!entry) return;
    (entry.copyIds || []).forEach(id => Store.deleteCopy(state.coll, id));
    Store.saveCollection(state.coll, { silent: true });
    state.log.splice(idx, 1);
    state.committed = Math.max(0, state.committed - (entry.count || 1));
    renderPreview(); // Besitz-Count der ggf. sichtbaren Karte aktualisieren
    renderLog();
    renderSummary();
  }

  function changeSet(code) {
    state.setCode = code;
    state.numMap = buildNumMap(code);
    state.nameIdx = buildNameIndex(code);
    Prefs.set(window.Util.PREF_KEYS.rapidEntrySet, code);
    setSelectedCard(null);
    const inp = inputEl();
    if (inp) { inp.value = ''; inp.focus(); }
    renderPreview();
  }

  function cycleVariant(dir) {
    if (state.variants.length <= 1) return;
    const n = state.variants.length;
    state.variantIdx = (state.variantIdx + dir + n) % n;
    renderPreview();
  }

  // ── DOM-Helfer ────────────────────────────────────────────────────────────

  function inputEl() { return modal && modal.content.querySelector('#re-number'); }

  function flashInput() {
    const inp = inputEl();
    if (!inp) return;
    inp.classList.add('ring-2', 'ring-red-500');
    setTimeout(() => inp.classList.remove('ring-2', 'ring-red-500'), 350);
  }

  function renderPreview() {
    const host = modal && modal.content.querySelector('#re-preview');
    if (!host) return;
    // "+N"-Button an die aktuelle Menge anpassen (oder +1, wenn keine Karte).
    const addBtn = modal.content.querySelector('#re-add');
    if (addBtn) addBtn.textContent = state.card ? ('+' + Math.max(1, state.qty | 0)) : '+1';
    if (!state.card) {
      host.innerHTML = `<div class="text-slate-500 text-sm flex items-center justify-center h-full text-center px-3">
        Nummer eingeben, ggf. Menge mit <b class="mx-1">↑ / ↓</b> wählen, dann <b class="mx-1">Enter</b> …</div>`;
      return;
    }
    const card = state.card;
    const variant = state.variants[state.variantIdx];
    const owned = variant ? Store.ownedTotalReal(state.coll, variant.key) : 0;
    const chips = state.variants.map((v, i) => {
      const on = i === state.variantIdx;
      return `<button type="button" data-re-variant="${i}"
        class="px-2 py-1 rounded text-xs font-semibold border ${on
          ? 'bg-amber-500 border-amber-400 text-slate-900'
          : 'bg-slate-700 border-slate-600 text-slate-200 hover:bg-slate-600'}">${escapeHtml(variantLabel(i))}</button>`;
    }).join('');
    host.innerHTML = `
      <div class="flex gap-3">
        <img src="${variant ? CardDB.imagePath(variant.key) : ''}" loading="lazy"
          onerror="this.style.visibility='hidden'"
          class="w-40 sm:w-48 shrink-0 aspect-[5/7] object-contain rounded bg-slate-900" alt="" />
        <div class="min-w-0 flex-1">
          <div class="font-bold leading-tight">${escapeHtml(CardDB.cleanDisplayName(card))}</div>
          <div class="font-mono text-xs text-slate-400 mt-0.5">${escapeHtml(card.id)}
            ${card.rarity ? '· ' + escapeHtml(CardDB.rarityShort(card.rarity)) : ''}</div>
          <div class="text-xs text-slate-400 mt-1">Im Besitz (dieser Variante): <b class="text-emerald-400">${owned}</b></div>
          <div class="flex items-center gap-2 mt-2">
            <span class="text-xs text-slate-400">Menge:</span>
            <button type="button" data-re-qty="-1" class="w-7 h-7 rounded bg-slate-700 hover:bg-slate-600 text-slate-100 font-bold leading-none">−</button>
            <span class="font-bold text-amber-400 w-6 text-center">${Math.max(1, state.qty | 0)}</span>
            <button type="button" data-re-qty="1" class="w-7 h-7 rounded bg-slate-700 hover:bg-slate-600 text-slate-100 font-bold leading-none">+</button>
            <span class="text-[11px] text-slate-500">(↑ / ↓ · Enter bucht ${Math.max(1, state.qty | 0)})</span>
          </div>
          ${state.variants.length > 1
            ? `<div class="flex flex-wrap gap-1 mt-2">${chips}</div>
               <div class="text-[11px] text-slate-500 mt-1">Alt-Art: Chip antippen oder ← / → drücken.</div>`
            : ''}
        </div>
      </div>`;
    host.querySelectorAll('[data-re-variant]').forEach(b => {
      b.addEventListener('click', () => { state.variantIdx = parseInt(b.dataset.reVariant, 10) || 0; renderPreview(); inputEl() && inputEl().focus(); });
    });
    host.querySelectorAll('[data-re-qty]').forEach(b => {
      b.addEventListener('click', () => { adjustQty(parseInt(b.dataset.reQty, 10) || 0); inputEl() && inputEl().focus(); });
    });
  }

  function renderSummary() {
    const el = modal && modal.content.querySelector('#re-summary');
    if (!el) return;
    let main = 0, alt = 0;
    for (const e of state.log) {
      const info = CardDB.allVariants.get(e.variant);
      if (info && info.isAlt) alt += (e.count || 1); else main += (e.count || 1);
    }
    el.innerHTML = `Erfasst: <b class="text-emerald-400">${state.committed}</b>
      <span class="text-slate-500">(Standard: ${main} · Alt: ${alt})</span>`;
  }

  function renderLog() {
    const host = modal && modal.content.querySelector('#re-log');
    if (!host) return;
    if (!state.log.length) {
      host.innerHTML = `<div class="text-slate-600 text-sm px-1 py-2">Noch nichts erfasst.</div>`;
      return;
    }
    host.innerHTML = state.log.map((e, i) => {
      const card = CardDB.byId.get(e.cardId);
      const info = CardDB.allVariants.get(e.variant);
      const altTag = info && info.isAlt ? ` <span class="text-amber-400">(${escapeHtml(String(e.variant).split('_')[1] || 'Alt')})</span>` : '';
      return `
        <div class="flex items-center gap-2 py-1 border-b border-slate-800 last:border-0 text-sm">
          <span class="text-emerald-400 font-semibold">+${e.count || 1}</span>
          <span class="font-mono text-xs text-slate-400">${escapeHtml(e.cardId)}</span>
          <span class="truncate flex-1 min-w-0">${escapeHtml(card ? CardDB.cleanDisplayName(card) : e.cardId)}${altTag}</span>
          <button type="button" data-re-undo="${i}" title="Rückgängig"
            class="text-slate-500 hover:text-red-400 px-1.5 shrink-0">✕</button>
        </div>`;
    }).join('');
    host.querySelectorAll('[data-re-undo]').forEach(b => {
      b.addEventListener('click', () => undo(parseInt(b.dataset.reUndo, 10)));
    });
  }

  // ── Kamera-Scan ──────────────────────────────────────────────────────────
  // Set ist gelockt → OCR muss nur die Nummer lesen; gemappt wird auf die
  // Hauptvariante (Alt-Arts werden bewusst nicht gescannt).

  function scanVideoEl() { return modal && modal.content.querySelector('#re-video'); }

  function setScanStatus(msg) {
    const el = modal && modal.content.querySelector('#re-scan-status');
    if (el) el.textContent = msg || '';
  }

  // Blendet Tastatur-Teile aus / Scan-Panel ein (oder umgekehrt).
  function applyScanUI(active) {
    const c = modal && modal.content;
    if (!c) return;
    const toggle = c.querySelector('#re-scan-toggle');
    if (toggle) toggle.textContent = active ? '⌨ Tastatur' : '📷 Scannen';
    ['#re-kb-input', '#re-preview', '#re-results-area'].forEach(sel => {
      const el = c.querySelector(sel);
      if (el) el.classList.toggle('hidden', active);
    });
    const scan = c.querySelector('#re-scan');
    if (scan) scan.classList.toggle('hidden', !active);
  }

  function toggleScan() {
    if (state.scanActive) {
      state.scanActive = false;
      stopScan();
      applyScanUI(false);
      const inp = inputEl(); if (inp) inp.focus();
    } else {
      startScan();
    }
  }

  function startScan() {
    if (!window.isSecureContext) {
      window.Util.toast('Kamera braucht HTTPS (sicherer Kontext).', 'error', 5000);
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      window.Util.toast('Kamera ist auf diesem Gerät/Browser nicht verfügbar.', 'error', 5000);
      return;
    }
    if (!window.OCR) {
      window.Util.toast('OCR-Modul nicht geladen.', 'error', 5000);
      return;
    }
    state.scanActive = true;
    applyScanUI(true);
    setScanStatus('Kamera wird gestartet …');
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      .then(stream => {
        if (!state.scanActive) { stream.getTracks().forEach(t => t.stop()); return; }
        state.scanStream = stream;
        const v = scanVideoEl();
        if (v) { v.srcObject = stream; v.play().catch(() => {}); }
        setScanStatus('OCR wird geladen (einmalig, kann kurz dauern) …');
        return window.OCR.ensureWorker();
      })
      .then(() => {
        if (!state.scanActive) return;
        state.scanBusy = false;
        state.scanStableKey = null; state.scanStableCount = 0;
        state.scanCommittedKey = null; state.scanEmpty = 0;
        setScanStatus('Bereit — Karten-Nummer in den gelben Rahmen halten.');
        state.scanLoop = setInterval(scanTick, 500);
      })
      .catch(err => {
        console.warn('Scan-Start fehlgeschlagen:', err);
        window.Util.toast('Kamera/OCR-Start fehlgeschlagen: ' + (err && err.message ? err.message : err), 'error', 6000);
        state.scanActive = false;
        stopScan();
        applyScanUI(false);
      });
  }

  function stopScan() {
    if (state.scanLoop) { clearInterval(state.scanLoop); state.scanLoop = null; }
    if (state.scanStream) { state.scanStream.getTracks().forEach(t => t.stop()); state.scanStream = null; }
    const v = scanVideoEl(); if (v) v.srcObject = null;
  }

  // Schneidet den unteren Streifen aus dem Video, skaliert hoch und binarisiert
  // grob — kleiner, kontrastreicher Ausschnitt liest sich für Tesseract besser.
  function cropStrip(v) {
    const vw = v.videoWidth, vh = v.videoHeight;
    const sx = Math.floor(vw * STRIP.x), sy = Math.floor(vh * STRIP.y);
    const sw = Math.floor(vw * STRIP.w), sh = Math.floor(vh * STRIP.h);
    const scale = 2;
    let c = state._scanCanvas;
    if (!c) { c = state._scanCanvas = document.createElement('canvas'); }
    c.width = sw * scale; c.height = sh * scale;
    const ctx = c.getContext('2d');
    ctx.drawImage(v, sx, sy, sw, sh, 0, 0, c.width, c.height);
    const img = ctx.getImageData(0, 0, c.width, c.height);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      const bw = g > 140 ? 255 : (g < 90 ? 0 : g);
      d[i] = d[i + 1] = d[i + 2] = bw;
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  async function scanTick() {
    if (!state.scanActive || state.scanBusy) return;
    const v = scanVideoEl();
    if (!v || !v.videoWidth) return;
    state.scanBusy = true;
    try {
      const { text } = await window.OCR.recognizeCanvas(cropStrip(v));
      // Debug-Feedback: zeigt, dass der Loop läuft und WAS gelesen wird.
      const clean = String(text || '').replace(/\s+/g, ' ').trim();
      setScanStatus(clean ? ('gelesen: ' + clean.slice(0, 48)) : 'gelesen: — (kein Text erkannt)');
      handleScanText(text); // überschreibt den Status bei einem Treffer
    } catch (e) {
      // Einzel-Frame-Fehler ignorieren (nächster Tick versucht es erneut).
    }
    state.scanBusy = false;
  }

  // OCR-Text → Karte im gelockten Set. Konservativ: nur Nummern akzeptieren, die
  // im Set wirklich existieren — lieber überspringen als falsch buchen.
  function parseScan(text) {
    if (!state.setCode) return null;
    const up = String(text || '').toUpperCase();
    // 1) Klar gelesene VOLLE ID gewinnt (auch falls es ausnahmsweise eine
    //    Fremdkarte ist) — das ist das spezifischste Signal.
    const m = up.match(/[A-Z]{1,3}\d{1,2}-\d{1,4}/);
    if (m) { const c = CardDB.byId.get(m[0]); if (c) return c; }
    // 2) Namens-Match im gelockten Set: längster Kartenname, der als Teilstring
    //    im (entrümpelten) OCR-Text vorkommt. Längster gewinnt, damit "WARGREYMON"
    //    nicht fälschlich auf "GREYMON" matcht.
    const norm = up.replace(/[^A-Z0-9]/g, '');
    let best = null;
    for (const e of state.nameIdx) {
      if (norm.includes(e.n) && (!best || e.n.length > best.n.length)) best = e;
    }
    if (best) return best.card;
    // 3) Sonst die Nummer im gelockten Set. Set-Code entfernen, dann mehrstellige
    //    Zifferngruppen zuerst (Sammler-Nr. 3-stellig "004"; Level/Parallel-Nr.
    //    sind kürzer → durch Längen-Sortierung nachrangig).
    const rest = up.replace(new RegExp(state.setCode.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), ' ');
    const ordered = (rest.match(/\d{1,4}/g) || []).slice().sort((a, b) => b.length - a.length);
    for (const g of ordered) {
      if (g.length < 3) continue; // Sammler-Nr. ist 3-stellig; Level/Parallel (1–2-stellig) ignorieren
      const card = state.numMap && state.numMap.get(parseInt(g, 10));
      if (card) return card;
    }
    return null;
  }

  function handleScanText(text) {
    const card = parseScan(text);
    if (!card) {
      state.scanEmpty++;
      // Karte weggenommen (Lücke) → dieselbe Karte darf danach erneut gebucht werden.
      if (state.scanEmpty >= 2) state.scanCommittedKey = null;
      state.scanStableKey = null; state.scanStableCount = 0;
      return;
    }
    state.scanEmpty = 0;
    const key = card.id;
    if (key === state.scanStableKey) state.scanStableCount++;
    else { state.scanStableKey = key; state.scanStableCount = 1; }
    // Stabil (2× in Folge) UND nicht schon zuletzt gebucht → in die Staging.
    if (state.scanStableCount >= 2 && key !== state.scanCommittedKey) {
      addToStaging(card);
      state.scanCommittedKey = key;
      flashScan(card);
    }
  }

  function flashScan(card) {
    setScanStatus('✓ ' + card.id + ' · ' + CardDB.cleanDisplayName(card) + ' erfasst');
    const v = scanVideoEl();
    if (v) { v.classList.add('ring-4', 'ring-emerald-400'); setTimeout(() => v.classList.remove('ring-4', 'ring-emerald-400'), 250); }
  }

  function addToStaging(card) {
    const variant = CardDB.mainVariantKey(card);
    const e = state.scanStaging.find(x => x.variant === variant);
    if (e) e.count++;
    else state.scanStaging.push({ cardId: card.id, variant, count: 1 });
    renderStaging();
  }

  function renderStaging() {
    const c = modal && modal.content;
    if (!c) return;
    const host = c.querySelector('#re-stage-list');
    const sum = c.querySelector('#re-stage-summary');
    const btn = c.querySelector('#re-scan-confirm');
    const n = state.scanStaging.reduce((s, e) => s + e.count, 0);
    if (sum) sum.innerHTML = `Gescannt: <b class="text-emerald-400">${n}</b> <span class="text-slate-500">(${state.scanStaging.length} versch.)</span>`;
    if (btn) { btn.textContent = n ? `Übernehmen (${n})` : 'Übernehmen'; btn.disabled = !n; btn.classList.toggle('opacity-50', !n); }
    if (!host) return;
    if (!state.scanStaging.length) {
      host.innerHTML = `<div class="text-slate-600 text-sm px-1 py-2">Noch nichts gescannt.</div>`;
      return;
    }
    host.innerHTML = state.scanStaging.map((e, i) => {
      const card = CardDB.byId.get(e.cardId);
      return `
        <div class="flex items-center gap-2 py-1 border-b border-slate-800 last:border-0 text-sm">
          <span class="font-mono text-xs text-slate-400">${escapeHtml(e.cardId)}</span>
          <span class="truncate flex-1 min-w-0">${escapeHtml(card ? CardDB.cleanDisplayName(card) : e.cardId)}</span>
          <button type="button" data-stage-dec="${i}" class="w-6 h-6 rounded bg-slate-700 hover:bg-slate-600 font-bold leading-none">−</button>
          <span class="w-6 text-center font-bold text-amber-400">${e.count}</span>
          <button type="button" data-stage-inc="${i}" class="w-6 h-6 rounded bg-slate-700 hover:bg-slate-600 font-bold leading-none">+</button>
          <button type="button" data-stage-rm="${i}" title="Entfernen" class="text-slate-500 hover:text-red-400 px-1.5">✕</button>
        </div>`;
    }).join('');
    host.querySelectorAll('[data-stage-inc]').forEach(b => b.addEventListener('click', () => { state.scanStaging[parseInt(b.dataset.stageInc, 10)].count++; renderStaging(); }));
    host.querySelectorAll('[data-stage-dec]').forEach(b => b.addEventListener('click', () => {
      const idx = parseInt(b.dataset.stageDec, 10);
      const e = state.scanStaging[idx];
      if (e) { e.count--; if (e.count <= 0) state.scanStaging.splice(idx, 1); }
      renderStaging();
    }));
    host.querySelectorAll('[data-stage-rm]').forEach(b => b.addEventListener('click', () => { state.scanStaging.splice(parseInt(b.dataset.stageRm, 10), 1); renderStaging(); }));
  }

  // Schreibt die Staging-Liste in die Collection (sofort, nicht-silent → Sync +
  // Tab-Refresh). Danach Staging leeren; Scannen kann weitergehen.
  function confirmStaging() {
    const n = state.scanStaging.reduce((s, e) => s + e.count, 0);
    if (!n) return;
    for (const e of state.scanStaging) {
      for (let i = 0; i < e.count; i++) {
        Store.createCopy(state.coll, e.variant, { isProxy: false, originSet: state.setCode });
      }
    }
    Store.saveCollection(state.coll);
    state.scanStaging = [];
    renderStaging();
    if (window.App && App.refreshActiveTab) App.refreshActiveTab();
    window.Util.toast(`${n} gescannte Karte(n) übernommen.`, 'success');
  }

  // ── Öffnen ──────────────────────────────────────────────────────────────────

  function open() {
    if (!window.CardDB || !window.Store) return;
    state.coll = Store.loadCollection();
    state.log = [];
    state.committed = 0;
    state.scanActive = false;
    state.scanStaging = [];
    setSelectedCard(null);

    const sets = (CardDB.sets || []);
    const stored = Prefs.get(window.Util.PREF_KEYS.rapidEntrySet, null);
    const valid = stored && sets.some(s => s.code === stored);
    state.setCode = valid ? stored : (sets[0] && sets[0].code) || null;
    state.numMap = state.setCode ? buildNumMap(state.setCode) : new Map();
    state.nameIdx = state.setCode ? buildNameIndex(state.setCode) : [];

    const setOptions = sets.map(s =>
      `<option value="${escapeAttr(s.code)}" ${s.code === state.setCode ? 'selected' : ''}>${escapeHtml(s.code)} — ${escapeHtml(s.name)}</option>`
    ).join('');

    const kbd = k => `<span class="inline-block px-1.5 py-0.5 rounded bg-slate-700 text-slate-100 font-mono text-[11px] leading-none">${k}</span>`;

    const contentHtml = `
      <div class="flex justify-between items-start mb-2 shrink-0">
        <div class="min-w-0">
          <h2 class="text-lg font-bold">⚡ Schnellerfassung</h2>
          <div class="text-xs text-slate-400 mt-1">Ideal beim Display-Öffnen: oben das <b>Set</b> wählen, dann pro Karte die Nummer ins Feld tippen (z.&nbsp;B. <span class="font-mono">25</span> oder volle ID <span class="font-mono">BT26-025</span>).</div>
        </div>
        <button data-re-close class="modal-close-x">×</button>
      </div>
      <div class="bg-slate-900/60 border border-slate-700 rounded px-3 py-2 mb-3 shrink-0">
        <div class="text-[11px] uppercase tracking-wide text-slate-500 mb-1 font-semibold">Steuerung</div>
        <div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-300">
          <span>${kbd('Enter')} bucht die Menge (+N)</span>
          <span>${kbd('↑')} / ${kbd('↓')} Menge erhöhen / verringern</span>
          <span>${kbd('←')} / ${kbd('→')} Variante wechseln (Alt-Arts)</span>
          <span>${kbd('✕')} in der Liste = Buchung rückgängig</span>
          <span>${kbd('Esc')} oder „Fertig" = schließen (speichert &amp; synct)</span>
        </div>
      </div>

      <div class="flex flex-col sm:flex-row gap-2 mb-3 shrink-0">
        <label class="flex items-center gap-2 text-sm flex-1 min-w-0">
          <span class="text-slate-400 shrink-0">Set:</span>
          <select id="re-set" class="bg-slate-900 border border-slate-600 rounded px-2 py-2 min-h-[40px] flex-1 min-w-0">${setOptions}</select>
        </label>
        <div id="re-kb-input" class="flex gap-2">
          <input id="re-number" type="text" inputmode="numeric" autocomplete="off"
            placeholder="Nr. (z.B. 25)"
            class="bg-slate-900 border border-slate-600 rounded px-3 py-2 min-h-[40px] w-32 font-mono text-lg" />
          <button id="re-add" class="bg-emerald-500 hover:bg-emerald-400 text-slate-900 px-4 py-2 rounded font-bold min-h-[40px] whitespace-nowrap">+1</button>
        </div>
        <button id="re-scan-toggle" class="bg-sky-500 hover:bg-sky-400 text-slate-900 px-3 py-2 rounded text-sm font-semibold min-h-[40px] whitespace-nowrap"
          title="Karten per Handy-Kamera scannen (OCR). Set vorher wählen.">📷 Scannen</button>
      </div>

      <div id="re-preview" class="bg-slate-900 border border-slate-700 rounded p-3 mb-3 min-h-[120px] shrink-0"></div>

      <div id="re-scan" class="hidden flex-1 min-h-0 flex flex-col gap-2 mb-1">
        <div class="relative bg-black rounded overflow-hidden shrink-0" style="max-height:42vh">
          <video id="re-video" playsinline muted class="w-full object-cover" style="aspect-ratio:4/3"></video>
          <div class="absolute inset-0 pointer-events-none">
            <div class="absolute border-2 border-amber-400 rounded" style="left:5%;top:5%;width:90%;height:30%"></div>
            <div class="absolute left-2 bottom-2 right-2 text-[11px] bg-black/60 text-amber-200 px-2 py-1 rounded">Oberen Karten-Block (Name + Nummer) in den gelben Rahmen halten</div>
          </div>
        </div>
        <div id="re-scan-status" class="text-xs text-slate-400 min-h-[1rem] shrink-0"></div>
        <div class="flex items-center justify-between shrink-0">
          <div id="re-stage-summary" class="text-sm"></div>
          <button id="re-scan-stop" class="text-xs text-slate-400 hover:text-slate-200 underline">Scan stoppen</button>
        </div>
        <div id="re-stage-list" class="overflow-y-auto flex-1 min-h-[60px] border border-slate-800 rounded px-2"></div>
        <button id="re-scan-confirm" class="bg-emerald-500 hover:bg-emerald-400 text-slate-900 px-4 py-2 rounded font-bold min-h-[40px] shrink-0">Übernehmen</button>
      </div>

      <div id="re-results-area" class="flex-1 min-h-0 flex flex-col">
        <div class="flex items-center justify-between mb-1 shrink-0">
          <div id="re-summary" class="text-sm"></div>
          <div class="text-xs text-slate-500">Erfasste Karten ↓</div>
        </div>
        <div id="re-log" class="overflow-y-auto flex-1 min-h-[80px] border border-slate-800 rounded px-2"></div>
      </div>

      <div class="flex justify-end gap-2 mt-3 shrink-0">
        <button data-re-close class="btn-primary-emerald">Fertig</button>
      </div>
    `;

    modal = window.Util.openModal({
      host: 'rapid-entry-root',
      id: 'rapid-entry-modal',
      sizeClass: 'w-[860px] max-w-[95vw]',
      flex: true,
      contentHtml,
      onClose: () => {
        // Kamera in jedem Fall freigeben.
        stopScan();
        // Noch nicht übernommene Scans? Einmal nachfragen, bevor sie verfallen.
        const pending = state.scanStaging.reduce((s, e) => s + e.count, 0);
        if (pending > 0 && window.confirm(`${pending} gescannte Karte(n) sind noch nicht übernommen. Jetzt in die Collection übernehmen?`)) {
          confirmStaging();
        }
        // Finaler, nicht-silenter Save der Tastatur-Erfassung → feuert
        // 'collection-changed' (Sync-Push + Tab-Refresh). Nur wenn etwas erfasst wurde.
        if (state.committed > 0) {
          Store.saveCollection(state.coll);
          window.Util.toast(`${state.committed} Karte(n) erfasst.`, 'success');
          // Den aktiven Tab (i.d.R. Collection, von wo der Button kommt) frisch aus
          // dem Store rendern. Ohne das bliebe das Grid auf dem alten Stand, weil
          // 'collection-changed' nur die NICHT-aktiven Tabs als dirty markiert und
          // die Collection keinen eigenen Listener hat — die Karten waeren zwar
          // gespeichert, aber erst nach Reload sichtbar.
          if (window.App && App.refreshActiveTab) App.refreshActiveTab();
        }
        modal = null;
      },
      onMount: (content, close) => {
        content.querySelectorAll('[data-re-close]').forEach(b => b.addEventListener('click', close));
        content.querySelector('#re-set').addEventListener('change', e => changeSet(e.target.value));
        content.querySelector('#re-add').addEventListener('click', commit);

        const inp = content.querySelector('#re-number');
        inp.addEventListener('input', () => { setSelectedCard(resolveCard(inp.value)); renderPreview(); });
        inp.addEventListener('keydown', e => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          else if (e.key === 'ArrowRight') { e.preventDefault(); cycleVariant(1); }
          else if (e.key === 'ArrowLeft') { e.preventDefault(); cycleVariant(-1); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); adjustQty(1); }
          else if (e.key === 'ArrowDown') { e.preventDefault(); adjustQty(-1); }
        });

        // Scan-Controls
        content.querySelector('#re-scan-toggle').addEventListener('click', toggleScan);
        content.querySelector('#re-scan-stop').addEventListener('click', () => {
          state.scanActive = false; stopScan(); applyScanUI(false);
          const i = inputEl(); if (i) i.focus();
        });
        content.querySelector('#re-scan-confirm').addEventListener('click', confirmStaging);

        renderPreview();
        renderLog();
        renderSummary();
        renderStaging();
        setTimeout(() => inp.focus(), 50);
      }
    });
  }

  window.UIRapidEntry = { open };
})();
