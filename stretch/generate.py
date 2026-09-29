import json
import os
import re

from . import llm
from .schemas import Household, Ingredient, Meal

_RULES = (
    "Use only these ingredient ids; never invent one. All quantities are grams per batch "
    "(integers), realistic for the given number of servings. Output JSON only, as an object "
    '{"meals": [ ... ]}, with no prose and no markdown fences. Each meal object: '
    '{"id", "name", "slot", "servings", "prep_min", "equipment", "palatability", "ingredients", '
    '"description"}. slot is breakfast|lunch|dinner. equipment is a list drawn from '
    "stovetop|microwave|oven (an empty list [] means no cooking at all). servings is an integer "
    "2-6. prep_min is an integer 5-35. palatability is 1-5. ingredients maps ingredient_id to "
    "grams per batch. id is a unique snake_case string made from the name, e.g. "
    '"smoky_black_bean_tacos", never a number. name reads like a real dish on a menu, specific '
    'and appetizing, e.g. "Smoky black bean tacos with cabbage slaw" or "Sheet-pan chicken '
    'thighs with roasted carrots" — never a flat label like "Bean Tacos" or "Chicken Dinner". '
    "description is one plain sentence, at most 110 characters, saying what the dish is and why "
    'it works on a budget; no health claims, no emoji, never the word "week".'
)

# (group name, required equipment, meal count, slot mix) at n=50; scaled for other n.
_GROUP_SPECS = [
    ("no-cook", [], 6, {"breakfast": 2, "lunch": 3, "dinner": 1}),
    ("microwave-only", ["microwave"], 8, {"breakfast": 2, "lunch": 4, "dinner": 2}),
    ("oven-only", ["oven"], 10, {"breakfast": 0, "lunch": 3, "dinner": 7}),
    ("stovetop-only", ["stovetop"], 26, {"breakfast": 8, "lunch": 9, "dinner": 9}),
]
_BASE_N = sum(count for _, _, count, _ in _GROUP_SPECS)


def _scaled_group_specs(n: int):
    """Scale the fixed n=50 equipment/slot quotas to an arbitrary n, preserving ratios."""
    if n == _BASE_N:
        return _GROUP_SPECS
    scale = n / _BASE_N
    out = []
    allocated = 0
    for idx, (name, equip, count, slots) in enumerate(_GROUP_SPECS):
        is_last = idx == len(_GROUP_SPECS) - 1
        c = (n - allocated) if is_last else max(1, round(count * scale))
        allocated += c
        slot_total = sum(slots.values()) or 1
        scaled_slots, slot_alloc = {}, 0
        keys = list(slots.keys())
        for j, k in enumerate(keys):
            if j == len(keys) - 1:
                scaled_slots[k] = max(0, c - slot_alloc)
            else:
                v = round(slots[k] * c / slot_total)
                scaled_slots[k] = v
                slot_alloc += v
        out.append((name, equip, c, scaled_slots))
    return out


def _slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", name.lower()).strip("_") or "meal"


def _ingredient_lines(ingredients: dict[str, Ingredient]) -> str:
    return "\n".join(f"{i.id}: {i.name}" for i in ingredients.values())


def _group_prompt(ingredients: dict[str, Ingredient], count: int, equipment: list[str],
                   slot_counts: dict[str, int] | None) -> str:
    if not equipment:
        equip_line = ('Every meal must use "equipment": [] — no-cook only, no stovetop, '
                       "no microwave, no oven.")
    else:
        equip_line = (f'Every meal must use "equipment": {json.dumps(equipment)} exactly — '
                       f"that equipment and nothing else.")
    if slot_counts:
        mix = ", ".join(f"{v} {k}" for k, v in slot_counts.items() if v > 0)
        slot_line = f"Return exactly {count} meals with this slot mix: {mix}."
    else:
        slot_line = (f"Return exactly {count} more meals in this same equipment category, any "
                     "mix of breakfast/lunch/dinner slots.")
    return (
        f"Propose {count} appetizing, budget-friendly household meals for a household on SNAP.\n"
        f"{_RULES}\n\n{equip_line}\n{slot_line}\n"
        "Favour meals that share staple ingredients (rice, beans, eggs, onions, tortillas) "
        "across the pool so one package stretches across several meals.\n\n"
        f"Ingredients:\n{_ingredient_lines(ingredients)}"
    )


