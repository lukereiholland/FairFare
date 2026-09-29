// Mirrors of stretch/schemas.py. Field names are identical to the Pydantic models; never rename.

export type Slot = "breakfast" | "lunch" | "dinner";
export type Equipment = "stovetop" | "microwave" | "oven";
export type Diet = "vegetarian" | "vegan" | "halal" | "kosher";
export type PantryLevel = "full" | "half" | "low";
export type PantrySource = "photo" | "text" | "manual" | "staple";

export interface Ingredient {
  id: string;
  name: string;
  kroger_product: string;
  package_g: number;
  price_cents: number;
  ebt_eligible: boolean;
  kcal_100g: number;
  protein_100g: number;
  fiber_100g: number;
  sodium_mg_100g: number;
  sugar_100g: number;
  perishable_days: number;
  tags: string[];
  aisle: string;
  staple: boolean;
  price_source: "csv" | "api";
  in_stock: boolean;
}

export interface Meal {
  id: string;
  name: string;
  slot: Slot;
  servings: number;
  prep_min: number;
  equipment: Equipment[];
  palatability: number;
  ingredients: Record<string, number>;
  description: string; // one plain sentence shown under the name ("" when absent)
}

export interface DaySchedule {
  day: number; // 1-based
  breakfast: string | null; // meal id, "school", or null when nothing covers it
  lunch: string | null;
  dinner: string | null;
}

/** Per-meal facts computed server-side from real ingredient data; one per meal in the pool. */
export interface MealFacts {
  meal_id: string;
  serving_cents: number; // ingredient cost per serving, pro-rated by weight (assumed staples free)
  kcal: number; // per serving
  protein_g: number;
  fiber_g: number;
  sodium_mg: number;
  snap_eligible: boolean; // every ingredient is EBT-eligible
  cash_ingredients: string[]; // ingredient ids that must be paid with cash/card
  tags: string[]; // "quick" | "no-cook" | "microwave" | "oven" | "budget" | "high-protein" | "high-fiber"
}

/** A store we hold real prices for; `priced` of `total` ingredients have a listing price there. */
export interface StoreInfo {
  id: string;
  name: string;
  priced: number;
  total: number;
  source: string;
}

/** Nearest branch of a chain to the household's ZIP, from OpenStreetMap. Address and distance only. */
export interface NearbyStore {
  store: string;
  name: string;
  address: string;
  distance_miles: number;
  lat: number;
  lon: number;
  maps_url: string;
}

export interface PantryItem {
  ingredient_id: string;
  level: PantryLevel;
  source: PantrySource;
}

export interface Household {
  people: number;
  trip_days: number;
  deposit_date: string | null; // ISO date "2026-10-14"
  school_breakfasts: number;
  school_lunches: number;
  ebt_cents: number;
  cash_cents: number;
  snap_only: boolean;
  max_prep_min: number;
  equipment: Equipment[];
  diet: Diet[];
  excluded_ingredients: string[];
  excluded_meals: string[];
  accepted_meals: string[] | null;
  required_meals: string[]; // meals the user pinned: the solver cooks each at least once if it can
  favorite_meals: string[]; // the user's cookbook: saved recipes the solver leans toward
  card_covers_snap_gap: boolean; // opt-in: SNAP-eligible food that does not fit under the SNAP cap goes on the card
  store: string; // which store's prices the plan uses ("kroger" by default)
  zip_code: string; // for the nearest-branch lookup only
  out_of_stock: string[];
  pantry: Record<string, number>;
  assume_staples: boolean;
  use_more_snap: boolean; // override the pacing cap: allow the full SNAP balance this trip
}

export interface NutrientTargets {
  kcal_min: number;
  protein_g_min: number;
  fiber_g_min: number;
  sodium_mg_max: number;
  sugar_g_max: number;
}

export interface PlanItem {
  ingredient_id: string;
  packages: number;
  line_cents: number;
  ebt_eligible: boolean;
  aisle: string;
}

export interface Plan {
  meals: Record<string, number>; // meal_id -> times cooked
  cart: PlanItem[];
  ebt_cents: number;
  cash_cents: number;
  basket_cents: number;
  cash_remaining_cents: number;
  eligible_pct: number;
  trips_covered: number;
  covers_until: string; // ISO date
  from_pantry: Record<string, number>;
  nutrition: Record<string, number>; // keys: kcal, protein, fiber, sodium, sugar
  targets: NutrientTargets;
  shortfalls: Record<string, number>;
  what_changed: string | null;
  solve_ms: number;
  // pacing against the balance that must last until the deposit
  trip_snap_cap_cents: number;
  snap_remaining_after_cents: number;
  days_remaining_after: number;
  on_pace: boolean;
  projected_run_out_date: string | null;
  // the plan as a plan
  schedule: DaySchedule[];
  leftovers: Record<string, number>; // ingredient_id -> grams left after the trip
  uncovered: Record<string, number>; // slot -> servings the budget could not cover ({} when all covered)
  relaxed: string[]; // "variety" | "repeats" | "slots" rules loosened to find a plan
  staples_assumed: string[]; // ingredient ids treated as already on hand
  meal_serving_cents: Record<string, number>; // meal_id -> ingredient cost per serving, pro-rated by weight from package prices
  meal_cost_cents: Record<string, number>; // chosen meal_id -> approximate ingredient cost for all batches this trip
  snap_overflow_cents: number; // SNAP-eligible food charged to the card because it did not fit under the SNAP cap
}

export interface AgentTurn {
  reply: string;
  plan: Plan | null;
  household: Household;
}

export const DEFAULT_HOUSEHOLD: Household = {
  people: 2,
  trip_days: 7,
  deposit_date: null,
  school_breakfasts: 0,
  school_lunches: 0,
  ebt_cents: 30000,
  cash_cents: 2000,
  snap_only: false,
  max_prep_min: 30,
  equipment: ["stovetop", "microwave"],
  diet: [],
  excluded_ingredients: [],
  excluded_meals: [],
  accepted_meals: null,
  required_meals: [],
  favorite_meals: [],
  card_covers_snap_gap: false,
  store: "kroger",
  zip_code: "",
  out_of_stock: [],
  pantry: {},
  assume_staples: true,
  use_more_snap: false,
};
