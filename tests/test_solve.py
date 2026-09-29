from datetime import date, timedelta

from stretch.nutrition import targets_for
from stretch.solve import solve
from tests.fixtures import INGREDIENTS, MEALS, make_household

MEALS_BY_ID = {m.id: m for m in MEALS}


def _solve(hh):
    return solve(MEALS, INGREDIENTS, hh, targets_for(hh))


def _grams_used(plan) -> dict[str, int]:
    used: dict[str, int] = {}
    for mid, times in plan.meals.items():
        for iid, grams in MEALS_BY_ID[mid].ingredients.items():
            used[iid] = used.get(iid, 0) + times * grams
    return used


def _total_servings(plan) -> int:
    return sum(times * MEALS_BY_ID[mid].servings for mid, times in plan.meals.items())


def test_returns_plan():
    plan = _solve(make_household())
    assert plan is not None
    assert plan.meals
    assert plan.cart


def test_ingredient_sufficiency():
    hh = make_household()
    plan = _solve(hh)
    packs = {c.ingredient_id: c.packages for c in plan.cart}
    for iid, grams in _grams_used(plan).items():
        ing = INGREDIENTS[iid]
        pantry = hh.pantry.get(iid, 0)
        if hh.assume_staples and ing.staple:
            pantry = max(pantry, ing.package_g)
        assert grams <= packs.get(iid, 0) * ing.package_g + pantry, iid


def test_budgets_and_totals_agree():
    hh = make_household()
    plan = _solve(hh)
    assert plan.ebt_cents <= hh.ebt_cents
    assert plan.cash_cents <= hh.cash_cents
    line_sum = sum(c.line_cents for c in plan.cart)
    assert plan.ebt_cents + plan.cash_cents == line_sum == plan.basket_cents
    assert plan.cash_remaining_cents == hh.cash_cents - plan.cash_cents


def test_out_of_stock_removes_ingredient():
    # rotisserie_chicken is unique to one dinner; with trip_days=4 the variety floor is 5 of 6
    # meals, so the solver is free to drop that dinner rather than fail.
    base = _solve(make_household(trip_days=4))
    assert any(c.ingredient_id == "rotisserie_chicken" for c in base.cart)
    plan = _solve(make_household(trip_days=4, out_of_stock=["rotisserie_chicken"]))
    assert plan is not None
    assert all(c.ingredient_id != "rotisserie_chicken" for c in plan.cart)


def test_pantry_reduces_packages():
    base = _solve(make_household())
    target = next(c for c in base.cart if not INGREDIENTS[c.ingredient_id].staple)
    hh = make_household(pantry={target.ingredient_id: INGREDIENTS[target.ingredient_id].package_g})
    plan = _solve(hh)
    after = next((c.packages for c in plan.cart if c.ingredient_id == target.ingredient_id), 0)
    assert after <= target.packages - 1
    assert plan.from_pantry.get(target.ingredient_id, 0) > 0


def test_fewer_days_fewer_servings():
    short = _solve(make_household(trip_days=3))
    long = _solve(make_household(trip_days=7))
    assert _total_servings(short) < _total_servings(long)


def test_servings_capped_near_need():
    hh = make_household()
    plan = _solve(hh)
    for slot in ("breakfast", "lunch", "dinner"):
        slot_meals = [m for m in MEALS if m.slot == slot]
        served = sum(times * MEALS_BY_ID[mid].servings for mid, times in plan.meals.items()
                     if MEALS_BY_ID[mid].slot == slot)
        need = hh.trip_days * hh.people
        assert need <= served <= need + max(m.servings for m in slot_meals), slot


def test_pacing_cap_binds_when_deposit_is_far():
    # $60 must last 34 days; a 7-day trip may only use 60 * 7 / 34 = $12.35 of it.
    hh = make_household(ebt_cents=6000, cash_cents=0, deposit_date=date.today() + timedelta(days=34))
    plan = _solve(hh)
    assert plan is not None
    assert plan.trip_snap_cap_cents == 6000 * 7 // 34 == 1235
    assert plan.ebt_cents <= 1235
    assert plan.on_pace
    assert plan.days_remaining_after == 27
    assert sum(plan.uncovered.values()) > 0 and "slots" in plan.relaxed  # $12 cannot cover 42 servings
    assert plan.staples_assumed == ["vegetable_oil"]


def test_use_more_snap_lifts_the_cap():
    hh = make_household(ebt_cents=6000, cash_cents=2000, deposit_date=date.today() + timedelta(days=34),
                        use_more_snap=True)
    plan = _solve(hh)
    assert plan.trip_snap_cap_cents == 6000
    assert plan.uncovered == {} and plan.relaxed == []
    assert not plan.on_pace
    assert plan.projected_run_out_date is not None
    assert plan.snap_remaining_after_cents == 6000 - plan.ebt_cents


def test_cap_equals_balance_when_trip_matches_deposit():
    hh = make_household(deposit_date=date.today() + timedelta(days=7))
    plan = _solve(hh)
    assert plan.trip_snap_cap_cents == hh.ebt_cents
    assert plan.days_remaining_after == 0 and plan.on_pace


def test_tiny_budget_returns_partial_plan_not_none():
    plan = _solve(make_household(ebt_cents=500, cash_cents=0))
    assert plan is not None
    assert plan.ebt_cents <= 500
    assert sum(plan.uncovered.values()) > 0
    assert plan.relaxed


