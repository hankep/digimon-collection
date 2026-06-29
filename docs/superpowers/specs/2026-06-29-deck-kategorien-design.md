# Eigene Kategorien für Decks/Listen — Design

**Datum:** 2026-06-29
**Status:** Design genehmigt, bereit für Implementierungsplan

## Problem / Ziel

Der Nutzer hat viele Deck-Listen und möchte sie selbst organisieren können, indem er
**eigene, benannte Kategorien** anlegt und Decks/Listen darin einsortiert. Die Kategorien
sollen **einklappbar** sein, um die Sidebar übersichtlich zu halten.

## Kontext (Ist-Zustand)

- Decks/Listen liegen in `decksState` (LocalStorage-Key `Util.LS_KEYS.decks`):
  `{ version, decks: [...], updatedAt }`.
- Jedes Deck-Objekt: `{ id, name, kind, notes, favorite, shared, createdAt, updatedAt, entries }`.
- `kind` ist auf feste Werte normalisiert (`normalizeKind`): `deck` / `wants` / `trade`
  (siehe [js/store.js](../../../js/store.js)). Diese Werte sind an die DB-Check-Constraint
  `shared_decks_kind_check` gebunden.
- Die Sidebar rendert über `deckListGroupsHtml()` in [js/ui-deckbuilder.js](../../../js/ui-deckbuilder.js)
  feste Gruppen (Wants / Trades / Decks + „Sonstige" als Fallback), je Gruppe Favoriten zuerst
  (`favFirst`), mit manueller Sortierung per ☰-Drag-Griff und ▲/▼-Buttons (`reorderKind`,
  `moveDeckInGroup`, `moveDeckRelative`).
- Sync (`js/sync.js`) ist **Last-Write-Wins über den gesamten `decks`-Blob**. Neue Felder im
  `decksState` bzw. an Deck-Objekten reisen automatisch mit. Das `shared_decks`-Upload nutzt nur
  ausgewählte Felder (`name`, `kind`, `notes`, `entries`).

## Entscheidungen (aus Brainstorming)

1. **Struktur:** Eigene Kategorien sind **Unterkategorien innerhalb** der bestehenden festen
   Gruppen (Decks / Wants / Trades). Eine Kategorie gehört zu genau **einem** `kind`. Eine
   „Turnier"-Kategorie unter Decks ist getrennt von einer evtl. gleichnamigen unter Wants.
2. **Verwaltung:** Verwaltete Kategorien (anlegen / umbenennen / löschen / eigene Reihenfolge).
   Zuordnung per Drag-and-Drop **und** per Dropdown am Deck (Touch-Fallback).
3. **Einklappen:** Collapse-Zustand wird **lokal/gerätespezifisch** in einem eigenen
   LocalStorage-Key gehalten, **nicht** im Sync-Blob — Auf-/Zuklappen löst keinen Sync-Push aus.

## Datenmodell

### `decksState.categories` (neu, synchronisiert)

```js
categories: [
  { id: 'c_<random>', kind: 'deck', name: 'Turnier', order: 0 },
  ...
]
```

- `id`: stabile ID (`'c_' + random` analog zur Deck-ID-Erzeugung).
- `kind`: einer der erlaubten Deck-kinds (`normalizeKind`).
- `name`: Anzeigename.
- `order`: Sortierindex innerhalb des `kind` (kleiner = weiter oben).

### Deck-Objekt: `categoryId` (neu, synchronisiert)

- `categoryId: string | null` — Verweis auf `categories[].id` oder `null` = „Ohne Kategorie".

### Lokaler Collapse-State (nicht synchronisiert)

- Eigener LocalStorage-Key (z.B. `Util.LS_KEYS.deckCatCollapse` oder Konstante in
  `ui-deckbuilder.js`). Inhalt: Menge/Map eingeklappter Kategorie-IDs.
  „Ohne Kategorie"-Sektionen brauchen ggf. einen synthetischen Schlüssel je `kind`
  (z.B. `uncat:deck`), falls auch sie einklappbar sein sollen.

## Store-Funktionen (js/store.js)

| Funktion | Verhalten |
|----------|-----------|
| `createCategory(state, kind, name)` | Legt Kategorie mit nächstem `order` im `kind` an, gibt sie zurück. |
| `renameCategory(state, categoryId, name)` | Setzt `name`. |
| `deleteCategory(state, categoryId)` | Entfernt Kategorie; setzt `categoryId` aller betroffenen Decks auf `null` (Decks bleiben erhalten). |
| `reorderCategories(state, kind, orderedIds)` | Schreibt `order` neu gemäß übergebener Reihenfolge (nur innerhalb `kind`; Safety-Check auf Vollständigkeit analog `reorderKind`). |
| `assignDeckToCategory(state, deckId, categoryId)` | Setzt `deck.categoryId` (Validierung: Kategorie existiert und hat gleichen `kind` wie Deck, sonst `null`). |

### Self-Heal (in `loadDecks` / `saveDecks`)

- `state.categories` immer als Array normalisieren; jede Kategorie `kind` per `normalizeKind`.
- Verwaiste Deck-`categoryId` (Kategorie existiert nicht oder `kind` passt nicht zum Deck) → `null`.
- Bestehende Decks/States ohne `categories`/`categoryId` laufen unverändert (Defaults: `[]` bzw. `null`).

## UI / Sidebar (js/ui-deckbuilder.js)

### Rendering (`deckListGroupsHtml`)

Pro fester Gruppe (Reihenfolge wie heute: Wants, Trades, Decks; danach „Sonstige"-Fallback):

1. Gruppen-Header wie bisher (`LABEL · Gesamtzahl`) plus **„+ Kategorie"-Button**.
2. Kategorien des `kind` nach `order`:
   - Klapp-Header `▼/▶ Name · Anzahl` mit Aktionen ✏️ (umbenennen) und ✕ (löschen, `confirm`),
     sowie Sortier-Handles (☰-Drag / ▲▼) analog zu Decks.
   - Wenn nicht eingeklappt: zugeordnete Decks via `favFirst` → `deckItemHtml` (bestehende
     manuelle Sortierung & Favoriten-Logik bleiben erhalten).
3. „Ohne Kategorie"-Sektion (Decks mit `categoryId === null` im `kind`):
   - Existieren **keine** Kategorien im `kind` → kein „Ohne Kategorie"-Header; die Decks
     werden direkt unter dem Gruppen-Header gerendert (optisch identisch zum heutigen Zustand).
   - Existiert **≥1** Kategorie im `kind` → „Ohne Kategorie" wird als eigener einklappbarer
     Header **immer** angezeigt (auch bei 0 uncategorisierten Decks), damit er als Drop-Ziel
     zum Entfernen aus einer Kategorie dient. Synthetischer Collapse-Key z.B. `uncat:<kind>`.

### Interaktion (`wireDeckList`)

- **„+ Kategorie":** Name per `prompt(...)` (Stil konsistent zum bestehenden Deck-Anlegen),
  dann `createCategory` + `saveDecks` + `renderDeckList`.
- **Umbenennen/Löschen** am Kategorie-Header: `renameCategory` (prompt) bzw. `deleteCategory`
  (confirm), danach speichern + neu rendern.
- **Zuordnung per Drag-and-Drop:** Bestehendes Drag-System am ☰-Griff erweitern, sodass ein
  Deck auf einen **Kategorie-Header** (oder in den Bereich einer Kategorie) gezogen werden kann
  → `assignDeckToCategory`. Drop bleibt auf das eigene `kind` beschränkt (wie heute `sameGroup`).
- **Zuordnung per Dropdown:** Im Deck-Editor (Detailbereich) ein `<select>` „Kategorie" mit den
  Kategorien des Deck-`kind` + „Ohne Kategorie" → `assignDeckToCategory`. Touch-Fallback.
- **Kategorien sortieren:** ☰-Drag / ▲▼ an Kategorie-Headern → `reorderCategories`.
- **Deck-Sortierung innerhalb Kategorie:** `reorderKind` sortiert weiterhin das flache
  `decks`-Array pro `kind` (stabil), Kategorie-Filterung passiert erst beim Rendern. ABER:
  `moveDeckRelative` / `moveDeckInGroup` müssen die Nachbar-Decks künftig innerhalb der
  gerenderten **Kategorie-Teilmenge** bestimmen, nicht über das ganze `kind`. Andernfalls
  springt ein Deck beim ▲/▼ über Kategoriegrenzen.
- **Einklappen:** Klick auf Kategorie-Header toggelt; Zustand im lokalen Collapse-Store
  persistieren; nur Re-Render der Sidebar, **kein** `saveDecks` (kein Sync-Push).

## Sync

- `categories` und `categoryId` reisen automatisch im `decks`-Blob mit (LWW in `js/sync.js`,
  `localDecks()` / `Store.saveDecks(row.decks, ...)`). Keine Sync-Code-Änderung nötig.
- `shared_decks`-Upload bleibt unverändert: Kategorien sind rein private Organisation und werden
  **nicht** mit anderen geteilt.
- Collapse-State ist lokal und wird nie übertragen.

## Edge Cases

- Kategorie gelöscht, während eines ihrer Decks aktiv (`activeDeckId`) ist → Deck bleibt aktiv,
  rutscht in „Ohne Kategorie".
- Import/Altdaten ohne `categories`/`categoryId` → Self-Heal-Defaults greifen.
- Deck wechselt `kind` (falls anderweitig möglich) → `categoryId` wird per Self-Heal auf `null`
  gesetzt, da die alte Kategorie nicht zum neuen `kind` passt.
- Duplizieren eines Decks (`duplicateDeck`): `categoryId` der Quelle mitkopieren (gleiches `kind`).
- Leere Kategorie (keine Decks) wird weiterhin angezeigt (Header mit `· 0`), damit man hineinziehen kann.
- **Main-Wants-Pseudo-Eintrag** (`MAIN_WANTS_ID`, separat über die Gruppen via `mainWantsItemHtml`
  gerendert): bleibt außerhalb des Kategorie-Systems — kein `kind`/`categoryId`, unverändert.
- **Collapse-Key in `Util.LS_KEYS`:** `LS_KEYS` ist in `util.js` `Object.freeze`d. Wird der
  Schlüssel dort abgelegt, muss er vor dem Freeze eingetragen werden; alternativ eine lokale
  Konstante in `ui-deckbuilder.js`. Beides okay — bewusst wählen.

## Nicht im Scope (YAGNI)

- Verschachtelte Kategorien (Unter-Unterkategorien).
- Mehrfachzuordnung eines Decks zu mehreren Kategorien (1 Deck → max. 1 Kategorie).
- Kategorien über `kind`-Grenzen hinweg / globale Kategorien.
- Teilen von Kategorien über `shared_decks`.

## Testbarkeit

- Store-Funktionen sind reine Zustandstransformationen über das `decksState`-Objekt und damit
  isoliert testbar (anlegen, umbenennen, löschen-mit-Reassign, reorder, assign mit kind-Mismatch,
  Self-Heal verwaister IDs).
- UI-Verhalten (Render-Gruppierung, Collapse-Toggle ohne Sync-Push) wird manuell in der App geprüft.
