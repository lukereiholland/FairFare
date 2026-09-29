"""Phase 4: answer "why not just ask an LLM?" with numbers. Writes eval/results.md."""
import json
import time
from datetime import date

from stretch import generate, llm, nutrition
from stretch import solve as solve_mod
from stretch.schemas import Household, Ingredient, Meal, load_ingredients

TEMPERATURE = 0.7
NUTRIENTS = ("kcal", "protein", "fiber", "sodium", "sugar")
_PER_100G = {
    "kcal": "kcal_100g",
    "protein": "protein_100g",
    "fiber": "fiber_100g",
    "sodium": "sodium_mg_100g",
    "sugar": "sugar_100g",
}

# Ingredients marked staple=True are assumed on hand (one full package) when scoring
# sufficiency, the same generous assumption solve.py makes for assume_staples=True.
GENEROUS_STAPLES = True


def _dollars(cents: int) -> str:
    return f"${cents / 100:.2f}"


def build_personas(ingredients: dict[str, Ingredient]) -> dict[str, Household]:
    """Three personas from the spec, with the same snap_only/diet merge api/main.py applies."""
    raw = {
        "P1 typical": Household(people=2, trip_days=7, ebt_cents=15000, cash_cents=2000),
        "P2 microwave-only, tight": Household(
            people=1, trip_days=5, ebt_cents=4000, cash_cents=0,
            snap_only=True, equipment=["microwave"],
        ),
        "P3 vegetarian family": Household(
            people=4, trip_days=7, ebt_cents=12000, cash_cents=0,
            snap_only=True, diet=["vegetarian"],
        ),
    }
    return {name: _prep_household(hh, ingredients) for name, hh in raw.items()}


def _prep_household(hh: Household, ingredients: dict[str, Ingredient]) -> Household:
    """Mirror api/main.py's /solve preprocessing: force cash to 0 on snap_only, merge diet exclusions."""
    if hh.snap_only:
        hh = hh.model_copy(update={"cash_cents": 0})
    merged = sorted(set(hh.excluded_ingredients) | set(nutrition.diet_exclusions(hh.diet, ingredients)))
    return hh.model_copy(update={"excluded_ingredients": merged})


# ---------------------------------------------------------------------------
# Scoring (plain Python; never trust the LLM's own totals)
# ---------------------------------------------------------------------------