def test_schedule_and_leftovers_are_consistent():
    hh = make_household()
    plan = _solve(hh)
    assert len(plan.schedule) == hh.trip_days
    for day in plan.schedule:
        for mid in (day.breakfast, day.lunch, day.dinner):
            assert mid in plan.meals, mid
    cart_ids = {c.ingredient_id for c in plan.cart}
    assert set(plan.leftovers) <= cart_ids
    assert all(g > 0 for g in plan.leftovers.values())


def test_staples_not_bought_when_assumed():
    hh = make_household(assume_staples=True)
    plan = _solve(hh)
    used = _grams_used(plan)
    for c in plan.cart:
        ing = INGREDIENTS[c.ingredient_id]
        if ing.staple:
            assert used.get(c.ingredient_id, 0) > ing.package_g, "staple bought before pantry exhausted"
    assert "vegetable_oil" not in {c.ingredient_id for c in plan.cart}


def test_meal_serving_cents_is_prorated_ingredient_cost():
    hh = make_household()
    plan = solve(MEALS, INGREDIENTS, hh, targets_for(hh))
    assert plan is not None
    assert set(plan.meal_serving_cents) == {m.id for m in MEALS}
    for m in MEALS:
        expected = round(sum(
            g * INGREDIENTS[i].price_cents / INGREDIENTS[i].package_g
            for i, g in m.ingredients.items()
            if not (hh.assume_staples and INGREDIENTS[i].staple)
        ) / max(1, m.servings))
        assert plan.meal_serving_cents[m.id] == expected
    assert any(v > 0 for v in plan.meal_serving_cents.values())


def test_pinned_meal_is_cooked_at_least_once():
    hh = make_household()
    base = solve(MEALS, INGREDIENTS, hh, targets_for(hh))
    assert base is not None
    unused = [m.id for m in MEALS if m.id not in base.meals]
    if not unused:
        return  # every fixture meal already chosen; nothing to pin
    pinned = solve(MEALS, INGREDIENTS, make_household(required_meals=[unused[0]]), targets_for(hh))
    assert pinned is not None
    assert pinned.meals.get(unused[0], 0) >= 1
    assert "pins" not in pinned.relaxed


def test_pin_that_cannot_fit_is_dropped_and_reported():
    from stretch.solve import _serving_cents
    priciest = max(MEALS, key=lambda m: _serving_cents(m, INGREDIENTS) * m.servings)
    hh = make_household(ebt_cents=300, cash_cents=0, required_meals=[priciest.id])
    plan = solve(MEALS, INGREDIENTS, hh, targets_for(hh))
    assert plan is not None
    assert priciest.id not in plan.meals
    assert "pins" in plan.relaxed


def test_meal_facts_match_solver_costs_and_flag_cash_items():
    from stretch.solve import meal_facts
    hh = make_household()
    plan = solve(MEALS, INGREDIENTS, hh, targets_for(hh))
    facts = meal_facts(MEALS, INGREDIENTS)
    assert set(facts) == {m.id for m in MEALS}
    for m in MEALS:
        f = facts[m.id]
        assert f.serving_cents == plan.meal_serving_cents[m.id]
        cash = [i for i in m.ingredients if not INGREDIENTS[i].ebt_eligible]
        assert f.snap_eligible == (not cash)
        assert f.cash_ingredients == cash
        assert ("quick" in f.tags) == (m.prep_min <= 15)
        assert f.kcal >= 0 and f.protein_g >= 0
    assert any("budget" in f.tags for f in facts.values())
    for mid, n in plan.meals.items():
        meal = next(m for m in MEALS if m.id == mid)
        assert plan.meal_cost_cents[mid] == plan.meal_serving_cents[mid] * meal.servings * n


def test_saved_recipes_are_never_cooked_less():
    hh = make_household()
    base = solve(MEALS, INGREDIENTS, hh, targets_for(hh))
    assert base is not None
    for m in MEALS:
        fav = solve(MEALS, INGREDIENTS, make_household(favorite_meals=[m.id]), targets_for(hh))
        assert fav is not None
        assert fav.meals.get(m.id, 0) >= base.meals.get(m.id, 0)
        assert fav.ebt_cents <= hh.ebt_cents and fav.cash_cents <= hh.cash_cents


def test_card_can_cover_snap_gap_only_when_opted_in():
    from stretch.solve import _serving_cents
    priciest = max(MEALS, key=lambda m: _serving_cents(m, INGREDIENTS) * m.servings)
    base = make_household(ebt_cents=300, cash_cents=5000, required_meals=[priciest.id])
    plan = solve(MEALS, INGREDIENTS, base, targets_for(base))
    assert plan is not None and "pins" in plan.relaxed and plan.snap_overflow_cents == 0

    hh = make_household(ebt_cents=300, cash_cents=5000, required_meals=[priciest.id], card_covers_snap_gap=True)
    plan = solve(MEALS, INGREDIENTS, hh, targets_for(hh))
    assert plan is not None
    assert plan.meals.get(priciest.id, 0) >= 1
    assert plan.ebt_cents <= hh.ebt_cents
    assert plan.cash_cents <= hh.cash_cents
    assert plan.basket_cents == plan.ebt_cents + plan.cash_cents == sum(c.line_cents for c in plan.cart)
    assert plan.snap_overflow_cents > 0
