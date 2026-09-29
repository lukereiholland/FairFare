# CLAUDE.md — Stretch

Stretch is a hackathon project (HackGT 13, 33-hour build). It plans meals for one shopping trip for a household on SNAP, against real Kroger prices, using what is already in their pantry, and produces a cart split into EBT and cash with the exact amounts to hand the cashier. An LLM proposes meals; the user accepts or rejects them; an integer program (OR-Tools CP-SAT) chooses which meals to cook and which packages to buy; an LLM agent uses the solver as a tool to adjust the plan from natural language and explain what changed.

One-line architecture: **the LLM proposes, the user chooses, the solver guarantees.**

**Stack, decided:** Python backend (the `stretch/` package, already working) exposed through a small FastAPI layer; a React (Vite) mobile web app as the primary UI; the Streamlit `app.py` kept runnable as the fallback until the demo video is exported. See "Stack and fallback" below.

The product name shown in the UI comes from the `APP_NAME` env var (default `Stretch`). The team may rename it (e.g. `FairFare`); that changes the env var and nothing else. Module and package names stay `stretch`.

Read this whole file before writing or changing any code. Follow the contracts exactly. Do not add features that are not listed here.

---

## Status and build order

The backend (`schemas`, `ingredients.csv`, `generate`, `nutrition`, `solve`) is **done and tested**. Everything below builds on it; do not rewrite it.

Work is gated. Ask the human which phase is active if it is not obvious from the repo state. Do not start a later phase until the earlier one is done and checked on a phone.

| Phase | Deliverable | Where | Gate |
|---|---|---|---|
| B1 | FastAPI wrapper: `/ingredients`, `/meals`, `/solve`, `/pantry/detect`, `/agent/turn` | `api/main.py` | `/solve` returns a real `Plan` via curl. **Hour 1.** |
| F1 | Plan screen: two big numbers, payment card, day list, budget sliders, SNAP-only toggle, accept/reject drawer, thumbs-down, scorecard, what-changed line | `web/` | Real numbers on a phone over the hotspot. **Hour 4.** |
| F2 | Quiz (first run): five questions, skip-with-defaults | `web/` | Completing it produces a plan. |
| F3 | Pantry screen: photo, text, staples chips, confirm → re-solve | `web/`, `stretch/pantry.py` | Photo → confirmed list → cart shrinks. **Hour 6.** |
| F4 | List screen + full-screen Register mode | `web/` | Out-of-stock toggle re-solves; register shows two numbers. **Hour 7. Freeze.** |
| 3 | Agent: chat drawer on Plan wired to `/agent/turn` | `stretch/agent.py`, `web/` | Only after F4 |
| 4 | Baseline eval | `eval/baseline.py` | Only after F4 |
| 2b / 2c / 5 | Live prices / SQLite / MCP | as before | Only after 3 and 4, if the video is already recorded |

**Fallback rule:** `app.py` (Streamlit) stays runnable the whole time. If F1 has not shown a real plan on a phone by hour 6, record the demo video in Streamlit and put the React UI on the roadmap slide. Nobody deletes or breaks `app.py` until the video is exported. Do not add new features to `app.py`; it is frozen at what it does now.

### Not this weekend

A longer product vision for this project exists (a 12-stage "FairFare" pipeline) and a nine-screen UI spec with a recipe feed, cookbook, profile, stores screen and infinite scroll. Both are vision documents, not specs. If either appears in the repo or in a prompt, do not build from it. Deliberately **out of scope**:

- Web search for recipes, or scraping recipe sites for nutrition
- Multiple retailers, retailer comparison tables, per-store "price multipliers" (a multiplier is an invented price), or any store other than the one Kroger location
- A separate "substitution agent" — substitution is the solver choosing among candidates already in the ingredient list
- An iterative "re-optimize until under budget" loop, or any money arithmetic outside `solve.py` — the solver enforces the budget as a hard constraint in one solve
- Separate agents for eligibility, retail search, consolidation, or nutrition scoring
- Fitness goals, macro targets, calorie targets per person, cooking skill level
- Expiration tracking, delivery, real retailer cart handoff or checkout integration
- Any new agent beyond the one in `agent.py`
- UI: Home/recipe feed, Recipe Detail screen, Cookbook, Profile/avatar, Stores screen, geolocation, speech recognition, infinite scroll, donut charts, cosmetic ratings, "difficulty to find" tags or sourcing-friction sentences (invented data), accounts, login

---

## Non-negotiables

1. **All solver math is integers.** Weights in grams, money in cents, nutrients pre-multiplied into integer coefficients. No floats anywhere in the CP-SAT model.
2. **Use OR-Tools CP-SAT.** Not PuLP, not scipy, not a greedy heuristic. `from ortools.sat.python import cp_model`.
3. **Never invent prices.** A price is either typed by a human from a real Kroger store into `data/ingredients.csv`, or returned by the Kroger API for a specific store (Phase 2b). Do not generate, estimate, or "fill in" a price. Nutrition values may be estimated; prices may not.
4. **Every module is a pure function with the signature in this file.** No global state, no side effects except where noted (caching to disk in `generate.py`; the per-session meal pool in `api/main.py`).
5. **Schemas in `stretch/schemas.py` are the single source of truth.** Import them; do not redefine fields, rename them, or add optional ones without updating this file. The API returns them as JSON with the same field names; the frontend TypeScript types mirror them exactly.
6. **Every dollar figure on every screen comes from `/solve`.** The frontend formats cents as `$X.XX` and does nothing else with money: no sums, no mins, no "eligible fraction" math, no per-store estimates. If a number is not in the `Plan`, it is not on the screen.
7. **Do not add medical or nutrition advice text.** The app is a planning tool. Nutrition appears only as "met / X% of target." Never grade a food or a user.
8. **All LLM calls go through `stretch/llm.py`.** No module imports a provider SDK directly. Swapping the model or provider is a one-file change.
9. **Never claim quantities from a photo.** The pantry photo yields `full` / `half` / `low` levels the user confirms; grams are derived from those levels and package sizes, and the UI says "estimated."
10. **Never imply a live EBT connection.** Every balance and date is typed by the user, and the disclaimer "Entered manually — not connected to your EBT account" appears wherever a balance is shown or edited.
11. **Say "this trip" and "until your deposit." Never "this week"** in UI copy.

---

## Stack and fallback

| Layer | Choice | Notes |
|---|---|---|
| Backend language | Python 3.11 or 3.12 | The `stretch/` package. Done. |
| Package manager | `uv` if installed, else `pip` + venv | `uv venv && uv pip install -r requirements.txt` |
| Data models | Pydantic v2 | `model_validate`, `model_dump`; the API serves these as JSON |
| Solver | OR-Tools CP-SAT | `from ortools.sat.python import cp_model` |
| LLM access | `openai` Python SDK pointed at the provider's OpenAI-compatible endpoint | Provider chosen by env vars; see `llm.py` |
| API | FastAPI + uvicorn | `api/main.py`; CORS open to the Vite dev origin and the LAN IP |
| Frontend (primary) | React 18 + Vite + TypeScript, plain CSS with variables | `web/`; no UI framework, no Tailwind, no component library |
| Icons | `lucide-react` | single color via `currentColor`; no emoji |
| Fonts | Fraunces (display), Karla (body) via Google Fonts `<link>` | with system fallbacks |
| Frontend (fallback) | Streamlit `app.py` | Frozen; kept runnable until the video is exported |
| Tests | pytest (backend) | `pytest -q` must pass before any merge. No frontend test suite this weekend. |
| Env | `python-dotenv`, `.env` file | Never commit `.env` |
| MCP (Phase 5 only) | `fastmcp` | stdio transport |