def score_plan(cart: list[dict], meals_norm: list[dict], household: Household,
              ingredients: dict[str, Ingredient]) -> dict:
    """Score a normalized plan (cart of {ingredient_id, packages}; meals of
    {slot, servings, times_cooked, ingredients}) against real CSV prices/nutrition."""
    ids_in_meals = {i for m in meals_norm for i in m["ingredients"]}
    ids_in_cart = {c["ingredient_id"] for c in cart}
    unknown_ids = sorted((ids_in_meals | ids_in_cart) - set(ingredients))

    ebt_cents = 0
    cash_cents = 0
    for c in cart:
        ing = ingredients.get(c["ingredient_id"])
        if ing is None:
            continue
        line = c["packages"] * ing.price_cents
        if ing.ebt_eligible:
            ebt_cents += line
        else:
            cash_cents += line
    basket_cents = ebt_cents + cash_cents

    over_budget = ebt_cents > household.ebt_cents or cash_cents > household.cash_cents
    ineligible_on_snap = bool(household.snap_only and cash_cents > 0)

    needed = household.people * household.trip_days
    got = {"breakfast": 0, "lunch": 0, "dinner": 0}
    for m in meals_norm:
        if m["slot"] in got:
            got[m["slot"]] += m["servings"] * m["times_cooked"]
    slots_covered = {s: got[s] >= needed for s in got}
    all_slots_covered = all(slots_covered.values())

    grams_needed: dict[str, int] = {}
    for m in meals_norm:
        for i, g in m["ingredients"].items():
            grams_needed[i] = grams_needed.get(i, 0) + g * m["times_cooked"]
    packages_bought: dict[str, int] = {}
    for c in cart:
        packages_bought[c["ingredient_id"]] = packages_bought.get(c["ingredient_id"], 0) + c["packages"]

    sufficiency_violations = len(unknown_ids)
    for i, need_g in grams_needed.items():
        ing = ingredients.get(i)
        if ing is None:
            continue  # already counted via unknown_ids
        have_g = packages_bought.get(i, 0) * ing.package_g
        if GENEROUS_STAPLES and household.assume_staples and ing.staple:
            have_g += ing.package_g
        if need_g > have_g:
            sufficiency_violations += 1

    totals = {n: 0.0 for n in NUTRIENTS}
    for m in meals_norm:
        for i, g in m["ingredients"].items():
            ing = ingredients.get(i)
            if ing is None:
                continue
            grams_total = g * m["times_cooked"]
            for n in NUTRIENTS:
                totals[n] += grams_total * getattr(ing, _PER_100G[n]) / 100

    targets = nutrition.targets_for(household)
    nutrient_met = {
        "kcal": totals["kcal"] >= targets.kcal_min,
        "protein": totals["protein"] >= targets.protein_g_min,
        "fiber": totals["fiber"] >= targets.fiber_g_min,
        "sodium": totals["sodium"] <= targets.sodium_mg_max,
        "sugar": totals["sugar"] <= targets.sugar_g_max,
    }
    all_targets_met = all(nutrient_met.values())
    excluded_ingredient_violations = sorted(ids_in_meals & set(household.excluded_ingredients))

    return {
        "ebt_cents": ebt_cents,
        "cash_cents": cash_cents,
        "basket_cents": basket_cents,
        "over_budget": over_budget,
        "ineligible_on_snap": ineligible_on_snap,
        "all_slots_covered": all_slots_covered,
        "slots_covered": slots_covered,
        "sufficiency_violations": sufficiency_violations,
        "unknown_ids": unknown_ids,
        "nutrient_met": nutrient_met,
        "targets_met_count": sum(1 for v in nutrient_met.values() if v),
        "all_targets_met": all_targets_met,
        "excluded_ingredient_violations": excluded_ingredient_violations,
    }


def _failure_row(persona: str, run: int, time_ms: int, error: str) -> dict:
    return {
        "persona": persona, "run": run, "time_ms": time_ms, "error": error,
        "ebt_cents": 0, "cash_cents": 0, "basket_cents": 0,
        "over_budget": None, "ineligible_on_snap": False, "all_slots_covered": False,
        "slots_covered": {}, "sufficiency_violations": None, "unknown_ids": [],
        "nutrient_met": {}, "targets_met_count": None, "all_targets_met": False,
        "excluded_ingredient_violations": [],
    }


# ---------------------------------------------------------------------------
# Baseline: ask the LLM to plan directly, no solver
# ---------------------------------------------------------------------------

def _ingredient_table(ingredients: dict[str, Ingredient]) -> str:
    return "\n".join(
        f'{i.id}: name="{i.name}", package_g={i.package_g}, price_cents={i.price_cents}, '
        f'ebt_eligible={i.ebt_eligible}'
        for i in ingredients.values()
    )


