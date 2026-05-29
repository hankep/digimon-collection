// dcgo.txt Format: Listen-Export aus DCGO / ähnlichen Tools.
//
// Eine Karte pro Zeile, Trenner ist Whitespace:
//   <count> <Name…> <CardID>
//
// Beispiele:
//   4 Tsunomon   ST21-01
//   1 Sora Takenouchi & Kari Kamiya   ST20-12
//   2 WarGreymon   AD1-004
//
// Konvention für Varianten: das letzte ID-Token in der Zeile bestimmt die Variante.
// Ein Suffix wie "_P1" ist erlaubt; sonst wird die Hauptvariante genommen.

(function () {
  window.IO_FORMATS = window.IO_FORMATS || [];

  const ID_RE = /[A-Z]+\d*-\d+[A-Z]?(?:_P\d+)?/g;

  window.IO_FORMATS.push({
    id: 'dcgo-text',
    label: 'dcgo.txt (count name id)',
    fileExtension: '.txt',

    exportDeck(deck) {
      const lines = [];
      if (deck.name) lines.push(`// ${deck.name}`);
      if (deck.kind && deck.kind !== 'deck') lines.push(`// kind: ${deck.kind}`);
      if (lines.length) lines.push('');

      for (const entry of deck.entries) {
        const card = CardDB.byId.get(entry.cardId);
        const name = card ? CardDB.cleanDisplayName(card) : entry.cardId;
        // Variante als Suffix, falls Alt-Art (z.B. ST21-01_P1).
        lines.push(`${entry.count} ${name}   ${entry.variant}`);
      }
      return lines.join('\n') + '\n';
    },

    importDeck(text) {
      const lines = String(text || '').split(/\r?\n/);
      let name = 'Imported';
      let kind = 'deck';
      const entries = [];
      const unknown = [];

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

        // (V.N) am Ende abschneiden — fuer Variant-Index-Mapping spaeter.
        let body = line;
        let versionN = null;
        const vm = body.match(/\s*\(V\.(\d+)\)\s*$/i);
        if (vm) {
          versionN = parseInt(vm[1], 10);
          body = body.slice(0, -vm[0].length).trim();
        }

        const m = body.match(/^(\d+)\s*[xX]?\s+(.+)$/);
        let count, rest;
        if (m) {
          count = parseInt(m[1], 10);
          rest = m[2];
        } else {
          count = 1;
          rest = body;
        }

        const ids = rest.match(ID_RE);
        if (!ids || !ids.length) {
          unknown.push(line);
          continue;
        }
        const idToken = ids[ids.length - 1];

        let resolved = null;
        if (versionN != null) resolved = resolveByVersion(idToken, versionN);
        if (!resolved) resolved = resolveIdent(idToken);
        if (!resolved) {
          unknown.push(idToken);
          continue;
        }
        entries.push({ cardId: resolved.cardId, variant: resolved.variant, count: Math.max(1, count) });
      }

      const result = { name, kind, notes: '', entries };
      if (unknown.length) result.unknownIds = unknown;
      return result;
    }
  });

  // V.1 = variantsOf(card)[0] (Main), V.2 = variantsOf(card)[1] (_P1), ...
  function resolveByVersion(cardIdToken, versionN) {
    if (!window.CardDB) return null;
    const card = CardDB.byId.get(cardIdToken);
    if (!card) return null;
    const variants = CardDB.variantsOf(card);
    const idx = (versionN || 1) - 1;
    if (idx < 0 || idx >= variants.length) return null;
    return { cardId: card.id, variant: variants[idx].key };
  }

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
})();
