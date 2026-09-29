import TopActions from "../components/TopActions";
import { useState } from "react";
import { Info, Leaf } from "lucide-react";
import { useApp } from "../state";
import type { Meal, MealFacts, Slot } from "../types";
import MealCard from "../components/MealCard";
import MealDetail from "../components/MealDetail";

type Filter = "all" | "trip" | "saved" | "quick" | "budget" | "high-protein" | "high-fiber" | "no-cook" | "microwave";
const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "trip", label: "In my trip" },
  { key: "saved", label: "Saved" },
  { key: "quick", label: "Quick" },
  { key: "budget", label: "Budget pick" },
  { key: "high-protein", label: "High protein" },
  { key: "high-fiber", label: "High fiber" },
  { key: "no-cook", label: "No-cook" },
  { key: "microwave", label: "Microwave" },
];

type SlotFilter = "all" | Slot;
const SLOTS: { key: SlotFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "breakfast", label: "Breakfast" },
  { key: "lunch", label: "Lunch" },
  { key: "dinner", label: "Dinner" },
];

/** Factual labels in display priority; the first match becomes the card's single fact pill. */
const TAG_LABEL: [string, string][] = [
  ["quick", "Quick"],
  ["budget", "Budget pick"],
  ["high-protein", "High protein"],
  ["high-fiber", "High fiber"],
  ["no-cook", "No cooking"],
];

export function factTag(f: MealFacts | undefined): string | undefined {
  if (!f) return undefined;
  return TAG_LABEL.find(([tag]) => f.tags.includes(tag))?.[1];
}

export function SkeletonRow() {
  return (
    <div className="home-skel" aria-hidden="true">
      <div className="skeleton home-skel__photo" />
      <div className="home-skel__lines">
        <div className="skeleton" style={{ width: "70%" }} />
        <div className="skeleton" style={{ width: "90%", minHeight: 12 }} />
        <div className="skeleton" style={{ width: "40%", minHeight: 12 }} />
      </div>
    </div>
  );
}

