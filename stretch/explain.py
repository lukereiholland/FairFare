from .schemas import Ingredient, Meal, Plan


def diff(old: Plan, new: Plan, meals: dict[str, Meal], ingredients: dict[str, Ingredient]) -> dict:
    """Pure-Python comparison of two plans: meals, cart lines, totals and nutrients."""
    def meal_name(mid: str) -> str:
        m = meals.get(mid)
        return m.name if m else mid

    def ing_name(iid: str) -> str:
        i = ingredients.get(iid)
        return i.name if i else iid

    old_packs = {c.ingredient_id: c.packages for c in old.cart}
    new_packs = {c.ingredient_id: c.packages for c in new.cart}

    added_ing = [ing_name(i) for i in new_packs if i not in old_packs]
    removed_ing = [ing_name(i) for i in old_packs if i not in new_packs]
    changed_ing = [
        {"name": ing_name(i), "from": old_packs[i], "to": new_packs[i]}
        for i in new_packs if i in old_packs and old_packs[i] != new_packs[i]
    ]

    nutrients = {}
    for key, value in new.nutrition.items():
        delta = round(value - old.nutrition.get(key, 0.0), 1)
        if delta:
            nutrients[key] = delta

    return {
        "meals_added": [meal_name(m) for m in new.meals if m not in old.meals],
        "meals_removed": [meal_name(m) for m in old.meals if m not in new.meals],
        "ingredients_added": added_ing,
        "ingredients_removed": removed_ing,
        "ingredients_changed": changed_ing,
        "ebt_delta_cents": new.ebt_cents - old.ebt_cents,
        "cash_delta_cents": new.cash_cents - old.cash_cents,
        "basket_delta_cents": new.basket_cents - old.basket_cents,
        "nutrients_delta": nutrients,
        "targets_met_now": all(v == 0 for v in new.shortfalls.values()),
        "targets_met_before": all(v == 0 for v in old.shortfalls.values()),
    }


_NUTRIENT_LABEL = {"kcal": "calorie", "protein": "protein", "fiber": "fiber", "sodium": "sodium", "sugar": "sugar"}


def _dollars(cents: int) -> str:
    return f"${abs(cents) // 100}.{abs(cents) % 100:02d}"


def _join(items: list[str]) -> str:
    if len(items) <= 1:
        return "".join(items)
    return ", ".join(items[:-1]) + " and " + items[-1]


def explain(old: Plan, new: Plan, meals, ingredients) -> str:
    """Plain sentences about what changed, built straight from the diff: instant, exact, and it only
    mentions nutrition when a target actually flipped. (Replaces the LLM call; see AGENTS.md addenda.)"""
    d = diff(old, new, meals, ingredients)

    def name(mid: str) -> str:
        m = meals.get(mid)
        return m.name if m else mid

    parts: list[str] = []
    added = [m for m in new.meals if m not in old.meals]
    removed = [m for m in old.meals if m not in new.meals]
    changed = [(m, old.meals[m], new.meals[m]) for m in new.meals if m in old.meals and old.meals[m] != new.meals[m]]
    if added:
        parts.append("Added " + _join([f"{name(m)} ({new.meals[m]}×)" for m in added]) + ".")
    if removed:
        parts.append("Dropped " + _join([name(m) for m in removed]) + " to make room.")
    if changed and len(changed) <= 3:
        parts.append(_join([f"{name(m)} from {a}× to {b}×" for m, a, b in changed]) + ".")
    elif changed:
        parts.append(f"{len(changed)} meals are cooked a different number of times.")

    old_unc = sum(old.uncovered.values())
    new_unc = sum(new.uncovered.values())
    if new_unc < old_unc:
        parts.append(f"Covers {old_unc - new_unc} more meal{'s' if old_unc - new_unc != 1 else ''}.")
    elif new_unc > old_unc:
        parts.append(f"Leaves {new_unc - old_unc} more meal{'s' if new_unc - old_unc != 1 else ''} uncovered.")

    if not added and not removed and not changed and (d["ingredients_added"] or d["ingredients_removed"]):
        swap = []
        if d["ingredients_added"]:
            swap.append("added " + _join(d["ingredients_added"]))
        if d["ingredients_removed"]:
            swap.append("removed " + _join(d["ingredients_removed"]))
        parts.append("Same meals; " + " and ".join(swap) + ".")

    pantry_now, pantry_before = len(new.from_pantry), len(old.from_pantry)
    if pantry_now > pantry_before:
        parts.append(f"Using {pantry_now} thing{'s' if pantry_now != 1 else ''} you already have.")

    delta = d["basket_delta_cents"]
    if delta > 0:
        parts.append(f"Total up {_dollars(delta)} to {_dollars(new.basket_cents)}.")
    elif delta < 0:
        parts.append(f"Total down {_dollars(delta)} to {_dollars(new.basket_cents)}.")

    flips = []
    for key, label in _NUTRIENT_LABEL.items():
        was_met = old.shortfalls.get(key, 0) == 0
        now_met = new.shortfalls.get(key, 0) == 0
        if was_met != now_met:
            flips.append(f"{label} target {'now met' if now_met else 'no longer met'}")
    if flips:
        parts.append(_join(flips).capitalize() + ".")

    return " ".join(parts) if parts else "No changes."