`requirements.txt` (install latest; pin only if something breaks):
```
ortools>=9.10
pydantic>=2.7
fastapi>=0.111
uvicorn[standard]>=0.30
python-multipart>=0.0.9
streamlit>=1.36
openai>=1.40
python-dotenv>=1.0
requests>=2.31
pytest>=8.0
httpx>=0.27        # for API tests
fastmcp>=2.0      # Phase 5 only; comment out until then
```

`.env.example` (copy to `.env` and fill in):
```
APP_NAME=Stretch       # product name shown in the UI; rename here only
LLM_BASE_URL=          # e.g. https://api.x.ai/v1  or  https://api.openai.com/v1
LLM_API_KEY=
LLM_MODEL=             # exact model id for the provider above; must support images for F3
LLM_TEMPERATURE=0.7
API_HOST=0.0.0.0       # so the phone can reach the API over the hotspot
API_PORT=8000
CORS_ORIGINS=http://localhost:5173,http://192.168.0.0/16   # add the laptop's LAN origin explicitly if this doesn't match
KROGER_CLIENT_ID=      # Phase 2b only; leave blank to disable live prices
KROGER_CLIENT_SECRET=
DEFAULT_ZIP=30311      # southwest Atlanta; used to find nearby stores
```

`web/.env.example`:
```
VITE_API_URL=http://192.168.x.x:8000   # the laptop's hotspot IP, not localhost, or the phone can't reach it
VITE_APP_NAME=Stretch
```

`.gitignore`: `.env`, `web/.env`, `.venv/`, `__pycache__/`, `web/node_modules/`, `web/dist/`, `data/stretch.db`, `data/prices_cache.json`. `data/meals.json` is **committed** (it is the cache the demo depends on); `eval/results.md` is committed.

Run commands:
```
pytest -q                                   # backend tests
uvicorn api.main:app --host 0.0.0.0 --port 8000 --reload   # API
cd web && npm run dev -- --host             # frontend, reachable from the phone
streamlit run app.py                        # fallback UI
python -m stretch.generate                  # regenerate data/meals.json (deletes the old cache first)
python -m eval.baseline                     # Phase 4
python mcp_server.py                        # Phase 5
```

Phone access: laptop and phone on the same hotspot; open `http://<laptop-ip>:5173` on the phone. Vite must run with `--host`. `VITE_API_URL` must be the laptop's IP. Disable phone auto-lock before recording.

Git: one branch per module (`api`, `web-plan`, `web-pantry`, `web-list`), merge to `main` when it works on a phone. There is no time for review cycles.

---

## `stretch/llm.py`

```python
def complete(messages: list[dict],
             tools: list[dict] | None = None,
             json_only: bool = False,
             temperature: float | None = None,
             images: list[bytes] | None = None) -> dict
```

- Builds one `openai.OpenAI(base_url=LLM_BASE_URL, api_key=LLM_API_KEY)` client at import time.
- Calls `chat.completions.create` with `model=LLM_MODEL`. If `json_only`, set `response_format={"type": "json_object"}` when the provider supports it and always strip markdown fences from the reply before returning.
- If `images` is given, attach each as a base64 `image_url` content part on the **last user message** (OpenAI-compatible vision format). Downscale to max 1024px on the long side before encoding. F3 only.
- Returns a plain dict: `{"text": str | None, "tool_calls": [{"id", "name", "arguments": dict}] , "raw": response}`. Parse `arguments` from JSON string to dict here so callers never do it.
- Retry once on a network or 5xx error, then raise. No other retry logic.
- One function. No streaming, no async, no caching in this module.

---

## Repo layout

```
stretch/
  schemas.py        Pydantic models (below). Done.
  llm.py            the only module that talks to an LLM provider
  generate.py       LLM -> list[Meal], cached to data/meals.json. Done.
  solve.py          CP-SAT model. solve(...) -> Plan | None. Done.
  explain.py        diff two Plans -> two-sentence explanation (helper)
  parse.py          free text -> household constraint updates (helper)
  nutrition.py      targets per household; diet -> excluded ingredient ids. Done.
  pantry.py         F3: photo / text / manual -> confirmed PantryItems -> grams
  prices.py         Phase 2b: Kroger API — nearby stores, live price/stock refresh, CSV fallback
  persist.py        Phase 2c, optional: SQLite save/load of households and plans
  agent.py          Phase 3: LLM agent with tools; owns the chat loop
api/
  main.py           B1: FastAPI app; thin wrappers over stretch/*; per-session meal pool
  test_api.py       httpx tests for /solve and /pantry/detect
web/                F1–F4: React + Vite + TypeScript mobile web app
  index.html        Google Fonts link, viewport meta with viewport-fit=cover
  src/
    main.tsx
    App.tsx         router: /quiz, /plan, /pantry, /list, /register
    api.ts          one fetch wrapper per endpoint; the only file that knows VITE_API_URL
    types.ts        TypeScript mirrors of the Pydantic schemas, same field names
    state.tsx       React context: household, plan, prevPlan, pantryItems, sessionId
    styles/tokens.css   the design system variables (below)
    styles/base.css
    screens/Quiz.tsx  Plan.tsx  Pantry.tsx  List.tsx  Register.tsx
    components/       BigNumber, PaymentCard, DayList, MealDrawer, Scorecard,
                      ChangedLine, StapleChips, PantryChecklist, CartGroup, TabBar
data/
  ingredients.csv   80 rows, human-entered prices (the fallback and the contract)
  meals.json        cached output of generate.py
  prices_cache.json Phase 2b: last successful API refresh per store (gitignored)
  stretch.db        Phase 2c: SQLite file (gitignored)
tests/
  fixtures.py       6 meals, 10 ingredients, one household
  test_solve.py
  test_pantry.py    F3
  test_agent.py     Phase 3
eval/
  baseline.py       Phase 4: plain-LLM planner vs. hybrid, writes eval/results.md
app.py              Streamlit fallback UI. Frozen. Keep runnable.
mcp_server.py       Phase 5, optional: FastMCP wrapper around the agent's tools
requirements.txt
.env.example
.gitignore
```

---

## Schemas (`stretch/schemas.py`)

