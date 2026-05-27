# Plan: Digimon Collection auf Smartphone nutzbar machen

## Context

Die App ist eine reine Vanilla-JS-Web-App (HTML + Tailwind via CDN + `localStorage`),
keine Build-Tools, kein Framework. Sie liegt aktuell nur als lokale Dateien auf dem PC.
Der Nutzer will sie auf Android **und** iOS nutzen.

**Kein React-Umstieg.** Die App läuft bereits in jedem mobilen Browser. Ein Rewrite auf
React brächte für das Ziel „auf dem Handy nutzen" keinen Mehrwert, nur Risiko und Aufwand.
Die drei echten Themen sind:

1. **Erreichbarkeit** – Hosting auf **GitHub Pages** (gratis, HTTPS, statisch).
2. **Daten-Sync** – `localStorage` ist pro Gerät. Automatischer Cloud-Sync über **Supabase**,
   so dass derselbe Login auf PC + Handy dieselbe Sammlung zeigt.
3. **Mobiles Layout** – das Layout ist auf breite Screens ausgelegt; responsive machen.

Login allein reicht nicht: Es braucht (a) einen gemeinsamen Cloud-Speicher (Supabase-Tabelle)
und (b) Sync-Code, der beim Login zieht und bei Änderungen hochschiebt. Login ist der
Schlüssel „diese Daten gehören dir", der Sync-Code bewegt die Daten.

---

## Teil A — Mobiles Layout (responsive)

### A1. Mobile-Bottom-Tab-Bar + Header — `index.html`, `css/app.css`
- Top-Nav (`index.html:14`) → `hidden md:flex`. Neue `<nav id="tabs-mobile">` als Geschwister
  vor `</body>`: `md:hidden fixed bottom-0 inset-x-0 z-30` mit 4 gleich breiten Buttons
  (`flex-1 py-3 text-xs`, Tap-Höhe ≥56px), `pb-[env(safe-area-inset-bottom)]`.
- Beide Nav-Container tragen `.tab-btn[data-tab=...]`.
- Header (`index.html:12`): `gap-6→gap-3`, Titel `text-base md:text-xl`, Padding `px-3 md:px-4`.
  `#status-line` (`:20`) → `hidden sm:block`.
- `<main>` (`:24`) → `px-3 md:px-4 pb-24 md:pb-4` (Platz für Bottom-Bar).
- Viewport (`:6`) → `viewport-fit=cover` ergänzen (iOS-Notch).
- `css/app.css`: Media-Query `<640px`: `.modal-content` quasi-Vollbild
  (`max-width/height:100vw/vh; border-radius:0; padding:1rem`). `.qty-controls button` /
  `.slot-controls button` → `min-height:44px`. Eigener Selektor `#tabs-mobile .tab-btn` (ohne `rounded`).

### A2. Collection-Tab — `js/ui-collection.js`
- Wurzel-Layout (`:38-40`): `flex flex-col md:flex-row`, Set-Sidebar `w-full md:w-64`,
  `#set-list` (`:50`) → `max-h-[40vh] md:max-h-[78vh]`.
- Filterleiste (`:54`): in einklappbares `<details>` (auf `md:` immer offen), `#search`
  → `flex-1 min-w-[140px]`, alle `select/input` → `min-h-[40px]`.
- `#card-grid` (`:107`): `grid-cols-2` Mobile ist okay; `gap-3→gap-2` auf Mobile.

### A3. Deckbuilder — `js/ui-deckbuilder.js`
- Drei-Spalten-Layout (`:36-51`): `flex flex-col lg:flex-row`, Sidebar `w-full lg:w-48`.
- `#deck-list`/`#deck-entries`/`#picker-results` `max-h-[78vh]` → `max-h-[50vh] lg:max-h-[78vh]`.
- Toolbar-Selects → `min-h-[40px]`.

### A4. Card-Menu (kritisch für Touch) — `js/ui-card-menu.js`
- `contextmenu` (`:37`) existiert auf Touch nicht → das „Zu Listen hinzufügen"-Menü ist am
  Handy unerreichbar. **Long-Press-Handler** (touchstart-Timer ~500ms) ergänzen, der dasselbe
  `openAddToListsDialog(cardId, variantKey)` aufruft (`findCardContext` bleibt nutzbar).
- Checkbox-Zeilen (`:72`) `py-1 → py-2`.

### A5. Stats — `js/ui-stats.js`
- Grids sind bereits responsive (`grid-cols-2 md:grid-cols-5` etc.), „Tabellen" sind
  flex-Bar-Rows. Keine Änderung nötig.


Ist fertig implementiert!
---

## Teil B — Cloud-Sync über Supabase

### B1. Supabase-Projekt anlegen (einmalig, im Supabase-Dashboard)
- Gratis-Projekt erstellen, Email-Auth (Magic Link) aktivieren.
- SQL ausführen:

