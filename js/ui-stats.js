// Statistik-Tab: Überblick über die Sammlung.

(function () {
  let rootEl = null;

  function init(el) {
    rootEl = el;
    rerender();
  }

  function rerender() {
    const includeProxy = !!Prefs.get('statsInclProxy', false);
    const coll = Store.loadCollection();
    render(computeStats(coll, includeProxy), includeProxy);
  }

  function computeStats(coll, includeProxy) {
    const cards = CardDB.all;
    let uniqueOwned = 0;
    let totalCopies = 0;
    const perSet = new Map();      // setCode -> { total, owned, copies }
    const perColor = new Map();
    const perRarity = new Map();
    const perType = new Map();
    const topOwned = []; // { card, count }

    const cmField = (id, field) => {
      if (!window.CM || !CM.hasData()) return null;
      const p = CM.get(id);
      return (p && p[field] != null) ? p[field] : null;
    };
    const cmLow = id => cmField(id, 'low');

    // Einmaliger Index über alle Copies (sonst O(Karten×Varianten×Copies)).
    const vidx = Object.create(null);
    for (const id in (coll.copies || {})) {
      const c = coll.copies[id];
      let slot = vidx[c.variant];
      if (!slot) { slot = { real: 0, proxy: 0, paid: 0, priced: 0 }; vidx[c.variant] = slot; }
      if (c.isProxy) {
        slot.proxy++;
      } else {
        slot.real++;
        if (c.price != null) { slot.paid += c.price; slot.priced++; }
      }
    }

    let totalProxies = 0;
    let proxyValue = 0;        // CM-low-Wert aller Proxy-Kopien (immer voll)
    // "Singles gekauft": Summe der an Copies hinterlegten Preise (tatsächlich bezahlt).
    let paidTotal = 0, paidKnown = 0, paidCopies = 0;
    // "Sammlungs Wert": CM-low / -trend aller echten Kopien (ohne Proxy).
    let collLowValue = 0, collTrendValue = 0;
    for (const card of cards) {
      const variants = CardDB.variantsOf(card);
      let realCopies = 0;
      let realValue = 0;
      let knownReal = 0;
      let proxies = 0;
      for (const v of variants) {
        const slot = vidx[v.key];
        if (!slot) continue;
        realCopies += slot.real;
        realValue += slot.paid;
        knownReal += slot.priced;
        proxies += slot.proxy;
      }
      totalProxies += proxies;
      const low = cmLow(card.id);
      const proxyValForCard = low != null ? low * proxies : 0;
      proxyValue += proxyValForCard;

      // Effektive Werte je nach Proxy-Einbezug.
      const copies = realCopies + (includeProxy ? proxies : 0);
      const cardValue = realValue + (includeProxy ? proxyValForCard : 0);
      const owned = copies > 0 ? 1 : 0;

      uniqueOwned += owned;
      totalCopies += copies;

      // Singles gekauft (bezahlte Preise, echte Kopien)
      paidTotal += realValue;
      paidKnown += knownReal;
      paidCopies += realCopies;
      // Sammlungs Wert (CM low / trend, ohne Proxy)
      if (low != null) collLowValue += low * realCopies;
      const trend = cmField(card.id, 'trend');
      if (trend != null) collTrendValue += trend * realCopies;

      // Set
      const s = perSet.get(card.set) || { total: 0, owned: 0, copies: 0, value: 0 };
      s.total++; s.owned += owned; s.copies += copies; s.value += cardValue;
      perSet.set(card.set, s);

      // Color
      const colors = Array.isArray(card.color) && card.color.length ? card.color : ['—'];
      for (const c of colors) {
        const e = perColor.get(c) || { total: 0, owned: 0, copies: 0, value: 0 };
        e.total++; e.owned += owned; e.copies += copies; e.value += cardValue;
        perColor.set(c, e);
      }
      // Rarity
      const r = card.rarity || '—';
      const er = perRarity.get(r) || { total: 0, owned: 0, copies: 0, value: 0 };
      er.total++; er.owned += owned; er.copies += copies; er.value += cardValue;
      perRarity.set(r, er);
      // Type
      const t = card.type || '—';
      const et = perType.get(t) || { total: 0, owned: 0, copies: 0, value: 0 };
      et.total++; et.owned += owned; et.copies += copies; et.value += cardValue;
      perType.set(t, et);

      if (copies > 0) topOwned.push({ card, count: copies, value: cardValue });
    }

    const singlesPaid = { total: paidTotal, known: paidKnown, copies: paidCopies };

    topOwned.sort((a, b) => b.count - a.count);

    return {
      uniqueOwned,
      totalCards: cards.length,
      totalCopies,
      totalProxies,
      proxyValue,
      singlesPaid,
      collLowValue,
      collTrendValue,
      perSet: Array.from(perSet.entries())
        .map(([code, v]) => ({ code, ...v }))
        .sort((a, b) => a.code.localeCompare(b.code)),
      perColor: Array.from(perColor.entries()).map(([k, v]) => ({ key: k, ...v })),
      perRarity: Array.from(perRarity.entries()).map(([k, v]) => ({ key: k, ...v }))
        .sort((a, b) => b.owned - a.owned),
      perType: Array.from(perType.entries()).map(([k, v]) => ({ key: k, ...v }))
        .sort((a, b) => b.owned - a.owned),
      topOwned: topOwned.slice(0, 20)
    };
  }

  function render(s, includeProxy) {
    const pctTotal = s.totalCards ? Math.round(s.uniqueOwned / s.totalCards * 100) : 0;
    rootEl.innerHTML = `
      <div class="flex justify-end mb-3">
        <label class="flex items-center gap-2 text-sm bg-slate-800 rounded px-3 py-1.5 cursor-pointer">
          <input id="stats-incl-proxy" type="checkbox" ${includeProxy ? 'checked' : ''} />
          Inkl. Proxy
        </label>
      </div>
      <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        <div class="bg-slate-800 rounded p-4">
          <div class="text-xs text-slate-400 uppercase">Karten gesamt</div>
          <div class="text-3xl font-bold">${s.totalCards}</div>
        </div>
        <div class="bg-slate-800 rounded p-4">
          <div class="text-xs text-slate-400 uppercase">Unique besessen</div>
          <div class="text-3xl font-bold text-amber-400">${s.uniqueOwned}</div>
          <div class="text-xs text-slate-500">${pctTotal}%</div>
        </div>
        <div class="bg-slate-800 rounded p-4">
          <div class="text-xs text-slate-400 uppercase">Kopien total</div>
          <div class="text-3xl font-bold">${s.totalCopies}</div>
          ${s.totalProxies > 0 ? `<div class="text-xs text-purple-400">${includeProxy ? `inkl. ${s.totalProxies} Proxy` : `+ ${s.totalProxies} Proxy`}</div>` : ''}
        </div>
        <div class="bg-slate-800 rounded p-4">
          <div class="text-xs text-slate-400 uppercase">Singles gekauft</div>
          <div class="text-3xl font-bold text-emerald-400">${Fmt.eur(s.singlesPaid.total)}</div>
          <div class="text-xs text-slate-500">${s.singlesPaid.known}/${s.singlesPaid.copies} mit Preis</div>
        </div>
        <div class="bg-slate-800 rounded p-4">
          <div class="text-xs text-slate-400 uppercase">Sammlungs Wert</div>
          <div class="flex items-baseline gap-3">
            <div>
              <div class="text-2xl font-bold text-emerald-400">${Fmt.eur(s.collLowValue)}</div>
              <div class="text-[11px] text-slate-500 uppercase">low</div>
            </div>
            <div>
              <div class="text-2xl font-bold text-sky-400">${Fmt.eur(s.collTrendValue)}</div>
              <div class="text-[11px] text-slate-500 uppercase">trend</div>
            </div>
          </div>
          <div class="text-xs text-slate-500 mt-1">ohne Proxy</div>
        </div>
        <div class="bg-slate-800 rounded p-4">
          <div class="text-xs text-slate-400 uppercase">Proxy Wert</div>
          <div class="text-3xl font-bold text-purple-400">${Fmt.eur(s.proxyValue)}</div>
          <div class="text-xs text-slate-500">${s.totalProxies} Proxy · CM low</div>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div>
          <h3 class="text-sm font-bold uppercase text-slate-400 mb-2">Set-Vollständigkeit</h3>
          <div class="space-y-1 max-h-[60vh] overflow-y-auto pr-2">
            ${s.perSet.map(s => renderBarRow(s.code, s.owned, s.total, s.copies, null, s.value)).join('')}
          </div>
        </div>
        <div class="space-y-6">
          <div>
            <h3 class="text-sm font-bold uppercase text-slate-400 mb-2">Nach Farbe</h3>
            <div class="space-y-1">${s.perColor.map(c => renderBarRow(c.key, c.owned, c.total, c.copies, 'color-' + c.key, c.value)).join('')}</div>
          </div>
          <div>
            <h3 class="text-sm font-bold uppercase text-slate-400 mb-2">Nach Rarity</h3>
            <div class="space-y-1">${s.perRarity.map(r => renderBarRow(r.key, r.owned, r.total, r.copies, null, r.value)).join('')}</div>
          </div>
          <div>
            <h3 class="text-sm font-bold uppercase text-slate-400 mb-2">Nach Typ</h3>
            <div class="space-y-1">${s.perType.map(t => renderBarRow(t.key, t.owned, t.total, t.copies, null, t.value)).join('')}</div>
          </div>
        </div>
      </div>

      <div>
        <h3 class="text-sm font-bold uppercase text-slate-400 mb-2">Top 20 (meiste Kopien)</h3>
        <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
          ${s.topOwned.map(t => `
            <div class="bg-slate-800 rounded p-2 flex gap-2 items-center">
              <img src="${CardDB.imagePath(CardDB.mainVariantKey(t.card))}" loading="lazy" class="w-10 h-14 object-cover rounded" alt="" />
              <div class="min-w-0 flex-1">
                <div class="text-xs font-mono text-slate-400">${escapeHtml(t.card.id)}</div>
                <div class="text-sm font-semibold truncate">${escapeHtml(CardDB.cleanDisplayName(t.card))}</div>
                <div class="text-xs text-amber-400 font-bold">×${t.count}${t.value ? ` · ${Fmt.eur(t.value)}` : ''}</div>
              </div>
            </div>
          `).join('') || '<div class="text-slate-500 text-sm">Keine Karten in der Sammlung.</div>'}
        </div>
      </div>
    `;

    const cb = rootEl.querySelector('#stats-incl-proxy');
    if (cb) cb.addEventListener('change', e => {
      Prefs.set('statsInclProxy', e.target.checked);
      rerender();
    });
  }

  function renderBarRow(label, owned, total, copies, colorClass, value) {
    const pct = total ? (owned / total * 100) : 0;
    return `
      <div class="bg-slate-800/60 rounded px-3 py-2">
        <div class="flex justify-between items-baseline text-sm mb-1">
          <span class="${colorClass ? colorClass + ' px-2 py-0.5 rounded font-bold text-xs' : 'font-semibold'}">${escapeHtml(label)}</span>
          <span class="text-xs text-slate-400">${owned}/${total} <span class="text-slate-500">· ${copies} Kopien${value ? ` · ${Fmt.eur(value)}` : ''}</span></span>
        </div>
        <div class="bg-slate-900 rounded h-2 overflow-hidden">
          <div class="bg-amber-500 h-full" style="width:${pct}%"></div>
        </div>
      </div>
    `;
  }

  const { escapeHtml } = window.Util;

  window.UIStats = { init };
})();