```python
from datetime import date
from typing import Literal
from pydantic import BaseModel, Field

Slot = Literal["breakfast", "lunch", "dinner"]
Equipment = Literal["stovetop", "microwave", "oven"]
Diet = Literal["vegetarian", "vegan", "halal", "kosher"]
PantryLevel = Literal["full", "half", "low"]

class Ingredient(BaseModel):
    id: str                    # snake_case, stable, e.g. "chicken_thighs"
    name: str                  # display name
    kroger_product: str        # exact product name as sold
    package_g: int             # grams per package (or ml for liquids; treat as g)
    price_cents: int           # human-entered, real
    ebt_eligible: bool
    kcal_100g: float
    protein_100g: float
    fiber_100g: float
    sodium_mg_100g: float
    sugar_100g: float          # added sugar where known, total otherwise
    perishable_days: int       # 0 = shelf-stable
    tags: list[str] = []       # from a fixed set: meat, poultry, fish, shellfish, pork, dairy, egg, gelatin, alcohol
    aisle: str = "other"       # produce, meat, dairy, frozen, dry, canned, bakery, other
    staple: bool = False       # salt, cooking oil, common spices, flour, sugar: assumed on hand by default
    price_source: Literal["csv", "api"] = "csv"   # Phase 2b sets "api" on refresh
    in_stock: bool = True                          # Phase 2b may set False

class Store(BaseModel):        # Phase 2b
    location_id: str           # Kroger locationId
    name: str
    address: str
    distance_miles: float

class Meal(BaseModel):
    id: str
    name: str
    slot: Slot
    servings: int              # servings produced by one batch
    prep_min: int
    equipment: list[Equipment]
    palatability: int = Field(ge=1, le=5)
    ingredients: dict[str, int]   # ingredient_id -> grams per batch

class PantryItem(BaseModel):   # F3
    ingredient_id: str
    level: PantryLevel
    source: Literal["photo", "text", "manual", "staple"]

class Household(BaseModel):
    people: int
    trip_days: int = 7            # days this shopping trip must cover (1..14)
    deposit_date: date | None = None   # next SNAP load; user-entered; display only
    school_breakfasts: int = 0    # weekday breakfasts covered by school, per WEEK; solver scales to trip_days
    school_lunches: int = 0
    ebt_cents: int                # SNAP available for this trip (user-entered)
    cash_cents: int               # cash/card available for this trip; 0 when snap_only
    snap_only: bool = False       # UI toggle; when True the API forces cash_cents = 0 before solving
    max_prep_min: int = 30
    equipment: list[Equipment] = ["stovetop", "microwave"]
    diet: list[Diet] = []         # expanded to excluded ingredient ids via nutrition.diet_exclusions
    excluded_ingredients: list[str] = []
    excluded_meals: list[str] = []   # includes meals the user thumbed down
    accepted_meals: list[str] | None = None   # None = all candidates allowed; otherwise only these meal ids
    out_of_stock: list[str] = []  # ingredient ids
    pantry: dict[str, int] = {}   # ingredient_id -> grams already on hand (derived from PantryItems)
    assume_staples: bool = True   # treat every Ingredient.staple as a full package on hand unless the user says otherwise

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

class Plan(BaseModel):
    meals: dict[str, int]         # meal_id -> times cooked
    cart: list[PlanItem]
    ebt_cents: int                # total charged to EBT  ("Planned SNAP payment")
    cash_cents: int               # total charged to cash/card  ("Cash you'll need")
    basket_cents: int             # ebt_cents + cash_cents, computed server-side so the frontend never adds
    cash_remaining_cents: int     # household.cash_cents - cash_cents (may be negative only if the solver returned a shortfall plan; normally >= 0)
    eligible_pct: int             # round(100 * ebt_cents / basket_cents), 0 if basket is 0
    trips_covered: float          # household.ebt_cents / ebt_cents, rounded to 1 decimal; how many trips like this the current SNAP balance covers
    covers_until: date            # today + trip_days
    from_pantry: dict[str, int]   # ingredient_id -> grams used from pantry (F3; empty before)
    nutrition: dict[str, float]   # achieved totals for the trip, keys match NutrientTargets fields minus suffix
    targets: NutrientTargets
    shortfalls: dict[str, float]  # nutrient -> amount short (0 if met)
    what_changed: str | None      # set by the API when the request included prev_plan; else None
    solve_ms: int
```

Everything a screen displays about money is a field on `Plan`. The frontend formats cents to `$X.XX` and formats dates; it never computes.

---

## Data (`data/ingredients.csv`)

Header, in this order, matching `Ingredient`:

```
id,name,kroger_product,package_g,price_cents,ebt_eligible,kcal_100g,protein_100g,fiber_100g,sodium_mg_100g,sugar_100g,perishable_days,tags,aisle,staple
```

`tags` is a `|`-separated list from the fixed set `meat|poultry|fish|shellfish|pork|dairy|egg|gelatin|alcohol` (empty for plant foods). `aisle` is one of `produce, meat, dairy, frozen, dry, canned, bakery, other`. `staple` is `true` for salt, cooking oil, common spices, flour, sugar and similar items a kitchen usually has; the solver assumes a full package on hand when `household.assume_staples` is true, so the cart doesn't buy a bottle of oil every trip.

Rules:
- Exactly the ~80 ingredients the team chose. Do not add rows unless asked. Include a few substitutes on purpose (frozen spinach next to fresh, store-brand rice, canned and dried beans) so the solver has cheaper options to choose from.
- `price_cents` is entered by a human. If a price is missing, leave the cell empty and flag it; do not fill it.
- Nutrition per 100g may be estimated. Spot-check against USDA FoodData Central.
- EBT eligibility: staple foods and seeds/plants are eligible. Hot prepared food, alcohol, tobacco, vitamins/supplements, pet food, and non-food are not.
- Tag every animal product. Diet rules depend on it.

Loader: `load_ingredients(path) -> dict[str, Ingredient]` in `schemas.py`. Validate every row; fail loudly on a bad row.

---

## `generate.py`

```python
def generate_meals(ingredients: dict[str, Ingredient],
                   household: Household,
                   n: int = 50,
                   cache_path: str = "data/meals.json") -> list[Meal]
```

- If `cache_path` exists, load and return it. Otherwise call the LLM, validate, write the cache, return.
- Prompt must include the full ingredient list as `id: name` lines and state: use only these ids; all quantities in grams per batch; output a JSON array only, no prose, no markdown fences.
- Ask for a mix: ~10 breakfasts, ~20 lunches, ~20 dinners. Ask for meals that share staple ingredients (rice, beans, eggs, onions) and for a range of prep times.
- Validate each meal with `Meal.model_validate`. Drop any meal referencing an ingredient id not in `ingredients`. Drop duplicates by name. Log how many were dropped.
- Strip markdown fences before `json.loads` in case the model adds them.

---

## `nutrition.py`

```python
def targets_for(household: Household) -> NutrientTargets
def diet_exclusions(diet: list[Diet], ingredients: dict[str, Ingredient]) -> list[str]
```

`targets_for`: per-person daily baseline × `trip_days` × people, then subtract a proportional share for school-covered meals (scale weekly school counts by `trip_days / 7`). Baseline per person per day: 2000 kcal, 50 g protein, 25 g fiber, 2300 mg sodium max, 50 g sugar max. Children count as people. Keep it simple; this is a demo.

`diet_exclusions`: returns ingredient ids whose `tags` intersect the excluded tag set for the chosen diets. Simplified rules, and the UI must label them "simplified":
- vegetarian → meat, poultry, fish, shellfish, gelatin
- vegan → vegetarian set + dairy, egg
- halal → pork, alcohol, gelatin
- kosher → pork, shellfish, gelatin (meat/dairy separation is **not** modeled; say so in the UI)

The caller (app or agent) merges the result into `household.excluded_ingredients`. This is a lookup, not an LLM call.

---

## `solve.py`

```python
def solve(meals: list[Meal],
          ingredients: dict[str, Ingredient],
          household: Household,
          targets: NutrientTargets,
          time_limit_s: float = 2.0) -> Plan | None
```

Let `D = household.trip_days`.

### Variables
- `x[m]` int 0..D — times meal m is cooked this trip
- `y[i]` int 0..20 — packages of ingredient i bought
- `used[m]` bool — meal m appears at all; enforce `x[m] <= D * used[m]`
- `short[n]` int >= 0 — shortfall for min-nutrients (kcal, protein, fiber)
- `excess[n]` int >= 0 — excess for max-nutrients (sodium, sugar)

