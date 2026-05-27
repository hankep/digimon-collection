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
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path

API_INDEX = 'https://digimoncard.io/api-public/getAllCards.php?series=Digimon%20Card%20Game&sort=name'
API_CARD = 'https://digimoncard.io/api-public/search.php?card='
IMG_BASE = 'https://world.digimoncard.com/images/cardlist/card/'

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


def log(msg):
    print(msg, flush=True)


def http_get_json(url, timeout=30):
    req = urllib.request.Request(url, headers={'User-Agent': 'digimon-collection-sync/1.0'})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        data = resp.read()
    return json.loads(data.decode('utf-8'))


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
    args = p.parse_args()

    log('🔄 Digimon Collection — Karten-Update')
    log('')

    log('  Lade bekannte Karten aus cards.data.js …')
    existing = load_existing_cards()
    known_ids = {c.get('id') for c in existing if c.get('id')}
    log(f'  → {len(known_ids)} Karten bekannt.')

    # Backfill-only Modus: kein API-Sync, nur Alt-Arts probieren.
    if args.backfill_alts:
        return run_backfill_alts(existing, args)

    if args.slim_raw:
        return run_slim_raw(existing)

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
