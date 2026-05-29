// Plain-Text Format: eine Karte pro Zeile.
//
// Syntax:
//   // optionaler Header-Kommentar (wird ignoriert)
//   # auch # gilt als Kommentar
//   4 BT1-001
//   3 BT1-001_P1          # Alt-Art als Variant
//   2x ST1-007            # 'x' nach Zahl erlaubt
//   ST1-009               # ohne Zahl = 1
//
// Export schreibt: optionalen "// Name" Header, dann "<count> <variant>" Zeilen.

(function () {
  window.IO_FORMATS = window.IO_FORMATS || [];

  window.IO_FORMATS.push({
    id: 'plain-text',
    label: 'Plain Text (count id)',
    fileExtension: '.txt',

    exportDeck(deck) {
      const lines = [];
      lines.push(`// ${deck.name}`);
      if (deck.kind) lines.push(`// kind: ${deck.kind}`);
      if (deck.notes) lines.push(`// ${deck.notes.replace(/\n/g, '\n// ')}`);
      lines.push('');
      for (const e of deck.entries) {
        lines.push(`${e.count} ${e.variant}`);
      }
      return lines.join('\n') + '\n';
    },

    importDeck(text) {
      const lines = text.split(/\r?\n/);
      let name = 'Imported';
      let kind = 'deck';
      const entries = [];
      const unknown = [];

      for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;

        if (line.startsWith('//') || line.startsWith('#')) {
          const stripped = line.replace(/^(\/\/|#)\s*/, '');
          const kindMatch = stripped.match(/^kind:\s*(\w+)/i);
          if (kindMatch) { kind = kindMatch[1].toLowerCase(); continue; }
          if (name === 'Imported' && stripped) name = stripped;
          continue;
        }

        // Trailing (V.N) abschneiden — wir behalten N fuer die Variant-Wahl.
        let body = line;
        let versionN = null;
        const vm = body.match(/\s*\(V\.(\d+)\)\s*$/i);
        if (vm) {
          versionN = parseInt(vm[1], 10);
          body = body.slice(0, -vm[0].length).trim();
        }

        // "4 BT1-001" / "4x BT1-001" / "BT1-001"
        const m = body.match(/^(\d+)\s*[xX]?\s+(.+?)(?:\s+(?:\/\/|#).*)?$/);
        let count, ident;
        if (m) {
          count = parseInt(m[1], 10);
          ident = m[2].trim();
        } else {
          count = 1;
          ident = body.replace(/\s+(?:\/\/|#).*$/, '').trim();
        }
        if (!ident) continue;

        let resolved = resolveIdent(ident);
        if (!resolved) {
          // "4 Tsunomon   ST21-01" (Name + ID): nehme letzte Card-ID in der Zeile.
          const idMatches = ident.match(/[A-Z]+\d*-\d+[A-Z]?(?:_P\d+)?/g);
          if (idMatches && idMatches.length) {
            const idToken = idMatches[idMatches.length - 1];
            if (versionN != null) {
              resolved = resolveByVersion(idToken, versionN);
            }
            if (!resolved) resolved = resolveIdent(idToken);
          }
        } else if (versionN != null) {
          // ident war direkt eine Card-ID / Variant-Key; versionN -> Index in variantsOf.
          const v = resolveByVersion(resolved.cardId, versionN);
          if (v) resolved = v;
        }
        if (!resolved) {
          unknown.push(ident);
          continue;
        }
        entries.push({ cardId: resolved.cardId, variant: resolved.variant, count: Math.max(1, count) });
      }

      const result = { name, kind, notes: '', entries };
      if (unknown.length) result.unknownIds = unknown;
      return result;
    }
  });

  // Versucht, ein Token als variantKey oder cardId zu erkennen.
  function resolveIdent(token) {
    if (!window.CardDB) return null;
    if (CardDB.allVariants.has(token)) {
      const info = CardDB.allVariants.get(token);
      return { cardId: info.cardId, variant: token };
    }
    if (CardDB.byId.has(token)) {
      const card = CardDB.byId.get(token);
      return { cardId: card.id, variant: CardDB.mainVariantKey(card) };
    }
    return null;
  }

  // V.1 = variantsOf(card)[0] (Main), V.2 = variantsOf(card)[1] (_P1), V.3 = ...
  // Spiegelt die Cardmarket-Konvention der Exporte (versionSuffixForVariant).
  function resolveByVersion(cardIdToken, versionN) {
    if (!window.CardDB) return null;
    const card = CardDB.byId.get(cardIdToken);
    if (!card) return null;
    const variants = CardDB.variantsOf(card);
    const idx = (versionN || 1) - 1;
    if (idx < 0 || idx >= variants.length) return null;
    return { cardId: card.id, variant: variants[idx].key };
  }
})();
