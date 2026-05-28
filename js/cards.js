// Card-Index aus window.CARDS bauen, Such- und Filter-Helpers.

(function () {
  const CARDS = window.CARDS || [];

  const byId = new Map();
  const bySet = new Map();
  const allVariants = new Map(); // variantKey -> { cardId, isAlt }
  const sets = []; // { code, name, count }
  const colors = new Set();
  const types = new Set();
  const rarities = new Set();

  function variantKeyFromImage(imgFilename) {
    // 'AD1-001.webp' -> 'AD1-001'; 'AD1-001_P1.webp' -> 'AD1-001_P1'
    return imgFilename.replace(/\.[^.]+$/, '');
  }

  // Manche Karten haben in den Quelldaten Kurz-/Kleinschreib-Rarities
  // (z.B. "c", "sr", "p"). Auf die kanonische Langform normalisieren, damit
  // sie nicht als eigene Rarity-Gruppe auftauchen und korrekt einsortiert sind.
  const RARITY_CANON = {
    c: 'Common', common: 'Common',
    u: 'Uncommon', uncommon: 'Uncommon',
    r: 'Rare', rare: 'Rare',
    sr: 'Super Rare', 'super rare': 'Super Rare',
    sec: 'Secret Rare', 'secret rare': 'Secret Rare',
    ur: 'UR',
    p: 'Promo', promo: 'Promo'
  };
  function canonRarity(r) {
    if (r == null) return r;
    return RARITY_CANON[String(r).toLowerCase()] || r;
  }

  for (const card of CARDS) {
    card.rarity = canonRarity(card.rarity);
    byId.set(card.id, card);

    if (!bySet.has(card.set)) bySet.set(card.set, []);
    bySet.get(card.set).push(card);

    // Hauptvariante
    if (card.image) {
      const main = variantKeyFromImage(card.image);
      allVariants.set(main, { cardId: card.id, isAlt: false });
    }
    // Alt-Arts
    if (Array.isArray(card.altImages)) {
      for (const alt of card.altImages) {
        const altKey = variantKeyFromImage(alt);
        allVariants.set(altKey, { cardId: card.id, isAlt: true });
      }
    }

    if (Array.isArray(card.color)) for (const c of card.color) colors.add(c);
    if (card.type) types.add(card.type);
    if (card.rarity) rarities.add(card.rarity);
  }

  // Bekannte Release-Daten der europäischen Sets (jeweils erste Veröffentlichung).
  // Quelle: vom User gepflegte Liste. Unbekannte Set-Codes (z.B. AD1, P, sehr neue BT/ST)
  // fallen auf das früheste card.raw.date_added zurück.
  const SET_RELEASES = {
    BT1: '2021-01-29', BT2: '2021-01-29', BT3: '2021-01-29',
    ST1: '2021-01-29', ST2: '2021-01-29', ST3: '2021-01-29',
    BT4: '2021-06-11', ST4: '2021-06-11', ST5: '2021-06-11', ST6: '2021-06-11',
    BT5: '2021-08-06',
    BT6: '2021-10-08', ST7: '2021-10-08', ST8: '2021-10-08',
    EX1: '2021-12-10',
    BT7: '2022-03-04',
    BT8: '2022-05-13', ST9: '2022-05-13', ST10: '2022-05-13',
    EX2: '2022-06-24',
    BT9: '2022-07-29',
    BT10: '2022-10-14', ST12: '2022-10-14', ST13: '2022-10-14',
    EX3: '2022-11-11',
    BT11: '2023-02-17',
    ST14: '2023-03-24',
    BT12: '2023-04-28',
    EX4: '2023-06-23',
    BT13: '2023-07-21',
    RB1: '2023-09-29',
    ST15: '2023-10-13', ST16: '2023-10-13',
    BT14: '2023-11-17',
    EX5: '2024-01-19',
    BT15: '2024-02-16',
    ST17: '2024-03-08',
    BT16: '2024-05-24',
    EX6: '2024-06-28',
    BT17: '2024-08-09',
    EX7: '2024-09-13', ST18: '2024-09-13', ST19: '2024-09-13',
    BT18: '2024-11-01', BT19: '2024-11-01',
    EX8: '2025-01-10',
    BT20: '2025-02-28',
    BT21: '2025-04-25', ST20: '2025-04-25', ST21: '2025-04-25',
    EX9: '2025-06-26',
    BT22: '2025-07-25',
    EX10: '2025-09-29',
    BT23: '2025-10-24',
    ST22: '2025-12-05'
  };

  // Pro Set die Anzahl Karten zählen, die in diesem Set erhältlich sind —
  // Origin + Reprints. So spiegelt der Sidebar-Counter, was der Filter zeigt.
  const reprintCounts = new Map(); // setCode -> count Reprints (Karten mit anderem Origin, die hier reprinted sind)
  for (const card of CARDS) {
    if (!Array.isArray(card.raw && card.raw.set_name)) continue;
    const seen = new Set();
    for (const productStr of card.raw.set_name) {
      const head = String(productStr || '').split(':')[0].trim();
      const m = head.match(/^([A-Za-z]+)-?0*(\d+)$/);
      if (!m) continue;
      const code = m[1] + m[2];
      if (!bySet.has(code)) continue;     // unbekanntes Set ignorieren
      if (code === card.set) continue;     // Origin nicht doppelt zählen
      if (seen.has(code)) continue;
      seen.add(code);
      reprintCounts.set(code, (reprintCounts.get(code) || 0) + 1);
    }
  }

  for (const [code, cards] of bySet.entries()) {
    const setName = (cards[0] && cards[0].raw && Array.isArray(cards[0].raw.set_name) && cards[0].raw.set_name[0]) || code;
    let earliestAdded = null;
    for (const c of cards) {
      const d = c.raw && c.raw.date_added;
      if (d && (!earliestAdded || d < earliestAdded)) earliestAdded = d;
    }
    const releasedAt = SET_RELEASES[code] || (earliestAdded ? earliestAdded.slice(0, 10) : null);
    const count = cards.length + (reprintCounts.get(code) || 0);
    sets.push({ code, name: setName, count, releasedAt });
  }

  sets.sort((a, b) => {
    // Neuestes Release zuerst.
    if (a.releasedAt && b.releasedAt) {
      const cmp = b.releasedAt.localeCompare(a.releasedAt);
      if (cmp !== 0) return cmp;
    } else if (a.releasedAt) return -1;
    else if (b.releasedAt) return 1;
    // Tie-Breaker: höhere Set-Nummer zuerst (BT10 vor BT2 vor BT1).
    return b.code.localeCompare(a.code, undefined, { numeric: true });
  });

  function mainVariantKey(card) {
    return card.image ? variantKeyFromImage(card.image) : card.id;
  }

  function variantsOf(card) {
    const list = [];
    if (card.image) list.push({ key: variantKeyFromImage(card.image), isAlt: false });
    if (Array.isArray(card.altImages)) {
      for (const alt of card.altImages) {
        list.push({ key: variantKeyFromImage(alt), isAlt: true });
      }
    }
    return list;
  }

  function imagePath(variantKey) {
    // Errata-Varianten haben dieselbe Bilddatei wie die Basis (URL ohne -Errata-Suffix).
    const key = variantKey.replace(/-Errata$/i, '');
    return 'https://world.digimoncard.com/images/cardlist/card/' + key + '.png';
  }

  function search(query, options) {
    const opts = options || {};
    const q = (query || '').trim().toLowerCase();
    const setCode = opts.set || null;
    const colorFilter = opts.color || null;
    const colorsFilter = Array.isArray(opts.colors) && opts.colors.length ? opts.colors : null;
    const typeFilter = opts.type || null;
    const rarityFilter = opts.rarity || null;
    const levelsFilter = Array.isArray(opts.levels) && opts.levels.length ? opts.levels : null;

    let pool;
    if (setCode) {
      // Reprint-aware: alle Karten, deren Origin ODER eines ihrer Reprint-Sets
      // dem Filter entspricht. So taucht z.B. BT16-002 unter Filter "AD1" auf,
      // weil sie in AD-01 als Reprint erhältlich ist.
      pool = CARDS.filter(c => appearsInSet(c, setCode));
    } else {
      pool = CARDS;
    }

    const tokens = q ? q.split(/\s+/).filter(Boolean) : null;
    const results = [];
    for (const card of pool) {
      if (tokens) {
        const name = (card.name || '').toLowerCase();
        const id = (card.id || '').toLowerCase();
        let allMatch = true;
        for (const t of tokens) {
          if (!name.includes(t) && !id.includes(t)) { allMatch = false; break; }
        }
        if (!allMatch) continue;
      }
      if (colorFilter && (!card.color || !card.color.includes(colorFilter))) continue;
      if (colorsFilter) {
        const cardColors = card.color || [];
        let any = false;
        for (const c of colorsFilter) { if (cardColors.includes(c)) { any = true; break; } }
        if (!any) continue;
      }
      if (typeFilter && card.type !== typeFilter) continue;
      if (rarityFilter && card.rarity !== rarityFilter) continue;
      if (levelsFilter && (card.level == null || !levelsFilter.includes(card.level))) continue;
      results.push(card);
    }

    if (opts.sortBy) {
      const dir = opts.sortDir === 'desc' ? -1 : 1;
      results.sort((a, b) => {
        const av = sortValue(a, opts.sortBy);
        const bv = sortValue(b, opts.sortBy);
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        if (av < bv) return -1 * dir;
        if (av > bv) return  1 * dir;
        return 0;
      });
    }

    return results;
  }

  function sortValue(card, key) {
    switch (key) {
      case 'id':    return card.id;
      case 'name':  return (card.name || '').toLowerCase();
      case 'level': return card.level != null ? card.level : null;
      case 'cost':  return card.cost  != null ? card.cost  : null;
      case 'price': {
        if (!window.CM || !CM.hasData()) return null;
        const p = CM.get(card.id);
        return (p && p.low != null) ? p.low : null;
      }
      default:      return null;
    }
  }

  // ── Reprints / Cross-Set-Verfügbarkeit ─────────────────────────────────────
  // card.raw.set_name listet alle Produkte, in denen eine Karte erscheint
  // (z.B. BT16-025 → ["AD-01: …", "BT-16: …"]). Daraus leiten wir ab, in welchen
  // anderen Sets dieselbe Karte (teils unter alter ID) erhältlich ist.

  // "AD-01: Advanced Booster …" → "AD1" (Bindestrich raus, führende Nullen weg).
  // Nur gültig, wenn der Code ein existierendes Set ist (sonst null → filtert
  // Promos/Sonderpacks wie "BT01-03", "BTC-01", "Tamer Battle Pack" automatisch).
  function setNameToCode(productStr) {
    const head = String(productStr || '').split(':')[0].trim();
    const m = head.match(/^([A-Za-z]+)-?0*(\d+)$/);
    if (!m) return null;
    const code = m[1] + m[2];
    return bySet.has(code) ? code : null;
  }

  // Alle Produkt-Strings einer Karte (roh), z.B. für die Modal-Liste.
  function productsOf(card) {
    const sn = card && card.raw && card.raw.set_name;
    return Array.isArray(sn) ? sn : [];
  }

  // Eindeutige, gültige Set-Codes ≠ eigenem Set — wo die Karte als Reprint erhältlich ist.
  function reprintSetsOf(card) {
    if (!card) return [];
    const out = [], seen = new Set();
    for (const p of productsOf(card)) {
      const code = setNameToCode(p);
      if (code && code !== card.set && !seen.has(code)) { seen.add(code); out.push(code); }
    }
    return out;
  }

  // Kompaktes Label (Code vor ":") für die Anzeige; Vollname bleibt als Tooltip nutzbar.
  function productLabel(productStr) {
    const s = String(productStr || '');
    const head = s.split(':')[0].trim();
    return head || s;
  }

  // SetCode -> Vollname (z.B. "BT16" -> "BT-16: Booster Beginning Observer").
  // Fuer unbekannte Codes (Promo-Labels wie "Reg 2024") wird der Code selbst
  // zurueckgegeben, damit Tooltips trotzdem etwas Sinnvolles zeigen.
  function setNameByCode(code) {
    if (!code) return '';
    const s = bySet.has(code) && bySet.get(code)[0];
    const sn = s && s.raw && Array.isArray(s.raw.set_name) ? s.raw.set_name[0] : null;
    return sn || code;
  }

  // True wenn die Karte unter setCode erhältlich ist — entweder als Origin (card.set)
  // oder als Reprint (über raw.set_name). Wird von Set-Filtern (Collection-Tab,
  // Main-Wants-Filter, …) verwendet, damit Reprints im Filter mitschwimmen.
  function appearsInSet(card, setCode) {
    if (!card || !setCode) return false;
    if (card.set === setCode) return true;
    return reprintSetsOf(card).includes(setCode);
  }

  // Erzeugt kleine Pills für jeden Reprint-Set-Code: "AD1 · Rare · 0,15 €".
  // Rarity ist die Origin-Rarity (Cardmarket liefert keine Per-Reprint-Rarity).
  // Low-Preis aus CM.getForSet, weggelassen wenn keiner verfügbar.
  function reprintPillsHtml(card) {
    if (!card) return '';
    const codes = reprintSetsOf(card);
    if (!codes.length) return '';
    return codes.map(code => setPillHtml(card, code, 'Reprint in')).join('');
  }

  // Alle Sets, in denen die Karte erhältlich ist (Origin zuerst, dann Reprints),
  // jeweils mit Rarity + Per-Set-Low. Genutzt im Detail-Modal-Variant-Block,
  // damit der User pro Variante alle möglichen Bezugs-Sets samt Preis sieht.
  function allSetsPillsHtml(card) {
    if (!card) return '';
    const codes = [];
    if (card.set) codes.push(card.set);
    for (const rc of reprintSetsOf(card)) {
      if (rc !== card.set) codes.push(rc);
    }
    if (!codes.length) return '';
    return codes.map((code, i) => setPillHtml(card, code, i === 0 ? 'Origin' : 'Reprint in')).join('');
  }

  // Slug-Helper fuer Cardmarket-URLs: Sonderzeichen raus, Leerzeichen zu Bindestrich.
  function slugify(s) {
    return String(s || '')
      .replace(/&/g, 'and')
      .replace(/[()'":;,.!?]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  // Konstruiert die Cardmarket-Produktseite einer konkreten Variante.
  // Pattern: cardmarket.com/de/Digimon/Products/Singles/<Set-Slug>/<Name-Slug>-<cardId>[-V<n>]
  //
  // Deep-Link nur dann, wenn das Variant-Set ein echter bekannter setCode aus
  // unseren Karten-Daten ist (BT16, AD1, EX5 …) UND ein passender raw.set_name-
  // Eintrag existiert. So koennen wir die richtige Set-Seite und den V-Index
  // innerhalb der Gruppe verlaesslich bilden.
  //
  // Fuer Promo-Labels wie "Reg 2024", "PB01", "Pre-Rls", "EP7" (idExpansions
  // ohne 1:1-Entsprechung zu unseren Sets — eine CM-idExpansion kann mehrere
  // URL-Sets enthalten, z.B. 5632 = Premium-Bandai-Products + Championship-
  // 2024-Promos) faellt der Link auf die CM-Such-URL fuer die Card-ID zurueck.
  // Die Suche fuehrt immer auf das richtige Ergebnis, auch wenn der User
  // dort 1x klicken muss.
  function cardmarketUrl(card, variantKey) {
    if (!card || !card.id) return null;
    const setNames = (card.raw && Array.isArray(card.raw.set_name)) ? card.raw.set_name : [];

    const variantSetOf = vk => {
      if (!window.CM || !CM.getForVariant) return null;
      const p = CM.getForVariant(vk);
      return p && p.set ? p.set : null;
    };
    const variantSet = variantSetOf(variantKey);

    // Match: Variant-Set muss ein echter setCode (Eintrag in bySet) sein UND in
    // raw.set_name vorkommen. Sonst Search-Fallback.
    let chosenSetName = null;
    if (variantSet && bySet.has(variantSet) && setNames.length) {
      for (const sn of setNames) {
        if (setNameToCode(sn) === variantSet) { chosenSetName = sn; break; }
      }
    }
    if (!chosenSetName) {
      return `https://www.cardmarket.com/de/Digimon/Products/Search?searchString=${encodeURIComponent(card.id)}`;
    }

    // "BT-16: Booster Beginning Observer" -> "Beginning Observer"
    const setSlugSource = chosenSetName.split(':').slice(1).join(':').trim().replace(/^Booster\s+/i, '');
    const setSlug = slugify(setSlugSource);
    if (!setSlug) return null;

    // Doppelnamen (z.B. "BeelStarmon // Fly Bullet") nimmt der CM-Slug komplett
    // mit auf ("BeelStarmon-Fly-Bullet"). card.name enthaelt nur den ersten Teil,
    // raw.tcgplayer_name den vollen — wir bevorzugen den, sofern vorhanden.
    const fullName = (card.raw && card.raw.tcgplayer_name)
      ? String(card.raw.tcgplayer_name).replace(/\s*\/\/\s*/g, ' ')
      : card.name;
    const nameSlug = slugify(fullName);
    if (!nameSlug) return null;

    // V-Index: Position innerhalb der Variants, die demselben Set zugeordnet sind.
    // Einzelvariante in einem Set -> kein V-Suffix.
    const variants = variantsOf(card);
    const sameSet = variants.filter(v => variantSetOf(v.key) === variantSet);
    let vSuffix = '';
    if (sameSet.length > 1) {
      const idx = sameSet.findIndex(v => v.key === variantKey);
      vSuffix = idx >= 0 ? `-V${idx + 1}` : '';
    }

    return `https://www.cardmarket.com/de/Digimon/Products/Singles/${setSlug}/${nameSlug}-${card.id}${vSuffix}`;
  }

  function setPillHtml(card, code, _titlePrefix) {
    const rarity = card.rarity || '';
    const p = (window.CM && CM.hasData()) ? CM.getForSet(card.id, code) : null;
    const priceTxt = (p && p.low != null) ? CM.fmt(p.low) : null;
    const parts = [code];
    if (rarity) parts.push(rarity);
    if (priceTxt) parts.push(priceTxt);
    const title = setNameByCode(code);
    return `<span class="reprint-pill" title="${escapeHtml(title)}">${parts.map(escapeHtml).join(' · ')}</span>`;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  window.CardDB = {
    all: CARDS,
    byId,
    bySet,
    sets,
    allVariants,
    colors: Array.from(colors),
    types: Array.from(types),
    rarities: Array.from(rarities),
    mainVariantKey,
    variantsOf,
    variantKeyFromImage,
    imagePath,
    search,
    setNameToCode,
    productsOf,
    reprintSetsOf,
    productLabel,
    appearsInSet,
    reprintPillsHtml,
    allSetsPillsHtml,
    cardmarketUrl,
    setNameByCode
  };
})();