### Pre-computation (do this in Python before building the model)
- `school_b = round(school_breakfasts * D / 7)`, `school_l = round(school_lunches * D / 7)`.
- `needed[slot]`: `needed["breakfast"] = D*people - school_b`, `needed["lunch"] = D*people - school_l`, `needed["dinner"] = D*people`.
- `coef[n][m]`: integer nutrient contribution of one batch of meal m for nutrient n: `round(sum(grams * ingredient.<n>_100g / 100 for each ingredient))`. Use whole units (kcal, g, mg).
- `pantry_g[i] = household.pantry.get(i, 0)`; if `household.assume_staples` and `ingredients[i].staple`, `pantry_g[i] = max(pantry_g[i], package_g[i])`.
- `max_repeat = max(1, ceil(3 * D / 7))`; `min_distinct = min(max(3, round(8 * D / 7)), number of meals)`.
- Filter meals before modeling: drop any meal with `prep_min > max_prep_min`, any requiring equipment not in `household.equipment`, any in `excluded_meals`, any using an `excluded_ingredient`, and — if `accepted_meals` is not `None` — any not in `accepted_meals`. Do not model excluded meals with `x=0`; just remove them.

### Constraints
```
slots:        for each slot: sum(x[m] * servings[m] for m in slot) >= needed[slot]
ingredients:  for each i: sum(x[m] * grams[m][i]) <= y[i] * package_g[i] + pantry_g[i]
ebt budget:   sum(y[i] * price_cents[i] for eligible i) <= ebt_cents
cash budget:  sum(y[i] * price_cents[i] for non-eligible i) <= cash_cents
kcal/protein/fiber:   sum(x[m] * coef[n][m]) + short[n] >= target_min[n]
sodium/sugar:         sum(x[m] * coef[n][m]) - excess[n] <= target_max[n]
variety:      x[m] <= max_repeat for all m;  sum(used[m]) >= min_distinct
stock:        y[i] = 0 for i in out_of_stock (set the upper bound to 0)
```
The pantry term is the only change the pantry feature makes to the solver. Pantry grams are free; the solver naturally uses them first because buying costs money.

### Objective (maximize)
```
100 * sum(x[m] * palatability[m])
- 2 * short["kcal"] / 100     (per 100 kcal short)      -> implement as -2 * short_kcal with short_kcal in units of 100 kcal, or scale target accordingly
- 20 * short["protein"]       (per gram)
- 10 * short["fiber"]         (per gram)
- 1 * excess["sodium"] / 100  (per 100 mg)
- 5 * excess["sugar"]         (per gram)
+ (ebt_cents + cash_cents - total_spent) / 100   (per dollar unspent, small tiebreaker)
```
Keep all weights integers. If a term needs division, scale the variable's units instead.

### Solver settings
```python
solver = cp_model.CpSolver()
solver.parameters.max_time_in_seconds = time_limit_s
solver.parameters.num_workers = 8
```
Accept `OPTIMAL` or `FEASIBLE`. Return `None` only on `INFEASIBLE`/`UNKNOWN` (should be rare because nutrition is soft; the slots constraint is the only hard one that can fail, e.g. when the user rejects too many meals).

### Output
Build `Plan` with the chosen meals, cart items (only `y[i] > 0`, each with its `aisle`), both totals, `basket_cents`, `cash_remaining_cents`, `eligible_pct`, `trips_covered`, `covers_until`, `from_pantry` (grams of each ingredient consumed from pantry: `min(pantry_g[i], grams used)`), achieved nutrition (computed from `x`), targets, shortfalls, `what_changed=None`, and `solve_ms`. All display math lives here, not in the frontend.

### Tests (`tests/test_solve.py`)
Using `tests/fixtures.py` (6 meals, 10 ingredients, one household that is clearly feasible):
1. `solve` returns a `Plan`, not `None`.
2. For every ingredient: grams used across chosen meals <= packages × package_g + pantry grams.
3. `plan.ebt_cents <= household.ebt_cents` and `plan.cash_cents <= household.cash_cents`, and `ebt_cents + cash_cents == sum(line_cents) == basket_cents`.
4. Setting `out_of_stock=[some_id]` yields a plan with that ingredient absent from the cart.
5. Setting `pantry={some_id: package_g}` for an ingredient the plan previously bought reduces its packages by at least one or removes it.
6. Setting `trip_days=3` yields fewer total servings than `trip_days=7` for the same household.
7. With `assume_staples=True`, no ingredient with `staple=True` appears in the cart unless its pantry grams are exhausted.

---

## `explain.py`

```python
def diff(old: Plan, new: Plan, meals: dict[str, Meal], ingredients: dict[str, Ingredient]) -> dict
def explain(old: Plan, new: Plan, meals, ingredients) -> str
```

- `diff` is pure Python: meals added, meals removed, ingredients added/removed/changed quantity, change in ebt/cash totals, change in each nutrient. Return a plain dict.
- `explain` sends the diff (not the full plans) to the LLM and asks for exactly two sentences, plain language, mentioning dollars saved or spent and whether nutrition targets are still met. No bullet points, no headers.
- If the diff is empty, return "No changes." without calling the LLM.
- Called by `/solve` when the request includes `prev_plan`; the result lands in `Plan.what_changed`.

---

## `parse.py`

```python
def parse_constraints(text: str,
                      ingredients: dict[str, Ingredient],
                      meals: list[Meal]) -> dict
```

Returns `{"excluded_ingredients": [...], "excluded_meals": [...], "max_prep_min": int | None, "equipment": [...] | None}`. The LLM receives the ingredient ids/names and meal ids/names and must return JSON only. Validate that every returned id exists; drop unknown ids. Caller merges the result into `Household`.

Used by the Streamlit fallback and by the agent. The React app does not call it directly; free text goes through `/agent/turn` in Phase 3.

---

## `pantry.py` (F3)

Turns what the household already has into `household.pantry` grams, so the solver buys only the gap. Three input paths plus staples, one confirmation step, one output.

```python
def detect_from_image(image: bytes, ingredients: dict[str, Ingredient]) -> list[PantryItem]
def detect_from_text(text: str, ingredients: dict[str, Ingredient]) -> list[PantryItem]
def to_grams(items: list[PantryItem], ingredients: dict[str, Ingredient]) -> dict[str, int]
```

- `detect_from_image`: one call to `llm.complete(..., images=[image], json_only=True)`. The prompt includes the 80 ingredients as `id: name` lines and asks: "List only items from this list that are clearly visible. For each give `ingredient_id` and `level` in {full, half, low}. Return a JSON array. Do not guess items you cannot see." Validate; drop unknown ids; set `source="photo"`.
- `detect_from_text`: same prompt shape without the image, for input like "I have rice, eggs, half a bag of spinach." Level defaults to `full` unless the text says otherwise. `source="text"`.
- Manual entry and staple chips are UI only; they produce `PantryItem(source="manual")` or `source="staple"`. No LLM.
- `to_grams`: `full → package_g`, `half → package_g // 2`, `low → package_g // 5`. Sum duplicates. This is an estimate and the UI says so.

Rules:
- Never claim grams from a photo (non-negotiable 9). Levels only.
- The detected list is always shown to the user as a checklist **before** it touches `household.pantry`. Unchecked items are dropped; a "+ add item" control uses the manual path.
- Perishables in the pantry are not tracked for expiry. Out of scope.
- 2-hour cap on the photo path. If the vision model is unreliable at the cap, keep text, manual and staples and drop the photo.

