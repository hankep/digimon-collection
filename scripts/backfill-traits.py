#!/usr/bin/env python3
"""Backfill: Trait-Daten (digi_type1-4) pro Karte aus der digimoncard.io-API
nachziehen und in cards.data.js als 'traits'-Array schreiben.

Idempotent: Karten die bereits ein 'traits'-Feld haben, werden uebersprungen
(es sei denn --force ist gesetzt). Zwischenspeichert alle 100 Karten und kann
mit Ctrl-C abgebrochen werden — beim naechsten Lauf macht der Script da
weiter, wo er aufgehoert hat.

Laufzeit: ca. 0.3s pro Karte, also ~20 min fuer ~4200 Karten.
"""

import json
import re
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path
from datetime import datetime

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
CARDS_DATA_JS = ROOT / 'data' / 'cards.data.js'

API = 'https://digimoncard.io/api-public/search.php?card='
USER_AGENT = 'Mozilla/5.0 (compatible; DigimonCollection-Backfill/1.0)'
REQUEST_TIMEOUT = 10
SLEEP_BETWEEN = 0.4   # 400 ms zwischen Calls — die API rate-limited bei zu hoher Geschwindigkeit.
SAVE_EVERY = 100
MAX_RETRIES = 6
BACKOFF_BASE = 2.0    # exponentiell: 2, 4, 8, 16 s …


def log(msg):
    print(msg, flush=True)


def read_cards():
    text = CARDS_DATA_JS.read_text(encoding='utf-8')
    m = re.match(r'\s*window\.CARDS\s*=\s*', text)
    if not m:
        raise RuntimeError('cards.data.js: erwartetes "window.CARDS = "-Praefix fehlt.')
    json_part = text[m.end():].rstrip().rstrip(';').rstrip()
    return json.loads(json_part)


def write_cards(cards):
    payload = 'window.CARDS = ' + json.dumps(cards, ensure_ascii=False) + ';\n'
    tmp = CARDS_DATA_JS.with_suffix('.js.tmp')
    tmp.write_text(payload, encoding='utf-8')
    tmp.replace(CARDS_DATA_JS)


def backup():
    if not CARDS_DATA_JS.exists():
        return None
    ts = datetime.now().strftime('%Y%m%d-%H%M%S')
    bak = CARDS_DATA_JS.with_name(f'cards.data.js.bak.{ts}')
    bak.write_bytes(CARDS_DATA_JS.read_bytes())
    return bak


def fetch_traits(card_id):
    """Liefert [traits] oder None bei dauerhaftem Fehler. Auf 429 (Rate-Limit)
    wird exponentiell wiederholt, damit kein Eintrag faelschlich leer bleibt."""
    url = API + urllib.request.quote(card_id)
    req = urllib.request.Request(url, headers={'User-Agent': USER_AGENT})
    last_err = None
    for attempt in range(MAX_RETRIES):
        try:
            with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as r:
                data = json.loads(r.read().decode('utf-8'))
            break
        except urllib.error.HTTPError as e:
            last_err = e
            if e.code == 429 and attempt < MAX_RETRIES - 1:
                wait = BACKOFF_BASE ** (attempt + 1)
                log(f'    429 {card_id} → warte {wait:.0f}s (Versuch {attempt+1}/{MAX_RETRIES})')
                time.sleep(wait)
                continue
            log(f'    ERR {card_id}: {e}')
            return None
        except (urllib.error.URLError, json.JSONDecodeError, TimeoutError, ConnectionError, OSError) as e:
            last_err = e
            if attempt < MAX_RETRIES - 1:
                wait = BACKOFF_BASE ** (attempt + 1)
                log(f'    {type(e).__name__} {card_id} → warte {wait:.0f}s (Versuch {attempt+1}/{MAX_RETRIES})')
                time.sleep(wait)
                continue
            log(f'    ERR {card_id}: {e}')
            return None
    else:
        log(f'    GIVE-UP {card_id}: {last_err}')
        return None
    if isinstance(data, list):
        raw = data[0] if data else None
    else:
        raw = data
    if not raw:
        # Karte nicht in API gefunden → leere Liste OK (kein Fehler).
        return []
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


def main():
    force = '--force' in sys.argv
    cards = read_cards()
    log(f'cards.data.js: {len(cards)} Karten geladen.')
    needs_fetch = [c for c in cards if force or 'traits' not in c]
    log(f'Zu holen: {len(needs_fetch)} Karten' + (' (force=alle)' if force else ' (Rest hat schon traits)'))
    if not needs_fetch:
        log('Nichts zu tun.')
        return 0

    bak = backup()
    if bak:
        log(f'Backup: {bak.name}')

    t_start = time.time()
    by_id = {c['id']: c for c in cards if c.get('id')}
    done = 0
    saved_at = 0
    try:
        for i, card in enumerate(needs_fetch, 1):
            cid = card.get('id') or ''
            if not cid:
                continue
            traits = fetch_traits(cid)
            if traits is None:
                # Hard-Fail nach Backoff: Karte nicht setzen, damit der naechste
                # Re-Run sie erneut versucht.
                continue
            by_id[cid]['traits'] = traits
            done += 1
            if i % 25 == 0:
                rate = done / max(0.001, time.time() - t_start)
                eta = (len(needs_fetch) - i) / max(0.001, rate)
                log(f'  [{i:>4}/{len(needs_fetch)}] {cid:<14} traits={traits!r}  rate {rate:.1f}/s  ETA {eta/60:.1f} min')
            if i - saved_at >= SAVE_EVERY:
                write_cards(cards)
                saved_at = i
                log(f'  (Zwischenspeicher nach {i} Karten)')
            time.sleep(SLEEP_BETWEEN)
    except KeyboardInterrupt:
        log('Abgebrochen — schreibe was bisher da ist…')

    write_cards(cards)
    log(f'Fertig: {done} Karten aktualisiert. Backup: {bak.name if bak else "—"}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
