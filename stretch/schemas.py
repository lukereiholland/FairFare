import csv
from datetime import date
from typing import Literal

from pydantic import BaseModel, Field

Slot = Literal["breakfast", "lunch", "dinner"]
Equipment = Literal["stovetop", "microwave", "oven"]
Diet = Literal["vegetarian", "vegan", "halal", "kosher"]
PantryLevel = Literal["full", "half", "low"]


class Ingredient(BaseModel):
    id: str
    name: str
    kroger_product: str
    package_g: int
    price_cents: int
    ebt_eligible: bool
    kcal_100g: float
    protein_100g: float
    fiber_100g: float
    sodium_mg_100g: float
    sugar_100g: float
    perishable_days: int
    tags: list[str] = []
    aisle: str = "other"
    staple: bool = False
    price_source: Literal["csv", "api"] = "csv"
    in_stock: bool = True


class Store(BaseModel):
    location_id: str
    name: str
    address: str
    distance_miles: float


class Meal(BaseModel):
    id: str
    name: str
    slot: Slot
    servings: int
    prep_min: int
    equipment: list[Equipment]
    palatability: int = Field(ge=1, le=5)
    ingredients: dict[str, int]
    description: str = ""          # one plain sentence shown under the name


class PantryItem(BaseModel):
    ingredient_id: str
    level: PantryLevel
    source: Literal["photo", "text", "manual", "staple"]


class Household(BaseModel):
    people: int
    trip_days: int = 7
    deposit_date: date | None = None
    school_breakfasts: int = 0
    school_lunches: int = 0
    ebt_cents: int
    cash_cents: int
    snap_only: bool = False
    max_prep_min: int = 30
    equipment: list[Equipment] = ["stovetop", "microwave"]
    diet: list[Diet] = []
    excluded_ingredients: list[str] = []
    excluded_meals: list[str] = []
    accepted_meals: list[str] | None = None
    required_meals: list[str] = []   # meals the user pinned; the solver cooks each at least once when the budget allows
    favorite_meals: list[str] = []   # the user's cookbook; the solver leans toward these (objective bonus, never a constraint)
    card_covers_snap_gap: bool = False  # opt-in: SNAP-eligible food that does not fit under the SNAP cap goes on the card, out of cash_cents
    store: str = "kroger"            # which store's prices to plan with; see stretch/stores.py
    zip_code: str = ""               # for the nearest-branch lookup only; the solver ignores it
    out_of_stock: list[str] = []
    pantry: dict[str, int] = {}
    assume_staples: bool = True
    use_more_snap: bool = False   # override the pacing cap and allow the full SNAP balance this trip


class NutrientTargets(BaseModel):
    kcal_min: int
    protein_g_min: int
    fiber_g_min: int
    sodium_mg_max: int
    sugar_g_max: int


class PlanItem(BaseModel):
    ingredient_id: str
    packages: int
    line_cents: int
    ebt_eligible: bool
    aisle: str


class DaySchedule(BaseModel):
    day: int                       # 1-based
    breakfast: str | None          # meal id, "school", or None when nothing covers it
    lunch: str | None
    dinner: str | None


class NearbyStore(BaseModel):        # nearest branch of a chain to the household's ZIP, from OpenStreetMap
    store: str                       # store id, e.g. "walmart"
    name: str
    address: str
    distance_miles: float
    lat: float
    lon: float
    maps_url: str


class MealFacts(BaseModel):          # per-meal display facts, computed in solve.meal_facts from real ingredient data
    meal_id: str
    serving_cents: int               # ingredient cost per serving, pro-rated by weight; assumed staples free
    kcal: int                        # per serving
    protein_g: int
    fiber_g: int
    sodium_mg: int
    snap_eligible: bool              # every ingredient is EBT-eligible
    cash_ingredients: list[str] = []
    tags: list[str] = []             # quick, no-cook, microwave, oven, budget, high-protein, high-fiber


class Plan(BaseModel):
    meals: dict[str, int]
    cart: list[PlanItem]
    ebt_cents: int
    cash_cents: int
    basket_cents: int
    cash_remaining_cents: int
    eligible_pct: int
    trips_covered: float
    covers_until: date
    from_pantry: dict[str, int]
    nutrition: dict[str, float]
    targets: NutrientTargets
    shortfalls: dict[str, float]
    what_changed: str | None
    solve_ms: int
    # pacing: how this trip sits against the balance that must last until the deposit
    trip_snap_cap_cents: int = 0          # SNAP the solver was allowed to spend this trip
    snap_remaining_after_cents: int = 0   # household.ebt_cents - ebt_cents
    days_remaining_after: int = 0         # days from covers_until to the deposit; 0 without a date
    on_pace: bool = True
    projected_run_out_date: date | None = None
    # the plan as a plan
    schedule: list[DaySchedule] = []
    leftovers: dict[str, int] = {}        # ingredient_id -> grams left after the trip (bought + pantry - used)
    uncovered: dict[str, int] = {}        # slot -> servings the budget could not cover (empty when all covered)
    relaxed: list[str] = []               # rules loosened to find a plan: "variety", "repeats", "slots"
    staples_assumed: list[str] = []       # ingredient ids treated as already on hand
    meal_serving_cents: dict[str, int] = {}  # meal_id -> ingredient cost per serving, pro-rated by weight from package prices
    meal_cost_cents: dict[str, int] = {}     # chosen meal_id -> approximate ingredient cost of all its batches this trip
    snap_overflow_cents: int = 0             # SNAP-eligible food charged to the card because it did not fit under the SNAP cap


def _to_bool(value: str, field: str, row_no: int) -> bool:
    v = (value or "").strip().lower()
    if v in ("true", "1", "yes", "y"):
        return True
    if v in ("false", "0", "no", "n", ""):
        return False
    raise ValueError(f"ingredients.csv row {row_no}: {field} is not a boolean: {value!r}")


def load_ingredients(path: str = "data/ingredients.csv") -> dict[str, Ingredient]:
    """Read the ingredient CSV into id -> Ingredient, failing loudly on any bad row."""
    out: dict[str, Ingredient] = {}
    with open(path, newline="", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        for row_no, row in enumerate(reader, start=2):
            if not (row.get("id") or "").strip():
                continue
            try:
                ing = Ingredient(
                    id=row["id"].strip(),
                    name=row["name"].strip(),
                    kroger_product=row["kroger_product"].strip(),
                    package_g=int(row["package_g"]),
                    price_cents=int(row["price_cents"]),
                    ebt_eligible=_to_bool(row["ebt_eligible"], "ebt_eligible", row_no),
                    kcal_100g=float(row["kcal_100g"]),
                    protein_100g=float(row["protein_100g"]),
                    fiber_100g=float(row["fiber_100g"]),
                    sodium_mg_100g=float(row["sodium_mg_100g"]),
                    sugar_100g=float(row["sugar_100g"]),
                    perishable_days=int(row["perishable_days"]),
                    tags=[t for t in (row.get("tags") or "").split("|") if t.strip()],
                    aisle=(row.get("aisle") or "other").strip() or "other",
                    staple=_to_bool(row.get("staple", ""), "staple", row_no),
                )
            except (KeyError, TypeError, ValueError) as exc:
                raise ValueError(f"ingredients.csv row {row_no} is invalid: {exc}") from exc
            if ing.id in out:
                raise ValueError(f"ingredients.csv row {row_no}: duplicate id {ing.id!r}")
            out[ing.id] = ing
    if not out:
        raise ValueError(f"{path} contained no ingredient rows")
    return out