Tests (`tests/test_pantry.py`): mock the LLM to return two items, one with an unknown id; assert one `PantryItem` survives. Assert `to_grams` on `[full rice, half rice]` equals `package_g + package_g // 2`.

UI: see the Pantry screen in the frontend spec.

---

## Meal accept/reject and thumbs-down

The "user chooses" step in the architecture line. Two UI controls, both filters on the candidate pool, neither calls the LLM:

- **Accept/reject drawer** on Plan: candidate meals as a checklist grouped by slot, all checked by default, with prep time and a one-line ingredient summary. Unchecked meals are removed from `household.accepted_meals`; checking everything sets it back to `None`. Any change re-solves. If `/solve` returns 422 because too few meals remain, show "Pick a few more meals so every day is covered" and do not clear the user's choices.
- **"Not for me"** (thumbs-down icon) on any meal in the day list: appends the meal id to `household.excluded_meals` and re-solves immediately. This is a real feature, not a cosmetic rating; there is no thumbs-up.

---

## `api/main.py` (B1)

Thin FastAPI wrappers over `stretch/*`. No business logic here beyond what is listed. CORS from `CORS_ORIGINS`. All request and response bodies are the Pydantic schemas above, serialized with their exact field names.

| Method | Path | Request | Response | Notes |
|---|---|---|---|---|
| GET | `/ingredients` | — | `list[Ingredient]` | from the CSV loader, cached at startup |
| GET | `/meals` | `?session_id=` optional | `list[Meal]` | the cached candidate pool; per-session pool if the agent has grown it |
| POST | `/solve` | `{household: Household, prev_plan: Plan \| null, session_id: str \| null}` | `Plan` | 1) if `household.snap_only`, set `cash_cents = 0`; 2) merge `nutrition.diet_exclusions(household.diet)` into `excluded_ingredients`; 3) `targets_for`; 4) `solve(...)`; 5) if `prev_plan` given, `what_changed = explain(prev_plan, plan)`. **422** `{detail: "<plain-language reason>"}` when `solve` returns `None`, e.g. "Not enough meals left to cover every day. Pick a few more." |
| POST | `/pantry/detect` | `{image_b64: str \| null, text: str \| null}` | `list[PantryItem]` | exactly one of the two must be set |
| POST | `/pantry/grams` | `{items: list[PantryItem]}` | `dict[str, int]` | `to_grams`; kept server-side so grams math never lives in the frontend |
| POST | `/agent/turn` | `{session_id: str, text: str, household: Household}` | `{reply: str, plan: Plan \| null, household: Household}` | Phase 3. Server keeps `AgentState` per `session_id` in a dict (meal pool, transcript, prev plan). |
| GET | `/health` | — | `{ok: true, app_name}` | the frontend pings this on load and shows a one-line "can't reach the planner" notice if it fails |

Rules:
- `/solve` must return in under 3 seconds on the demo laptop; pass `time_limit_s=2.0`.
- Log every request path and duration to stdout; nothing else.
- No database, no auth, no background tasks.
- `api/test_api.py` with httpx: `/solve` on the fixture household returns 200 and a `Plan` whose `basket_cents == ebt_cents + cash_cents`; `/solve` with `snap_only=True` returns `cash_cents == 0`; `/pantry/detect` with neither field returns 422.

---

## Frontend (`web/`, F1–F4)

A mobile web app. Max content width 430px, centered on wider screens with the paper background filling the rest. Every screen must be usable one-handed on a phone; minimum tap target 44×44px; body text at least 15px.

### Data flow
- One React context holds `household`, `plan`, `prevPlan`, `pantryItems`, `sessionId`.
- Any change to `household` → debounce 300ms → `POST /solve` with `prev_plan` = the current plan → replace `plan`, move old to `prevPlan`. Show a subtle inline loading state on the two big numbers; never a full-screen spinner.
- The List and Register screens render from `plan` in context. **They never refetch.** Store signal is bad; whatever is on the phone when the user walks in is what they see.
- `api.ts` is the only file that knows `VITE_API_URL`. `types.ts` mirrors the Pydantic schemas with identical field names; do not rename in transit.
- On 422 from `/solve`, keep the previous plan on screen and show the `detail` text in the ChangedLine slot. Never clear the user's inputs on an error.
- Persist `household` and `pantryItems` to `localStorage` on change; restore on load. No accounts.

### Design system (`styles/tokens.css`)
CSS variables on `:root`, redefined under `@media (prefers-color-scheme: dark)`.

```
--paper:      #F7F3EA  / dark #1B1F17
--paper-alt:  #EEE7D5  / dark #242A1F
--card:       #FFFFFF  / dark #242A1F
--ink:        #1F2A1E  / dark #F1EEDD
--ink-soft:   #57614F  / dark #B7B29B
--green:      #3B6E4E            (primary; SNAP-eligible; success)
--green-deep: #24462F            (hero surfaces, big-number background)
--gold:       #D9A441  / dark #E3B45B   (fills and icons ONLY — never text)
--berry:      #8C3B4F            ("added" states, secondary accent)
--red:        #B3452F            (over-budget warning, used sparingly)
--line:       #DDD4C0  / dark #3A4234
--radius:     16px
--radius-pill: 999px
```

- **Type:** Fraunces for h1, h2, card titles and the two big numbers only. Karla for everything else. No all-caps labels. No serif below 18px.
- **Contrast rule:** gold is never used for text on paper or card. Text is `--ink` or `--ink-soft`, or white on `--green-deep`.
- **Shape:** 16px radius on cards and buttons, pill tags, 1px `--line` borders, no drop shadows.
- **Icons:** `lucide-react` only, 24px, `currentColor`. No emoji anywhere, including copy.
- **Safe areas:** `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`; pad the tab bar and any fixed header with `env(safe-area-inset-*)`.
- Do not add a UI framework, Tailwind, or a component library. Plain CSS with these variables.

### Copy rules
- "This trip" and "until your deposit." Never "week."
- Balances are user-entered; the line "Entered manually — not connected to your EBT account" appears wherever a balance is shown or edited.
- Warnings state the problem and the next step, in one sentence. Never apologetic, never red text for the user's situation.
- Money always `$X.XX`. Dates as "Oct 14."
- Nutrition only as "met" or "85% of target."

### Navigation
Bottom tab bar, three tabs: **Plan**, **Pantry**, **List**. Icon + label; active tab `--green` (`--gold` in dark mode). Hidden during the quiz. Register is a full-screen route reached from List, with a back chevron; it is not a tab. "Redo setup" is a text link at the bottom of Plan.

### Screen: Quiz (`/quiz`, first run only)
Full-bleed, one question per screen, back chevron (hidden on Q1), thin progress bar. Each question: a lucide icon, a headline, one supporting line, a vertical stack of large option cards (selected: `--green` border and tint). "Continue" disabled until an option is picked; last screen says "See my plan."

Every question changes the solver input. Five questions:
1. **Who eats here?** people (1–6+); then a follow-up row: which kids get school breakfast or lunch (sets `school_breakfasts`, `school_lunches` per week).
2. **When does your SNAP load, and how much do you have for this trip?** `deposit_date` picker, `ebt_cents` input, `trip_days` slider ("shopping for the next N days"). Disclaimer under the balance.
3. **Any cash for groceries this trip?** `cash_cents` input, or "SNAP only" (sets `snap_only=True`).
4. **Anything you don't eat?** diet multiselect (vegetarian, vegan, halal, kosher, labeled "simplified rules") plus a chip row of common exclusions.
5. **What can you cook with?** equipment cards plus a max-minutes selector.

