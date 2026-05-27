// Default Phase-1 Format: einfaches JSON Round-Trip.

(function () {
  window.IO_FORMATS = window.IO_FORMATS || [];
  window.IO_FORMATS.push({
    id: 'generic-json',
    label: 'Generic JSON',
    fileExtension: '.json',
    exportDeck(deck) {
      const payload = {
        format: 'generic-json',
        name: deck.name,
        kind: deck.kind,
        notes: deck.notes || '',
        entries: deck.entries.map(e => ({
          cardId: e.cardId,
          variant: e.variant,
          count: e.count
        }))
      };
      return JSON.stringify(payload, null, 2);
    },
    importDeck(text) {
      const data = JSON.parse(text);
      if (!data || !Array.isArray(data.entries)) {
        throw new Error('Ungültiges Format: "entries"-Array fehlt.');
      }
      return {
        name: data.name || 'Imported',
        kind: data.kind || 'deck',
        notes: data.notes || '',
        entries: data.entries.map(e => ({
          cardId: String(e.cardId),
          variant: String(e.variant || e.cardId),
          count: Math.max(1, parseInt(e.count, 10) || 1)
        }))
      };
    }
  });
})();
