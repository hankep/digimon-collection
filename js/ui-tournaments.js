// Tournaments-Tab: gemeinsame Turnierliste aller User. Turniere leben nur in
// Supabase (Tabelle 'tournaments'), kein LocalStorage-Cache — siehe sync.js.
// Platzierungen koennen ein geteiltes Deck eines der App-User verknuepfen
// (Snapshot der Eintraege zum Verknuepfungszeitpunkt) oder, fuer Spieler ohne
// Account, einen reinen Freitext-Decknamen tragen.

(function () {
  const { escapeHtml, escapeAttr } = window.Util;
  const RESULTS = [
    { key: 'W', label: 'Sieg' },
    { key: 'L', label: 'Niederlage' },
    { key: 'D', label: 'Unentschieden' }
  ];

  const state = {
    tournaments: null,   // null = noch nicht geladen
    loadError: null,
    profiles: new Map()  // userId -> displayName, fuer die Anzeige
  };

  let rootEl = null;
  let listEl = null;

  function init(el) {
    rootEl = el;
    render();
    loadAll();
  }

  function render() {
    rootEl.innerHTML = `
      <div class="max-w-5xl mx-auto">
        <div class="flex items-center gap-2 mb-3 flex-wrap">
          <h2 class="text-xl font-bold">🏆 Tournaments</h2>
          <span class="text-xs text-slate-500">Gemeinsame Turnierliste — Platzierungen, Decklisten &amp; Rundenverlauf.</span>
          <button id="tourn-refresh" class="bg-slate-700 hover:bg-slate-600 text-slate-100 text-sm px-3 py-1 rounded">⟳ Neu laden</button>
          <button id="tourn-new" class="btn-primary-amber ml-auto">+ Neues Turnier</button>
        </div>
        <div id="tourn-list"></div>
      </div>
    `;
    listEl = rootEl.querySelector('#tourn-list');
    rootEl.querySelector('#tourn-refresh').addEventListener('click', loadAll);
    rootEl.querySelector('#tourn-new').addEventListener('click', () => openFormModal(null));
  }

  async function loadAll() {
    state.loadError = null;
    state.tournaments = null;
    renderList();
    if (!window.Sync || !Sync.listTournaments) {
      state.loadError = 'Sync nicht verfügbar.';
      renderList();
      return;
    }
    const { tournaments, error } = await Sync.listTournaments();
    if (error) { state.loadError = error; renderList(); return; }
    const ownerIds = new Set();
    for (const t of tournaments) {
      for (const p of (t.placements || [])) {
        if (p.linkedDeck && p.linkedDeck.ownerId) ownerIds.add(p.linkedDeck.ownerId);
      }
    }
    if (ownerIds.size) {
      const profiles = await Sync.loadProfilesFor(Array.from(ownerIds));
      for (const [id, name] of profiles) state.profiles.set(id, name);
    }
    state.tournaments = tournaments;
    renderList();
  }

  function ownerLabel(linkedDeck) {
    return state.profiles.get(linkedDeck.ownerId) || linkedDeck.ownerName || '—';
  }

  function renderList() {
    if (!listEl) return;
    if (state.loadError) {
      listEl.innerHTML = `<div class="bg-red-900/20 border border-red-700 rounded p-4 text-sm text-red-300">Fehler: ${escapeHtml(state.loadError)}</div>`;
      return;
    }
    if (state.tournaments === null) {
      listEl.innerHTML = `<div class="text-sm text-slate-400">Lade…</div>`;
      return;
    }
    if (!state.tournaments.length) {
      listEl.innerHTML = `<div class="bg-slate-800 rounded p-4 text-sm text-slate-400">Noch keine Turniere erfasst.</div>`;
      return;
    }
    listEl.innerHTML = state.tournaments.map(tournamentCardHtml).join('');
    listEl.querySelectorAll('[data-tourn-edit]').forEach(btn => {
      btn.addEventListener('click', () => {
        const t = state.tournaments.find(x => x.id === btn.dataset.tournEdit);
        if (t) openFormModal(t);
      });
    });
    listEl.querySelectorAll('[data-tourn-delete]').forEach(btn => {
      btn.addEventListener('click', () => deleteTournament(btn.dataset.tournDelete));
    });
    listEl.querySelectorAll('[data-view-deck]').forEach(btn => {
      btn.addEventListener('click', () => {
        const t = state.tournaments.find(x => x.id === btn.dataset.viewDeckTournament);
        const p = t && (t.placements || [])[Number(btn.dataset.viewDeckIdx)];
        if (p && p.linkedDeck) openDeckViewModal(p.linkedDeck);
      });
    });
  }

  function tournamentCardHtml(t) {
    const placements = (t.placements || []).slice().sort((a, b) => (a.rank || 999) - (b.rank || 999));
    const dateLabel = t.event_date ? new Date(t.event_date + 'T00:00:00').toLocaleDateString('de-DE') : '—';
    const rows = placements.map((p, idx) => {
      let deckHtml;
      if (p.linkedDeck) {
        const total = (p.linkedDeck.entries || []).reduce((s, e) => s + (e.count || 0), 0);
        deckHtml = `<button class="text-amber-400 hover:underline text-left" data-view-deck data-view-deck-tournament="${escapeAttr(t.id)}" data-view-deck-idx="${idx}">
          ${escapeHtml(p.linkedDeck.deckName)} <span class="text-slate-500">(${escapeHtml(ownerLabel(p.linkedDeck))} · ${total} Karten)</span>
        </button>`;
      } else {
        deckHtml = `<span class="text-slate-300">${escapeHtml(p.deckPlaceholder || '—')}</span>`;
      }
      const rounds = (p.rounds || []).map(r => {
        const cls = r.result === 'W' ? 'text-emerald-400' : r.result === 'L' ? 'text-rose-400' : 'text-slate-400';
        const resLabel = (RESULTS.find(x => x.key === r.result) || {}).label || r.result;
        const note = r.note ? ` <span class="text-slate-500" title="Notiz">(${escapeHtml(r.note)})</span>` : '';
        return `<div class="text-xs ${cls}">vs. ${escapeHtml(r.opponent || '—')}: ${escapeHtml(resLabel)}${note}</div>`;
      }).join('');
      return `<tr>
        <td class="pr-3 font-bold text-amber-400">#${escapeHtml(p.rank != null ? p.rank : '?')}</td>
        <td class="pr-3">${escapeHtml(p.playerName || '—')}</td>
        <td class="pr-3">${deckHtml}</td>
        <td class="pr-3">${p.points != null ? escapeHtml(p.points) : '—'}</td>
        <td class="pr-3">${rounds || '<span class="text-slate-600">—</span>'}</td>
      </tr>`;
    }).join('');

    return `<div class="bg-slate-800 rounded p-4 mb-3">
      <div class="flex items-start justify-between gap-2 flex-wrap mb-2">
        <div>
          <div class="font-bold text-lg">${escapeHtml(t.location || 'Unbenannter Ort')}</div>
          <div class="text-xs text-slate-400">${dateLabel} · ${escapeHtml(t.type)} · ${t.participant_count != null ? t.participant_count + ' Teilnehmer' : 'Teilnehmerzahl unbekannt'}</div>
        </div>
        <div class="flex gap-2 shrink-0">
          <button class="btn-secondary" data-tourn-edit="${escapeAttr(t.id)}">Bearbeiten</button>
          <button class="btn-secondary" data-tourn-delete="${escapeAttr(t.id)}">Löschen</button>
        </div>
      </div>
      <div class="overflow-x-auto">
        <table class="wants-table text-sm w-full">
          <thead class="text-xs text-slate-500 uppercase">
            <tr><td>Platz</td><td>Name</td><td>Deck</td><td>Punkte</td><td>Runden</td></tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="5" class="text-slate-500">Keine Platzierungen erfasst.</td></tr>'}</tbody>
        </table>
      </div>
    </div>`;
  }

  async function deleteTournament(id) {
    if (!confirm('Dieses Turnier wirklich löschen?')) return;
    const { error } = await Sync.deleteTournament(id);
    if (error) { window.Util.toast('Löschen fehlgeschlagen: ' + error, 'error'); return; }
    document.dispatchEvent(new CustomEvent('tournaments-changed'));
    loadAll();
  }

  function openDeckViewModal(linkedDeck) {
    const entries = (linkedDeck.entries || []).map(e => {
      const card = CardDB.byId.get(e.cardId);
      const name = card ? CardDB.cleanDisplayName(card) : e.cardId;
      const level = card && card.level != null ? card.level : null;
      return { entry: e, name, level };
    }).sort((a, b) => {
      const al = a.level == null ? Infinity : a.level;
      const bl = b.level == null ? Infinity : b.level;
      if (al !== bl) return al - bl;
      return a.name.localeCompare(b.name);
    });
    const total = entries.reduce((s, m) => s + (m.entry.count || 0), 0);
    const contentHtml = `
      <div class="flex justify-between items-start mb-3 shrink-0">
        <div class="min-w-0">
          <h2 class="text-lg font-bold truncate">${escapeHtml(linkedDeck.deckName)}</h2>
          <div class="text-xs text-slate-400 mt-1">von <b>${escapeHtml(ownerLabel(linkedDeck))}</b> · ${total} Karten</div>
        </div>
        <button data-modal-close class="modal-close-x">×</button>
      </div>
      <div class="overflow-y-auto flex-1 min-h-0 pr-1">
        <table class="wants-table text-sm w-full">
          <tbody>
            ${entries.map(m => `<tr>
              <td class="pr-3 text-amber-400 font-bold">${m.entry.count}×</td>
              <td>${escapeHtml(m.name)}</td>
              <td class="text-slate-500 font-mono text-xs">${escapeHtml(m.entry.variant)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="flex justify-end mt-3 shrink-0">
        <button data-modal-close class="btn-secondary">Schliessen</button>
      </div>
    `;
    window.Util.openModal({
      host: 'tourn-modal-root',
      id: 'tourn-deck-view',
      sizeClass: 'w-[560px] max-w-[95vw] max-h-[85vh]',
      flex: true,
      contentHtml,
      onMount: (content, close) => {
        content.querySelectorAll('[data-modal-close]').forEach(b => b.addEventListener('click', close));
      }
    });
  }

  // ── Formular (Anlegen/Bearbeiten) ────────────────────────────────────────────

  function genId() {
    return 't_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  }

  function placementToForm(p) {
    const hasLinked = !!p.linkedDeck;
    return {
      rank: p.rank != null ? p.rank : '',
      playerName: p.playerName || '',
      points: p.points != null ? p.points : '',
      deckKey: hasLinked ? `${p.linkedDeck.ownerId}::${p.linkedDeck.deckId}` : '',
      deckPlaceholder: p.deckPlaceholder || '',
      rounds: (p.rounds || []).map(r => ({ opponent: r.opponent || '', result: r.result || 'W', note: r.note || '' }))
    };
  }

  function openFormModal(existing) {
    const form = {
      id: existing ? existing.id : null,
      location: existing ? (existing.location || '') : '',
      eventDate: existing ? (existing.event_date || '') : '',
      type: existing ? existing.type : Sync.TOURNAMENT_TYPES[0],
      participantCount: existing && existing.participant_count != null ? existing.participant_count : '',
      placements: existing ? (existing.placements || []).map(placementToForm) : []
    };
    let sharedDeckList = []; // flach, befuellt nach dem Laden; Key = ownerId::deckId

    const contentHtml = `
      <div class="flex justify-between items-start mb-3 shrink-0">
        <h2 class="text-lg font-bold">${existing ? 'Turnier bearbeiten' : 'Neues Turnier'}</h2>
        <button data-modal-close class="modal-close-x">×</button>
      </div>
      <div class="overflow-y-auto flex-1 min-h-0 pr-1 space-y-3">
        <div class="grid grid-cols-2 gap-2">
          <label class="text-sm">Ort
            <input id="tf-location" type="text" value="${escapeAttr(form.location)}"
                   class="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm mt-1" />
          </label>
          <label class="text-sm">Datum
            <input id="tf-date" type="date" value="${escapeAttr(form.eventDate)}"
                   class="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm mt-1" />
          </label>
          <label class="text-sm">Turnierart
            <select id="tf-type" class="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm mt-1">
              ${Sync.TOURNAMENT_TYPES.map(t => `<option value="${escapeAttr(t)}" ${t === form.type ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('')}
            </select>
          </label>
          <label class="text-sm">Teilnehmerzahl
            <input id="tf-count" type="number" min="0" value="${escapeAttr(form.participantCount)}"
                   class="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm mt-1" />
          </label>
        </div>
        <div>
          <div class="flex items-center gap-2 mb-2">
            <h3 class="font-semibold">Platzierungen</h3>
            <button id="tf-add-placement" class="btn-secondary text-xs">+ Platzierung</button>
          </div>
          <div id="tf-placements" class="space-y-3"></div>
        </div>
      </div>
      <div class="flex justify-end gap-2 mt-3 shrink-0">
        <button data-modal-close class="btn-secondary">Abbrechen</button>
        <button id="tf-save" class="btn-primary-emerald">Speichern</button>
      </div>
    `;

    window.Util.openModal({
      host: 'tourn-modal-root',
      id: 'tourn-form',
      sizeClass: 'w-[820px] max-w-[95vw] max-h-[90vh]',
      flex: true,
      contentHtml,
      onMount: async (content, close) => {
        content.querySelectorAll('[data-modal-close]').forEach(b => b.addEventListener('click', close));
        const placementsEl = content.querySelector('#tf-placements');

        function renderPlacements() {
          placementsEl.innerHTML = form.placements.map((p, i) => placementRowHtml(p, i, sharedDeckList)).join('')
            || '<div class="text-sm text-slate-500">Noch keine Platzierungen.</div>';
          wirePlacements();
        }

        function wirePlacements() {
          placementsEl.querySelectorAll('[data-p-idx]').forEach(row => {
            const idx = Number(row.dataset.pIdx);
            const p = form.placements[idx];
            row.querySelector('[data-f=rank]').addEventListener('input', e => { p.rank = e.target.value; });
            row.querySelector('[data-f=playerName]').addEventListener('input', e => { p.playerName = e.target.value; });
            row.querySelector('[data-f=points]').addEventListener('input', e => { p.points = e.target.value; });
            row.querySelector('[data-f=deckKey]').addEventListener('change', e => {
              p.deckKey = e.target.value;
              renderPlacements();
            });
            const placeholderInput = row.querySelector('[data-f=deckPlaceholder]');
            if (placeholderInput) placeholderInput.addEventListener('input', e => { p.deckPlaceholder = e.target.value; });
            row.querySelector('[data-remove-placement]').addEventListener('click', () => {
              form.placements.splice(idx, 1);
              renderPlacements();
            });
            row.querySelector('[data-add-round]').addEventListener('click', () => {
              p.rounds.push({ opponent: '', result: 'W', note: '' });
              renderPlacements();
            });
            row.querySelectorAll('[data-round-idx]').forEach(roundRow => {
              const rIdx = Number(roundRow.dataset.roundIdx);
              const r = p.rounds[rIdx];
              roundRow.querySelector('[data-f=opponent]').addEventListener('input', e => { r.opponent = e.target.value; });
              roundRow.querySelector('[data-f=result]').addEventListener('change', e => { r.result = e.target.value; });
              roundRow.querySelector('[data-f=note]').addEventListener('input', e => { r.note = e.target.value; });
              roundRow.querySelector('[data-remove-round]').addEventListener('click', () => {
                p.rounds.splice(rIdx, 1);
                renderPlacements();
              });
            });
          });
        }

        content.querySelector('#tf-add-placement').addEventListener('click', () => {
          form.placements.push({ rank: form.placements.length + 1, playerName: '', points: '', deckKey: '', deckPlaceholder: '', rounds: [] });
          renderPlacements();
        });

        renderPlacements();

        // Geteilte Decks (kind='deck') aller User laden, fuer den Deck-Picker.
        // Laeuft im Hintergrund nach; bereits eingegebene Platzierungen bleiben
        // erhalten, nur die <select>-Optionen werden nachgereicht.
        if (window.Sync && Sync.loadSharedDecks) {
          const { decks, error } = await Sync.loadSharedDecks('deck');
          if (!error && decks) {
            const ownerIds = Array.from(new Set(decks.map(d => d.owner_id)));
            const profiles = await Sync.loadProfilesFor(ownerIds);
            sharedDeckList = decks.map(d => ({
              ownerId: d.owner_id,
              ownerName: profiles.get(d.owner_id) || (d.owner_email || '').split('@')[0] || '—',
              deckId: d.deck_id,
              deckName: d.name,
              entries: d.entries || []
            }));
            renderPlacements();
          }
        }

        content.querySelector('#tf-save').addEventListener('click', async () => {
          const location = content.querySelector('#tf-location').value.trim();
          const eventDate = content.querySelector('#tf-date').value || null;
          const type = content.querySelector('#tf-type').value;
          const participantCountRaw = content.querySelector('#tf-count').value;
          const participantCount = participantCountRaw === '' ? null : Number(participantCountRaw);

          const placements = form.placements.map(p => {
            const linked = p.deckKey ? sharedDeckList.find(d => `${d.ownerId}::${d.deckId}` === p.deckKey) : null;
            return {
              rank: p.rank === '' ? null : Number(p.rank),
              playerName: (p.playerName || '').trim(),
              points: p.points === '' ? null : Number(p.points),
              linkedDeck: linked ? { ownerId: linked.ownerId, ownerName: linked.ownerName, deckId: linked.deckId, deckName: linked.deckName, entries: linked.entries } : null,
              deckPlaceholder: linked ? null : ((p.deckPlaceholder || '').trim() || null),
              rounds: p.rounds.map(r => ({ opponent: (r.opponent || '').trim(), result: r.result, note: (r.note || '').trim() }))
            };
          });

          const saveBtn = content.querySelector('#tf-save');
          saveBtn.disabled = true;
          saveBtn.textContent = 'Speichere…';
          const { error } = await Sync.upsertTournament({
            id: form.id || genId(),
            location, eventDate, type, participantCount, placements
          });
          if (error) {
            window.Util.toast('Speichern fehlgeschlagen: ' + error, 'error');
            saveBtn.disabled = false;
            saveBtn.textContent = 'Speichern';
            return;
          }
          document.dispatchEvent(new CustomEvent('tournaments-changed'));
          close();
          loadAll();
        });
      }
    });
  }

  function placementRowHtml(p, idx, sharedDeckList) {
    const byOwner = new Map();
    for (const d of sharedDeckList) {
      if (!byOwner.has(d.ownerId)) byOwner.set(d.ownerId, { name: d.ownerName, decks: [] });
      byOwner.get(d.ownerId).decks.push(d);
    }
    const optgroups = Array.from(byOwner.values()).map(o => `
      <optgroup label="${escapeAttr(o.name)}">
        ${o.decks.map(d => `<option value="${escapeAttr(d.ownerId + '::' + d.deckId)}" ${p.deckKey === (d.ownerId + '::' + d.deckId) ? 'selected' : ''}>${escapeHtml(d.deckName)}</option>`).join('')}
      </optgroup>`).join('');
    const roundsHtml = p.rounds.map((r, rIdx) => `
      <div class="flex gap-2 items-center" data-round-idx="${rIdx}">
        <input data-f="opponent" type="text" placeholder="Gegner" value="${escapeAttr(r.opponent)}"
               class="flex-1 bg-slate-900 border border-slate-600 rounded px-2 py-1 text-sm" />
        <select data-f="result" class="bg-slate-900 border border-slate-600 rounded px-2 py-1 text-sm">
          ${RESULTS.map(x => `<option value="${x.key}" ${r.result === x.key ? 'selected' : ''}>${x.label}</option>`).join('')}
        </select>
        <input data-f="note" type="text" placeholder="Notiz (optional)" value="${escapeAttr(r.note)}"
               class="flex-1 bg-slate-900 border border-slate-600 rounded px-2 py-1 text-sm" />
        <button data-remove-round class="text-rose-400 hover:text-rose-300 text-sm px-1">✕</button>
      </div>`).join('');

    return `<div class="bg-slate-900 rounded p-3" data-p-idx="${idx}">
      <div class="grid grid-cols-4 gap-2 mb-2">
        <input data-f="rank" type="number" min="1" placeholder="Platz" value="${escapeAttr(p.rank)}"
               class="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm" />
        <input data-f="playerName" type="text" placeholder="Name" value="${escapeAttr(p.playerName)}"
               class="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm col-span-2" />
        <input data-f="points" type="number" placeholder="Punkte" value="${escapeAttr(p.points)}"
               class="bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm" />
      </div>
      <div class="flex gap-2 mb-2">
        <select data-f="deckKey" class="flex-1 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm">
          <option value="">— Freitext —</option>
          ${optgroups}
        </select>
        ${!p.deckKey ? `<input data-f="deckPlaceholder" type="text" placeholder="Deckname (Freitext)" value="${escapeAttr(p.deckPlaceholder)}"
               class="flex-1 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm" />` : ''}
        <button data-remove-placement class="btn-secondary text-xs">Platzierung entfernen</button>
      </div>
      <div class="space-y-1">
        ${roundsHtml}
        <button data-add-round class="text-xs text-amber-400 hover:underline">+ Runde</button>
      </div>
    </div>`;
  }

  window.UITournaments = { init };
})();
