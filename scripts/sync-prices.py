#!/usr/bin/env python3
"""Baut prices.data.js aus den lokalen Cardmarket-JSONs.

Erwartet im Projekt-Root:
  - products_singles_17.json   (Produktnamen + idProduct)
  - price_guide_17.json        (Preise pro idProduct)

Schreibt:
  - prices.data.js mit window.CM_PRICES = { "<cardId>": {low,avg,trend,prints}, ... }
    und window.CM_PRICES_UPDATED_AT = "<ISO timestamp aus price_guide>".

Aggregation: mehrere CM-Produkte pro Card-ID werden zu min(low), min(avg),
min(trend) zusammengefasst, prints = Anzahl der gefundenen Produkte.

Usage:
  python3 scripts/sync-prices.py
"""

import json
import re
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
PRODUCTS_JSON = PROJECT_ROOT / 'products_singles_17.json'
PRICES_JSON = PROJECT_ROOT / 'price_guide_17.json'
DATA_DIR = PROJECT_ROOT / 'data'
DATA_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_JS = DATA_DIR / 'prices.data.js'

CARD_ID_RE = re.compile(r'[A-Z]+\d*-\d+[A-Z]?')


def log(msg):
    print(msg, flush=True)


def load_json(path):
    if not path.exists():
        log(f'FEHLER: {path.name} nicht im Projekt-Root gefunden.')
        sys.exit(1)
    with path.open('r', encoding='utf-8') as f:
        return json.load(f)


def main():
    products = load_json(PRODUCTS_JSON)
    prices = load_json(PRICES_JSON)

    products_list = products.get('products', [])
    prices_list = prices.get('priceGuides', [])
    updated_at = prices.get('createdAt') or products.get('createdAt') or ''

    log(f'Produkte: {len(products_list)}')
    log(f'Preis-Einträge: {len(prices_list)}')

    # idProduct -> price-dict
    price_by_id = {p['idProduct']: p for p in prices_list}

    # cardId -> aggregator {low, avg, trend, prints}
    agg = {}

    skipped_no_id = 0
    skipped_no_price = 0

    for prod in products_list:
        name = prod.get('name', '')
        m = CARD_ID_RE.search(name)
        if not m:
            skipped_no_id += 1
            continue
        card_id = m.group(0)
        p = price_by_id.get(prod['idProduct'])
        if not p:
            skipped_no_price += 1
            continue

        low = p.get('low')
        avg = p.get('avg')
        trend = p.get('trend')

        slot = agg.setdefault(card_id, {'low': None, 'avg': None, 'trend': None, 'prints': 0})
        slot['prints'] += 1
        if isinstance(low, (int, float)) and low > 0:
            slot['low'] = low if slot['low'] is None else min(slot['low'], low)
        if isinstance(avg, (int, float)) and avg > 0:
            slot['avg'] = avg if slot['avg'] is None else min(slot['avg'], avg)
        if isinstance(trend, (int, float)) and trend > 0:
            slot['trend'] = trend if slot['trend'] is None else min(slot['trend'], trend)

    log(f'Card-IDs mit Preisen: {len(agg)}')
    log(f'Produkte ohne erkennbare Card-ID übersprungen: {skipped_no_id}')
    log(f'Produkte ohne Preis-Eintrag übersprungen: {skipped_no_price}')

    # Sort keys for stable output
    out = {k: agg[k] for k in sorted(agg.keys())}

    payload = (
        '// Auto-generiert von scripts/sync-prices.py — nicht von Hand editieren.\n'
        f'window.CM_PRICES_UPDATED_AT = {json.dumps(updated_at)};\n'
        f'window.CM_PRICES = {json.dumps(out, ensure_ascii=False, separators=(",", ":"))};\n'
    )
    OUTPUT_JS.write_text(payload, encoding='utf-8')
    log(f'Geschrieben: {OUTPUT_JS.name} ({OUTPUT_JS.stat().st_size // 1024} KB)')
    log(f'CM-Daten-Timestamp: {updated_at}')


if __name__ == '__main__':
    main()