Screen 1 has a text link "Use typical settings" that fills defaults (2 people, 7 days, $150 SNAP, $20 cash, stovetop + microwave, 30 min) and jumps to Plan.

### Screen: Plan (`/plan`, default tab, the hero)
Top to bottom:
1. **Two big numbers** on a `--green-deep` hero card, white Fraunces: **"Cash you'll need: $6.10"** (`plan.cash_cents`) and **"Covers you until Oct 14"** (`plan.covers_until`). Below in small text: "N days until your deposit" if `deposit_date` is set, and "Your SNAP covers about `trips_covered` trips like this."
2. **ChangedLine:** `plan.what_changed` in one line under the hero, when present.
3. **Payment card** (also reused on List and Register), exact rows:
   ```
   Grocery basket          $basket_cents
   Planned SNAP payment    $ebt_cents
   Cash you'll need        $cash_cents
   Cash remaining          $cash_remaining_cents
   SNAP-eligible items     eligible_pct%
   ```
   If `snap_only` and `cash_cents > 0`: a `--paper-alt` notice, "This trip needs $X.XX in cash and you're set to SNAP only. Swap or remove an item to close the gap." If `cash_remaining_cents < 0`: "This is $X.XX over your available cash."
4. **Controls row:** SNAP available slider, cash slider (hidden when SNAP-only), SNAP-only toggle, trip-days stepper. Disclaimer line beneath.
5. **Day list:** Day 1 … Day N cards, each with breakfast / lunch / dinner name, prep minutes, and a thumbs-down icon ("Not for me") that excludes the meal and re-solves. Fill slots by repeating chosen meals in a sensible order; presentation only.
6. **Meals drawer:** a button "Choose from N meals" opens a bottom sheet with the accept/reject checklist.
7. **Scorecard:** one line per nutrient.
8. Small text: `solve_ms` ms. Text link: "Redo setup."
9. Phase 3 adds a chat drawer button here wired to `/agent/turn`.

### Screen: Pantry (`/pantry`)
1. Headline "What's in your kitchen?" and one line: "We'll only buy what you don't have. Amounts are estimates."
2. **Staples row:** chips for every `Ingredient.staple` (salt, oil, spices, flour, sugar…), all selected by default, with the caption "Tap to remove anything you're out of." Deselecting a chip sets `assume_staples=False` for the whole set and adds the remaining ones as `PantryItem(source="staple", level="full")` — simplest correct behavior.
3. **Photo:** a dashed-border card with a camera icon, "Snap a photo of your shelf." `<input type="file" accept="image/*" capture="environment">`. Downscale client-side to 1024px before base64. → `POST /pantry/detect`.
4. **Text:** "Or type what you have" textarea + Detect → `POST /pantry/detect`.
5. **Checklist:** detected items with checkboxes and a level pill (full / half / low, tappable to change), a "+ add item" that opens a searchable list of the 80 ingredients. **Confirm** → `POST /pantry/grams` → set `household.pantry` → re-solve. Then show "Saved. Your cart just got shorter." and the `from_pantry` items.
6. On detect failure: "Couldn't read that photo. Try more light, or type what you have." Never a blank screen.

### Screen: List (`/list`)
1. Payment card (same component).
2. **Running totals** pinned at the top of the list: "In basket · EBT $X · Card $Y", computed by summing `line_cents` of checked rows **server-side is not needed** here — this is the one exception to non-negotiable 6, allowed because it is a display sum of solver-provided line items for a checkbox UI, not a plan calculation. Keep it in one function in `List.tsx` and nowhere else.
3. Items grouped by `aisle` in store order (produce, dairy, meat, frozen, dry, canned, bakery, other). Each row: checkbox "in basket", product name, package size, packages, `$line_cents`, a "SNAP" pill if eligible or "Card" if not, and an "Out of stock" toggle that appends to `household.out_of_stock` and re-solves. After a re-solve, newly added items get a `--berry` "swapped in" pill for one render.
4. "From your kitchen" section listing `from_pantry` items with a filled dot.
5. Persistent line: "SNAP can't cover delivery fees or tips if you order for delivery."
6. Primary button at the bottom: **"Show the cashier"** → `/register`.

### Screen: Register (`/register`, full-screen)
High contrast: `--green-deep` background, white text, no tab bar, back chevron top-left. Two lines in Fraunces at 56–64px:
```
Swipe EBT first
$47.20

Then card
$6.10
```
If `cash_cents == 0`: only the first block and "That's everything." Below in Karla: "Entered manually — not connected to your EBT account." One text button: "Back to list." Prevent screen dimming with the Screen Wake Lock API when available; fail silently if not.

### Not in the frontend
Home feed, Recipe Detail, Cookbook, Profile, avatar, Stores, geolocation, speech recognition, infinite scroll, donut chart, thumbs-up, difficulty or sourcing tags, store multipliers, any arithmetic on money other than the List running total, any component library.

---

## `prices.py` (Phase 2b)

Live prices from the Kroger Public API. The CSV remains the contract and the fallback; this module only overwrites `price_cents`, `in_stock`, and `price_source` on `Ingredient` objects in memory and in `data/prices_cache.json`. It never edits `ingredients.csv`.

```python
def get_token() -> str
def nearby_stores(zip_code: str, radius_miles: int = 10, limit: int = 5) -> list[Store]
def refresh_prices(ingredients: dict[str, Ingredient],
                   location_id: str) -> tuple[dict[str, Ingredient], dict]
```

Endpoint notes (verify against developer.kroger.com; field names below are from memory and may have drifted):
- Token: OAuth2 client credentials, `POST https://api.kroger.com/v1/connect/oauth2/token`, scope `product.compact`. Cache the token in memory until expiry.
- Stores: `GET /v1/locations?filter.zipCode.near={zip}&filter.radiusInMiles={r}&filter.limit={n}`. Map each result to `Store`.
- Products: `GET /v1/products?filter.term={kroger_product}&filter.locationId={id}&filter.limit=3`. Each item has a `price.regular`, optional `price.promo`, a `size` string, and an `inventory.stockLevel` (values like `HIGH`, `LOW`, `TEMPORARILY_OUT_OF_STOCK`).

Matching rules (this is where wrong data sneaks in):
- Search by the CSV's `kroger_product` string. Take the first result whose `size` parses to within 25% of `package_g`; otherwise keep the CSV price and mark that ingredient `price_source="csv"`. Never take a product just because it came back first.
- Use `price.promo` if present and nonzero, else `price.regular`. Convert dollars to cents with rounding.
- `in_stock = False` only for `TEMPORARILY_OUT_OF_STOCK`; treat missing or unknown as in stock.
- Return a report dict: `{"updated": n, "kept_csv": n, "out_of_stock": [...], "fetched_at": iso_timestamp, "store": Store}`. The UI shows this.

Caching and failure:
- Write every successful refresh to `data/prices_cache.json` keyed by `location_id` with a timestamp. On startup, load the cache for the chosen store if it is under 6 hours old before calling the API.
- Any exception anywhere in this module → log it, return the ingredients unchanged, and report `{"updated": 0, "error": str}`. The app must render normally with CSV prices. **A price API failure is never a demo failure.**
- Rate limits: one refresh per store per session. No polling.

