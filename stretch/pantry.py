import json

from . import llm
from .schemas import Ingredient, PantryItem

_LEVELS = {"full", "half", "low"}


def _ingredient_lines(ingredients: dict[str, Ingredient]) -> str:
    return "\n".join(f"{i.id}: {i.name}" for i in ingredients.values())


def _parse(text: str, ingredients: dict[str, Ingredient], source: str) -> list[PantryItem]:
    try:
        payload = json.loads(text or "[]")
    except json.JSONDecodeError:
        return []
    if isinstance(payload, dict):
        for key in ("items", "pantry", "data", "result"):
            if isinstance(payload.get(key), list):
                payload = payload[key]
                break
        else:
            lists = [v for v in payload.values() if isinstance(v, list)]
            if lists:
                payload = lists[0]
    if not isinstance(payload, list):
        return []

    out: list[PantryItem] = []
    seen: set[str] = set()
    for raw in payload:
        if not isinstance(raw, dict):
            continue
        iid = str(raw.get("ingredient_id", "")).strip()
        level = str(raw.get("level", "full")).strip().lower()
        if iid not in ingredients or level not in _LEVELS or iid in seen:
            continue  # unknown id, bad level, or the same ingredient spotted twice (two peppers -> one chip)
        seen.add(iid)
        out.append(PantryItem(ingredient_id=iid, level=level, source=source))
    return out


def detect_from_image(image: bytes, ingredients: dict[str, Ingredient]) -> list[PantryItem]:
    """Read a shelf photo into levels the user will confirm; never grams."""
    # Two steps in one call: name what is visible first, then map. Asking for the mapping alone makes the
    # model too cautious and it returns nothing for ordinary produce photos.
    prompt = (
        "This is a photo of someone's kitchen shelf, pantry, fridge or groceries. Step 1: name every food you "
        "can see. Step 2: for each one, pick the closest ingredient_id from the list below when there is a "
        "reasonable match; fresh, frozen, canned or dried versions of the same food count as a match (fresh "
        "spinach -> frozen_spinach, any tomatoes -> roma_tomatoes, any lentils -> dried_lentils, red kidney "
        "beans -> canned_kidney_beans, broccoli -> broccoli_crowns, any white rice -> long_grain_rice, any jar "
        "of peanut butter -> peanut_butter). Skip foods with no reasonable match; never invent an item that is "
        'not in the photo. Level: "full" if unopened or plentiful, "half" if partly used, "low" if nearly gone. '
        'Return JSON only: {"seen": [names], "items": [{"ingredient_id": ..., "level": ...}]}.\n\n'
        f"{_ingredient_lines(ingredients)}"
    )
    reply = llm.complete([{"role": "user", "content": prompt}], json_only=True, images=[image], temperature=0.2)
    return _parse(reply["text"], ingredients, "photo")


def detect_from_text(text: str, ingredients: dict[str, Ingredient]) -> list[PantryItem]:
    """Read a typed list of what the household has into levels the user will confirm."""
    prompt = (
        "List only items from this list that the person says they have. For each give "
        '"ingredient_id" and "level" in {full, half, low}. Use "full" unless they say '
        'otherwise. Return JSON only, as an object {"items": [ ... ]}. Do not guess items they did not mention.\n\n'
        f"They said: {text}\n\n{_ingredient_lines(ingredients)}"
    )
    reply = llm.complete([{"role": "user", "content": prompt}], json_only=True)
    return _parse(reply["text"], ingredients, "text")


def to_grams(items: list[PantryItem], ingredients: dict[str, Ingredient]) -> dict[str, int]:
    """Estimated grams on hand per ingredient; duplicates sum."""
    out: dict[str, int] = {}
    for item in items:
        ing = ingredients.get(item.ingredient_id)
        if ing is None:
            continue
        if item.level == "full":
            grams = ing.package_g
        elif item.level == "half":
            grams = ing.package_g // 2
        else:
            grams = ing.package_g // 5
        out[item.ingredient_id] = out.get(item.ingredient_id, 0) + grams
    return out
