import base64
import json
import os
import re
import time
from datetime import datetime, timedelta, timezone

import requests
from dotenv import load_dotenv

from .schemas import Ingredient, Store

load_dotenv()

API = "https://api.kroger.com/v1"
CACHE_PATH = "data/prices_cache.json"
CACHE_MAX_AGE_H = 6
SIZE_TOLERANCE = 0.25

_token: dict = {"value": None, "expires_at": 0.0}

_UNIT_G = {
    "fl oz": 29.5735, "oz": 28.3495, "ounce": 28.3495, "ounces": 28.3495,
    "lb": 453.592, "lbs": 453.592, "pound": 453.592, "pounds": 453.592,
    "g": 1.0, "gram": 1.0, "grams": 1.0, "kg": 1000.0,
    "ml": 1.0, "l": 1000.0, "liter": 1000.0, "litre": 1000.0,
    "gal": 3785.41, "gallon": 3785.41, "qt": 946.353, "quart": 946.353,
    "pt": 473.176, "pint": 473.176,
}
_UNITS = "|".join(sorted(_UNIT_G, key=len, reverse=True))


def get_token() -> str:
    """Client-credentials token for product.compact, cached in memory until it expires."""
    if _token["value"] and time.time() < _token["expires_at"] - 60:
        return _token["value"]
    cid = os.getenv("KROGER_CLIENT_ID", "")
    secret = os.getenv("KROGER_CLIENT_SECRET", "")
    if not cid or not secret:
        raise RuntimeError("KROGER_CLIENT_ID / KROGER_CLIENT_SECRET are not set in .env")
    basic = base64.b64encode(f"{cid}:{secret}".encode()).decode()
    r = requests.post(
        f"{API}/connect/oauth2/token",
        headers={"Authorization": f"Basic {basic}",
                 "Content-Type": "application/x-www-form-urlencoded"},
        data={"grant_type": "client_credentials", "scope": "product.compact"},
        timeout=20,
    )
    r.raise_for_status()
    body = r.json()
    _token["value"] = body["access_token"]
    _token["expires_at"] = time.time() + int(body.get("expires_in", 1800))
    return _token["value"]


def _get(path: str, params: dict) -> dict:
    r = requests.get(f"{API}{path}", params=params, timeout=20,
                     headers={"Authorization": f"Bearer {get_token()}", "Accept": "application/json"})
    r.raise_for_status()
    return r.json()


def _to_store(d: dict) -> Store:
    addr = d.get("address") or {}
    parts = [addr.get("addressLine1"), addr.get("city"), addr.get("state"), addr.get("zipCode")]
    return Store(location_id=str(d.get("locationId", "")), name=d.get("name", ""),
                 address=", ".join(p for p in parts if p),
                 distance_miles=float(d.get("distance") or 0.0))


def nearby_stores(zip_code: str, radius_miles: int = 10, limit: int = 5) -> list[Store]:
    """Kroger locations near a zip code."""
    data = _get("/locations", {"filter.zipCode.near": zip_code,
                               "filter.radiusInMiles": radius_miles,
                               "filter.limit": limit}).get("data", [])
    return [_to_store(d) for d in data]


def size_candidates_g(size: str) -> list[int]:
    """Gram readings of a size string; '12 ct / 3 oz' may mean per pack or total, so both are returned."""
    s = (size or "").lower().replace("fluid ounce", "fl oz").replace("fl. oz", "fl oz")
    m = re.search(rf"(\d+(?:\.\d+)?)\s*(?:x|×)\s*(\d+(?:\.\d+)?)\s*({_UNITS})\b", s)
    if m:
        return [round(float(m.group(1)) * float(m.group(2)) * _UNIT_G[m.group(3)])]
    m = re.search(rf"(\d+(?:\.\d+)?)\s*(?:ct|count|pk|pack)\s*/\s*(\d+(?:\.\d+)?)\s*({_UNITS})\b", s)
    if m:
        each = float(m.group(2)) * _UNIT_G[m.group(3)]
        return [round(each), round(float(m.group(1)) * each)]
    m = re.search(rf"(\d+(?:\.\d+)?)\s*({_UNITS})\b", s)
    if m:
        return [round(float(m.group(1)) * _UNIT_G[m.group(2)])]
    return []


def size_to_grams(size: str) -> int | None:
    """Unambiguous gram reading of a size string; None when count-only or ambiguous."""
    candidates = size_candidates_g(size)
    return candidates[0] if len(candidates) == 1 else None


