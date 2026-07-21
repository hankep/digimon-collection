#!/usr/bin/env python3
"""Lädt neue Karten von digimoncard.io und aktualisiert cards.data.js.

Workflow:
  1. cards.data.js parsen → bekannte Card-IDs
  2. Index von digimoncard.io abrufen
  3. Diff → Liste neuer IDs
  4. Pro neue ID: API-Call mit Rate-Limit + Backoff
  5. Backup von cards.data.js → cards.data.js.bak.<timestamp>
  6. cards.data.js neu schreiben mit gemergten Daten

Resumability: alle 20 Karten wird cards.data.js zwischengeflusht. Ein Abbruch
(Ctrl-C) verliert maximal 20 Karten Fortschritt. Erneuter Start picks up.

Usage:
  python3 scripts/sync-cards.py [--limit N] [--delay-ms MS] [--dry-run]
"""

import argparse
import io
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image

# Karten werden im Grid max. ~250px breit angezeigt (Zoom-Stufe XL), im
# Karten-Detail max. ~320px. 480px Zielbreite gibt etwas Retina-Reserve, ohne
# die vollaufgeloesten Community-Scans (oft 800px+, 1MB+) unnoetig mitzuschleppen.
MIRROR_MAX_WIDTH = 480
MIRROR_JPEG_QUALITY = 82

API_INDEX = 'https://digimoncard.io/api-public/getAllCards.php?series=Digimon%20Card%20Game&sort=name'
API_CARD = 'https://digimoncard.io/api-public/search.php?card='
IMG_BASE = 'https://world.digimoncard.com/images/cardlist/card/'

# Übergangs-Bildquelle: Bandai veröffentlicht Kartenbilder auf world.digimoncard.com
# oft erst Wochen nach den Kartendaten. digimoncard.dev sammelt Community-Scans
# schneller. Braucht Browser-typische Header, sonst 406 (mod_security).
DCD_INDEX = 'https://digimoncard.dev/data8675309.php'
DCD_HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Referer': 'https://digimoncard.dev/',
    'Origin': 'https://digimoncard.dev',
}

MAX_ALT_PROBE = 10      # _P1 .. _P10 probieren (bestehende Daten haben bis zu 7 Alts)
ALT_PROBE_DELAY = 0.2   # 200 ms zwischen HEAD-Requests

RARITY_MAP = {
    'C': 'Common', 'U': 'Uncommon', 'R': 'Rare', 'SR': 'Super Rare',
    'SEC': 'Secret Rare', 'P': 'Promo', 'T': 'Token',
}

DEFAULT_DELAY_MS = 800
BACKOFF_429 = [30, 60, 120, 300]   # seconds
BACKOFF_5XX = [5, 15, 30]
MAX_RETRIES = 3
FLUSH_EVERY = 20

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = PROJECT_ROOT / 'data'
DATA_DIR.mkdir(parents=True, exist_ok=True)
CARDS_DATA_JS = DATA_DIR / 'cards.data.js'
SET_PROGRESS_JS = DATA_DIR / 'set-progress.data.js'
REVEAL_IMAGES_JS = DATA_DIR / 'reveal-images.data.js'
REVEAL_CACHE_DIR = DATA_DIR / 'reveal-cache'
# Zeitstempel (YYYY-MM-DD, UTC) des letzten digimoncard.dev-Index-Abrufs. Sorgt
# dafür, dass der Index selbst dann höchstens EINMAL pro Kalendertag abgefragt
# wird, wenn der Workflow an einem Tag mehrfach ausgelöst wird (Cron-Re-Run,
# workflow_dispatch, lokaler Lauf) — Schutz davor, von digimoncard.dev
# (mod_security) ausgesperrt zu werden. Liegt bewusst in reveal-cache/, wird
# also mit den gespiegelten Bildern versioniert und ist in GitHub Actions über
# Läufe hinweg persistent.
DCD_STAMP_FILE = REVEAL_CACHE_DIR / '.dcd-last-fetch'


def _today_utc():
    return datetime.now(timezone.utc).strftime('%Y-%m-%d')


def dcd_fetched_today():
    """True, wenn der digimoncard.dev-Index heute (UTC) bereits abgefragt wurde."""
    try:
        return DCD_STAMP_FILE.read_text(encoding='utf-8').strip() == _today_utc()
    except OSError:
        return False


def mark_dcd_fetched():
    try:
        REVEAL_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        DCD_STAMP_FILE.write_text(_today_utc(), encoding='utf-8')
    except OSError as e:
        log(f'  ⚠ Konnte digimoncard.dev-Zeitstempel nicht schreiben: {e}')


