// Reports: User koennen Bugs/Features melden und alle bisherigen Reports lesen.
// Persistenz: Supabase-Tabelle public.reports.
//
// API: UIReports.init() — am Login-Zeitpunkt aufgerufen, wired den Header-Button.
// Setup: SQL in /Users/phanke/.claude/plans/... (Tabelle public.reports + RLS).

(function () {
  let wired = false;

  function init() {
    if (wired) return;
    const btn = document.getElementById('report-btn');
    if (!btn) return;
    btn.addEventListener('click', openReportsModal);
    wired = true;
  }

  function host() {
    let el = document.getElementById('reports-root');
    if (!el) {
      el = document.createElement('div');
      el.id = 'reports-root';
      document.body.appendChild(el);
    }
    return el;
  }

  // State innerhalb des Modals — wird bei jedem Open zurueckgesetzt.
  let state = null;

  function openReportsModal() {
    state = {
      tab: 'list',                  // 'list' | 'new'
      submitType: 'bug',            // 'bug' | 'feature'
      submitText: '',
      reports: null,                // null = noch nicht geladen
      loadError: null,
      filterType: 'all',            // 'all' | 'bug' | 'feature'
      filterStatus: 'open',         // 'all' | 'open'
      expandedId: null
    };
    render();
    loadReports();
  }

  function close() {
    const el = document.getElementById('reports-root');
    if (el) el.innerHTML = '';
    document.removeEventListener('keydown', escListener);
    state = null;
  }

  function escListener(e) { if (e.key === 'Escape') close(); }

  function render() {
    const el = host();
    el.innerHTML = `
      <div class="modal-backdrop" id="reports-modal">
        <div class="modal-content w-[720px] max-w-[95vw] max-h-[90vh] flex flex-col">
          <div class="flex justify-between items-start mb-3 shrink-0">
            <div>
              <h2 class="text-lg font-bold">Reports</h2>
              <div class="text-xs text-slate-400 mt-1">Bugs melden, Features vorschlagen, andere Reports lesen.</div>
            </div>
            <button id="reports-close" class="text-slate-400 hover:text-white text-2xl leading-none">×</button>
          </div>

          <div class="flex gap-2 mb-3 shrink-0">
            <button data-tab="list" class="px-3 py-1.5 rounded text-sm font-semibold ${state.tab === 'list' ? 'bg-amber-500 text-slate-900' : 'bg-slate-700 hover:bg-slate-600'}">Alle Reports</button>
            <button data-tab="new"  class="px-3 py-1.5 rounded text-sm font-semibold ${state.tab === 'new'  ? 'bg-amber-500 text-slate-900' : 'bg-slate-700 hover:bg-slate-600'}">Neuer Report</button>
          </div>

          <div id="reports-body" class="overflow-y-auto flex-1 min-h-0 pr-1"></div>
        </div>
      </div>
    `;
    el.querySelector('#reports-close').addEventListener('click', close);
    el.querySelector('#reports-modal').addEventListener('click', e => {
      if (e.target.id === 'reports-modal') close();
    });
    el.querySelectorAll('[data-tab]').forEach(btn => {
      btn.addEventListener('click', () => { state.tab = btn.dataset.tab; render(); });
    });
    document.addEventListener('keydown', escListener);
    renderBody();
  }

  function renderBody() {
    const body = document.getElementById('reports-body');
    if (!body) return;
    if (state.tab === 'new') renderNewTab(body);
    else renderListTab(body);
  }

  // ---- Tab: Neuer Report -----------------------------------------------------

  function renderNewTab(body) {
    body.innerHTML = `
      <div class="space-y-3">
        <div class="flex gap-3 text-sm">
          <label class="flex items-center gap-1 cursor-pointer">
            <input type="radio" name="report-type" value="bug" ${state.submitType === 'bug' ? 'checked' : ''} />
            <span>🐛 Bug</span>
          </label>
          <label class="flex items-center gap-1 cursor-pointer">
            <input type="radio" name="report-type" value="feature" ${state.submitType === 'feature' ? 'checked' : ''} />
            <span>✨ Feature</span>
          </label>
        </div>
        <textarea id="report-text" rows="10"
          class="w-full bg-slate-900 border border-slate-600 rounded p-3 font-mono text-xs"
          placeholder="Was ist passiert / was wuenschst du dir?">${escapeHtml(state.submitText)}</textarea>
        <div id="report-msg" class="text-sm min-h-[1.25rem] text-slate-400"></div>
        <div class="flex justify-end gap-2">
          <button id="report-cancel" class="bg-slate-700 hover:bg-slate-600 px-3 py-1.5 rounded text-sm">Verwerfen</button>
          <button id="report-submit" class="bg-amber-500 text-slate-900 hover:bg-amber-400 px-4 py-1.5 rounded text-sm font-semibold">Absenden</button>
        </div>
      </div>
    `;
    body.querySelectorAll('input[name="report-type"]').forEach(r => {
      r.addEventListener('change', e => { state.submitType = e.target.value; });
    });
    body.querySelector('#report-text').addEventListener('input', e => { state.submitText = e.target.value; });
    body.querySelector('#report-cancel').addEventListener('click', () => {
      state.submitText = '';
      state.tab = 'list';
      render();
    });
    body.querySelector('#report-submit').addEventListener('click', submitReport);
  }

  async function submitReport() {
    const msgEl = document.getElementById('report-msg');
    const text = (state.submitText || '').trim();
    if (!text) { if (msgEl) msgEl.textContent = 'Bitte einen Text eingeben.'; return; }
    if (!window.Sync || !Sync.getClient || !Sync.getClient()) {
      if (msgEl) msgEl.textContent = 'Sync nicht verfügbar — bitte einloggen.';
      return;
    }
    const client = Sync.getClient();
    const userId = Sync.getUserId();
    const userEmail = Sync.getSessionEmail();
    if (!userId || !userEmail) {
      if (msgEl) msgEl.textContent = 'Kein eingeloggter User.';
      return;
    }
    if (msgEl) { msgEl.textContent = 'Sende…'; msgEl.className = 'text-sm text-slate-400'; }
    const { data, error } = await client.from('reports').insert({
      user_id: userId,
      user_email: userEmail,
      type: state.submitType,
      text
    }).select().single();
    if (error) {
      if (msgEl) { msgEl.textContent = 'Fehler: ' + (error.message || 'unbekannt'); msgEl.className = 'text-sm text-red-400'; }
      return;
    }
    state.submitText = '';
    state.submitType = 'bug';
    state.tab = 'list';
    if (Array.isArray(state.reports) && data) state.reports.unshift(data);
    render();
  }

  // ---- Tab: Alle Reports -----------------------------------------------------

  async function loadReports() {
    if (!window.Sync || !Sync.getClient || !Sync.getClient()) {
      state.loadError = 'Sync nicht verfügbar.';
      renderBody();
      return;
    }
    const client = Sync.getClient();
    const { data, error } = await client.from('reports')
      .select('id,user_id,user_email,type,text,status,created_at')
      .order('created_at', { ascending: false });
    if (error) {
      state.loadError = error.message || 'Fehler beim Laden';
      state.reports = [];
    } else {
      state.loadError = null;
      state.reports = data || [];
    }
    renderBody();
  }

  function renderListTab(body) {
    if (state.reports === null) {
      body.innerHTML = `<div class="text-sm text-slate-400">Lade…</div>`;
      return;
    }
    if (state.loadError) {
      body.innerHTML = `<div class="text-sm text-red-400">Fehler: ${escapeHtml(state.loadError)}</div>`;
      return;
    }
    const ownId = (window.Sync && Sync.getUserId) ? Sync.getUserId() : null;
    const filtered = state.reports.filter(r => {
      if (state.filterType !== 'all' && r.type !== state.filterType) return false;
      if (state.filterStatus !== 'all' && r.status !== state.filterStatus) return false;
      return true;
    });
    body.innerHTML = `
      <div class="flex flex-wrap items-center gap-3 mb-3 text-xs">
        <span class="text-slate-400">Typ:</span>
        ${typeFilterPills()}
        <span class="text-slate-400">Status:</span>
        ${statusFilterPills()}
        <span class="ml-auto text-slate-500">${filtered.length} / ${state.reports.length}</span>
      </div>
      <div class="space-y-2">
        ${filtered.length ? filtered.map(r => renderReportRow(r, r.user_id === ownId)).join('') : '<div class="text-sm text-slate-500">Keine Eintraege.</div>'}
      </div>
    `;
    body.querySelectorAll('[data-filter-type]').forEach(b => b.addEventListener('click', () => {
      state.filterType = b.dataset.filterType; renderBody();
    }));
    body.querySelectorAll('[data-filter-status]').forEach(b => b.addEventListener('click', () => {
      state.filterStatus = b.dataset.filterStatus; renderBody();
    }));
    body.querySelectorAll('[data-toggle-report]').forEach(b => b.addEventListener('click', () => {
      const id = b.dataset.toggleReport;
      state.expandedId = state.expandedId === id ? null : id;
      renderBody();
    }));
  }

  function typeFilterPills() {
    const opts = [
      { v: 'all',     l: 'Alle' },
      { v: 'bug',     l: '🐛 Bug' },
      { v: 'feature', l: '✨ Feature' }
    ];
    return opts.map(o => `<button data-filter-type="${o.v}" class="px-2 py-0.5 rounded ${state.filterType === o.v ? 'bg-amber-500 text-slate-900' : 'bg-slate-700 hover:bg-slate-600'}">${o.l}</button>`).join('');
  }
  function statusFilterPills() {
    const opts = [
      { v: 'open', l: 'Offen' },
      { v: 'all',  l: 'Alle'  }
    ];
    return opts.map(o => `<button data-filter-status="${o.v}" class="px-2 py-0.5 rounded ${state.filterStatus === o.v ? 'bg-amber-500 text-slate-900' : 'bg-slate-700 hover:bg-slate-600'}">${o.l}</button>`).join('');
  }

  function renderReportRow(r, isOwn) {
    const typeIcon = r.type === 'bug' ? '🐛' : '✨';
    const statusBadge = statusBadgeHtml(r.status);
    const dateTitle = new Date(r.created_at).toLocaleString('de-DE');
    const relDate = relativeDate(r.created_at);
    const isExpanded = state.expandedId === r.id;
    const firstLine = (r.text || '').split('\n')[0] || '';
    const shownText = isExpanded ? r.text : firstLine;
    const own = isOwn ? `<span class="text-[10px] bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded">Du</span>` : '';
    return `
      <div class="bg-slate-900 rounded p-3 cursor-pointer hover:bg-slate-800" data-toggle-report="${escapeAttr(r.id)}">
        <div class="flex items-center gap-2 mb-1 text-xs">
          <span class="text-base leading-none">${typeIcon}</span>
          ${statusBadge}
          ${own}
          <span class="text-slate-400 truncate flex-1" title="${escapeAttr(r.user_email)}">${escapeHtml(r.user_email)}</span>
          <span class="text-slate-500 whitespace-nowrap" title="${escapeAttr(dateTitle)}">${escapeHtml(relDate)}</span>
        </div>
        <div class="text-sm ${isExpanded ? 'whitespace-pre-wrap' : 'truncate'}">${escapeHtml(shownText)}</div>
      </div>
    `;
  }

  function statusBadgeHtml(s) {
    const map = {
      open: { cls: 'bg-sky-500/20 text-sky-300',     l: 'open' },
      wip:  { cls: 'bg-amber-500/20 text-amber-300', l: 'in Arbeit' },
      done: { cls: 'bg-emerald-500/20 text-emerald-300', l: 'erledigt' }
    };
    const cfg = map[s] || map.open;
    return `<span class="text-[10px] ${cfg.cls} px-1.5 py-0.5 rounded">${cfg.l}</span>`;
  }

  function relativeDate(iso) {
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return '';
    const sec = Math.round((Date.now() - t) / 1000);
    if (sec < 60) return 'gerade eben';
    const min = Math.round(sec / 60);
    if (min < 60) return `vor ${min} min`;
    const h = Math.round(min / 60);
    if (h < 24) return `vor ${h} h`;
    const d = Math.round(h / 24);
    if (d < 14) return `vor ${d} Tagen`;
    const w = Math.round(d / 7);
    if (w < 6) return `vor ${w} Wochen`;
    return new Date(iso).toLocaleDateString('de-DE');
  }

  const { escapeHtml, escapeAttr } = window.Util;

  window.UIReports = { init };
})();