export default function Recipes() {
  const { household, plan, meals, ingredients, facts, solving, setHousehold, pinMeal, skipMeal, toggleFavorite, navigate } =
    useApp();
  const [filter, setFilter] = useState<Filter>("all");
  const [slot, setSlot] = useState<SlotFilter>("all");
  const [openMeal, setOpenMeal] = useState<Meal | null>(null);
  if (!household) return null;

  const excluded = new Set(household.excluded_meals);
  const favorites = new Set(household.favorite_meals);
  const required = new Set(household.required_meals);
  const isInTrip = (id: string) => (plan?.meals[id] ?? 0) > 0;
  // Only once the server confirms a pin was dropped; while a solve is running the pin is simply pending.
  const isPinnedNotFit = (id: string) =>
    !solving && (plan?.relaxed ?? []).includes("pins") && required.has(id) && !isInTrip(id);
  // "Don't suggest this again" is a filter on the candidate pool, never an LLM call. A hidden meal also loses its pin.
  const neverShow = (id: string) =>
    setHousehold({
      excluded_meals: Array.from(new Set([...household.excluded_meals, id])),
      required_meals: household.required_meals.filter((x) => x !== id),
    });
  const showAgain = (id: string) => setHousehold({ excluded_meals: household.excluded_meals.filter((x) => x !== id) });

  const pool = Object.values(meals);
  const factsFor = (id: string): MealFacts | undefined => facts[id];
  const passesFilter = (m: Meal) => {
    if (filter === "all") return true;
    if (filter === "trip") return isInTrip(m.id);
    if (filter === "saved") return favorites.has(m.id);
    return factsFor(m.id)?.tags.includes(filter) ?? false;
  };
  const passesSlot = (m: Meal) => slot === "all" || m.slot === slot;
  // In-trip first, then cheapest per serving; meals without facts sort last within their group.
  const order = (a: Meal, b: Meal) => {
    const ta = isInTrip(a.id) ? 0 : 1;
    const tb = isInTrip(b.id) ? 0 : 1;
    if (ta !== tb) return ta - tb;
    const ca = factsFor(a.id)?.serving_cents;
    const cb = factsFor(b.id)?.serving_cents;
    if (ca === undefined && cb === undefined) return a.name.localeCompare(b.name);
    if (ca === undefined) return 1;
    if (cb === undefined) return -1;
    return ca - cb || a.name.localeCompare(b.name);
  };

  const rows = pool.filter((m) => !excluded.has(m.id) && passesFilter(m) && passesSlot(m)).sort(order);
  const hiddenCount = household.excluded_meals.length;
  const pinsRelaxed = plan?.relaxed.includes("pins") ?? false;

  return (
    <div className="screen">
      <div className="topbar screen-head screen-head--recipes">
        <div className="topbar__text">
          <h2>Recipes</h2>
          <p className="subnote">Real store prices · tap a recipe to see it</p>
        </div>
        <TopActions />
      </div>

      {pinsRelaxed && (
        <div className="infobox" role="status">
          <Info className="ic" aria-hidden="true" />
          <span>One recipe you added didn't fit this trip's budget. It stays saved for next time.</span>
        </div>
      )}

      <div className="home-chips" role="group" aria-label="Filter recipes">
        {FILTERS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            className={`chip${filter === key ? " new" : ""}`}
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="home-chips home-chips--sm" role="group" aria-label="Filter by meal">
        {SLOTS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            className={`chip${slot === key ? " new" : ""}`}
            aria-pressed={slot === key}
            onClick={() => setSlot(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <section aria-label="Recipes">
        {pool.length === 0 ? (
          <div className="home-list">
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </div>
        ) : rows.length === 0 ? (
          <p className="subnote">Nothing matches. Try another filter.</p>
        ) : (
          <div className="home-list">
            {rows.map((meal) => {
              const f = factsFor(meal.id);
              const inTrip = isInTrip(meal.id);
              return (
                <MealCard
                  key={meal.id}
                  meal={meal}
                  servingCents={f?.serving_cents}
                  times={inTrip ? plan?.meals[meal.id] : undefined}
                  tag={
                    meal.equipment.some((e) => !(household?.equipment ?? []).includes(e))
                      ? `Needs ${meal.equipment.filter((e) => !(household?.equipment ?? []).includes(e)).join(" + ")}`
                      : meal.prep_min > (household?.max_prep_min ?? 999)
                        ? `${meal.prep_min} min, over your limit`
                        : factTag(f)
                  }
                  favorite={favorites.has(meal.id)}
                  inTrip={inTrip}
                  pinnedNotFit={!solving && (plan?.relaxed ?? []).includes("pins") && (household?.required_meals ?? []).includes(meal.id) && !inTrip}
                  onOpen={() => setOpenMeal(meal)}
                  onToggleFavorite={() => toggleFavorite(meal.id)}
                  onAdd={() => pinMeal(meal.id)}
                  onRemove={() => skipMeal(meal.id)}
                  loading={solving}
                />
              );
            })}
          </div>
        )}
      </section>

      {hiddenCount > 0 && (
        <p className="disclaim center">
          {hiddenCount} {hiddenCount === 1 ? "recipe" : "recipes"} hidden · manage in Profile
        </p>
      )}

      <MealDetail
        meal={openMeal}
        ingredients={ingredients}
        facts={openMeal ? factsFor(openMeal.id) : undefined}
        times={openMeal ? plan?.meals[openMeal.id] : undefined}
        favorite={openMeal ? favorites.has(openMeal.id) : false}
        inTrip={openMeal ? isInTrip(openMeal.id) : false}
        pinnedNotFit={openMeal ? isPinnedNotFit(openMeal.id) : false}
        canPayWithCard={!!household && household.cash_cents > 0 && !household.card_covers_snap_gap}
        onPayWithCard={() => setHousehold({ card_covers_snap_gap: true })}
        excluded={openMeal ? excluded.has(openMeal.id) : false}
        onClose={() => setOpenMeal(null)}
        onToggleFavorite={toggleFavorite}
        onAdd={pinMeal}
        onRemove={skipMeal}
        onNeverShow={neverShow}
        onShowAgain={showAgain}
      />
    </div>
  );
}