def log(msg):
    print(msg, flush=True)


def http_get_json(url, timeout=30):
    req = urllib.request.Request(url, headers={'User-Agent': 'digimon-collection-sync/1.0'})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = resp.read()
    return json.loads(data.decode('utf-8'))


_dcd_fallback_cache = None


def fetch_dcd_fallback_map():
    """Lädt den digimoncard.dev-Datensatz und baut cardid -> imageUrl (nur
       en-US, LETZTER Treffer pro Karte — dev ergänzt korrigierte/englische
       Scans oft als zusätzlichen Eintrag, der neuere gewinnt).

       Zwei Drosseln, damit digimoncard.dev höchstens 1×/Tag getroffen wird:
       - memoisiert innerhalb eines Laufs (_dcd_fallback_cache)
       - persistente Tagessperre über Läufe hinweg (DCD_STAMP_FILE): wurde der
         Index heute schon geholt, wird NICHT erneut angefragt — es kommt ein
         leerer Map zurück, offene Fallbacks werden dann eben morgen ergänzt.
       Der Zeitstempel wird VOR dem Netz-Request gesetzt: auch ein
       fehlgeschlagener Versuch zählt als Tagesabfrage (kein Retry-Hämmern)."""
    global _dcd_fallback_cache
    if _dcd_fallback_cache is not None:
        return _dcd_fallback_cache
    if dcd_fetched_today():
        log('  digimoncard.dev heute bereits abgefragt — überspringe (max. 1×/Tag).')
        _dcd_fallback_cache = {}
        return _dcd_fallback_cache
    log('  Lade digimoncard.dev-Fallback-Index (Übergangsbilder) …')
    mark_dcd_fetched()
    try:
        req = urllib.request.Request(DCD_INDEX, headers=DCD_HEADERS)
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode('utf-8'))
        out = {}
        for entry in data:
            cid = entry.get('cardid')
            url = entry.get('imageUrl')
            if cid and url and 'en-US' in url:
                out[cid] = url   # letzter en-US-Treffer gewinnt (s. Docstring)
        log(f'  → {len(out)} Fallback-Bilder bei digimoncard.dev gefunden.')
        _dcd_fallback_cache = out
    except Exception as e:
        log(f'  ⚠ digimoncard.dev-Fallback nicht erreichbar: {e}')
        _dcd_fallback_cache = {}
    return _dcd_fallback_cache


def remove_local_mirror(fallback):
    """Löscht die gespiegelte reveal-cache-Datei zu einem Fallback (nur wenn es
       ein lokaler Pfad unter reveal-cache/ ist). Hotlink-URLs werden ignoriert."""
    if not isinstance(fallback, str) or fallback.startswith('http'):
        return
    p = PROJECT_ROOT / fallback
    try:
        if p.exists() and REVEAL_CACHE_DIR in p.parents:
            p.unlink()
    except OSError:
        pass


def apply_image_fallback(card):
    """Prüft, ob das offizielle Bandai-Bild für `card` existiert. Falls nicht
       und noch kein Fallback gesetzt ist, wird bei digimoncard.dev ein
       Übergangsbild nachgeschlagen und — wie bei sync_reveal_images — LOKAL
       gespiegelt (data/reveal-cache/), NICHT direkt verlinkt: deren CDN
       (assets.cardlist.dev) blockt Cross-Origin-Zugriffe mit 403, ein Hotlink
       wäre im Browser also ein kaputtes Bild. Falls Bandai inzwischen doch ein
       eigenes Bild hat, wird ein vorher gesetzter Fallback (inkl. lokaler
       Spiegel-Datei) wieder entfernt.

       Die Quell-URL wird in 'imageFallbackSrc' mitgespeichert: liefert
       digimoncard.dev später ein besseres/korrigiertes Bild unter einer neuen
       URL (z.B. erst JP-, dann englischer Scan), wird automatisch neu
       gespiegelt. Ein Fallback ohne bekannte Quelle (Altbestand) wird beim
       nächsten Check einmalig aufgefrischt.
       Gibt 'added' / 'refreshed' / 'resolved' / None zurück (für Logging)."""
    cid = card.get('id')
    if not cid:
        return None
    status, _ = head_probe(IMG_BASE + cid + '.png')
    if status == 200:
        # Bandai hat jetzt ein offizielles Bild → Übergangs-Fallback entfernen.
        if card.get('imageFallback'):
            remove_local_mirror(card['imageFallback'])
            del card['imageFallback']
            card.pop('imageFallbackSrc', None)
            return 'resolved'
        return None
    url = fetch_dcd_fallback_map().get(cid)
    if not url:
        return None
    if card.get('imageFallback'):
        # Schon ein Fallback da — nur neu spiegeln, wenn dev inzwischen eine
        # andere Quelle liefert (oder die Quelle unbekannt ist, Altbestand).
        # Sonst kein Download.
        if card.get('imageFallbackSrc') == url:
            return None
        local = mirror_image(cid, url)
        if local:
            card['imageFallback'] = local
            card['imageFallbackSrc'] = url
            return 'refreshed'
        return None
    # Noch gar kein Fallback → neu anlegen.
    local = mirror_image(cid, url)
    if local:
        card['imageFallback'] = local
        card['imageFallbackSrc'] = url
        return 'added'
    # Spiegeln fehlgeschlagen → lieber gar kein Fallback als ein blockierter
    # Hotlink (kaputtes Bild). Nächster Lauf versucht es erneut.
    return None


