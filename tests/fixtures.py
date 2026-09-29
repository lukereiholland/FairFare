# Synthetic test data only. These prices are fixtures for the solver tests and are NOT
# real Kroger prices; real prices live only in data/ingredients.csv, entered by a human.
from stretch.schemas import Household, Ingredient, Meal


def _ing(**kw) -> Ingredient:
    return Ingredient(**kw)


INGREDIENTS: dict[str, Ingredient] = {i.id: i for i in [
    _ing(id="rice", name="Long grain rice", kroger_product="Kroger Long Grain Rice 2 lb",
         package_g=907, price_cents=199, ebt_eligible=True, kcal_100g=360, protein_100g=7,
         fiber_100g=1, sodium_mg_100g=5, sugar_100g=0, perishable_days=0, aisle="dry"),
    _ing(id="black_beans", name="Black beans (can)", kroger_product="Kroger Black Beans 15 oz",
         package_g=425, price_cents=89, ebt_eligible=True, kcal_100g=90, protein_100g=6,
         fiber_100g=7, sodium_mg_100g=300, sugar_100g=0, perishable_days=0, aisle="canned"),
    _ing(id="eggs", name="Eggs (dozen)", kroger_product="Kroger Grade A Large Eggs 12 ct",
         package_g=600, price_cents=249, ebt_eligible=True, kcal_100g=143, protein_100g=13,
         fiber_100g=0, sodium_mg_100g=140, sugar_100g=1, perishable_days=21, tags=["egg"],
         aisle="dairy"),
    _ing(id="chicken_thighs", name="Chicken thighs", kroger_product="Kroger Chicken Thighs 2 lb",
         package_g=900, price_cents=549, ebt_eligible=True, kcal_100g=180, protein_100g=20,
         fiber_100g=0, sodium_mg_100g=80, sugar_100g=0, perishable_days=3,
         tags=["meat", "poultry"], aisle="meat"),
    _ing(id="frozen_spinach", name="Frozen spinach", kroger_product="Kroger Chopped Spinach 16 oz",
         package_g=454, price_cents=129, ebt_eligible=True, kcal_100g=25, protein_100g=3,
         fiber_100g=2.5, sodium_mg_100g=70, sugar_100g=0.5, perishable_days=0, aisle="frozen"),
    _ing(id="onions", name="Yellow onions", kroger_product="Yellow Onions 2 lb bag",
         package_g=900, price_cents=179, ebt_eligible=True, kcal_100g=40, protein_100g=1,
         fiber_100g=1.7, sodium_mg_100g=4, sugar_100g=4, perishable_days=21, aisle="produce"),
    _ing(id="tortillas", name="Flour tortillas", kroger_product="Kroger Flour Tortillas 10 ct",
         package_g=500, price_cents=229, ebt_eligible=True, kcal_100g=300, protein_100g=8,
         fiber_100g=3, sodium_mg_100g=600, sugar_100g=2, perishable_days=14, aisle="bakery"),
    _ing(id="cheddar", name="Cheddar cheese", kroger_product="Kroger Sharp Cheddar 8 oz",
         package_g=226, price_cents=279, ebt_eligible=True, kcal_100g=400, protein_100g=25,
         fiber_100g=0, sodium_mg_100g=620, sugar_100g=0.5, perishable_days=21, tags=["dairy"],
         aisle="dairy"),
    _ing(id="vegetable_oil", name="Vegetable oil", kroger_product="Kroger Vegetable Oil 48 oz",
         package_g=1000, price_cents=399, ebt_eligible=True, kcal_100g=884, protein_100g=0,
         fiber_100g=0, sodium_mg_100g=0, sugar_100g=0, perishable_days=0, aisle="dry",
         staple=True),
    _ing(id="rotisserie_chicken", name="Rotisserie chicken (hot)",
         kroger_product="Kroger Rotisserie Chicken", package_g=900, price_cents=699,
         ebt_eligible=False, kcal_100g=200, protein_100g=25, fiber_100g=0,
         sodium_mg_100g=400, sugar_100g=0, perishable_days=2, tags=["meat", "poultry"],
         aisle="other"),
]}


MEALS: list[Meal] = [
    Meal(id="veggie_scramble", name="Veggie scramble", slot="breakfast", servings=6, prep_min=15,
         equipment=["stovetop"], palatability=4,
         ingredients={"eggs": 300, "frozen_spinach": 100, "onions": 50, "vegetable_oil": 10}),
    Meal(id="rice_porridge", name="Rice porridge with egg", slot="breakfast", servings=6,
         prep_min=20, equipment=["stovetop"], palatability=2,
         ingredients={"rice": 200, "eggs": 100, "vegetable_oil": 5}),
    Meal(id="bean_burritos", name="Bean and cheese burritos", slot="lunch", servings=6,
         prep_min=15, equipment=["stovetop"], palatability=4,
         ingredients={"tortillas": 300, "black_beans": 425, "cheddar": 100, "onions": 50}),
    Meal(id="rice_and_beans", name="Rice and beans", slot="lunch", servings=6, prep_min=25,
         equipment=["stovetop"], palatability=4,
         ingredients={"rice": 300, "black_beans": 425, "onions": 100, "vegetable_oil": 10}),
    Meal(id="chicken_rice_skillet", name="Chicken and rice skillet", slot="dinner", servings=6,
         prep_min=30, equipment=["stovetop"], palatability=5,
         ingredients={"chicken_thighs": 600, "rice": 300, "frozen_spinach": 200, "onions": 100,
                      "vegetable_oil": 15}),
    Meal(id="rotisserie_plate", name="Rotisserie chicken plate", slot="dinner", servings=6,
         prep_min=10, equipment=["microwave"], palatability=4,
         ingredients={"rotisserie_chicken": 600, "rice": 300, "frozen_spinach": 150}),
]


def make_household(**overrides) -> Household:
    """A clearly feasible two-person, seven-day household; override any field."""
    base = dict(people=2, trip_days=7, ebt_cents=20000, cash_cents=3000)
    base.update(overrides)
    return Household(**base)


HOUSEHOLD: Household = make_household()
