"""Look up one store's online listing price for every ingredient, with a source URL per row.

Same method as the Kroger prices in data/ingredients.csv (search listings, never estimates), run through the
model's web-search tool so it is repeatable per store. Output: data/prices_<store>.csv with the columns
id, price_cents, size, product, url, checked_at, note. Rows the search cannot price are left blank and noted.

Usage: python -m stretch.price_search --store walmart [--workers 3] [--limit N] [--only id ...]
"""
import argparse
import csv
import json
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

from . import llm
from .prices import size_to_grams
from .schemas import Ingredient, load_ingredients

STORES = {
    "walmart": {"name": "Walmart", "domain": "walmart.com"},
    "aldi": {"name": "ALDI", "domain": "aldi.us"},
    "target": {"name": "Target", "domain": "target.com"},
    "publix": {"name": "Publix", "domain": "publix.com"},
}
SIZE_TOLERANCE = 0.25  # same rule as prices.py: accept a listing within 25% of our package size


def _oz(grams: int) -> str:
    return f"{grams / 28.35:.0f} oz"


def _prompt(ing: Ingredient, store: dict, exact_size: bool = False) -> str:
    size_line = (
        f"The package must be about {_oz(ing.package_g)} ({ing.package_g} g); do not report a different size. "
        if exact_size
        else f"Prefer a package size close to {_oz(ing.package_g)} ({ing.package_g} g). "
    )
    return (
        f"Search {store['domain']} for the store-brand or cheapest comparable product matching: "
        f"{ing.name} (sold at Kroger as '{ing.kroger_product}', about {ing.package_g} g per package). "
        f"{size_line}Use only a {store['domain']} product page that shows a price. "
        'Return JSON only, no prose: {"found": true|false, "product": "exact product name", '
        '"price_dollars": number, "size": "as printed, e.g. 32 oz or 12 ct", "url": "https://..."}. '
        "If no product page with a price is found, return {\"found\": false}."
    )


def _parse(text: str) -> dict | None:
    m = re.search(r"\{.*\}", text or "", re.S)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except json.JSONDecodeError:
        return None


def lookup(ing: Ingredient, store: dict, exact_size: bool = False) -> dict:
    """One ingredient at one store; never invents: an unusable answer becomes a blank row with a note.
    A size mismatch triggers one retry that insists on our package size."""
    row = {"id": ing.id, "price_cents": "", "size": "", "product": "", "url": "",
           "checked_at": datetime.now(timezone.utc).isoformat(timespec="minutes"), "note": ""}
    try:
        text = llm.web_lookup(_prompt(ing, store, exact_size))
    except Exception as exc:
        row["note"] = f"lookup failed: {str(exc)[:80]}"
        return row
    data = _parse(text)
    if not data or not data.get("found"):
        row["note"] = "not found"
        return row
    try:
        cents = round(float(data.get("price_dollars", 0)) * 100)
    except (TypeError, ValueError):
        row["note"] = "price unreadable"
        return row
    url = str(data.get("url", "")).strip()
    if cents <= 0 or store["domain"] not in url:
        row["note"] = "no usable product page"
        return row
    size = str(data.get("size", "")).strip()
    grams = size_to_grams(size) if size else None
    if grams is not None and abs(grams - ing.package_g) > SIZE_TOLERANCE * ing.package_g:
        if not exact_size:
            return lookup(ing, store, exact_size=True)
        row.update(size=size, product=str(data.get("product", "")), url=url,
                   note=f"size mismatch: listing {grams} g vs ours {ing.package_g} g; price {cents} not used")
        return row
    row.update(price_cents=cents, size=size, product=str(data.get("product", "")).strip(), url=url,
               note="" if grams is not None else "size not parsed; accepted on product match")
    return row


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--store", required=True, choices=sorted(STORES))
    ap.add_argument("--workers", type=int, default=3)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--only", nargs="*")
    ap.add_argument("--retry-failed", action="store_true",
                    help="re-look-up only the rows of the existing file that have no price; keep the rest")
    args = ap.parse_args()
    store = STORES[args.store]

    all_ingredients = list(load_ingredients("data/ingredients.csv").values())
    ingredients = list(all_ingredients)
    out_path = f"data/prices_{args.store}.csv"
    rows: dict[str, dict] = {}
    if args.retry_failed and os.path.exists(out_path):
        with open(out_path, encoding="utf-8", newline="") as fh:
            rows = {r["id"]: r for r in csv.DictReader(fh)}
        ingredients = [i for i in ingredients if not (rows.get(i.id, {}).get("price_cents") or "").strip()]
    if args.only:
        wanted = set(args.only)
        ingredients = [i for i in ingredients if i.id in wanted]
    if args.limit:
        ingredients = ingredients[: args.limit]
    print(f"price_search: {len(ingredients)} items at {store['name']} -> {out_path}", flush=True)
    started = time.time()
    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futures = {ex.submit(lookup, ing, store): ing.id for ing in ingredients}
        for fut in as_completed(futures):
            row = fut.result()
            rows[row["id"]] = row
            status = f"${int(row['price_cents']) / 100:.2f} {row['size']}" if row["price_cents"] != "" else row["note"]
            print(f"price_search: {row['id']}: {status}", flush=True)

    fields = ["id", "price_cents", "size", "product", "url", "checked_at", "note"]
    with open(out_path, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=fields)
        w.writeheader()
        for ing in all_ingredients if (args.retry_failed or not (args.only or args.limit)) else ingredients:
            w.writerow({k: rows.get(ing.id, {"id": ing.id, "note": "not attempted"}).get(k, "") for k in fields})
    priced = sum(1 for r in rows.values() if (r.get("price_cents") or "") != "")
    print(f"price_search: done in {int(time.time() - started)}s: {priced}/{len(all_ingredients)} priced overall", flush=True)


if __name__ == "__main__":
    main()