def head_probe(url, timeout=10):
    """Schickt einen HEAD-Request. Gibt (status_code, error_message) zurück.
       status_code ist int oder None bei Netzwerk-/Timeout-Fehlern."""
    req = urllib.request.Request(url, method='HEAD', headers={'User-Agent': 'digimon-collection-sync/1.0'})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, None
    except urllib.error.HTTPError as e:
        return e.code, None
    except urllib.error.URLError as e:
        return None, f'URLError: {e.reason}'
    except Exception as e:
        return None, f'{type(e).__name__}: {e}'


def probe_alt_arts(card_id, verbose=False, prefix='      '):
    """Probiert _P1 … am Bandai-CDN; stoppt bei erstem 404.
       Mit verbose=True wird jedes HTTP-Ergebnis geloggt.
       Bei transienten Fehlern (Timeout, 5xx) wird bis zu 2× retried."""
    alts = []
    for i in range(1, MAX_ALT_PROBE + 1):
        url = f'{IMG_BASE}{card_id}_P{i}.png'

        # bis zu 3 Versuche bei transienten Fehlern
        status, err = None, None
        for attempt in range(1, 4):
            t0 = time.time()
            status, err = head_probe(url)
            elapsed = time.time() - t0

            if status == 200:
                if verbose:
                    log(f'{prefix}_P{i} = 200 ({elapsed*1000:.0f}ms) ✓')
                break
            if status == 404:
                if verbose:
                    log(f'{prefix}_P{i} = 404 → stop ({elapsed*1000:.0f}ms)')
                break
            # alles andere: transient, retry
            reason = f'HTTP {status}' if status else err or 'unknown'
            if attempt < 3:
                if verbose:
                    log(f'{prefix}_P{i} = {reason} ({elapsed*1000:.0f}ms) → retry {attempt}/2 in {attempt*5}s …')
                time.sleep(attempt * 5)
            else:
                if verbose:
                    log(f'{prefix}_P{i} = {reason} → aufgegeben nach 3 Versuchen')

        if status == 200:
            alts.append(f'{card_id}_P{i}.webp')
            time.sleep(ALT_PROBE_DELAY)
            continue
        # 404 oder permanenter Fehler → Schleife abbrechen
        break
    return alts


def load_existing_cards():
    if not CARDS_DATA_JS.exists():
        log(f'⚠ {CARDS_DATA_JS.name} nicht gefunden — starte mit leerer Sammlung.')
        return []
    text = CARDS_DATA_JS.read_text(encoding='utf-8')
    m = re.match(r'^\s*window\.CARDS\s*=\s*', text)
    if not m:
        raise RuntimeError('cards.data.js hat kein erwartetes "window.CARDS = "-Präfix.')
    json_part = text[m.end():].rstrip().rstrip(';').rstrip()
    return json.loads(json_part)


def write_cards_data_js(cards):
    payload = 'window.CARDS = ' + json.dumps(cards, ensure_ascii=False) + ';\n'
    tmp = CARDS_DATA_JS.with_suffix('.js.tmp')
    tmp.write_text(payload, encoding='utf-8')
    tmp.replace(CARDS_DATA_JS)


def load_set_progress():
    """Liest data/set-progress.data.js (manuell gepflegte Gesamtkartenzahl
       je unvollständigem Set). Gültiges JSON nach dem 'window.SET_PROGRESS = '-Präfix."""
    if not SET_PROGRESS_JS.exists():
        return {}
    text = SET_PROGRESS_JS.read_text(encoding='utf-8')
    m = re.search(r'window\.SET_PROGRESS\s*=\s*', text)
    if not m:
        return {}
    json_part = text[m.end():].rstrip().rstrip(';').rstrip()
    return json.loads(json_part)