def _baseline_prompt(hh: Household, ingredients: dict[str, Ingredient]) -> str:
    needed = hh.people * hh.trip_days
    return (
        "You are planning ONE grocery shopping trip for a household on SNAP (food stamps), "
        "against real Kroger prices. Use ONLY the ingredient ids listed below; never invent an id.\n\n"
        f"Household (JSON): {hh.model_dump_json()}\n\n"
        f"Equipment available: {hh.equipment}. Max prep minutes per meal: {hh.max_prep_min}. "
        f"Ingredient ids already excluded by diet or preference: {hh.excluded_ingredients}.\n\n"
        "Ingredient table (id: name, package_g, price_cents, ebt_eligible):\n"
        f"{_ingredient_table(ingredients)}\n\n"
        f"Plan meals so breakfast, lunch and dinner each total at least {needed} servings across "
        f"the whole trip ({hh.people} people x {hh.trip_days} days). Stay within a SNAP/EBT budget "
        f"of {hh.ebt_cents} cents, spent only on ebt_eligible ingredients, and a cash budget of "
        f"{hh.cash_cents} cents, spent only on ingredients that are not ebt_eligible.\n\n"
        "Return JSON only, no prose, no markdown fences, in exactly this shape:\n"
        '{"meals": [{"name": str, "slot": "breakfast"|"lunch"|"dinner", "servings": int, '
        '"times_cooked": int, "ingredients": {"ingredient_id": grams_per_batch_int}}], '
        '"cart": [{"ingredient_id": str, "packages": int}]}\n'
        "\"servings\" is servings produced by one batch of that meal; \"times_cooked\" is how many "
        "times that batch is cooked this trip; ingredient grams are per single batch, not per trip."
    )


def _normalize_baseline_meals(meals_raw: list) -> list[dict]:
    out = []
    for m in meals_raw:
        out.append({
            "slot": m.get("slot"),
            "servings": int(m.get("servings", 0)),
            "times_cooked": int(m.get("times_cooked", 0)),
            "ingredients": {str(k): int(v) for k, v in (m.get("ingredients") or {}).items()},
        })
    return out


def run_baseline(n: int, personas: dict[str, Household],
                 ingredients: dict[str, Ingredient]) -> list[dict]:
    """Plain-LLM planner: no solver, scored the same way as the hybrid path."""
    rows = []
    for persona, hh in personas.items():
        prompt = _baseline_prompt(hh, ingredients)
        for run_i in range(n):
            t0 = time.perf_counter()
            try:
                reply = llm.complete([{"role": "user", "content": prompt}],
                                     json_only=True, temperature=TEMPERATURE)
                elapsed_ms = int((time.perf_counter() - t0) * 1000)
                payload = json.loads(reply["text"] or "{}")
                meals_norm = _normalize_baseline_meals(payload.get("meals") or [])
                cart = [
                    {"ingredient_id": str(c.get("ingredient_id")), "packages": int(c.get("packages", 0))}
                    for c in (payload.get("cart") or [])
                ]
                scored = score_plan(cart, meals_norm, hh, ingredients)
                scored.update({"persona": persona, "run": run_i, "time_ms": elapsed_ms, "error": None})
            except Exception as exc:
                elapsed_ms = int((time.perf_counter() - t0) * 1000)
                scored = _failure_row(persona, run_i, elapsed_ms, f"{type(exc).__name__}: {exc}")
            rows.append(scored)
    return rows


# ---------------------------------------------------------------------------
# Hybrid: generate + solve
# ---------------------------------------------------------------------------

def run_hybrid(n: int, personas: dict[str, Household], meal_pool: list[Meal],
               ingredients: dict[str, Ingredient]) -> list[dict]:
    """generate_meals (here: the cached pool, see deviation note) then solve.solve, scored identically."""
    meals_by_id = {m.id: m for m in meal_pool}
    rows = []
    for persona, hh in personas.items():
        targets = nutrition.targets_for(hh)
        for run_i in range(n):
            try:
                plan = solve_mod.solve(meal_pool, ingredients, hh, targets, time_limit_s=2.0)
                if plan is None:
                    rows.append(_failure_row(persona, run_i, 0, "solve() returned None (infeasible)"))
                    continue
                meals_norm = []
                for mid, times in plan.meals.items():
                    meal = meals_by_id.get(mid)
                    if meal is None:
                        continue
                    meals_norm.append({
                        "slot": meal.slot, "servings": meal.servings,
                        "times_cooked": times, "ingredients": dict(meal.ingredients),
                    })
                cart = [{"ingredient_id": pi.ingredient_id, "packages": pi.packages} for pi in plan.cart]
                scored = score_plan(cart, meals_norm, hh, ingredients)
                scored.update({"persona": persona, "run": run_i, "time_ms": plan.solve_ms, "error": None})
            except Exception as exc:
                scored = _failure_row(persona, run_i, 0, f"{type(exc).__name__}: {exc}")
            rows.append(scored)
    return rows


