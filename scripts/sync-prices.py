#!/usr/bin/env python3
"""Baut prices.data.js aus den lokalen Cardmarket-JSONs.

Erwartet im Projekt-Root:
  - products_singles_17.json   (Produktnamen + idProduct + idExpansion)
  - price_guide_17.json        (Preise pro idProduct)

Schreibt:
  - prices.data.js mit window.CM_PRICES = { "<cardId>": {low,avg,trend,prints,bySet}, ... }
    und window.CM_PRICES_UPDATED_AT = "<ISO timestamp aus price_guide>".

Aggregation:
  - Top-Level: mehrere CM-Produkte pro Card-ID werden zu min(low/avg/trend)
    zusammengefasst, prints = Anzahl der gefundenen Produkte.
  - bySet: zusaetzlich pro Reprint-Set min(low/avg/trend). Mapping
    idExpansion -> setCode per Heuristik (siehe infer_expansion_to_set).

Usage:
  python3 scripts/sync-prices.py
"""

import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
PRODUCTS_JSON = PROJECT_ROOT / 'products_singles_17.json'
PRICES_JSON = PROJECT_ROOT / 'price_guide_17.json'
DATA_DIR = PROJECT_ROOT / 'data'
DATA_DIR.mkdir(parents=True, exist_ok=True)
OUTPUT_JS = DATA_DIR / 'prices.data.js'
CARDS_DATA_JS = DATA_DIR / 'cards.data.js'

CARD_ID_RE = re.compile(r'[A-Z]+\d*-\d+[A-Z]?')

# Mindest-Trefferquote, ab der eine idExpansion einem Set-Code zugeordnet wird.
# Origin-Sets erreichen 100% (alle Karten enthalten den eigenen Set-Code in
# raw.set_name). Reprint-Sets ebenfalls (alle ihre Karten haben das Reprint-Set
# in raw.set_name). Karten ohne raw.set_name werden ignoriert.
EXP_MATCH_THRESHOLD = 0.8


def log(msg):
    print(msg, flush=True)


def load_json(path):
    if not path.exists():
        log(f'FEHLER: {path.name} nicht im Projekt-Root gefunden.')
        sys.exit(1)
    with path.open('r', encoding='utf-8') as f:
        return json.load(f)


def load_cards_data_js():
    """Parst data/cards.data.js (Format: 'window.CARDS = [...];') und gibt die
       Card-Liste zurueck. Kein optionales Argument, da wir die Mapping zwingend
       brauchen fuer die Per-Set-Aggregation."""
    if not CARDS_DATA_JS.exists():
        log(f'FEHLER: {CARDS_DATA_JS} nicht gefunden.')
        sys.exit(1)
    text = CARDS_DATA_JS.read_text(encoding='utf-8')
    m = re.match(r'^\s*window\.CARDS\s*=\s*', text)
    if not m:
        log('FEHLER: cards.data.js hat kein erwartetes "window.CARDS = "-Praefix.')
        sys.exit(1)
    json_part = text[m.end():].rstrip().rstrip(';').rstrip()
    return json.loads(json_part)


def set_name_to_code(product_str, known_set_codes):
    """Spiegelt CardDB.setNameToCode aus js/cards.js. Liefert den normalisierten
       Set-Code (z.B. 'AD1' fuer 'AD-01: ...'), wenn das Set in cards.data.js
       existiert."""
    head = str(product_str or '').split(':')[0].strip()
    m = re.match(r'^([A-Za-z]+)-?0*(\d+)$', head)
    if not m:
        return None
    code = m.group(1) + m.group(2)
    return code if code in known_set_codes else None