def load_reveal_images():
    if not REVEAL_IMAGES_JS.exists():
        return {}
    text = REVEAL_IMAGES_JS.read_text(encoding='utf-8')
    m = re.search(r'window\.REVEAL_IMAGES\s*=\s*', text)
    if not m:
        return {}
    json_part = text[m.end():].rstrip().rstrip(';').rstrip()
    try:
        return json.loads(json_part)
    except json.JSONDecodeError:
        return {}


def write_reveal_images(mapping):
    payload = 'window.REVEAL_IMAGES = ' + json.dumps(mapping, ensure_ascii=False, indent=2, sort_keys=True) + ';\n'
    tmp = REVEAL_IMAGES_JS.with_suffix('.js.tmp')
    tmp.write_text(payload, encoding='utf-8')
    tmp.replace(REVEAL_IMAGES_JS)


def mirror_image(cid, url):
    """Lädt ein digimoncard.dev-Bild einmalig herunter, verkleinert es auf
       Anzeigegröße und speichert es lokal unter data/reveal-cache/. So
       hotlinken wir ihre CDN nicht bei jedem Seitenaufruf (die blockt das per
       Referer-Check sowieso) — ihre Bandbreite wird nur 1x pro Karte belastet,
       nicht pro Besucher. Immer als JPEG gespeichert, damit die oft 1MB+
       grossen Rohscans nicht 1:1 ins Repo wandern.
       Gibt den repo-relativen Pfad zurück, oder None bei Fehler."""
    REVEAL_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    dest = REVEAL_CACHE_DIR / f'{cid}.jpg'
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'digimon-collection-sync/1.0'})
        with urllib.request.urlopen(req, timeout=30) as resp:
            raw = resp.read()
        img = Image.open(io.BytesIO(raw)).convert('RGB')
        if img.width > MIRROR_MAX_WIDTH:
            new_h = round(img.height * MIRROR_MAX_WIDTH / img.width)
            img = img.resize((MIRROR_MAX_WIDTH, new_h), Image.LANCZOS)
        img.save(dest, 'JPEG', quality=MIRROR_JPEG_QUALITY, optimize=True)
        return f'data/reveal-cache/{dest.name}'
    except Exception as e:
        log(f'  ⚠ Mirror fehlgeschlagen für {cid}: {e}')
        return None


def sync_reveal_images(existing):
    """Für Sets aus set-progress.data.js: IDs, die weder in cards.data.js noch
       digimoncard.io bekannt sind, aber bei digimoncard.dev schon ein
       Community-Bild haben, landen in reveal-images.data.js — als lokal
       gespiegelte Kopie (data/reveal-cache/), nicht als direkter Link zu
       deren CDN (die blockt Hotlinking per Referer-Check, und selbst ohne
       Block waere staendiges Hotlinken unfair gegenueber ihrer Bandbreite).
       Nur die Bild-Datei wird übernommen — keine Kartendaten (Name/Effekt/etc.
       kommen erst mit dem offiziellen digimoncard.io-Sync).

       Additiv, nicht destruktiv: bestehende Einträge (auch von Hand
       korrigierte) werden nie neu berechnet oder überschrieben — nur wirklich
       neue IDs kommen dazu. Ein Eintrag verschwindet erst wieder, sobald die
       Karte offiziell erfasst ist (dann übernimmt der normale Sync das echte
       Bild), die gespiegelte Datei wird dann ebenfalls aufgeräumt."""
    progress = load_set_progress()
    if not progress:
        return
    known_ids = {c['id'] for c in existing if c.get('id')}
    reveal = load_reveal_images()
    changed = False

    # Spiegel-Dateien, die als offizieller Fallback in cards.data.js referenziert
    # werden — die dürfen beim Aufräumen NICHT gelöscht werden, auch wenn dieselbe
    # ID noch (verwaist) in reveal-images steht. Sonst zeigt der cards.data.js-
    # Fallback nach dem Cleanup ins Leere (kaputtes Bild).
    fallbacks_in_use = {c['imageFallback'] for c in existing
                        if isinstance(c.get('imageFallback'), str)}

    for cid in list(reveal.keys()):
        if cid in known_ids:
            path = reveal[cid]
            old_path = PROJECT_ROOT / path
            if (path not in fallbacks_in_use
                    and old_path.exists() and REVEAL_CACHE_DIR in old_path.parents):
                old_path.unlink()
            del reveal[cid]
            changed = True

    # Migration: Einträge aus früheren Läufen, die noch direkt auf deren CDN
    # zeigen (vor Einführung des Mirrorings), einmalig lokal spiegeln.
    for cid, val in list(reveal.items()):
        if isinstance(val, str) and val.startswith('http'):
            local_path = mirror_image(cid, val)
            if local_path:
                reveal[cid] = local_path
                changed = True

    fb_map = None
    for set_code, total in progress.items():
        sample = next((c for c in existing if c.get('set') == set_code and c.get('id')), None)
        pad = len((sample['id'].split('-')[1] if sample else '')) or 3
        new_ids = [f'{set_code}-{n:0{pad}d}' for n in range(1, total + 1)
                   if f'{set_code}-{n:0{pad}d}' not in known_ids and f'{set_code}-{n:0{pad}d}' not in reveal]
        if not new_ids:
            continue
        if fb_map is None:
            fb_map = fetch_dcd_fallback_map()
        for cid in new_ids:
            url = fb_map.get(cid)
            if not url:
                continue
            local_path = mirror_image(cid, url)
            if local_path:
                reveal[cid] = local_path
                changed = True

    if not changed:
        return
    write_reveal_images(reveal)
    log(f'  🖼  reveal-images.data.js: {len(reveal)} Bild(er) insgesamt (nur neue IDs ergänzt, Bestand unangetastet).')


