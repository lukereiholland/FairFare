import math
import os
import time
from datetime import date, timedelta

from ortools.sat.python import cp_model

from .schemas import DaySchedule, Household, Ingredient, Meal, MealFacts, NutrientTargets, Plan, PlanItem

NUTRIENTS = ("kcal", "protein", "fiber", "sodium", "sugar")
_PER_100G = {
    "kcal": "kcal_100g",
    "protein": "protein_100g",
    "fiber": "fiber_100g",
    "sodium": "sodium_mg_100g",
    "sugar": "sugar_100g",
}
SLOTS = ("breakfast", "lunch", "dinner")
UNCOVERED_PENALTY = 1_000_000  # per serving, in the x100-scaled objective; dwarfs palatability
VARIETY_BONUS = 20_000  # per distinct meal, only once the variety floor has been relaxed
FAVORITE_BONUS = 20_000  # per batch of a saved (cookbook) recipe: worth about two palatability points
OVERFLOW_PENALTY = 60  # per cent of SNAP-eligible food put on the card: only worth it to honour a pin, never for extras


def _candidates(meals: list[Meal], ingredients: dict[str, Ingredient],
                household: Household) -> list[Meal]:
    excluded_ing = set(household.excluded_ingredients)
    excluded_meals = set(household.excluded_meals)
    equipment = set(household.equipment)
    accepted = set(household.accepted_meals) if household.accepted_meals is not None else None

    out = []
    for m in meals:
        if m.id in excluded_meals:
            continue
        if accepted is not None and m.id not in accepted:
            continue
        if m.prep_min > household.max_prep_min:
            continue
        if not set(m.equipment) <= equipment:
            continue
        if any(i not in ingredients for i in m.ingredients):
            continue
        if excluded_ing & set(m.ingredients):
            continue
        out.append(m)
    return out


def _schedule(chosen: dict[str, int], by_id: dict[str, Meal], D: int, people: int,
              school: dict[str, bool]) -> list[DaySchedule]:
    """Greedy day assignment after the solve: batches interleaved across meals, leftovers roll forward."""
    per_slot: dict[str, list[str | None]] = {}
    for slot in SLOTS:
        counts = sorted(
            [{"id": mid, "left": n} for mid, n in chosen.items() if by_id[mid].slot == slot],
            key=lambda c: (-c["left"], c["id"]),
        )
        batches: list[str] = []
        while any(c["left"] > 0 for c in counts):
            for c in counts:
                if c["left"] > 0:
                    batches.append(c["id"])
                    c["left"] -= 1
        servings: list[str] = []
        for mid in batches:
            servings.extend([mid] * max(1, by_id[mid].servings))
        days: list[str | None] = []
        for d in range(D):
            unit = servings[d * max(1, people)] if d * max(1, people) < len(servings) else None
            days.append(unit if unit else ("school" if school.get(slot) else None))
        per_slot[slot] = days
    return [
        DaySchedule(day=d + 1, breakfast=per_slot["breakfast"][d], lunch=per_slot["lunch"][d],
                    dinner=per_slot["dinner"][d])
        for d in range(D)
    ]


def _serving_cents(m: Meal, ingredients: dict[str, Ingredient], assume_staples: bool = True) -> int:
    """Ingredient cost per serving, pro-rated by weight from package prices; assumed staples are free."""
    total = sum(g * ingredients[i].price_cents / ingredients[i].package_g
                for i, g in m.ingredients.items()
                if not (assume_staples and ingredients[i].staple))
    return round(total / max(1, m.servings))