def infer_expansion_to_set(products_list, cards_by_id, known_set_codes):
    """Bestimmt fuer jede idExpansion den zugehoerigen setCode per Heuristik:
       Pro idExpansion zaehlen wir die Set-Codes aus raw.set_name aller
       enthaltenen Karten. Der haeufigste Code mit Treffer-Quote >= Schwellwert
       gewinnt. Origin- und Reprint-Sets erreichen typischerweise 100%."""
    exp_to_cards = defaultdict(list)
    for prod in products_list:
        name = prod.get('name', '')
        m = CARD_ID_RE.search(name)
        if not m:
            continue
        card_id = m.group(0)
        card = cards_by_id.get(card_id)
        if not card:
            continue
        exp_to_cards[prod['idExpansion']].append(card)

    mapping = {}
    for exp_id, cards in exp_to_cards.items():
        counter = Counter()
        for card in cards:
            raw = card.get('raw') or {}
            set_names = raw.get('set_name') or []
            seen_in_card = set()
            for sn in set_names:
                code = set_name_to_code(sn, known_set_codes)
                if code and code not in seen_in_card:
                    counter[code] += 1
                    seen_in_card.add(code)
        if not counter:
            continue
        most_code, hits = counter.most_common(1)[0]
        if hits >= EXP_MATCH_THRESHOLD * len(cards):
            mapping[exp_id] = most_code
    return mapping


def variant_keys_of(card):
    """Liefert die Variant-Keys einer Karte (Main zuerst, dann _P1, _P2, ...),
       analog zu CardDB.variantsOf in der Web-App."""
    keys = []
    img = card.get('image') or ''
    if img:
        keys.append(img.rsplit('.', 1)[0])
    for alt in card.get('altImages') or []:
        keys.append(alt.rsplit('.', 1)[0])
    return keys