def backup_cards_data_js():
    if not CARDS_DATA_JS.exists():
        return None
    ts = datetime.now().strftime('%Y%m%d-%H%M%S')
    bak = CARDS_DATA_JS.with_name(f'cards.data.js.bak.{ts}')
    bak.write_bytes(CARDS_DATA_JS.read_bytes())
    return bak


def combine_effects(main, source, alt):
    parts = []
    if main and main.strip():
        parts.append(main)
    if source and source.strip():
        parts.append('[When Digivolving] ' + source)
    if alt and alt.strip():
        parts.append(alt)
    return '\n\n'.join(parts)


# Nur die zur Laufzeit (Web-App) gelesenen raw-Felder behalten. Die volle
# digimoncard.io-Antwort macht ~66% von cards.data.js aus und wird sonst nicht
# gebraucht (Effekttext liegt bereits in 'effect'). Genutzt: cards.js (set_name,
# date_added), ui-wants/ui-trade (tcgplayer_name).
RAW_KEEP = ('set_name', 'date_added', 'tcgplayer_name')


def slim_raw(raw):
    if not isinstance(raw, dict):
        return {}
    out = {}
    for k in RAW_KEEP:
        v = raw.get(k)
        if v is not None:
            out[k] = v
    return out


def extract_traits(raw):
    """Sammelt digi_type/digi_type2/digi_type3/digi_type4 in eine deduplizierte
    Reihenfolge. Leerstrings und None werden uebersprungen."""
    seen = set()
    out = []
    for k in ('digi_type', 'digi_type2', 'digi_type3', 'digi_type4'):
        v = raw.get(k)
        if not v:
            continue
        s = str(v).strip()
        if not s:
            continue
        key = s.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(s)
    return out


def map_card(raw):
    cid = raw.get('id') or ''
    return {
        'id': cid,
        'name': raw.get('name', ''),
        'set': cid.split('-')[0] if cid else '',
        'rarity': RARITY_MAP.get(raw.get('rarity'), raw.get('rarity') or ''),
        'color': [c for c in [raw.get('color'), raw.get('color2')] if c],
        'type': raw.get('type'),
        'image': f'{cid}.webp',
        'raw': slim_raw(raw),
        'altImages': [],
        'level': raw.get('level'),
        'cost': raw.get('play_cost'),
        'effect': combine_effects(raw.get('main_effect'), raw.get('source_effect'), raw.get('alt_effect')),
        'traits': extract_traits(raw),
    }


def run_backfill_alts(existing, args):
    """Probiert für ALLE Karten in cards.data.js die Alt-Arts und aktualisiert altImages."""
    log('')
    log(f'🔍 Alt-Art Backfill für {len(existing)} Karten …')
    est_sec = len(existing) * 1.5
    log(f'   Geschätzte Dauer: ~{est_sec/60:.0f} min (Ctrl-C zum Abbrechen, alle 100 Karten Zwischenspeicher)')
    log(f'   Pro Karte siehst du die HTTP-Codes jedes Probes.')
    log('')

    bak = backup_cards_data_js()
    if bak:
        log(f'   Backup: {bak.name}')
    log('')

    changed = 0
    for i, card in enumerate(existing, 1):
        cid = card.get('id')
        if not cid:
            continue
        log(f'  [{i:>4}/{len(existing)}] {cid}')
        alts = probe_alt_arts(cid, verbose=True, prefix='        ')
        current = list(card.get('altImages') or [])
        if alts != current:
            card['altImages'] = alts
            changed += 1
            log(f'        → geändert: {current or "(leer)"} → {alts or "(leer)"}')

        if i % 100 == 0:
            log(f'  ── Fortschritt {i}/{len(existing)} · {changed} Änderungen bisher · Zwischenspeichern')
            write_cards_data_js(existing)

    write_cards_data_js(existing)
    log('')
    log(f'✅ Backfill fertig. {changed} Karten mit aktualisierten Alt-Arts.')
    return 0