# ---------------------------------------------------------------------------
# Aggregation and results.md
# ---------------------------------------------------------------------------

def _pct(rows: list[dict], key: str) -> float:
    if not rows:
        return 0.0
    true_count = sum(1 for r in rows if r.get(key) is True)
    return 100.0 * true_count / len(rows)


def _mean(rows: list[dict], key: str) -> float:
    vals = [r[key] for r in rows if r.get(key) is not None]
    if not vals:
        return 0.0
    return sum(vals) / len(vals)


def _summarize(rows: list[dict]) -> dict:
    return {
        "runs": len(rows),
        "pct_over_budget": _pct(rows, "over_budget"),
        "pct_ineligible_on_snap": _pct(rows, "ineligible_on_snap"),
        "pct_all_slots_covered": _pct(rows, "all_slots_covered"),
        "mean_sufficiency_violations": _mean(rows, "sufficiency_violations"),
        "mean_targets_met": _mean(rows, "targets_met_count"),
        "pct_all_targets_met": _pct(rows, "all_targets_met"),
        "mean_time_ms": _mean(rows, "time_ms"),
        "failures": sum(1 for r in rows if r.get("error")),
    }


def _summary_row(label: str, s: dict) -> str:
    return (f"| {label} | {s['runs']} | {s['pct_over_budget']:.0f}% | {s['pct_ineligible_on_snap']:.0f}% | "
            f"{s['pct_all_slots_covered']:.0f}% | {s['mean_sufficiency_violations']:.1f} | "
            f"{s['mean_targets_met']:.1f} / 5 | {s['pct_all_targets_met']:.0f}% | {s['mean_time_ms']:.0f} |")