def main():
    products = load_json(PRODUCTS_JSON)
    prices = load_json(PRICES_JSON)
    cards = load_cards_data_js()

    products_list = products.get('products', [])
    prices_list = prices.get('priceGuides', [])
    updated_at = prices.get('createdAt') or products.get('createdAt') or ''

    log(f'Produkte: {len(products_list)}')
    log(f'Preis-Eintraege: {len(prices_list)}')
    log(f'Karten in cards.data.js: {len(cards)}')

    cards_by_id = {c.get('id'): c for c in cards if c.get('id')}
    known_set_codes = set()
    for c in cards:
        if c.get('set'):
            known_set_codes.add(c['set'])
    log(f'Bekannte Set-Codes: {len(known_set_codes)}')

    exp_to_set = infer_expansion_to_set(products_list, cards_by_id, known_set_codes)
    log(f'idExpansion -> setCode Mapping: {len(exp_to_set)} Sets erkannt')

    # idProduct -> price-dict
    price_by_id = {p['idProduct']: p for p in prices_list}

    # Pro Card-ID: alle Produkte sammeln, damit wir am Ende byVariant zuordnen koennen.
    products_by_cardid = defaultdict(list)
    for prod in products_list:
        m = CARD_ID_RE.search(prod.get('name', ''))
        if not m:
            continue
        products_by_cardid[m.group(0)].append(prod)

    # cardId -> aggregator
    #   { low, avg, trend, prints, bySet: { setCode: {low, avg, trend} },
    #     byVariant: { variantKey: {low, avg, trend} } }
    agg = {}

    skipped_no_id = 0
    skipped_no_price = 0

    def update_slot(slot, low, avg, trend, count_print=True):
        if count_print:
            slot['prints'] = slot.get('prints', 0) + 1
        if isinstance(low, (int, float)) and low > 0:
            slot['low'] = low if slot.get('low') is None else min(slot['low'], low)
        if isinstance(avg, (int, float)) and avg > 0:
            slot['avg'] = avg if slot.get('avg') is None else min(slot['avg'], avg)
        if isinstance(trend, (int, float)) and trend > 0:
            slot['trend'] = trend if slot.get('trend') is None else min(slot['trend'], trend)

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

        slot = agg.setdefault(card_id, {'low': None, 'avg': None, 'trend': None, 'prints': 0, 'bySet': {}, 'byVariant': {}})
        update_slot(slot, low, avg, trend, count_print=True)

        set_code = exp_to_set.get(prod.get('idExpansion'))
        if set_code:
            by_set_slot = slot['bySet'].setdefault(set_code, {'low': None, 'avg': None, 'trend': None})
            update_slot(by_set_slot, low, avg, trend, count_print=False)

    # Per-Variant-Zuordnung (Main / _P1 / _P2 …). Heuristik: sortiere Cardmarket-
    # Produkte einer Card-ID asc nach idProduct (chronologisch von Cardmarket
    # angelegt) und matche positional gegen die App-Variants (Main zuerst, dann
    # Alt-Arts in altImages-Reihenfolge).
    #   - len(prods) == len(variants) → ideale Zuordnung (z.B. AD1-016: 3=3).
    #   - len(prods) < len(variants)  → erste N Variants kriegen einen CM-Preis,
    #                                    Rest faellt auf Top-Level-Low zurueck.
    #   - len(prods) > len(variants)  → ueberzaehlige idProducts werden nur fuer
    #                                    Top-Level-Aggregat genutzt, kein
    #                                    byVariant-Eintrag fuer sie.
    # Annahme ist nicht perfekt (Cardmarket-Reihenfolge muss nicht der digimoncard.io-
    # Reihenfolge entsprechen), aber besser als "alle Variants zeigen denselben
    # Aggregat-Low".
    variant_exact = 0
    variant_partial = 0
    variant_none = 0
    for card_id, card in cards_by_id.items():
        slot = agg.get(card_id)
        if not slot:
            continue
        prods = products_by_cardid.get(card_id, [])
        variants = variant_keys_of(card)
        if not variants or not prods:
            variant_none += 1
            continue
        prods_sorted = sorted(prods, key=lambda p: p['idProduct'])
        for variant_key, prod in zip(variants, prods_sorted):
            p = price_by_id.get(prod['idProduct'])
            if not p:
                continue
            vs = {'low': None, 'avg': None, 'trend': None}
            update_slot(vs, p.get('low'), p.get('avg'), p.get('trend'), count_print=False)
            # SetCode zum CM-Produkt mitspeichern, damit der Detail-Modal pro
            # Variant zeigen kann, aus welchem Set sie laut Heuristik kommt.
            set_code = exp_to_set.get(prod.get('idExpansion'))
            if set_code:
                vs['set'] = set_code
            slot['byVariant'][variant_key] = vs
        if len(prods) == len(variants):
            variant_exact += 1
        else:
            variant_partial += 1

    # Leere bySet/byVariant-Objekte herausnehmen, damit JSON kompakt bleibt.
    for slot in agg.values():
        if not slot['bySet']:
            del slot['bySet']
        if not slot['byVariant']:
            del slot['byVariant']

    log(f'Card-IDs mit Preisen: {len(agg)}')
    cards_with_byset = sum(1 for v in agg.values() if 'bySet' in v)
    cards_with_byvariant = sum(1 for v in agg.values() if 'byVariant' in v)
    log(f'Card-IDs mit Per-Set-Preis (bySet): {cards_with_byset}')
    log(f'Card-IDs mit Per-Variant-Preis (byVariant): {cards_with_byvariant}')
    log(f'  exakter Match (CM=App): {variant_exact}; partial Match (CM!=App, positional): {variant_partial}; kein CM/Variant: {variant_none}')
    log(f'Produkte ohne erkennbare Card-ID uebersprungen: {skipped_no_id}')
    log(f'Produkte ohne Preis-Eintrag uebersprungen: {skipped_no_price}')

    # Sort keys for stable output
    out = {k: agg[k] for k in sorted(agg.keys())}

    payload = (
        '// Auto-generiert von scripts/sync-prices.py - nicht von Hand editieren.\n'
        f'window.CM_PRICES_UPDATED_AT = {json.dumps(updated_at)};\n'
        f'window.CM_PRICES = {json.dumps(out, ensure_ascii=False, separators=(",", ":"))};\n'
    )
    OUTPUT_JS.write_text(payload, encoding='utf-8')
    log(f'Geschrieben: {OUTPUT_JS.name} ({OUTPUT_JS.stat().st_size // 1024} KB)')
    log(f'CM-Daten-Timestamp: {updated_at}')


if __name__ == '__main__':
    main()