def newest_set(existing):
    """Ermittelt das zuletzt hinzugefügte Set (über raw.date_added — Set-Codes
       korrelieren nicht mit dem Erscheinungsdatum)."""
    dated = [(c['raw']['date_added'], c.get('set')) for c in existing
             if isinstance(c.get('raw'), dict) and c['raw'].get('date_added') and c.get('set')]
    return max(dated)[1] if dated else None


def fix_images_for_cards(candidates):
    """Läuft apply_image_fallback über candidates und loggt je Karte.
       Gibt (added, refreshed, resolved) zurück. Schreibt NICHT — das erledigt
       der Aufrufer."""
    added = refreshed = resolved = 0
    total = len(candidates)
    for i, card in enumerate(candidates, 1):
        action = apply_image_fallback(card)
        if action == 'added':
            added += 1
            log(f'  [{i:>3}/{total}] {card["id"]}  → Fallback ergänzt')
        elif action == 'refreshed':
            refreshed += 1
            log(f'  [{i:>3}/{total}] {card["id"]}  → besseres dev-Bild, neu gespiegelt')
        elif action == 'resolved':
            resolved += 1
            log(f'  [{i:>3}/{total}] {card["id"]}  → Bandai-Bild jetzt da, Fallback entfernt')
    return added, refreshed, resolved


def run_fix_missing_images(existing, args):
    """Prüft Karten ohne offizielles Bandai-Bild (frisch angekündigte Sets,
       CDN hinkt hinterher) und ergänzt/aktualisiert eine lokal gespiegelte
       digimoncard.dev-Übergangsgrafik. Wird ein Fallback durch ein inzwischen
       erschienenes Bandai-Bild überflüssig, wird er entfernt.
       Standard: nur das neueste Set (per --set einschränkbar)."""
    target_set = args.set or newest_set(existing)
    candidates = [c for c in existing if c.get('set') == target_set] if target_set else existing
    log('')
    log(f'🖼  Bild-Fallback-Check für Set {target_set!r} ({len(candidates)} Karten) …')
    bak = backup_cards_data_js()
    if bak:
        log(f'   Backup: {bak.name}')
    log('')

    added, refreshed, resolved = fix_images_for_cards(candidates)

    write_cards_data_js(existing)
    log('')
    log(f'✅ Fertig. {added} ergänzt, {refreshed} aufgefrischt, {resolved} durch offizielles Bild ersetzt.')
    return 0


def run_mirror_fallbacks(existing):
    """Einmalige Migration: bestehende Hotlink-Fallbacks (imageFallback = http…,
       z.B. assets.cardlist.dev) lokal nach data/reveal-cache/ spiegeln und den
       Eintrag auf den lokalen Pfad umbiegen. Nötig, weil deren CDN
       Cross-Origin-Hotlinks mit 403 blockt (kaputtes Bild im Browser).

       Lädt NUR die bereits in cards.data.js gespeicherten Bild-URLs herunter —
       KEIN digimoncard.dev-Index-Abruf. Damit unabhängig von der Tagessperre
       und gefahrlos einmalig ausführbar (das „Nachziehen")."""
    targets = [c for c in existing
               if isinstance(c.get('imageFallback'), str) and c['imageFallback'].startswith('http')]
    log('')
    log(f'🪞 Spiegle {len(targets)} vorhandene(n) Hotlink-Fallback(s) lokal '
        f'(kein digimoncard.dev-Index-Abruf) …')
    if not targets:
        log('   Nichts zu tun.')
        return 0
    bak = backup_cards_data_js()
    if bak:
        log(f'   Backup: {bak.name}')
    log('')

    ok, fail = 0, 0
    for i, card in enumerate(targets, 1):
        cid = card['id']
        local = mirror_image(cid, card['imageFallback'])
        if local:
            card['imageFallback'] = local
            ok += 1
            log(f'  [{i:>3}/{len(targets)}] {cid}  → {local}')
        else:
            fail += 1
            log(f'  [{i:>3}/{len(targets)}] {cid}  ✗ Spiegeln fehlgeschlagen (Hotlink bleibt)')

    write_cards_data_js(existing)
    log('')
    log(f'✅ Fertig. {ok} lokal gespiegelt, {fail} fehlgeschlagen.')
    return 0