```sql
create table if not exists public.app_state (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  collection  jsonb not null default '{}'::jsonb,
  decks       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);
alter table public.app_state enable row level security;
create policy "own_select" on public.app_state for select using (auth.uid() = user_id);
create policy "own_insert" on public.app_state for insert with check (auth.uid() = user_id);
create policy "own_update" on public.app_state for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

- `Project URL` + `anon public key` notieren (anon-Key darf öffentlich im Client stehen –
  RLS schützt die Daten).

### B2. Neue Datei `js/sync.js` (`window.Sync`, IIFE wie die anderen Module)
- Client: `window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)`.
- **Auth:** `signIn(email)` → `signInWithOtp({ email, options:{ emailRedirectTo: location.href }})`;
  `getSession()` beim Start (Auto-Login pro Gerät); `onAuthStateChange` → bei `SIGNED_IN` `pull()`.
- **pull():** `select ... from app_state` (`.maybeSingle()`, RLS filtert auf eigene Zeile).
  - keine Zeile → `push()` (Erstbefüllung).
  - remote `updated_at` > lokales kombiniertes `updatedAt` → `applyRemote`:
    `Store.saveCollection(row.collection)` + `Store.saveDecks(row.decks)`, dann
    `onRemoteApplied()` (Tab-Refresh). Internes `suppressPush`-Flag verhindert Rück-Push.
  - lokal neuer → `push()`.
- **push() (debounced ~1500ms):** `upsert({ user_id, collection, decks, updated_at }, {onConflict:'user_id'})`.
  Status-Indikator im Header („syncing/synced/error").
- **Hooks:** `collection-changed` (existiert) + `decks-changed` (neu, s. B3) → `debouncedPush`,
  no-op wenn nicht eingeloggt oder `suppressPush`.
- **Login-UI:** `mountLoginUI(hostEl)` – „E-Mail → Magic Link" bzw. „Eingeloggt als … · Logout · Jetzt syncen".

### B3. Minimale Anpassungen an bestehendem Code
- `js/store.js` `saveDecks` (`:364-366`): analog zu `saveCollection` `state.updatedAt = now()`
  setzen **und** `document.dispatchEvent(new CustomEvent('decks-changed'))` feuern.
  `loadDecks`-Default (`:361`) um `updatedAt` ergänzen.
- `js/app.js`: `window.App.refreshActiveTab` exponieren (re-init des aktiven Tabs via
  vorhandener `activateTab`-Logik, `:14-26`); in `init()` nach `activateTab('collection')` (`:45`):
  `if (window.Sync) Sync.init({ onRemoteApplied: () => App.refreshActiveTab() });`.
  Tab-Verdrahtung (`:37-39`) zusätzlich für `#tabs-mobile .tab-btn`; in `activateTab` beide
  Button-Sets als `.active` markieren.
- `index.html`: nach Tailwind-CDN (`:7`) Supabase-CDN
  `<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>`;
  Inline-`<script>` mit `window.SUPABASE_URL` / `window.SUPABASE_ANON_KEY`; `js/sync.js`
  **nach** `js/store.js` und **vor** `js/app.js` einbinden.
- `js/ui-importexport.js`: im Backup-Block (`render()`, `:98`) additiven Sync-Abschnitt
  (`Sync.mountLoginUI(...)`) einhängen.

### B4. Sync-Strategie & bewusste Limitierung
Last-Write-Wins über den **gesamten Blob** (collection + decks), Tiebreaker `updated_at`.
**Limitierung:** Werden zwei Geräte gleichzeitig offline editiert, überschreibt der zuletzt
gepushte Blob den anderen komplett (kein Feld-Merge). Für einen Einzelnutzer (sequenzielle
Nutzung) akzeptabel; das vorhandene Backup-JSON (`ui-importexport.js:369`) bleibt als Netz.

---

## Teil C — Deployment auf GitHub Pages
1. Git-Repo initialisieren (Verzeichnis ist noch kein Repo), `.gitignore` für lokale Backups.
2. Repo auf GitHub pushen, **Settings → Pages** → Branch `main` / Root aktivieren.
3. URL `https://<user>.github.io/<repo>` → auf Handy öffnen, „Zum Home-Bildschirm hinzufügen".
4. In Supabase die Pages-URL als erlaubte Redirect-URL für Auth eintragen.

---

## Verifikation
- **Desktop lokal:** App starten (z.B. `python3 -m http.server`), einloggen, Karte hinzufügen
  → in Supabase-Tabelle erscheint die Zeile mit aktualisiertem `collection`/`updated_at`.
- **Zweites Gerät / Inkognito:** mit derselben E-Mail einloggen → dieselbe Sammlung erscheint;
  dort eine Änderung machen → nach Reload auf dem ersten Gerät sichtbar.
- **Mobile-Layout:** Browser-DevTools auf 360px / echtes Smartphone: Bottom-Tab-Bar erreichbar,
  Grid 2-spaltig, Modals quasi-Vollbild, Long-Press auf Kachel öffnet „Zu Listen hinzufügen".
- **Offline-Fallback:** Ohne Login funktioniert die App weiter rein lokal (localStorage),
  Backup-Download/Restore unverändert.

## Kritische Dateien
- `index.html`, `css/app.css` (Layout + Einbindung)
- `js/sync.js` (neu)
- `js/store.js`, `js/app.js` (Hooks)
- `js/ui-collection.js`, `js/ui-deckbuilder.js`, `js/ui-card-menu.js`, `js/ui-importexport.js` (Layout/UI)
