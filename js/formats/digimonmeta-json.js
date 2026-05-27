// digimonmeta.com JSON Format.
//
//   ["Exported from digimonmeta.com", "ST23-01", "ST23-01", "BT25-046", ...]
//
// - Erstes Element ist ein Marker-String und wird ignoriert.
// - Jede weitere Karten-ID kommt einmal pro Kopie vor.
// - IDs können kürzer (2-stellig) sein als unsere kanonischen IDs (3-stellig) —
//   wir versuchen Zero-Padding wenn der Direkt-Lookup scheitert.
// - Keine Variant-Info: alles wird der Hauptvariante zugeordnet.

(function () {
  window.IO_FORMATS = window.IO_FORMATS || [];

  window.IO_FORMATS.push({
    id: 'digimonmeta-json',
    label: 'digimonmeta.com JSON',
    fileExtension: '.json',

    exportDeck(deck) {
      const arr = ['Exported from digimon-collection app'];
      for (const entry of deck.entries) {
        const card = CardDB.byId.get(entry.cardId);
        const id = card ? card.id : entry.cardId;
        for (let i = 0; i < entry.count; i++) arr.push(id);
      }
      return JSON.stringify(arr);
    },

    importDeck(text) {
      const data = JSON.parse(text);
      if (!Array.isArray(data)) throw new Error('Erwarte ein JSON-Array von Karten-IDs.');

      const counts = new Map(); // cardId -> count
      const unknownIds = [];
      let name = 'Imported';

      for (const raw of data) {
        if (typeof raw !== 'string') continue;
        const token = raw.trim();
        if (!token) continue;

        // Marker / Header (z.B. "Exported from ...")
        if (/^exported from/i.test(token) || /\s/.test(token) && !/^[A-Z]+\d*-\d+/.test(token)) {
          if (name === 'Imported' && /^exported from/i.test(token)) {
            name = token.replace(/^exported from\s*/i, '').trim() || 'Imported';
          }
          continue;
        }

        const cardId = resolveId(token);
        if (!cardId) { unknownIds.push(token); continue; }
        counts.set(cardId, (counts.get(cardId) || 0) + 1);
      }

      const entries = [];
      for (const [cardId, count] of counts) {
        const card = CardDB.byId.get(cardId);
        if (!card) continue;
        entries.push({ cardId, variant: CardDB.mainVariantKey(card), count });
      }

      const result = { name, kind: 'deck', notes: '', entries };
      if (unknownIds.length) result.unknownIds = unknownIds;
      return result;
    }
  });

  // Direkt versuchen; sonst Suffix auf 2 bzw. 3 Stellen padden / entpadden.
  function resolveId(token) {
    if (CardDB.byId.has(token)) return token;
    const m = token.match(/^(.+-)(\d+)([A-Z]?)$/);
    if (!m) return null;
    const [, prefix, num, suffix] = m;
    for (const width of [3, 4, 2]) {
      const padded = prefix + num.padStart(width, '0') + suffix;
      if (CardDB.byId.has(padded)) return padded;
    }
    // Auch entpaddet probieren (für den unwahrscheinlichen Fall überlanger Token)
    const stripped = prefix + String(parseInt(num, 10)) + suffix;
    if (CardDB.byId.has(stripped)) return stripped;
    return null;
  }
})();
