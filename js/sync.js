// Cloud-Sync über Supabase. Speichert Collection + Decks pro eingeloggtem Nutzer
// in der Tabelle public.app_state und gleicht zwischen Geräten ab.
//
// Strategie: Last-Write-Wins über den gesamten Blob (collection + decks),
// Tiebreaker ist updated_at. Kein Feld-Merge — siehe IMPLEMENTATION-PLAN.md Teil B4.
//
// Wenn das Supabase-SDK oder die Keys fehlen, bleibt das Modul inaktiv und die
// App läuft rein lokal weiter (Offline-Fallback).

(function () {
  let client = null;
  let session = null;
  let onRemoteApplied = function () {};
  let onAuthStateChange = function () {};
  let pushTimer = null;
  let dirty = false;        // lokale Änderungen, die noch nicht (bestätigt) hochgeladen sind
  let statusEl = null;
  const loginHosts = [];          // gemountete Login-UI-Container (re-render bei Auth-Wechsel)

  const TABLE = 'app_state';
  const PUSH_DEBOUNCE_MS = 1500;

  // ── Status-Indikator ──────────────────────────────────────────────────────

  function setStatus(state) {
    if (!statusEl) statusEl = document.getElementById('sync-status');
    if (!statusEl) return;
    const map = {
      off:     { text: '', cls: '' },
      idle:    { text: 'nicht synchronisiert', cls: 'text-slate-500' },
      syncing: { text: '⟳ Sync…',  cls: 'text-amber-400' },
      synced:  { text: '✓ Synced', cls: 'text-emerald-400' },
      error:   { text: '⚠ Sync-Fehler', cls: 'text-red-400' }
    };
    const s = map[state] || map.idle;
    statusEl.textContent = s.text;
    statusEl.className = 'text-sm ' + s.cls + (s.text ? '' : ' hidden');
  }

  // ── Lokaler Zustand ─────────────────────────────────────────────────────────

  function localCollection() { return Store.loadCollection(); }
  function localDecks() { return Store.loadDecks(); }

  // Spätestes lokales updatedAt über Collection + Decks (ISO-String oder null).
  function localUpdatedAt() {
    const a = localCollection().updatedAt;
    const b = localDecks().updatedAt;
    if (!a) return b || null;
    if (!b) return a || null;
    return a > b ? a : b;
  }

  // ── Auth ──────────────────────────────────────────────────────────────────

  function isLoggedIn() { return !!(session && session.user); }

  async function signIn(email, password) {
    if (!client) return { error: { message: 'Sync nicht konfiguriert' } };
    setStatus('syncing');
    // E-Mail + Passwort statt Magic-Link → kein Mailversand, keine Rate-Limits.
    // Accounts werden ausschließlich vom Admin im Supabase-Dashboard angelegt
    // (Self-Signup dort deaktiviert).
    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) setStatus('error');
    return { error };
  }

  async function signOut() {
    if (!client) return;
    await client.auth.signOut();
  }

  // ── Pull / Push ─────────────────────────────────────────────────────────────

  async function pull() {
    if (!client || !isLoggedIn()) return;
    // Noch nicht gepushte lokale Änderungen haben IMMER Vorrang: niemals mit
    // (evtl. zeit-verschobenen oder von einem zweiten Kontext stammenden)
    // Remote-Daten überschreiben — stattdessen erst den lokalen Stand hochladen.
    // Verhindert, dass z.B. frisch zugewiesene Deck-Slots beim Auto-Pull
    // (Resume/Auth-Event auf dem Handy) zurückgesetzt werden.
    if (dirty) { await push(); return; }
    setStatus('syncing');
    const { data, error } = await client
      .from(TABLE)
      .select('collection, decks, updated_at')
      .maybeSingle();

    if (error) { console.warn('Sync pull-Fehler:', error); setStatus('error'); return; }

    if (!data) {
      // Noch keine Zeile für diesen Nutzer → mit lokalem Stand erstbefüllen.
      await push();
      return;
    }

    const remoteAt = data.updated_at || null;
    const localAt = localUpdatedAt();

    if (remoteAt && (!localAt || remoteAt > localAt)) {
      applyRemote(data);
    } else if (localAt && (!remoteAt || localAt > remoteAt)) {
      await push();
    } else {
      setStatus('synced');
    }
  }

  function applyRemote(row) {
    // Remote-Blob unverändert übernehmen: updatedAt NICHT neu setzen (sonst gilt der
    // lokale Stand sofort als neuer → unnötiger Rück-Push, Last-Write-Wins kaputt) und
    // kein change-Event feuern (kein Spurious-Push). Re-Render läuft über onRemoteApplied.
    if (row.collection && row.collection.copies) {
      Store.saveCollection(row.collection, { touch: false, silent: true });
    }
    if (row.decks && Array.isArray(row.decks.decks)) {
      Store.saveDecks(row.decks, { touch: false, silent: true });
    }
    setStatus('synced');
    // Geteilte Listen + Collection-Row mit AKTUELLEM Code neu publishen, sobald
    // die Remote-Decks lokal angekommen sind. Wichtig: applyRemote speichert
    // 'silent' (kein decks-changed), und der Login-Sync rennt gegen pull() — bei
    // frischem Login (leerer localStorage) lief syncSharedDecks sonst zu frueh,
    // mit leeren Decks, und nie wieder. Folge: Slot-Counts (slottedReal/Proxy)
    // fehlten in den shared_decks-Zeilen, bis der User zufaellig etwas aenderte.
    debouncedSyncShared();
    try { onRemoteApplied(); } catch (e) { console.warn('onRemoteApplied-Fehler:', e); }
  }

  function debouncedPush() {
    dirty = true; // lokaler Stand ist „noch nicht gesichert"
    if (!client || !isLoggedIn()) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(push, PUSH_DEBOUNCE_MS);
  }

  async function push() {
    if (!client || !isLoggedIn()) return;
    clearTimeout(pushTimer);
    // LocalStorage muss aktuell sein, bevor wir hochladen — Store debounced
    // den Disk-Write, daher vorm Push sicher flushen.
    if (Store.flushSaves) Store.flushSaves();
    setStatus('syncing');
    const snapshot = localUpdatedAt();   // Stand, den dieser Push hochlädt
    const payload = {
      user_id: session.user.id,
      collection: localCollection(),
      decks: localDecks(),
      updated_at: snapshot || new Date().toISOString()
    };
    const { error } = await client
      .from(TABLE)
      .upsert(payload, { onConflict: 'user_id' });
    if (error) { console.warn('Sync push-Fehler:', error); setStatus('error'); return; } // dirty bleibt → Retry
    // Nur als „sauber" markieren, wenn während des (async) Push keine neue
    // Änderung dazukam — sonst bleibt dirty und der nächste Push lädt sie nach.
    if (localUpdatedAt() === snapshot) dirty = false;
    setStatus('synced');
  }

  // Vor einem location.reload() lokale Änderungen noch pushen — der Debounce-Timer
  // würde sonst vom Reload abgebrochen. Ohne Login/Client: einfach (verzögert) neu laden.
  function flushThenReload(delayMs) {
    const reload = () => location.reload();
    if (client && isLoggedIn()) {
      Promise.resolve(push()).catch(() => {}).then(reload);
    } else {
      setTimeout(reload, delayMs || 0);
    }
  }

  // ── Login-UI ────────────────────────────────────────────────────────────────

  // Hängt die Login-/Status-Oberfläche in hostEl. Wird bei Auth-Wechsel neu gerendert.
  function mountLoginUI(hostEl) {
    if (!hostEl) return;
    if (loginHosts.indexOf(hostEl) === -1) loginHosts.push(hostEl);
    renderLoginUI(hostEl);
  }

  function renderAllLoginUIs() {
    loginHosts.forEach(h => { if (document.body.contains(h)) renderLoginUI(h); });
  }

  function renderLoginUI(hostEl) {
    if (!client) {
      hostEl.innerHTML =
        '<p class="text-sm text-slate-500">Cloud-Sync ist nicht konfiguriert ' +
        '(keine Supabase-Zugangsdaten in index.html).</p>';
      return;
    }

    if (isLoggedIn()) {
      hostEl.innerHTML = `
        <p class="text-sm text-slate-300 mb-2">
          Eingeloggt als <span class="font-semibold text-emerald-400">${escapeHtml(session.user.email || '')}</span>
        </p>
        <div class="flex flex-wrap gap-2">
          <button id="sync-now"    class="bg-emerald-500 text-slate-900 px-4 py-2 rounded font-semibold">Jetzt syncen</button>
          <button id="sync-logout" class="bg-slate-700 hover:bg-slate-600 px-4 py-2 rounded">Logout</button>
        </div>
        <div id="sync-msg" class="mt-2 text-sm text-slate-400"></div>
      `;
      hostEl.querySelector('#sync-now').addEventListener('click', async () => {
        await pull();
        const m = hostEl.querySelector('#sync-msg');
        if (m) m.textContent = 'Synchronisiert.';
      });
      hostEl.querySelector('#sync-logout').addEventListener('click', () => signOut());
    } else {
      hostEl.innerHTML = `
        <p class="text-sm text-slate-400 mb-2">
          Melde dich mit E-Mail und Passwort an, um deine Sammlung geräteübergreifend zu synchronisieren.
          Zugänge werden vom Betreiber vergeben.
        </p>
        <div class="flex flex-wrap gap-2">
          <input id="sync-email" type="email" placeholder="deine@email.de" autocomplete="username"
                 class="bg-slate-900 border border-slate-600 rounded px-3 py-2 flex-1 min-w-[200px]" />
          <input id="sync-password" type="password" placeholder="Passwort" autocomplete="current-password"
                 class="bg-slate-900 border border-slate-600 rounded px-3 py-2 flex-1 min-w-[200px]" />
          <button id="sync-signin" class="bg-emerald-500 text-slate-900 px-4 py-2 rounded font-semibold">Einloggen</button>
        </div>
        <div id="sync-msg" class="mt-2 text-sm text-slate-400"></div>
      `;
      const send = async () => {
        const email = (hostEl.querySelector('#sync-email').value || '').trim();
        const password = hostEl.querySelector('#sync-password').value || '';
        const msg = hostEl.querySelector('#sync-msg');
        if (!email || !password) { msg.textContent = 'Bitte E-Mail und Passwort eingeben.'; return; }
        msg.textContent = 'Logge ein…';
        const { error } = await signIn(email, password);
        if (!error) {
          msg.textContent = '';  // onAuthStateChange rendert die UI neu
        } else if (/invalid login|invalid credentials/i.test(error.message || '')) {
          msg.textContent = 'E-Mail oder Passwort falsch.';
        } else if (/not confirmed|confirm/i.test(error.message || '')) {
          msg.textContent = 'Konto noch nicht bestätigt – wende dich an den Betreiber.';
        } else {
          msg.textContent = 'Fehler: ' + error.message;
        }
      };
      hostEl.querySelector('#sync-signin').addEventListener('click', send);
      const onEnter = e => { if (e.key === 'Enter') send(); };
      hostEl.querySelector('#sync-email').addEventListener('keydown', onEnter);
      hostEl.querySelector('#sync-password').addEventListener('keydown', onEnter);
    }
  }

  const { escapeHtml } = window.Util;

  // ── Init ────────────────────────────────────────────────────────────────────

  function init(opts) {
    opts = opts || {};
    if (typeof opts.onRemoteApplied === 'function') onRemoteApplied = opts.onRemoteApplied;
    if (typeof opts.onAuthStateChange === 'function') onAuthStateChange = opts.onAuthStateChange;

    if (!isConfigured()) {
      setStatus('off');
      // App-Gate trotzdem informieren: nicht eingeloggt (UI bleibt gesperrt).
      try { onAuthStateChange(false); } catch (e) { console.warn('onAuthStateChange-Fehler:', e); }
      return;
    }

    client = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

    client.auth.onAuthStateChange((event, sess) => {
      session = sess;
      renderAllLoginUIs();
      if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
        if (isLoggedIn()) {
          pull();
          // Eigenes Profile + Initial-Sync der shared_decks (Cleanup).
          loadProfile(session.user.id).then(name => { ownDisplayName = name; });
          debouncedSyncShared();
        } else setStatus('idle');
      } else if (event === 'SIGNED_OUT') {
        setStatus('idle');
      }
      try { onAuthStateChange(isLoggedIn()); } catch (e) { console.warn('onAuthStateChange-Fehler:', e); }
    });

    // Auto-Login pro Gerät: bestehende Session aufgreifen.
    client.auth.getSession().then(({ data }) => {
      session = data.session;
      renderAllLoginUIs();
      if (isLoggedIn()) {
        pull();
        loadProfile(session.user.id).then(name => { ownDisplayName = name; });
        debouncedSyncShared();
      } else setStatus('idle');
      try { onAuthStateChange(isLoggedIn()); } catch (e) { console.warn('onAuthStateChange-Fehler:', e); }
    });

    document.addEventListener('collection-changed', debouncedPush);
    document.addEventListener('decks-changed', debouncedPush);
    // Shared-Decks separat — die brauchen kein app_state, sondern eigene Tabelle.
    document.addEventListener('decks-changed', debouncedSyncShared);
    // Collection-Aenderungen pushen die geteilte Collection-Row mit slotted/free-Counts.
    document.addEventListener('collection-changed', debouncedSyncShared);
  }

  // ── Profile (Anzeigename) ───────────────────────────────────────────────────

  // In-Memory-Cache: userId → display_name (oder null). Pro Session.
  const profileCache = new Map();
  let ownDisplayName = null;

  async function loadProfile(userId) {
    if (!client || !userId) return null;
    if (profileCache.has(userId)) return profileCache.get(userId);
    const { data, error } = await client.from('profiles')
      .select('display_name').eq('user_id', userId).maybeSingle();
    if (error) { console.warn('loadProfile:', error); return null; }
    const name = data ? data.display_name : null;
    profileCache.set(userId, name);
    if (session && session.user && session.user.id === userId) {
      ownDisplayName = name;
      document.dispatchEvent(new CustomEvent('profile-changed'));
    }
    return name;
  }

  async function loadProfilesFor(userIds) {
    if (!client || !userIds || !userIds.length) return new Map();
    const unknown = userIds.filter(id => !profileCache.has(id));
    if (unknown.length) {
      const { data, error } = await client.from('profiles')
        .select('user_id,display_name').in('user_id', unknown);
      if (error) console.warn('loadProfilesFor:', error);
      if (data) for (const row of data) profileCache.set(row.user_id, row.display_name || null);
      // Auch unbekannte als 'null' markieren, damit wir sie nicht erneut anfragen.
      for (const id of unknown) if (!profileCache.has(id)) profileCache.set(id, null);
    }
    const out = new Map();
    for (const id of userIds) out.set(id, profileCache.get(id) || null);
    return out;
  }

  async function saveProfile(displayName) {
    if (!client || !isLoggedIn()) return { error: { message: 'Nicht eingeloggt' } };
    const payload = {
      user_id: session.user.id,
      display_name: (displayName || '').trim() || null,
      updated_at: new Date().toISOString()
    };
    const { error } = await client.from('profiles').upsert(payload, { onConflict: 'user_id' });
    if (!error) {
      profileCache.set(session.user.id, payload.display_name);
      ownDisplayName = payload.display_name;
      document.dispatchEvent(new CustomEvent('profile-changed'));
    }
    return { error };
  }

  function getOwnDisplayName() { return ownDisplayName; }

  // ── Shared Decks ────────────────────────────────────────────────────────────

  const SHARED_DEBOUNCE_MS = 800;
  let sharedTimer = null;
  function debouncedSyncShared() {
    if (!client || !isLoggedIn()) return;
    clearTimeout(sharedTimer);
    sharedTimer = setTimeout(syncSharedDecks, SHARED_DEBOUNCE_MS);
  }

  async function syncSharedDecks() {
    if (!client || !isLoggedIn()) return;
    const userId = session.user.id;
    const ownerEmail = session.user.email || null;
    const decks = (Store.loadDecks().decks || []);
    const shared = decks.filter(d => d.shared === true);
    const rowId = d => `${userId}:${d.id}`;
    const COLLECTION_ROW_ID = `${userId}:__collection__`;
    const desiredIds = new Set(shared.map(rowId));
    desiredIds.add(COLLECTION_ROW_ID);

    const coll = Store.loadCollection();
    const deckIdx = Store.buildDeckAssignedIndex(coll);

    // 1) Collection-Row immer hochladen (read-only fuer alle anderen via RLS).
    //    Damit kann das Trade-Modal Wants gegen die Collections anderer User
    //    matchen. Pro Variante: freeReal/freeProxy + slottedReal/slottedProxy.
    {
      const variantIdx = Store.getVariantIndex(coll);
      const collectionEntries = [];
      for (const variantKey of Object.keys(variantIdx)) {
        const v = variantIdx[variantKey];
        const freeReal = v.freeReal || 0;
        const freeProxy = v.freeProxy || 0;
        const slottedReal = v.assignedReal || 0;
        const slottedProxy = v.assignedProxy || 0;
        const total = freeReal + freeProxy + slottedReal + slottedProxy;
        if (total === 0) continue;
        const info = CardDB.allVariants && CardDB.allVariants.get
          ? CardDB.allVariants.get(variantKey)
          : null;
        const cardId = info ? info.cardId : variantKey.replace(/_P\d+$/, '').replace(/-Errata$/i, '');
        collectionEntries.push({
          cardId, variant: variantKey,
          freeReal, freeProxy, slottedReal, slottedProxy
        });
      }
      const collectionPayload = [{
        id: COLLECTION_ROW_ID,
        owner_id: userId,
        owner_email: ownerEmail,
        deck_id: '__collection__',
        name: 'Collection',
        kind: 'collection',
        notes: '',
        entries: collectionEntries,
        updated_at: new Date().toISOString()
      }];
      const { error: collErr } = await client.from('shared_decks').upsert(collectionPayload, { onConflict: 'id' });
      if (collErr) console.warn('syncSharedDecks collection upsert:', collErr);
    }

    if (shared.length) {
      const payload = shared.map(d => {
        const isDeck = (d.kind || 'deck') === 'deck';
        const entries = (d.entries || []).map(e => {
          const out = { cardId: e.cardId, variant: e.variant, count: e.count };
          if (isDeck) {
            const a = Store.deckAssignedStats(deckIdx, d.id, e.variant);
            out.slottedReal = a.real || 0;
            out.slottedProxy = a.proxy || 0;
          }
          return out;
        });
        // ownerEmail kommt jetzt aus dem outer-Scope.
        return {
          id: rowId(d),
          owner_id: userId,
          owner_email: ownerEmail,
          deck_id: d.id,
          name: d.name || 'Untitled',
          kind: d.kind || 'deck',
          notes: d.notes || '',
          entries,
          updated_at: d.updatedAt || new Date().toISOString()
        };
      });
      const { error } = await client.from('shared_decks').upsert(payload, { onConflict: 'id' });
      if (error) console.warn('syncSharedDecks upsert:', error);
    }
    // Aufraeumen: alle eigenen Zeilen pruefen + wegputzen, was nicht mehr shared ist.
    const { data: existing, error: selErr } = await client.from('shared_decks')
      .select('id').eq('owner_id', userId);
    if (selErr) { console.warn('syncSharedDecks select:', selErr); return; }
    const toDelete = (existing || []).map(r => r.id).filter(id => !desiredIds.has(id));
    if (toDelete.length) {
      const { error } = await client.from('shared_decks').delete().in('id', toDelete);
      if (error) console.warn('syncSharedDecks delete:', error);
    }
  }

  async function loadSharedDecks(kind) {
    if (!client) return { decks: [], error: 'Sync nicht verfügbar' };
    let q = client.from('shared_decks').select('id,owner_id,owner_email,deck_id,name,kind,notes,entries,updated_at');
    if (kind) q = q.eq('kind', kind);
    const { data, error } = await q.order('updated_at', { ascending: false });
    if (error) return { decks: [], error: error.message || String(error) };
    return { decks: data || [], error: null };
  }

  // True, wenn Supabase-SDK + URL + Anon-Key gesetzt sind.
  function isConfigured() {
    return !!(window.supabase && window.SUPABASE_URL && window.SUPABASE_ANON_KEY);
  }

  window.Sync = {
    init,
    signIn,
    signOut,
    pull,
    push,
    flushThenReload,
    mountLoginUI,
    isLoggedIn: () => isLoggedIn(),
    isConfigured,
    getClient: () => client,
    getSessionEmail: () => (session && session.user) ? session.user.email : null,
    getUserId: () => (session && session.user) ? session.user.id : null,
    loadProfile,
    loadProfilesFor,
    saveProfile,
    getOwnDisplayName,
    syncSharedDecks,
    loadSharedDecks
  };
})();