def size_matches(size: str, ing: Ingredient) -> bool:
    """True when an API item's size is within tolerance of the CSV package (or the same count)."""
    candidates = size_candidates_g(size)
    if candidates:
        return any(abs(g - ing.package_g) <= SIZE_TOLERANCE * ing.package_g for g in candidates)
    s = (size or "").lower()
    m = re.search(r"(\d+)\s*(?:ct|count|pk|pack|each)\b", s)
    if m:
        if m.group(1) == "1" and not re.search(r"\d", ing.kroger_product):
            return True  # loose produce sold by the piece
        return re.search(rf"\b{m.group(1)}\s*(?:ct|count|pk|pack)\b", ing.kroger_product.lower()) is not None
    if s.strip() in ("each", "ea"):
        return not re.search(r"\d", ing.kroger_product)
    return False


def _load_cache(location_id: str) -> dict | None:
    if not os.path.exists(CACHE_PATH):
        return None
    with open(CACHE_PATH, encoding="utf-8") as fh:
        entry = (json.load(fh) or {}).get(location_id)
    if not entry:
        return None
    fetched = datetime.fromisoformat(entry["fetched_at"])
    if datetime.now(timezone.utc) - fetched > timedelta(hours=CACHE_MAX_AGE_H):
        return None
    return entry


def _save_cache(location_id: str, entry: dict) -> None:
    os.makedirs(os.path.dirname(CACHE_PATH) or ".", exist_ok=True)
    existing = {}
    if os.path.exists(CACHE_PATH):
        with open(CACHE_PATH, encoding="utf-8") as fh:
            existing = json.load(fh) or {}
    existing[location_id] = entry
    with open(CACHE_PATH, "w", encoding="utf-8") as fh:
        json.dump(existing, fh, indent=1)


def _apply(ingredients: dict[str, Ingredient], prices: dict) -> dict[str, Ingredient]:
    out = {}
    for iid, ing in ingredients.items():
        p = prices.get(iid)
        if p:
            out[iid] = ing.model_copy(update={"price_cents": p["price_cents"], "price_source": "api",
                                              "in_stock": p.get("in_stock", True)})
        else:
            out[iid] = ing.model_copy(update={"price_source": "csv"})
    return out


def refresh_prices(ingredients: dict[str, Ingredient],
                   location_id: str) -> tuple[dict[str, Ingredient], dict]:
    """Overlay live store prices onto the CSV ingredients; on any failure return them unchanged."""
    try:
        cached = _load_cache(location_id)
        if cached:
            prices = cached["prices"]
            updated = _apply(ingredients, prices)
            return updated, {"updated": len(prices), "kept_csv": len(ingredients) - len(prices),
                             "out_of_stock": [i for i, p in prices.items() if not p.get("in_stock", True)],
                             "fetched_at": cached["fetched_at"], "store": cached.get("store"),
                             "matches": prices, "from_cache": True}

        prices: dict[str, dict] = {}
        unmatched: list[str] = []
        for iid, ing in ingredients.items():
            data = _get("/products", {"filter.term": ing.kroger_product,
                                      "filter.locationId": location_id,
                                      "filter.limit": 3}).get("data", [])
            match = None
            for product in data:
                for item in product.get("items", []):
                    if size_matches(item.get("size", ""), ing):
                        match = (product, item)
                        break
                if match:
                    break
            if not match:
                unmatched.append(iid)
                continue
            product, item = match
            price = item.get("price") or {}
            dollars = price.get("promo") or price.get("regular")
            if not dollars:
                unmatched.append(iid)
                continue
            stock = (item.get("inventory") or {}).get("stockLevel", "")
            prices[iid] = {
                "price_cents": round(float(dollars) * 100),
                "in_stock": stock != "TEMPORARILY_OUT_OF_STOCK",
                "description": product.get("description", ""),
                "size": item.get("size", ""),
                "brand": product.get("brand", ""),
                "upc": product.get("upc", ""),
            }

        store = None
        try:
            store = _to_store(_get(f"/locations/{location_id}", {}).get("data", {})).model_dump()
        except Exception:
            pass
        fetched_at = datetime.now(timezone.utc).isoformat()
        _save_cache(location_id, {"fetched_at": fetched_at, "store": store, "prices": prices})
        report = {"updated": len(prices), "kept_csv": len(unmatched),
                  "out_of_stock": [i for i, p in prices.items() if not p["in_stock"]],
                  "fetched_at": fetched_at, "store": store, "matches": prices, "unmatched": unmatched}
        return _apply(ingredients, prices), report
    except Exception as exc:
        print(f"prices: refresh failed, keeping CSV prices: {exc}")
        return ingredients, {"updated": 0, "error": str(exc)}