def _parse(text: str, ingredients: dict[str, Ingredient],
           seen_names: set[str] | None = None, seen_ids: set[str] | None = None) -> list[Meal]:
    if seen_names is None:
        seen_names = set()
    if seen_ids is None:
        seen_ids = set()
    payload = json.loads(text)
    if isinstance(payload, dict):
        for key in ("meals", "data", "items", "result"):
            if isinstance(payload.get(key), list):
                payload = payload[key]
                break
        else:
            lists = [v for v in payload.values() if isinstance(v, list)]
            if lists:
                payload = lists[0]
    if not isinstance(payload, list):
        raise ValueError("model did not return a JSON array of meals")

    meals: list[Meal] = []
    dropped = 0
    first_error = ""
    for raw in payload:
        if isinstance(raw, dict) and not isinstance(raw.get("id"), str):
            raw = {**raw, "id": _slug(str(raw.get("name", "")))}
        try:
            meal = Meal.model_validate(raw)
        except Exception as exc:
            dropped += 1
            first_error = first_error or str(exc).splitlines()[0]
            continue
        if any(i not in ingredients for i in meal.ingredients) or not meal.ingredients:
            dropped += 1
            continue
        desc = (meal.description or "").strip()
        if not desc or len(desc) > 160:
            dropped += 1
            continue
        key = meal.name.strip().lower()
        if key in seen_names or meal.id in seen_ids:
            dropped += 1
            continue
        seen_names.add(key)
        seen_ids.add(meal.id)
        meals.append(meal)
    print(f"generate: kept {len(meals)} meals, dropped {dropped}"
          + (f" (first error: {first_error})" if first_error else ""))
    return meals


def _generate_group(ingredients: dict[str, Ingredient], group_name: str, equipment: list[str],
                    count: int, slot_counts: dict[str, int],
                    seen_names: set[str], seen_ids: set[str], max_extra_rounds: int = 1) -> list[Meal]:
    collected: list[Meal] = []
    remaining = count
    round_no = 0
    while remaining > 0 and round_no <= max_extra_rounds:
        prompt = _group_prompt(ingredients, remaining, equipment, slot_counts if round_no == 0 else None)
        reply = llm.complete([{"role": "user", "content": prompt}], json_only=True)
        parsed = _parse(reply["text"] or "[]", ingredients, seen_names, seen_ids)
        matched = [m for m in parsed if sorted(m.equipment) == sorted(equipment)]
        mismatched = len(parsed) - len(matched)
        collected.extend(matched)
        remaining = count - len(collected)
        print(f"generate[{group_name}]: round {round_no + 1} kept {len(matched)} matching "
              f"equipment (+{mismatched} dropped for wrong equipment); {max(remaining, 0)} still needed")
        round_no += 1
    return collected


def generate_meals(ingredients: dict[str, Ingredient],
                   household: Household,
                   n: int = 50,
                   cache_path: str = "data/meals.json") -> list[Meal]:
    """Load the cached meal pool if present, otherwise ask the LLM (per equipment group) and cache it."""
    if cache_path and os.path.exists(cache_path):
        with open(cache_path, encoding="utf-8") as fh:
            return [Meal.model_validate(m) for m in json.load(fh)]

    seen_names: set[str] = set()
    seen_ids: set[str] = set()
    meals: list[Meal] = []
    for group_name, equipment, count, slot_counts in _scaled_group_specs(n):
        meals.extend(_generate_group(ingredients, group_name, equipment, count, slot_counts,
                                     seen_names, seen_ids))

    if cache_path:
        os.makedirs(os.path.dirname(cache_path) or ".", exist_ok=True)
        with open(cache_path, "w", encoding="utf-8") as fh:
            json.dump([m.model_dump() for m in meals], fh, indent=1)
    return meals


def load_cached(cache_path: str = "data/meals.json") -> list[Meal]:
    """Read the meal cache without ever calling the LLM; empty list when there is no cache."""
    if not os.path.exists(cache_path):
        return []
    with open(cache_path, encoding="utf-8") as fh:
        return [Meal.model_validate(m) for m in json.load(fh)]


if __name__ == "__main__":
    from .schemas import load_ingredients

    ings = load_ingredients()
    if os.path.exists("data/meals.json"):
        os.remove("data/meals.json")
    hh = Household(people=2, ebt_cents=15000, cash_cents=2000)
    print(f"generated {len(generate_meals(ings, hh))} meals into data/meals.json")
