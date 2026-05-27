# Supabase einrichten (Cloud-Sync, Teil B)

Einmalige Einrichtung, ca. 10 Minuten. Du brauchst keinen Server und keine Kreditkarte —
der Free-Tier reicht für eine persönliche Sammlung locker.

## 1. Projekt anlegen

1. Auf [supabase.com](https://supabase.com) registrieren (z.B. mit GitHub-Login).
2. **New project** → Name frei wählen (z.B. `digimon-collection`), Region in deiner Nähe
   (z.B. *Central EU (Frankfurt)*), ein **Datenbank-Passwort** vergeben (irgendwo notieren —
   wird hier nicht weiter gebraucht).
3. Warten, bis das Projekt fertig provisioniert ist (~1-2 Min).

## 2. E-Mail-Login (Magic Link) aktivieren

1. Links im Menü **Authentication** → **Sign In / Providers** (bzw. **Providers**).
2. **Email** ist standardmäßig aktiv. Magic Link funktioniert damit out-of-the-box.
3. Optional für schnelleres Testen: unter **Authentication → Sign In / Providers → Email**
   die Option **"Confirm email"** ausschalten. (Kannst du später wieder einschalten.)

## 3. Datenbank-Tabelle anlegen

Links **SQL Editor** → **New query** → folgendes einfügen und **Run** klicken:

```sql
create table if not exists public.app_state (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  collection  jsonb not null default '{}'::jsonb,
  decks       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

alter table public.app_state enable row level security;

create policy "own_select" on public.app_state for select
  using (auth.uid() = user_id);
create policy "own_insert" on public.app_state for insert
  with check (auth.uid() = user_id);
create policy "own_update" on public.app_state for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

Das legt die Tabelle an und sorgt per **Row-Level-Security** dafür, dass jeder Nutzer
ausschließlich seine eigene Zeile sehen und ändern kann.

## 4. Zugangsdaten holen und eintragen

1. Links **Project Settings** (Zahnrad) → **API**.
2. Kopiere zwei Werte:
   - **Project URL** (z.B. `https://abcdxyz.supabase.co`)
   - **anon public** Key (langer Token unter *Project API keys*)
3. Trage beide in [index.html](index.html) ein (oberer Bereich, im `<script>` nach dem
   Supabase-CDN):

```html
<script>
  window.SUPABASE_URL = 'https://DEIN-PROJEKT.supabase.co';
  window.SUPABASE_ANON_KEY = 'DEIN-ANON-KEY';
</script>
```

Der `anon public` Key ist **für den Browser gedacht** und darf öffentlich im Code stehen —
der Schutz kommt über die RLS-Policies aus Schritt 3. (Der *service_role*-Key dagegen darf
**niemals** in den Client — den brauchst du hier nicht.)

## 5. Testen

1. App lokal starten: `python3 -m http.server` im Projektordner, dann
   <http://localhost:8000> öffnen.
2. Tab **Import / Export** → Abschnitt **Cloud-Sync** → E-Mail eingeben → **Login-Link senden**.
3. Mail öffnen, Link klicken → du landest wieder in der App, jetzt eingeloggt.
4. Eine Karte hinzufügen → im Supabase **Table Editor → app_state** erscheint eine Zeile mit
   gefülltem `collection` und frischem `updated_at`. Im Header steht „✓ Synced".
5. Zweites Gerät / Inkognito-Fenster: gleiche E-Mail → nach Login dieselbe Sammlung.

> **Später (Teil C):** Wenn die App auf GitHub Pages liegt, musst du die Pages-URL in
> Supabase unter **Authentication → URL Configuration** als erlaubte Redirect-URL eintragen,
> damit der Magic-Link-Login auch von dort funktioniert.