def run_slim_raw(existing):
    """Einmalige Migration: reduziert das raw-Objekt jeder bekannten Karte auf
       die zur Laufzeit genutzten Felder (RAW_KEEP) und spart so ~66% Dateigröße."""
    log('')
    log(f'🪶 Slimme raw-Felder für {len(existing)} Karten (behalte: {", ".join(RAW_KEEP)}) …')
    bak = backup_cards_data_js()
    if bak:
        log(f'   Backup: {bak.name}')
    changed = 0
    for card in existing:
        r = card.get('raw')
        if isinstance(r, dict):
            slim = slim_raw(r)
            if slim != r:
                card['raw'] = slim
                changed += 1
    write_cards_data_js(existing)
    log(f'✅ Fertig. {changed} Karten verschlankt. Lade die App neu.')
    return 0


def fetch_card_with_retry(cardnumber):
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            data = http_get_json(API_CARD + urllib.parse.quote(cardnumber))
            raw = data[0] if isinstance(data, list) and data else data
            if not raw or not raw.get('id'):
                raise RuntimeError('Leere Antwort')
            return map_card(raw), None
        except urllib.error.HTTPError as e:
            if e.code == 429:
                delay = BACKOFF_429[min(attempt - 1, len(BACKOFF_429) - 1)]
                log(f'  ⏸ API-Limit erreicht, warte {delay}s …')
                time.sleep(delay)
            elif 500 <= e.code < 600:
                delay = BACKOFF_5XX[min(attempt - 1, len(BACKOFF_5XX) - 1)]
                log(f'  ⚠ HTTP {e.code}, retry in {delay}s …')
                time.sleep(delay)
            elif attempt == MAX_RETRIES:
                return None, f'HTTP {e.code}'
            else:
                time.sleep(1)
        except Exception as e:
            if attempt == MAX_RETRIES:
                return None, str(e)
            time.sleep(1)
    return None, 'unbekannt'


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--limit', type=int, default=None, help='Max. neue Karten pro Lauf')
    p.add_argument('--delay-ms', type=int, default=DEFAULT_DELAY_MS, help=f'Wartezeit zwischen API-Calls (Default {DEFAULT_DELAY_MS})')
    p.add_argument('--dry-run', action='store_true', help='Nur Diff zeigen, nichts schreiben')
    p.add_argument('--backfill-alts', action='store_true', help='Nur Alt-Arts nachprobieren für Karten mit leerem altImages, kein API-Sync')
    p.add_argument('--no-alt-probe', action='store_true', help='Beim Sync keine Alt-Arts probieren')
    p.add_argument('--slim-raw', action='store_true', help='Nur raw-Felder auf das Noetige reduzieren (einmalige Migration), kein API-Sync')
    p.add_argument('--fix-missing-images', action='store_true', help='Nur Bild-Fallback (digimoncard.dev) für Karten ohne offizielles Bandai-Bild prüfen/ergänzen, kein API-Sync')
    p.add_argument('--mirror-fallbacks', action='store_true', help='Einmalige Migration: bestehende Hotlink-Fallbacks (http…) lokal nach data/reveal-cache/ spiegeln, kein API- und kein digimoncard.dev-Index-Abruf')
    p.add_argument('--set', type=str, default=None, help='Zusammen mit --fix-missing-images: nur dieses Set prüfen (Default: neuestes Set)')
    args = p.parse_args()

    log('🔄 Digimon Collection — Karten-Update')
    log('')

    log('  Lade bekannte Karten aus cards.data.js …')
    existing = load_existing_cards()
    known_ids = {c.get('id') for c in existing if c.get('id')}
    log(f'  → {len(known_ids)} Karten bekannt.')

    # Einmalige Migration: reine Datei-Umschreibung, KEIN Netz-Index-Abruf.
    # Läuft vor sync_reveal_images(), damit digimoncard.dev dabei nicht getroffen
    # wird (nur die schon gespeicherten Bild-URLs werden heruntergeladen).
    if args.mirror_fallbacks:
        return run_mirror_fallbacks(existing)

    # Community-Bilder (digimoncard.dev) für Karten, die noch NICHT einmal bei
    # digimoncard.io gelistet sind, aber schon geleakt/gespoilert wurden —
    # unabhängig vom gewählten Modus, außer bei --dry-run.
    if not args.dry_run:
        sync_reveal_images(existing)

    # Backfill-only Modus: kein API-Sync, nur Alt-Arts probieren.
    if args.backfill_alts:
        return run_backfill_alts(existing, args)

    if args.slim_raw:
        return run_slim_raw(existing)

    if args.fix_missing_images:
        return run_fix_missing_images(existing, args)

    # Bild-Übergangsgrafiken des neuesten Sets bei jedem Sync mitpflegen: neue
    # Karten ohne Bandai-Bild bekommen einen Fallback, bestehende werden
    # aufgefrischt, sobald dev ein besseres (englisches) Bild hat, und gelöst,
    # sobald Bandai nachzieht. Der dev-Index wird dabei nur 1×/Tag getroffen
    # (Tagessperre in fetch_dcd_fallback_map); Karten anderer Sets mit noch
    # offenem Fallback prüfen wir zusätzlich auf ein inzwischen erschienenes
    # Bandai-Bild.
    if not args.dry_run:
        target_set = newest_set(existing)
        newest = [c for c in existing if c.get('set') == target_set]
        newest_ids = {id(c) for c in newest}
        others = [c for c in existing if c.get('imageFallback') and id(c) not in newest_ids]
        candidates = newest + others
        if candidates:
            log(f'  Bild-Fallback-Pflege: Set {target_set!r} ({len(newest)}) + {len(others)} weitere mit offenem Fallback …')
            added, refreshed, resolved = fix_images_for_cards(candidates)
            if added or refreshed or resolved:
                write_cards_data_js(existing)
            log(f'  → {added} ergänzt, {refreshed} aufgefrischt, {resolved} gelöst.')
            log('')

    log('  Lade Index von digimoncard.io …')
    try:
        index = http_get_json(API_INDEX)
    except Exception as e:
        log(f'❌ Index-Fetch fehlgeschlagen: {e}')
        return 1
    if not isinstance(index, list):
        log('❌ Unerwartetes API-Format.')
        return 1
    log(f'  → {len(index)} Karten im Index.')

    new_ids = []
    for entry in index:
        cid = entry.get('cardnumber') or entry.get('id')
        if not cid or cid in known_ids:
            continue
        new_ids.append((cid, entry.get('name', '')))
    new_ids.sort(key=lambda x: x[0])

    log('')
    if not new_ids:
        log('✓ Bereits auf aktuellem Stand. Keine neuen Karten.')
        return 0
    log(f'📥 {len(new_ids)} neue Karten gefunden:')
    for cid, name in new_ids[:10]:
        log(f'   • {cid}  {name}')
    if len(new_ids) > 10:
        log(f'   … und {len(new_ids) - 10} weitere')

    if args.limit:
        new_ids = new_ids[:args.limit]
        log(f'\n  Limit aktiv: nur {len(new_ids)} werden geladen.')

    if args.dry_run:
        log('\n(dry-run — nichts geschrieben)')
        return 0

    bak = backup_cards_data_js()
    if bak:
        log(f'\n  Backup: {bak.name}')

    delay = args.delay_ms / 1000
    log(f'  Tempo: {args.delay_ms}ms zwischen Anfragen.\n')

    fetched = []
    failed = {}
    cards_buffer = list(existing)

    for i, (cid, name) in enumerate(new_ids, 1):
        log(f'  [{i:>3}/{len(new_ids)}] {cid}  {name}')
        card, err = fetch_card_with_retry(cid)
        if card:
            if not args.no_alt_probe:
                alts = probe_alt_arts(cid, verbose=True, prefix='      ')
                if alts:
                    card['altImages'] = alts
                    log(f'      → {len(alts)} Alt-Art(s) übernommen')
            fb_action = apply_image_fallback(card)
            if fb_action == 'added':
                log(f'      → kein Bandai-Bild, Übergangs-Fallback (digimoncard.dev) gesetzt')
            fetched.append(card)
            cards_buffer.append(card)
        else:
            failed[cid] = err
            log(f'      ✗ {err}')

        if i % FLUSH_EVERY == 0:
            write_cards_data_js(cards_buffer)
            log(f'      💾 Zwischenspeicher: {len(fetched)} neue Karten geschrieben.')

        if i < len(new_ids):
            time.sleep(delay)

    write_cards_data_js(cards_buffer)

    log('')
    log(f'✅ Fertig.')
    log(f'   {len(fetched)} Karten hinzugefügt.')
    if failed:
        log(f'   {len(failed)} Fehler:')
        for cid, err in list(failed.items())[:20]:
            log(f'     • {cid} — {err}')
    log('')
    log(f'   Lade die App neu — die Karten sind jetzt drin.')

    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        log('\n\n⏹ Abgebrochen. Zwischenstand ist gespeichert — erneut starten setzt fort.')
        sys.exit(130)
