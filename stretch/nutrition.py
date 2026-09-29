from .schemas import Diet, Household, Ingredient, NutrientTargets

KCAL_DAY = 2000
PROTEIN_DAY = 50
FIBER_DAY = 25
SODIUM_DAY = 2300
SUGAR_DAY = 50

MEALS_PER_DAY = 3

DIET_TAGS: dict[str, set[str]] = {
    "vegetarian": {"meat", "poultry", "fish", "shellfish", "gelatin"},
    "vegan": {"meat", "poultry", "fish", "shellfish", "gelatin", "dairy", "egg"},
    "halal": {"pork", "alcohol", "gelatin"},
    "kosher": {"pork", "shellfish", "gelatin"},
}


def targets_for(household: Household) -> NutrientTargets:
    """Per-person daily baselines scaled to the trip, less the share school meals cover."""
    d = household.trip_days
    p = household.people
    person_days = d * p

    school_meals = round(household.school_breakfasts * d / 7) + round(household.school_lunches * d / 7)
    total_meals = person_days * MEALS_PER_DAY
    covered = min(school_meals, total_meals)
    share = (total_meals - covered) / total_meals if total_meals else 0.0

    return NutrientTargets(
        kcal_min=round(KCAL_DAY * person_days * share),
        protein_g_min=round(PROTEIN_DAY * person_days * share),
        fiber_g_min=round(FIBER_DAY * person_days * share),
        sodium_mg_max=round(SODIUM_DAY * person_days * share),
        sugar_g_max=round(SUGAR_DAY * person_days * share),
    )


def diet_exclusions(diet: list[Diet], ingredients: dict[str, Ingredient]) -> list[str]:
    """Ingredient ids whose tags collide with the chosen diets (simplified rules)."""
    banned: set[str] = set()
    for d in diet:
        banned |= DIET_TAGS.get(d, set())
    if not banned:
        return []
    return sorted(i.id for i in ingredients.values() if banned & set(i.tags))
