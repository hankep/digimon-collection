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
  let pushTimer = null;
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
    try { onRemoteApplied(); } catch (e) { console.warn('onRemoteApplied-Fehler:', e); }
  }

  function debouncedPush() {
    if (!client || !isLoggedIn()) return;
    clearTimeout(pushTimer);
    pushTimer = setTimeout(push, PUSH_DEBOUNCE_MS);
  }

  async function push() {
    if (!client || !isLoggedIn()) return;
    clearTimeout(pushTimer);
    setStatus('syncing');
    const payload = {
      user_id: session.user.id,
      collection: localCollection(),
      decks: localDecks(),
      updated_at: localUpdatedAt() || new Date().toISOString()
    };
    const { error } = await client
      .from(TABLE)
      .upsert(payload, { onConflict: 'user_id' });
    if (error) { console.warn('Sync push-Fehler:', error); setStatus('error'); return; }
    setStatus('synced');
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

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // ── Init ────────────────────────────────────────────────────────────────────

  function init(opts) {
    opts = opts || {};
    if (typeof opts.onRemoteApplied === 'function') onRemoteApplied = opts.onRemoteApplied;

    if (!window.supabase || !window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) {
      setStatus('off');
      return; // inaktiv → App läuft rein lokal
    }

    client = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

    client.auth.onAuthStateChange((event, sess) => {
      session = sess;
      renderAllLoginUIs();
      if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
        if (isLoggedIn()) pull(); else setStatus('idle');
      } else if (event === 'SIGNED_OUT') {
        setStatus('idle');
      }
    });

    // Auto-Login pro Gerät: bestehende Session aufgreifen.
    client.auth.getSession().then(({ data }) => {
      session = data.session;
      renderAllLoginUIs();
      if (isLoggedIn()) pull(); else setStatus('idle');
    });

    document.addEventListener('collection-changed', debouncedPush);
    document.addEventListener('decks-changed', debouncedPush);
  }

  window.Sync = {
    init,
    signIn,
    signOut,
    pull,
    push,
    mountLoginUI,
    isLoggedIn: () => isLoggedIn()
  };
})();