UI (Phase 2b, only if built): two extra endpoints, `GET /stores?zip=` → `list[Store]` and `POST /prices/refresh {location_id}` → the report dict. In `web/`, a small "Store" card at the bottom of Plan: zip input → store dropdown with distance → "Refresh prices" button → one line "Prices as of {time} from {store name} · {updated} live, {kept_csv} from list". `in_stock=False` items come back pre-toggled as out of stock on List. Nothing in `solve.py` changes.

Tests: one test with the HTTP client mocked to return two products, one within size tolerance and one not; assert the first updates and the second keeps the CSV price. One test where the mock raises; assert ingredients are returned unchanged and the report has `error`.

---

## `persist.py` (Phase 2c, optional)

The smallest thing that survives a page refresh. Standard library `sqlite3`, one file, no ORM, no migrations framework.

```python
def init(path: str = "data/stretch.db") -> None
def save_household(hh: Household, name: str) -> int
def save_plan(plan: Plan, household_id: int) -> int
def load_last() -> tuple[Household, Plan] | None
def list_households() -> list[tuple[int, str, str]]   # id, name, created_at
```

- Two tables: `households(id INTEGER PRIMARY KEY, name TEXT, json TEXT, created_at TEXT)` and `plans(id INTEGER PRIMARY KEY, household_id INTEGER, json TEXT, created_at TEXT)`. Store `model_dump_json()`; load with `model_validate_json()`.
- `app.py`: a "Save" button (asks for a name, default "Dana") and a "Load last" button in the sidebar. Auto-save the plan after every successful solve if a household has been saved this session.
- No users, no login, no multi-tenancy. If someone proposes a `users` table, the answer is no.
- If `init` fails (read-only disk, whatever), the app runs without persistence and shows nothing about it.

---

## `agent.py` (Phase 3)

The agent is an LLM using the solver as a tool. It owns the chat panel. It never does arithmetic on budgets or nutrition itself; it calls tools and reports what they return.

```python
class AgentState(BaseModel):
    household: Household
    meals: list[Meal]              # current candidate pool (may grow via propose_meals)
    plan: Plan | None
    prev_plan: Plan | None
    transcript: list[dict]         # LLM message history

def run_turn(state: AgentState, user_text: str,
             ingredients: dict[str, Ingredient],
             targets_fn=nutrition.targets_for) -> tuple[AgentState, str]
```

`run_turn` sends the user message plus the current plan summary, lets the model call tools (max 3 tool calls per turn, then force a text reply), applies each tool, and returns the new state and the assistant's reply.

### Tools — exactly these five, no others

| Tool | Args | Effect | Returns |
|---|---|---|---|
| `set_budget` | `ebt_dollars: float, cash_dollars: float` | Update `household.ebt_cents`, `cash_cents` | new totals |
| `exclude` | `ingredient_ids: list[str], meal_ids: list[str]` | Append to `household.excluded_*`; unknown ids dropped and reported | what was excluded, what was unknown |
| `set_household` | `max_prep_min: int \| None, equipment: list[str] \| None, out_of_stock: list[str] \| None, trip_days: int \| None, diet: list[str] \| None` | Update those fields; if `diet` changes, recompute `nutrition.diet_exclusions` and merge into `excluded_ingredients` | updated fields |
| `propose_meals` | `gap: str, n: int = 5` | Call `generate.propose(gap, ingredients, household, n)` (a variant of `generate_meals` that asks for meals aimed at a stated gap); validate; append to `state.meals` | names of meals added |
| `solve` | none | Run `solve.solve(state.meals, ingredients, household, targets)`; set `prev_plan = plan`, `plan = result` | plan summary: meals chosen, EBT total, cash total, nutrition met/short, `solve_ms`; or "infeasible: slots cannot be covered" |

Rules for the tool loop:
- After any tool that changes household or meals, the model should call `solve` before replying. Put this in the system prompt; also enforce it in code: if the turn ends with a dirty state and no solve, call `solve` yourself and append its result to the reply.
- `propose_meals` may be called at most once per turn.
- The reply to the user is two to four sentences, plain language, mentions dollars and whether targets are met, never bullet points. If `prev_plan` exists, the model may use `explain.diff` output, which you pass into the tool result of `solve`.
- Cap total tool calls at 3 per turn. On the 4th attempt, return the tool results so far and force a text answer.

### System prompt contents
- The one-line architecture sentence.
- The five tools and when to use each.
- The current household as JSON, the current plan summary as JSON (not the full cart), and the ingredient id/name list.
- Tone rules: plain language, no health lectures, no grading foods, mention money first.

### `generate.propose`
```python
def propose(gap: str, ingredients: dict[str, Ingredient],
            household: Household, n: int = 5) -> list[Meal]
```
Same prompt as `generate_meals` plus: "Propose {n} meals that specifically address: {gap}." Same validation. Not cached.

### Tests (`tests/test_agent.py`)
Mock the LLM client. Three tests:
1. A turn whose mocked tool calls are `set_budget` then `solve` updates `household` and produces a `plan`.
2. A turn that calls `exclude` but not `solve` still ends with a fresh `plan` (the code-enforced solve).
3. A 4th tool call attempt is refused and a text reply is returned.

---

## `eval/baseline.py` (Phase 4)

Purpose: answer "why not just ask an LLM?" with numbers.

```python
def run_baseline(n: int = 10) -> list[dict]     # plain LLM, no solver
def run_hybrid(n: int = 10) -> list[dict]       # generate + solve
def main() -> None                              # writes eval/results.md
```

- **Baseline**: give the LLM the same household, the same ingredient list with real prices and package sizes, and ask it to return a week of meals plus a cart as JSON (`{"meals": [...], "cart": [{"ingredient_id", "packages"}]}`). Price the cart with the real CSV. Record: total cost, EBT total, cash total, over-budget (bool), each nutrient met (bool), ingredient sufficiency violations (count of ingredients used more than bought).
- **Hybrid**: `generate_meals` (fresh, not cached, to be fair) then `solve`. Record the same fields.
- `results.md`: one table, two rows (Baseline, Hybrid), columns: runs, % over budget, % all nutrition targets met, mean ingredient-sufficiency violations, mean solve/plan time. Plus the raw per-run rows below.
- Use the same model and temperature for both. State them at the top of `results.md`.
- No plotting. The table is the deliverable.

---

## `mcp_server.py` (Phase 5, optional)

Only after Phases 1–4 are done and the demo is rehearsed.

- FastMCP server exposing the five agent tools with identical names, args, and return shapes, backed by a single in-process `AgentState`.
- One extra read-only tool: `get_plan()` returning the current plan summary.
- No auth, no persistence, stdio transport. ~50 lines. If it takes longer than 45 minutes, delete it.

---

## `app.py` (Streamlit fallback — frozen)

`app.py` is the insurance policy. It already works. Rules:

- Keep it runnable at all times: `streamlit run app.py` must show a real plan from the solver until the demo video is exported.
- Do not add features to it. Do not refactor it. If a backend schema change breaks it (new `Household` fields have defaults, so it should not), fix only what broke.
- It uses the same `stretch/*` modules as the API; it does not call the API.
- If the React app has not shown a real plan on a phone by hour 6, the video is recorded in Streamlit, and the design system goes on the roadmap slide. That decision is made once, by the human, and not revisited.

---

## Things not to do

