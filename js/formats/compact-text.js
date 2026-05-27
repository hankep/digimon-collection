// Compact-Text Format: eine Karte pro Zeile inkl. Name und Variant.
//
//   3x Agumon (BT25-003)
//   4x Titamon (P-209) (V.2)
//
// Konvention für V.X:
//   - Hauptvariante: kein (V.X)
//   - Alt-Art Nr. n (1-basiert): (V.<n+1>) — also _P1 → (V.2), _P2 → (V.3) …
//   - Spiegelbildlich zum Cardmarket-Import.

(function () {
  window.IO_FORMATS = window.IO_FORMATS || [];

  window.IO_FORMATS.push({
    id: 'compact-text',
    label: 'Compact (Name + ID + V)',
    fileExtension: '.txt',

    exportDeck(deck) {
      const lines = [];
      if (deck.name) lines.push(`// ${deck.name}`);
      if (deck.kind && deck.kind !== 'deck') lines.push(`// kind: ${deck.kind}`);
      if (lines.length) lines.push('');

      for (const entry of deck.entries) {
        const card = CardDB.byId.get(entry.cardId);
        const name = card ? card.name : entry.cardId;
        const id = card ? card.id : entry.cardId;
        const vSuffix = versionSuffix(card, entry.variant);
        lines.push(`${entry.count}x ${name} (${id})${vSuffix}`);
      }
      return lines.join('\n') + '\n';
    },

    importDeck(text) {
      const lines = String(text || '').split(/\r?\n/);
      let name = 'Imported';
      let kind = 'deck';
      const entries = [];
      const unknownIds = [];

      for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;

        if (line.startsWith('//') || line.startsWith('#')) {
          const stripped = line.replace(/^(\/\/|#)\s*/, '');
          const km = stripped.match(/^kind:\s*(\w+)/i);
          if (km) { kind = km[1].toLowerCase(); continue; }
          if (name === 'Imported' && stripped) name = stripped;
          continue;
        }

        const m = line.match(/^(\d+)\s*[xX]\s+.+?\(([A-Z]+\d*-\d+[A-Z]?)\)\s*(?:\(V\.(\d+)\))?\s*$/);
        if (!m) { unknownIds.push(line); continue; }
        const count = parseInt(m[1], 10);
        const cardId = m[2];
        const version = m[3] ? parseInt(m[3], 10) : 1;

        const variant = variantFor(cardId, version);
        if (!variant) { unknownIds.push(cardId + (m[3] ? ` (V.${version})` : '')); continue; }
        entries.push({ cardId, variant, count: Math.max(1, count) });
      }

      const result = { name, kind, notes: '', entries };
      if (unknownIds.length) result.unknownIds = unknownIds;
      return result;
    }
  });

  function versionSuffix(card, variantKey) {
    if (!card) return '';
    const main = CardDB.mainVariantKey(card);
    if (variantKey === main) return '';
    const alts = CardDB.variantsOf(card).filter(v => v.isAlt);
    const idx = alts.findIndex(v => v.key === variantKey);
    if (idx < 0) return '';
    return ` (V.${idx + 2})`;
  }

  function variantFor(cardId, version) {
    const card = CardDB.byId.get(cardId);
    if (!card) return null;
    const variants = CardDB.variantsOf(card);
    if (!variants.length) return null;
    if (!version || version === 1) return (variants.find(v => !v.isAlt) || variants[0]).key;
    const alts = variants.filter(v => v.isAlt);
    const idx = version - 2;
    if (idx >= 0 && idx < alts.length) return alts[idx].key;
    return (variants.find(v => !v.isAlt) || variants[0]).key;
  }
})();
