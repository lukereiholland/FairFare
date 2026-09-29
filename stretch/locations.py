"""Nearest branch of each chain to a ZIP code, from OpenStreetMap (Nominatim + Overpass; free, keyless).
Address and distance only. Never prices: those stay chain-level online listings."""
import math
import time

import requests

from .schemas import NearbyStore

_UA = {"User-Agent": "FairFare-hackathon/1.0 (meal planner demo)"}
_BRANDS = {"kroger": "Kroger", "walmart": "Walmart", "aldi": "ALDI", "target": "Target", "publix": "Publix"}
_OVERPASS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]
_geo_cache: dict[str, tuple[float, float] | None] = {}
_near_cache: dict[str, tuple[float, dict[str, NearbyStore]]] = {}
CACHE_S = 6 * 3600


def geocode_zip(zip_code: str) -> tuple[float, float] | None:
    """ZIP -> (lat, lon) via Nominatim; None when unknown or the service is unreachable."""
    z = zip_code.strip()
    if z in _geo_cache:
        return _geo_cache[z]
    try:
        r = requests.get("https://nominatim.openstreetmap.org/search",
                         params={"postalcode": z, "country": "US", "format": "json", "limit": 1},
                         headers=_UA, timeout=10)
        r.raise_for_status()
        hits = r.json()
        out = (float(hits[0]["lat"]), float(hits[0]["lon"])) if hits else None
    except Exception as exc:
        print(f"locations: geocode {z} failed: {str(exc)[:100]}", flush=True)
        return None  # do not cache a hiccup
    _geo_cache[z] = out
    return out


def _miles(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p = math.pi / 180
    a = 0.5 - math.cos((lat2 - lat1) * p) / 2 + math.cos(lat1 * p) * math.cos(lat2 * p) * (1 - math.cos((lon2 - lon1) * p)) / 2
    return 7917.5 * math.asin(math.sqrt(a))


def _address(tags: dict) -> str:
    parts = [" ".join(x for x in (tags.get("addr:housenumber"), tags.get("addr:street")) if x), tags.get("addr:city")]
    return ", ".join(x for x in parts if x) or (tags.get("name") or "")


def _brand_of(tags: dict, store_ids: list[str]) -> str | None:
    label = f"{tags.get('brand', '')} {tags.get('name', '')}".lower()
    for sid in store_ids:
        if _BRANDS[sid].lower() in label:
            return sid
    return None


def nearest_all(store_ids: list[str], lat: float, lon: float, radius_m: int = 25000) -> dict[str, NearbyStore]:
    """One Overpass query for every chain at once (the public server rate-limits repeated calls); returns
    store id -> nearest branch. Chains with no hit are absent. Empty on any service failure, not cached."""
    ids = [s for s in store_ids if s in _BRANDS]
    if not ids:
        return {}
    key = f"{lat:.3f},{lon:.3f}:{','.join(sorted(ids))}"
    hit = _near_cache.get(key)
    if hit and time.time() - hit[0] < CACHE_S:
        return hit[1]
    pattern = "|".join(_BRANDS[s] for s in ids)
    query = (
        f'[out:json][timeout:15];('
        f'nwr["shop"]["brand"~"^({pattern})",i](around:{radius_m},{lat},{lon});'
        f'nwr["shop"]["name"~"^({pattern})",i](around:{radius_m},{lat},{lon});'
        f');out center tags;'
    )
    elements = None
    for url in _OVERPASS:
        try:
            r = requests.post(url, data={"data": query}, headers=_UA, timeout=25)
            r.raise_for_status()
            elements = r.json().get("elements", [])
            break
        except Exception as exc:
            print(f"locations: overpass {url} failed: {str(exc)[:100]}", flush=True)
    if elements is None:
        return {}
    best: dict[str, tuple[float, float, float, dict]] = {}
    for el in elements:
        plat = el.get("lat") or (el.get("center") or {}).get("lat")
        plon = el.get("lon") or (el.get("center") or {}).get("lon")
        tags = el.get("tags", {})
        sid = _brand_of(tags, ids)
        if plat is None or plon is None or sid is None:
            continue
        d = _miles(lat, lon, plat, plon)
        if sid not in best or d < best[sid][0]:
            best[sid] = (d, plat, plon, tags)
    out = {
        sid: NearbyStore(store=sid, name=tags.get("name") or _BRANDS[sid], address=_address(tags),
                         distance_miles=round(d, 1), lat=plat, lon=plon,
                         maps_url=f"https://www.google.com/maps/search/?api=1&query={plat},{plon}")
        for sid, (d, plat, plon, tags) in best.items()
    }
    _near_cache[key] = (time.time(), out)
    return out


def nearest(store: str, lat: float, lon: float) -> NearbyStore | None:
    return nearest_all([store], lat, lon).get(store)


def nearby_for_zip(zip_code: str, store_ids: list[str]) -> list[NearbyStore]:
    """Nearest branch of each chain to a ZIP; chains with no hit are simply absent."""
    geo = geocode_zip(zip_code)
    if not geo:
        return []
    found = nearest_all(store_ids, *geo)
    return [found[s] for s in store_ids if s in found]
