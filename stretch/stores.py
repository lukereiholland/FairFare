"""Per-store price overlays. Kroger prices live in data/ingredients.csv; another store is a
data/prices_<store>.csv written by price_search.py (id, price_cents, size, product, url, ...).
An ingredient the store file does not price is marked out of stock for that store, never estimated."""
import csv
import os

from .schemas import Ingredient

STORE_NAMES = {"kroger": "Kroger", "walmart": "Walmart", "aldi": "ALDI", "target": "Target", "publix": "Publix"}
DEFAULT_STORE = "kroger"


def _path(store: str) -> str:
    return f"data/prices_{store}.csv"


def load_overlay(store: str) -> dict[str, dict]:
    """id -> {price_cents, product, url} for rows that carry a real price; empty when the file is missing."""
    if store == DEFAULT_STORE or not os.path.exists(_path(store)):
        return {}
    out: dict[str, dict] = {}
    with open(_path(store), encoding="utf-8", newline="") as fh:
        for row in csv.DictReader(fh):
            cents = (row.get("price_cents") or "").strip()
            if not cents.isdigit() or int(cents) <= 0:
                continue
            out[row["id"]] = {"price_cents": int(cents), "product": (row.get("product") or "").strip(),
                              "url": (row.get("url") or "").strip()}
    return out


def available_stores(base: dict[str, Ingredient]) -> list[dict]:
    """The default store plus every store with a price file; `priced` counts ingredients with a real price."""
    stores = [{"id": DEFAULT_STORE, "name": STORE_NAMES[DEFAULT_STORE], "priced": len(base), "total": len(base),
               "source": "kroger.com listings"}]
    for sid, name in STORE_NAMES.items():
        if sid == DEFAULT_STORE or not os.path.exists(_path(sid)):
            continue
        overlay = load_overlay(sid)
        stores.append({"id": sid, "name": name, "priced": len(overlay), "total": len(base),
                       "source": f"{sid}.com listings"})
    return stores


def ingredients_for(base: dict[str, Ingredient], store: str) -> dict[str, Ingredient]:
    """Copy of the ingredient table priced for `store`; unpriced items are out of stock there."""
    if store == DEFAULT_STORE:
        return base
    overlay = load_overlay(store)
    if not overlay:
        return base
    out: dict[str, Ingredient] = {}
    for iid, ing in base.items():
        hit = overlay.get(iid)
        if hit:
            out[iid] = ing.model_copy(update={"price_cents": hit["price_cents"],
                                              "kroger_product": hit["product"] or ing.kroger_product,
                                              "in_stock": True})
        else:
            out[iid] = ing.model_copy(update={"in_stock": False})
    return out
