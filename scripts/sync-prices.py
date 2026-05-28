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
PRODUCTS_NONSINGLES_JSON = PROJECT_ROOT / 'products_nonsingles_17.json'
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


def derive_label_from_nonsingles_name(name):
    """Aus einem Booster/Box/Promo-Pack-Produktnamen ein kurzes Set-Label ableiten.
       Wird verwendet, wenn unsere set_name-Heuristik keinen bekannten setCode findet
       (z.B. fuer Regionals/Event-Packs/Limited Card Packs)."""
    if not name:
        return None
    # 1) Code in Klammern: "(PB-01)", "(P-180)", "(LM-04)"
    m = re.search(r'\(([A-Z]+\d*-?\d+[A-Z]?)\)', name)
    if m:
        return m.group(1).replace('-', '')
    # 2) Regionals YYYY
    m = re.search(r'(\d{4})\s+Regionals', name)
    if m:
        return f'Reg {m.group(1)}'
    # 3) Event Pack N
    m = re.search(r'Event Pack\s*(\d+)', name, re.I)
    if m:
        return f'EP{m.group(1)}'
    # 4) Pre-Release Pack
    if re.search(r'Pre-?Release', name, re.I):
        return 'Pre-Rls'
    # 5) Championship YYYY
    if 'Championship' in name:
        m = re.search(r'(\d{4})', name)
        return f'Champ {m.group(1)}' if m else 'Champ'
    # 6) Limited Card Pack <Name>
    m = re.search(r'Limited Card Pack ([\w]+)', name, re.I)
    if m:
        return f'LM:{m.group(1)[:8]}'
    # 7) Tamer's / Premium / generischer Booster
    cleaned = re.sub(r'\([^)]*\)', '', name).strip()
    cleaned = re.sub(r'\s*(Booster Box|Booster|Card Set|Set)\s*$', '', cleaned, flags=re.I).strip()
    cleaned = re.sub(r'^[A-Z]+-?\d+:\s*', '', cleaned)  # "BT-25: Foo" -> "Foo"
    words = cleaned.split()
    if not words:
        return None
    label = ' '.join(words[:2])
    return label[:14] if label else None