def _write_results(baseline_rows: list[dict], hybrid_rows: list[dict], n: int,
                   path: str = "eval/results.md") -> None:
    header_cols = ("| Method | runs | % over budget | % ineligible charged to SNAP | "
                   "% all slots covered | mean sufficiency violations | "
                   "nutrition targets met (of 5) | % all nutrition targets met | mean time (ms) |")
    header_sep = "|---|---|---|---|---|---|---|---|---|"

    lines = []
    lines.append("# Baseline vs. hybrid eval (Phase 4)")
    lines.append("")
    lines.append(f"Model: `{llm.LLM_MODEL}` · Temperature: {TEMPERATURE} · "
                 f"Date: {date.today().isoformat()} · n per persona: {n}")
    lines.append("")
    lines.append("**Deviation from spec:** the hybrid path reuses the cached meal pool "
                 "(`generate.load_cached(\"data/meals.json\")`) instead of calling fresh "
                 "`generate_meals` per run. Fresh generation is a second, uncached LLM call per "
                 "run (9 more calls, more cost and wall time) that mostly reproduces the same pool "
                 "this cache already holds; reusing it keeps the eval cheap and fast while `solve()` "
                 "is still exercised fresh every run. State this if the numbers are quoted.")
    lines.append("")
    lines.append("## Summary")
    lines.append("")
    lines.append(header_cols)
    lines.append(header_sep)
    lines.append(_summary_row("Baseline (plain LLM)", _summarize(baseline_rows)))
    lines.append(_summary_row("Hybrid (generate + solve)", _summarize(hybrid_rows)))
    lines.append("")
    n_fail_b = sum(1 for r in baseline_rows if r.get("error"))
    n_fail_h = sum(1 for r in hybrid_rows if r.get("error"))
    lines.append(f"Parse/solve failures: baseline {n_fail_b}/{len(baseline_rows)}, "
                 f"hybrid {n_fail_h}/{len(hybrid_rows)}.")
    lines.append("")
    lines.append("Notes: percentages are over all attempted runs (a failed run counts as not-over-budget, "
                 "not-ineligible, slots-not-covered, targets-not-met, since its true value is unknown). "
                 "Mean sufficiency violations is averaged over successful runs only. Ingredient-sufficiency "
                 "counts an ingredient as satisfied if packages bought (plus one full package for staples, "
                 "matching solve.py's assume_staples default) cover the grams the plan's meals need.")
    lines.append("")

    lines.append("## Per persona")
    lines.append("")
    lines.append("| Persona | Method | runs | % over budget | % ineligible charged to SNAP | "
                 "% all slots covered | mean sufficiency violations | "
                 "nutrition targets met (of 5) | % all nutrition targets met | mean time (ms) |")
    lines.append("|---|---|---|---|---|---|---|---|---|---|")
    personas = list(dict.fromkeys(r["persona"] for r in baseline_rows + hybrid_rows))
    for persona in personas:
        b = [r for r in baseline_rows if r["persona"] == persona]
        h = [r for r in hybrid_rows if r["persona"] == persona]
        sb, sh = _summarize(b), _summarize(h)
        lines.append(f"| {persona} | Baseline | {sb['runs']} | {sb['pct_over_budget']:.0f}% | "
                     f"{sb['pct_ineligible_on_snap']:.0f}% | {sb['pct_all_slots_covered']:.0f}% | "
                     f"{sb['mean_sufficiency_violations']:.1f} | {sb['mean_targets_met']:.1f} / 5 | "
                     f"{sb['pct_all_targets_met']:.0f}% | "
                     f"{sb['mean_time_ms']:.0f} |")
        lines.append(f"| {persona} | Hybrid | {sh['runs']} | {sh['pct_over_budget']:.0f}% | "
                     f"{sh['pct_ineligible_on_snap']:.0f}% | {sh['pct_all_slots_covered']:.0f}% | "
                     f"{sh['mean_sufficiency_violations']:.1f} | {sh['mean_targets_met']:.1f} / 5 | "
                     f"{sh['pct_all_targets_met']:.0f}% | "
                     f"{sh['mean_time_ms']:.0f} |")
    lines.append("")

    lines.append("## Raw per-run rows")
    lines.append("")
    lines.append("| Method | Persona | Run | Basket | EBT | Cash | Over budget | Ineligible on SNAP | "
                 "Slots covered | Suff. violations | Targets met (of 5) | All targets met | Error |")
    lines.append("|---|---|---|---|---|---|---|---|---|---|---|---|---|")
    for label, rows in (("Baseline", baseline_rows), ("Hybrid", hybrid_rows)):
        for r in rows:
            lines.append(
                f"| {label} | {r['persona']} | {r['run']} | {_dollars(r['basket_cents'])} | "
                f"{_dollars(r['ebt_cents'])} | {_dollars(r['cash_cents'])} | {r['over_budget']} | "
                f"{r['ineligible_on_snap']} | {r['all_slots_covered']} | "
                f"{r['sufficiency_violations']} | {r['targets_met_count']} | {r['all_targets_met']} | {r.get('error') or ''} |"
            )
    lines.append("")

    with open(path, "w", encoding="utf-8") as fh:
        fh.write("\n".join(lines) + "\n")


def main() -> None:
    n = 3
    ingredients = load_ingredients("data/ingredients.csv")
    meal_pool = generate.load_cached("data/meals.json")
    personas = build_personas(ingredients)

    print(f"running baseline: {n} runs x {len(personas)} personas ({n * len(personas)} LLM calls)")
    baseline_rows = run_baseline(n, personas, ingredients)
    print(f"running hybrid: {n} runs x {len(personas)} personas")
    hybrid_rows = run_hybrid(n, personas, meal_pool, ingredients)

    _write_results(baseline_rows, hybrid_rows, n)
    print("wrote eval/results.md")


if __name__ == "__main__":
    main()