def meal_facts(meals: list[Meal], ingredients: dict[str, Ingredient],
               assume_staples: bool = True) -> dict[str, MealFacts]:
    """Per-serving cost, nutrition and factual tags for every meal in the pool (display only)."""
    valid = [m for m in meals if all(i in ingredients for i in m.ingredients)]
    costs = {m.id: _serving_cents(m, ingredients, assume_staples) for m in valid}
    ranked = sorted(costs.values())
    budget_cut = ranked[max(0, len(ranked) // 3 - 1)] if ranked else 0  # cheapest third of the pool
    facts: dict[str, MealFacts] = {}
    for m in valid:
        per = {n: sum(g * getattr(ingredients[i], _PER_100G[n]) / 100 for i, g in m.ingredients.items())
               / max(1, m.servings) for n in NUTRIENTS}
        cash = [i for i in m.ingredients if not ingredients[i].ebt_eligible]
        tags: list[str] = []
        if m.prep_min <= 15:
            tags.append("quick")
        if not m.equipment:
            tags.append("no-cook")
        if "microwave" in m.equipment:
            tags.append("microwave")
        if "oven" in m.equipment:
            tags.append("oven")
        if costs[m.id] <= budget_cut:
            tags.append("budget")
        if per["protein"] >= 20:  # a meal-sized bar: 40% of the daily value in one serving
            tags.append("high-protein")
        if per["fiber"] >= 8:
            tags.append("high-fiber")
        facts[m.id] = MealFacts(meal_id=m.id, serving_cents=costs[m.id], kcal=round(per["kcal"]),
                                protein_g=round(per["protein"]), fiber_g=round(per["fiber"]),
                                sodium_mg=round(per["sodium"]), snap_eligible=not cash,
                                cash_ingredients=cash, tags=tags)
    return facts


def solve(meals: list[Meal],
          ingredients: dict[str, Ingredient],
          household: Household,
          targets: NutrientTargets,
          time_limit_s: float = 2.0,
          today: date | None = None) -> Plan | None:
    """Choose meals and packages under the budgets; relax variety, repeats, then coverage before giving up."""
    started = time.perf_counter()
    today = today or date.today()
    D = household.trip_days
    cand = _candidates(meals, ingredients, household)
    if not cand:
        return None
    by_id = {m.id: m for m in cand}

    # ---- pre-computation (plain Python, integers only past this point) ----
    school_b = round(household.school_breakfasts * D / 7)
    school_l = round(household.school_lunches * D / 7)
    needed = {
        "breakfast": max(0, D * household.people - school_b),
        "lunch": max(0, D * household.people - school_l),
        "dinner": max(0, D * household.people),
    }

    days_until = (household.deposit_date - today).days if household.deposit_date else None
    snap_cap = household.ebt_cents
    if days_until is not None and days_until > D > 0 and not household.use_more_snap:
        snap_cap = household.ebt_cents * D // days_until

    coef: dict[str, dict[str, int]] = {n: {} for n in NUTRIENTS}
    for m in cand:
        for n in NUTRIENTS:
            attr = _PER_100G[n]
            coef[n][m.id] = round(sum(g * getattr(ingredients[i], attr) / 100 for i, g in m.ingredients.items()))

    used_ids = sorted({i for m in cand for i in m.ingredients})
    pantry_g: dict[str, int] = {}
    staples_assumed: list[str] = []
    for i in used_ids:
        g = household.pantry.get(i, 0)
        if household.assume_staples and ingredients[i].staple:
            g = max(g, ingredients[i].package_g)
            staples_assumed.append(i)
        pantry_g[i] = g

    base_repeat = max(1, math.ceil(3 * D / 7))
    base_distinct = min(max(3, round(8 * D / 7)), len(cand))
    out_of_stock = set(household.out_of_stock)

    required = [m.id for m in cand if m.id in set(household.required_meals)]
    # A pinned meal the kitchen setup or time limit rules out is reported as a dropped pin too.
    pins_not_candidates = [m for m in household.required_meals if m not in by_id]
    favorites = set(household.favorite_meals)

    # ---- model, built per attempt so rules can be relaxed in order ----
    def attempt(min_distinct: int, max_repeat: int, soft_slots: bool, limit: float,
                variety_bonus: int = 0, max_uncovered: int | None = None, pins: bool = True):
        model = cp_model.CpModel()
        x = {m.id: model.NewIntVar(0, D, f"x_{m.id}") for m in cand}
        used = {m.id: model.NewBoolVar(f"u_{m.id}") for m in cand}
        y = {i: model.NewIntVar(0, 0 if i in out_of_stock else 20, f"y_{i}") for i in used_ids}
        uncovered = {}

        for m in cand:
            model.Add(x[m.id] <= D * used[m.id])
            model.Add(used[m.id] <= x[m.id])
            model.Add(x[m.id] <= max_repeat)
        if min_distinct > 0:
            model.Add(sum(used.values()) >= min_distinct)
        if pins:
            for mid in required:  # meals the user pinned: cook each at least once
                model.Add(x[mid] >= 1)

        for slot, need in needed.items():
            slot_meals = [m for m in cand if m.slot == slot]
            terms = [x[m.id] * m.servings for m in slot_meals]
            if need > 0:
                if soft_slots:
                    uncovered[slot] = model.NewIntVar(0, need, f"unc_{slot}")
                    if terms:
                        model.Add(sum(terms) + uncovered[slot] >= need)
                    else:
                        model.Add(uncovered[slot] == need)
                else:
                    if not terms:
                        return None, None, None, None, None
                    model.Add(sum(terms) >= need)
            if terms:
                # Buy what the trip needs plus at most one batch of leftovers, not the whole budget.
                model.Add(sum(terms) <= need + max(m.servings for m in slot_meals))

        if max_uncovered is not None and uncovered:
            model.Add(sum(uncovered.values()) <= max_uncovered)

        for i in used_ids:
            usage = [x[m.id] * m.ingredients[i] for m in cand if i in m.ingredients]
            model.Add(sum(usage) <= y[i] * ingredients[i].package_g + pantry_g[i])

        ebt_terms = [y[i] * ingredients[i].price_cents for i in used_ids if ingredients[i].ebt_eligible]
        cash_terms = [y[i] * ingredients[i].price_cents for i in used_ids if not ingredients[i].ebt_eligible]
        eligible_spend = sum(ebt_terms) if ebt_terms else 0
        ineligible_spend = sum(cash_terms) if cash_terms else 0
        overflow = 0
        if household.card_covers_snap_gap and ebt_terms:
            # SNAP first; eligible food that does not fit under the cap goes on the card, out of cash_cents.
            overflow = model.NewIntVar(0, max(0, household.cash_cents), "snap_overflow")
            model.Add(eligible_spend - overflow <= snap_cap)
            model.Add(ineligible_spend + overflow <= household.cash_cents)
        else:
            if ebt_terms:
                model.Add(eligible_spend <= snap_cap)
            if cash_terms:
                model.Add(ineligible_spend <= household.cash_cents)
        spend = eligible_spend + ineligible_spend

        def _max_total(n: str) -> int:
            return max(1, sum(max(0, coef[n][m.id]) * max_repeat for m in cand))

        short_kcal100 = model.NewIntVar(0, targets.kcal_min // 100 + 1, "short_kcal100")
        short_protein = model.NewIntVar(0, max(1, targets.protein_g_min), "short_protein")
        short_fiber = model.NewIntVar(0, max(1, targets.fiber_g_min), "short_fiber")
        excess_sodium100 = model.NewIntVar(0, _max_total("sodium") // 100 + 1, "excess_sodium100")
        excess_sugar = model.NewIntVar(0, _max_total("sugar"), "excess_sugar")
        model.Add(sum(x[m.id] * coef["kcal"][m.id] for m in cand) + 100 * short_kcal100 >= targets.kcal_min)
        model.Add(sum(x[m.id] * coef["protein"][m.id] for m in cand) + short_protein >= targets.protein_g_min)
        model.Add(sum(x[m.id] * coef["fiber"][m.id] for m in cand) + short_fiber >= targets.fiber_g_min)
        model.Add(sum(x[m.id] * coef["sodium"][m.id] for m in cand) - 100 * excess_sodium100 <= targets.sodium_mg_max)
        model.Add(sum(x[m.id] * coef["sugar"][m.id] for m in cand) - excess_sugar <= targets.sugar_g_max)

        # Objective scaled by 100 so every weight stays an integer (spec weights are per-dollar).
        budget = snap_cap + household.cash_cents
        model.Maximize(
            10000 * sum(x[m.id] * m.palatability for m in cand)
            + FAVORITE_BONUS * sum(x[m.id] for m in cand if m.id in favorites)
            + variety_bonus * sum(used.values())
            - 200 * short_kcal100
            - 2000 * short_protein
            - 1000 * short_fiber
            - 100 * excess_sodium100
            - 500 * excess_sugar
            + (budget - spend)
            - OVERFLOW_PENALTY * overflow
            - UNCOVERED_PENALTY * sum(uncovered.values())
        )

        solver = cp_model.CpSolver()
        solver.parameters.max_time_in_seconds = limit
        solver.parameters.num_workers = int(os.getenv("SOLVER_WORKERS", "8"))  # fewer on a small cloud CPU
        status = solver.Solve(model)
        if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
            return None, None, None, None, status
        return solver, x, y, uncovered, status

    half = max(0.5, time_limit_s / 2)
    # (rules relaxed, min distinct, max repeat, soft slots, time limit, variety bonus, keep pins)
    stages = [
        ([], base_distinct, base_repeat, False, time_limit_s, 0, True),
        (["variety"], 1, base_repeat, False, half, VARIETY_BONUS, True),
        (["variety", "repeats"], 1, D, False, half, VARIETY_BONUS, True),
    ]
    if required:
        # A pinned meal the budget cannot hold is dropped before any slot goes uncovered (food first).
        stages.append((["variety", "repeats", "pins"], 1, D, False, half, VARIETY_BONUS, False))
    stages.append((["variety", "repeats", "slots"], 0, D, True, half, VARIETY_BONUS, True))
    if required:
        stages.append((["variety", "repeats", "pins", "slots"], 0, D, True, half, VARIETY_BONUS, False))
    solver = x = y = uncovered_vars = None
    relaxed: list[str] = []
    pins_kept = True
    for relaxed, min_distinct, max_repeat, soft, limit, bonus, pins_kept in stages:
        solver, x, y, uncovered_vars, status = attempt(min_distinct, max_repeat, soft, limit, bonus, pins=pins_kept)
        if solver is None and status == cp_model.UNKNOWN:
            # Out of time with no proof either way (busy machine): retry once before relaxing a rule.
            solver, x, y, uncovered_vars, status = attempt(min_distinct, max_repeat, soft, limit * 1.5, bonus,
                                                          pins=pins_kept)
        if solver is not None:
            break
    if solver is None:
        return None
    if "slots" in relaxed and uncovered_vars:
        # Food first, variety second: keep the coverage just found, then retry without the long repeats.
        best_uncovered = sum(solver.Value(v) for v in uncovered_vars.values())
        again = attempt(0, base_repeat, True, half, VARIETY_BONUS, best_uncovered, pins=pins_kept)
        if again[0] is not None:
            solver, x, y, uncovered_vars, _ = again
            relaxed = [r for r in relaxed if r != "repeats"]

    # ---- output; every display number is computed here ----
    chosen = {m.id: solver.Value(x[m.id]) for m in cand if solver.Value(x[m.id]) > 0}
    cart: list[PlanItem] = []
    ebt_cents = 0
    cash_cents = 0
    packs = {}
    for i in used_ids:
        n = solver.Value(y[i])
        packs[i] = n
        if n <= 0:
            continue
        ing = ingredients[i]
        line = n * ing.price_cents
        if ing.ebt_eligible:
            ebt_cents += line
        else:
            cash_cents += line
        cart.append(PlanItem(ingredient_id=i, packages=n, line_cents=line,
                             ebt_eligible=ing.ebt_eligible, aisle=ing.aisle))

    snap_overflow_cents = 0
    if household.card_covers_snap_gap and ebt_cents > snap_cap:
        # The register runs EBT first up to the cap; the rest of the eligible food goes on the card.
        snap_overflow_cents = ebt_cents - snap_cap
        ebt_cents = snap_cap
        cash_cents += snap_overflow_cents
    basket_cents = ebt_cents + cash_cents
    used_g = {i: sum(chosen.get(m.id, 0) * m.ingredients[i] for m in cand if i in m.ingredients) for i in used_ids}
    from_pantry = {i: min(pantry_g[i], used_g[i]) for i in used_ids if min(pantry_g[i], used_g[i]) > 0}
    leftovers = {}
    for i in used_ids:
        if packs[i] > 0:
            left = packs[i] * ingredients[i].package_g + pantry_g[i] - used_g[i]
            if left > 0:
                leftovers[i] = left

    achieved = {n: float(sum(chosen.get(m.id, 0) * coef[n][m.id] for m in cand)) for n in NUTRIENTS}
    shortfalls = {
        "kcal": max(0.0, targets.kcal_min - achieved["kcal"]),
        "protein": max(0.0, targets.protein_g_min - achieved["protein"]),
        "fiber": max(0.0, targets.fiber_g_min - achieved["fiber"]),
        "sodium": max(0.0, achieved["sodium"] - targets.sodium_mg_max),
        "sugar": max(0.0, achieved["sugar"] - targets.sugar_g_max),
    }
    uncovered = {s: solver.Value(v) for s, v in (uncovered_vars or {}).items() if solver.Value(v) > 0}

    snap_remaining_after = household.ebt_cents - ebt_cents
    days_remaining_after = max(0, days_until - D) if days_until is not None else 0
    on_pace = True
    projected: date | None = None
    if days_until is not None and days_remaining_after > 0:
        on_pace = snap_remaining_after * D >= ebt_cents * days_remaining_after
        if not on_pace and ebt_cents > 0:
            projected = today + timedelta(days=household.ebt_cents * D // ebt_cents)

    # Ingredient cost per serving for every meal in the pool (display only; see _serving_cents).
    meal_serving_cents = {m.id: _serving_cents(m, ingredients, household.assume_staples)
                          for m in meals if all(i in ingredients for i in m.ingredients)}

    return Plan(
        meals=chosen,
        cart=cart,
        ebt_cents=ebt_cents,
        cash_cents=cash_cents,
        basket_cents=basket_cents,
        cash_remaining_cents=household.cash_cents - cash_cents,
        eligible_pct=round(100 * ebt_cents / basket_cents) if basket_cents else 0,
        trips_covered=round(household.ebt_cents / ebt_cents, 1) if ebt_cents else 0.0,
        covers_until=today + timedelta(days=D),
        from_pantry=from_pantry,
        nutrition=achieved,
        targets=targets,
        shortfalls=shortfalls,
        what_changed=None,
        solve_ms=int((time.perf_counter() - started) * 1000),
        trip_snap_cap_cents=snap_cap,
        snap_remaining_after_cents=snap_remaining_after,
        days_remaining_after=days_remaining_after,
        on_pace=on_pace,
        projected_run_out_date=projected,
        schedule=_schedule(chosen, by_id, D, household.people,
                           {"breakfast": school_b > 0, "lunch": school_l > 0, "dinner": False}),
        leftovers=leftovers,
        uncovered=uncovered,
        relaxed=list(relaxed) + (["pins"] if pins_not_candidates and "pins" not in relaxed else []),
        staples_assumed=staples_assumed,
        meal_serving_cents=meal_serving_cents,
        meal_cost_cents={mid: meal_serving_cents.get(mid, 0) * by_id[mid].servings * n for mid, n in chosen.items()},
        snap_overflow_cents=snap_overflow_cents,
    )