def build_exp_to_label(exp_to_set, ns_products):
    """Baut die volle idExpansion -> Label-Mappung. Wenn ein echter setCode aus
       set_name vorhanden ist, nutzt diesen; sonst leitet ein Label aus dem
       ersten Nonsingles-Produkt der idExpansion ab. So bekommt JEDE Variante
       ein erkennbares Set-Badge — auch Promo-/Regionals-/Pre-Release-Sets."""
    ns_by_exp = defaultdict(list)
    for p in ns_products:
        ns_by_exp[p['idExpansion']].append(p)
    labels = dict(exp_to_set)  # echte setCodes haben Vorrang
    for exp_id, prods in ns_by_exp.items():
        if exp_id in labels:
            continue
        sample = sorted(prods, key=lambda p: p['idProduct'])[0]
        lbl = derive_label_from_nonsingles_name(sample.get('name', ''))
        if lbl:
            labels[exp_id] = lbl
    return labels


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
    nonsingles_data = json.loads(PRODUCTS_NONSINGLES_JSON.read_text(encoding='utf-8')) if PRODUCTS_NONSINGLES_JSON.exists() else {'products': []}
    nonsingles_list = nonsingles_data.get('products', [])

    products_list = products.get('products', [])
    prices_list = prices.get('priceGuides', [])
    updated_at = prices.get('createdAt') or products.get('createdAt') or ''

    log(f'Produkte: {len(products_list)}')
    log(f'Nonsingles-Produkte: {len(nonsingles_list)}')
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
    exp_to_label = build_exp_to_label(exp_to_set, nonsingles_list)
    log(f'idExpansion -> Label (inkl. Fallback aus Nonsingles): {len(exp_to_label)} Sets erkannt')

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

    # Per-Variant-Zuordnung. Eine App-"Variante" ist ein Art-Style (Main / _P1 …),
    # ein Cardmarket-Produkt ist ein (Art-Style x Set)-Tupel: BT16-025 Main existiert
    # physisch zweimal — einmal als BT16-Druck, einmal als AD1-Reprint. Beide haben
    # in CM denselben Produktnamen, unterscheiden sich nur in idExpansion.
    #
    # Algorithmus (per Card):
    #   1) CM-Produkte nach idExpansion gruppieren.
    #   2) Pro idExpansion-Gruppe: nach idProduct sortieren, positional gegen die
    #      App-Variants matchen (Main, _P1, _P2, ...). Damit ist die positional-
    #      Heuristik auf eine sinnvolle Achse beschraenkt: innerhalb desselben
    #      Sets ist die idProduct-Reihenfolge stabil und folgt typischerweise
    #      dem Erscheinen Main -> Alt-Art_1 -> Alt-Art_2.
    #   3) Treffer landen in byVariant[key].bySet[setCode] = {low, avg, trend}.
    #   4) Default-Felder am byVariant-Slot (low/avg/trend/set) zeigen das
    #      Origin-Set, sofern dort gedruckt; sonst das guenstigste verfuegbare
    #      Set. So bleiben bestehende Frontend-Konsumenten (CM.getForVariant
    #      ohne setCode) weiterhin lesbar.
    #
    # Edge-Cases:
    #   - idExp-Gruppe hat mehr Produkte als die Card Variants -> ueberzaehlige
    #     idProducts werden ignoriert (kein byVariant-Eintrag). Top-Level-Aggregat
    #     enthaelt sie weiterhin (s.o.).
    #   - idExpansion ohne erkennbares Set/Label -> wird uebersprungen.
    variant_with_byset = 0
    variant_no_prods = 0
    overfill_groups = 0
    for card_id, card in cards_by_id.items():
        slot = agg.get(card_id)
        if not slot:
            continue
        prods = products_by_cardid.get(card_id, [])
        variants = variant_keys_of(card)
        if not variants or not prods:
            variant_no_prods += 1
            continue

        # Gruppieren nach idExpansion
        prods_by_exp = defaultdict(list)
        for prod in prods:
            prods_by_exp[prod.get('idExpansion')].append(prod)

        for id_exp, ps in prods_by_exp.items():
            set_code = exp_to_set.get(id_exp) or exp_to_label.get(id_exp)
            if not set_code:
                continue
            ps_sorted = sorted(ps, key=lambda p: p['idProduct'])
            if len(ps_sorted) > len(variants):
                overfill_groups += 1
            # Positional INNERHALB der idExpansion-Gruppe matchen: CM-V.1 -> Main,
            # CM-V.2 -> _P1, ... Cardmarket vergibt V.X in der Reihenfolge, in der
            # die Drucke in der Datenbank angelegt wurden (= aufsteigendes
            # idProduct). Das entspricht in der Regel der App-altImages-Reihenfolge
            # (Main, _P1, _P2, ...).
            #
            # Edge-Case: CM hat weniger Drucke in dem Set als die App Variants
            # kennt (z.B. CM listet nur Main + V.2, weil V.3/V.4 nicht angelegt
            # wurden). Dann werden die "fehlenden" App-Variants in diesem Set
            # einfach keinen Preis bekommen — kein falscher Wert wird zugewiesen.
            for variant_key, prod in zip(variants, ps_sorted):
                price = price_by_id.get(prod['idProduct'])
                if not price:
                    continue
                v_slot = slot['byVariant'].setdefault(variant_key, {'bySet': {}})
                if 'bySet' not in v_slot:
                    v_slot['bySet'] = {}
                bs = v_slot['bySet'].setdefault(set_code, {'low': None, 'avg': None, 'trend': None})
                update_slot(bs, price.get('low'), price.get('avg'), price.get('trend'), count_print=False)

        # Default-Eintrag pro Variant: bevorzugt Origin-Set, sonst guenstigster Set.
        origin = card.get('set')
        for variant_key, v_slot in list(slot['byVariant'].items()):
            by_set = v_slot.get('bySet') or {}
            if not by_set:
                # Kein Set-Treffer ueberlebt -> Slot wegwerfen (vermeidet leere Entries).
                del slot['byVariant'][variant_key]
                continue
            chosen_set = None
            if origin and origin in by_set:
                chosen_set = origin
            else:
                # Guenstigster low; None ist Tiefstpreis-untauglich, daher hinten.
                chosen_set = min(
                    by_set.keys(),
                    key=lambda c: (by_set[c]['low'] is None, by_set[c]['low'] or 0)
                )
            chosen = by_set[chosen_set]
            v_slot['low'] = chosen['low']
            v_slot['avg'] = chosen['avg']
            v_slot['trend'] = chosen['trend']
            v_slot['set'] = chosen_set
            variant_with_byset += 1

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
    log(f'  Variants mit bySet-Eintrag: {variant_with_byset}; Karten ohne CM-Produkte: {variant_no_prods}; idExp-Gruppen mit mehr Produkten als Variants: {overfill_groups}')
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