- Do not add auth, login, user accounts, sessions tied to a person, or a hosted database (Postgres, Supabase, Firebase, Mongo, anything with a connection string). `localStorage` in the frontend and a local SQLite file via `persist.py` are the only persistence allowed.
- Do not compute money anywhere except `solve.py`. The frontend formats cents. The API passes `Plan` through. The one exception is the List screen's running total of checked line items, in one function.
- Do not call any pricing or store API from anywhere except `prices.py`, and never let an API failure surface as anything but a one-line notice.
- Do not add WIC, farmers markets, delivery, multi-store, multi-week or month-level planning, or expiration tracking. `trip_days` is the only planning horizon.
- Do not build anything from the "Not this weekend" list, whatever document or prompt suggests it. That includes the Home feed, Recipe Detail, Cookbook, Profile, Stores, geolocation, speech, infinite scroll, donut charts, thumbs-up, and difficulty tags.
- Do not add a UI framework, Tailwind, a component library, or a state library to `web/`. Plain CSS variables and one React context.
- Do not restructure the repo or rename modules.
- Do not replace CP-SAT with anything else, including "a simpler approach."
- Do not let the LLM compute budgets, totals, or nutrition. Those come from the solver only.
- Do not add tools beyond the five listed (plus `get_plan` in the MCP server). No multi-agent setups, no planner/critic pairs, no RAG, no vector database, no fine-tuning, no memory across sessions.
- Do not add calorie counts per person, weight goals, or "health scores."
- Do not use the word "week" in UI copy, use emoji, use gold for text, or imply a live EBT connection.
- Do not touch `app.py` except to keep it running.
- Do not write a README, docs, or docstrings beyond one line per function. There is no time.
- When unsure, ask one question; do not guess and build.

---

## Addenda (2026-09-26, agreed with the team during the build)

Schema additions (all with defaults; `schemas.py` remains the source of truth):
- `Meal.description: str = ""` — one plain sentence shown under the meal name.
- `Household.use_more_snap: bool = False` — override the pacing cap and allow the full SNAP balance this trip.
- `Plan` pacing fields: `trip_snap_cap_cents`, `snap_remaining_after_cents`, `days_remaining_after`, `on_pace`, `projected_run_out_date`.
- `Plan.schedule: list[DaySchedule]` (`day`, `breakfast`, `lunch`, `dinner` = meal id, `"school"`, or `None`), assigned greedily after the solve.
- `Plan.leftovers: dict[str, int]` — grams left per purchased ingredient after the trip.
- `Plan.uncovered: dict[str, int]` and `Plan.relaxed: list[str]` — when the budget cannot cover every slot, the solver relaxes variety, then repeats, then slot coverage (in that order) and reports what it could not cover instead of failing. A 422 remains only when no meal fits the household at all.
- `Plan.staples_assumed: list[str]` — the staples treated as on hand, so the UI can show the assumption.
- `Plan.meal_serving_cents: dict[str, int]` — ingredient cost per serving for every meal in the pool, pro-rated by weight from package prices (display only; assumed staples count as free). Computed in `solve.py` so the frontend still never does money math.
- 2026-09-26 late, on the team's explicit decision, the app adopts the FairFare screen set: **Home** (photo cards with factual filter chips, sticky plan bar), **Week** tab (the Plan screen), **Cookbook** (photo grid of the pool) and **Profile** (settings) join Pantry in a five-tab bar; List and Register are reached from the plan. Still out: Nearby Stores / per-store totals (no data), microphone (no secure context on the phone URL), ratings, feeds of external recipes.
- `Household.required_meals: list[str]` — meals the user pinned ("Add to this trip"); the solver enforces at least one batch of each, dropping the pins (reported as `"pins"` in `Plan.relaxed`) only when the budget cannot hold them and before leaving any slot uncovered.
- `explain.explain()` no longer calls the LLM. It builds the sentence from `diff()`: meals added/dropped/re-counted, coverage change, package swaps, pantry use, the dollar delta, and nutrition only when a target flipped between met and not met. Instant and exact; the LLM version was slow and kept saying "targets still not met" for one nutrient over its cap.
- Stores (2026-09-27 03:30, on the team's decision): `stretch/price_search.py` looks up one chain's online listing price per ingredient through the model's web-search tool (`llm.web_lookup`, chat model `gpt-5-search-api`), keeps a listing only when its package size is within 25% of ours, and writes `data/prices_<store>.csv` with a source URL per row; unpriced rows stay blank. `stretch/stores.py` overlays such a file onto the ingredient table (unpriced items become out of stock for that store, never estimated). `Household.store` selects the overlay in `/solve`, `/ingredients?store=`, `/meal_facts?store=`; `GET /stores` lists stores with coverage. These are online listing prices, labelled as such in the UI, not shelf prices at a specific location. Still not built: per-location prices (needs the Kroger API key).
- `Household.card_covers_snap_gap: bool = False` — opt-in, offered when an added recipe does not fit under the SNAP cap and the household has cash: SNAP-eligible food beyond the cap goes on the card (the register runs EBT first, card covers the rest). The solver penalises that overflow heavily so it is used only to honour the user's pins, never for extras. `Plan.snap_overflow_cents` reports it and the Plan screen says plainly that it is the household's own money.
- `Household.favorite_meals: list[str]` — the user's Cookbook (saved recipes). The solver adds a per-batch objective bonus for saved recipes so the plan leans toward them; it is never a constraint, so budget and coverage still win.
- Flow simplified 2026-09-27 00:00: four tabs **Plan, Recipes, Cookbook, Pantry**; Profile behind the leaf icon; List and Register reached only from the Plan's one button. Meal verbs are exactly: heart (save), "Add to trip" (pin), "Remove" (skip), "Don't suggest this again" (exclude). A toast shows the solver's one-line explanation after each change.
- `MealFacts` (new schema) via `GET /meal_facts`: per-serving cost, kcal, protein, fiber, sodium, SNAP-eligibility, cash-only ingredient ids and factual tags (`quick` ≤15 min, `no-cook`, `microwave`, `oven`, `budget` = cheapest third of the pool, `high-protein` ≥20 g and `high-fiber` ≥8 g per serving, meal-sized bars so the tags stay selective). Computed in `solve.meal_facts`; nothing is graded, these are labels.
- `Plan.meal_cost_cents: dict[str, int]` — approximate ingredient cost of all batches of each chosen meal (`serving_cents × servings × times`), labelled "about" in the UI.
- Default "typical settings" household is now $300 SNAP / $20 cash for 2 people; the frontend's stored-household key moved to `stretch.v2.*` so older test setups reset.
- Meal photos: `python -m stretch.images` generates one AI image per meal into `web/public/meals/<id>.jpg` through `llm.generate_image` (model from `LLM_IMAGE_MODEL`). The UI labels them as illustrations and falls back to a plain tile when a file is missing. Meals open in a detail sheet (photo, description, ingredients with SNAP/Card tags, cost per serving, "Not for me"); the meal chooser is a photo list with real-attribute filters (slot, quick, no-cook, microwave). No recipe feed, cookbook, ratings, stores or profile screens.

Solver changes: per-trip SNAP cap `ebt_cents * trip_days // days_until_deposit` when a deposit date is set and is further away than the trip (unless `use_more_snap`); per-slot servings cap of `needed + one batch`.

Frontend: two payment colours (`--color-snap`, `--color-cash`) are the only colours used for dollar figures; the Plan hero shows this trip's total spend and pace, then today's meals and the day-by-day week; secondary controls live behind "Adjust".
