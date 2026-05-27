// Statistik-Tab: Überblick über die Sammlung.

(function () {
  let rootEl = null;

  function init(el) {
    rootEl = el;
    const coll = Store.loadCollection();
    const stats = computeStats(coll);
    render(stats);
  }

  function computeStats(coll) {
    const cards = CardDB.all;
    let uniqueOwned = 0;
    let totalCopies = 0;
    const perSet = new Map();      // setCode -> { total, owned, copies }
    const perColor = new Map();
    const perRarity = new Map();
    const perType = new Map();
    const topOwned = []; // { card, count }

    let totalProxies = 0;
    for (const card of cards) {
      const variants = CardDB.variantsOf(card);
      let copies = 0;
      let cardValue = 0;
      let proxies = 0;
      for (const v of variants) {
        const prices = Store.getPrices(coll, v.key);
        copies += prices.length;
        for (const p of prices) if (p != null) cardValue += p;
        proxies += Store.getProxyCount(coll, v.key);
      }
      totalProxies += proxies;
      const owned = (copies + proxies) > 0 ? 1 : 0;

      uniqueOwned += owned;
      totalCopies += copies;

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

    const value = Store.collectionValue(coll);

    topOwned.sort((a, b) => b.count - a.count);

    return {
      uniqueOwned,
      totalCards: cards.length,
      totalCopies,
      totalProxies,
      value,
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

  function render(s) {
    const pctTotal = s.totalCards ? Math.round(s.uniqueOwned / s.totalCards * 100) : 0;
    rootEl.innerHTML = `
      <div class="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
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
          ${s.totalProxies > 0 ? `<div class="text-xs text-purple-400">+ ${s.totalProxies} Proxy</div>` : ''}
        </div>
        <div class="bg-slate-800 rounded p-4">
          <div class="text-xs text-slate-400 uppercase">Sammlungswert</div>
          <div class="text-3xl font-bold text-emerald-400">${Fmt.eur(s.value.total)}</div>
          <div class="text-xs text-slate-500">${s.value.known}/${s.value.copies} mit Preis</div>
        </div>
        <div class="bg-slate-800 rounded p-4">
          <div class="text-xs text-slate-400 uppercase">Sets</div>
          <div class="text-3xl font-bold">${s.perSet.length}</div>
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
                <div class="text-sm font-semibold truncate">${escapeHtml(t.card.name)}</div>
                <div class="text-xs text-amber-400 font-bold">×${t.count}${t.value ? ` · ${Fmt.eur(t.value)}` : ''}</div>
              </div>
            </div>
          `).join('') || '<div class="text-slate-500 text-sm">Keine Karten in der Sammlung.</div>'}
        </div>
      </div>
    `;
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

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  window.UIStats = { init };
})();
