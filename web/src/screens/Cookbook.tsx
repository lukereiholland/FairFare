import TopActions from "../components/TopActions";
import { useState } from "react";
import { Heart, Leaf } from "lucide-react";
import { useApp } from "../state";
import type { Meal, MealFacts } from "../types";
import MealCard from "../components/MealCard";
import MealDetail from "../components/MealDetail";
import { factTag, SkeletonRow } from "./Recipes";

/** Saved recipes only, in the order they were hearted. The planner leans on these when it builds the trip. */
export default function Cookbook() {
  const { household, plan, meals, ingredients, facts, solving, setHousehold, pinMeal, skipMeal, toggleFavorite, navigate } =
    useApp();
  const [openMeal, setOpenMeal] = useState<Meal | null>(null);
  if (!household) return null;

  const excluded = new Set(household.excluded_meals);
  const favorites = new Set(household.favorite_meals);
  const required = new Set(household.required_meals);
  const isInTrip = (id: string) => (plan?.meals[id] ?? 0) > 0;
  const isPinnedNotFit = (id: string) =>
    !solving && (plan?.relaxed ?? []).includes("pins") && required.has(id) && !isInTrip(id);
  const neverShow = (id: string) =>
    setHousehold({
      excluded_meals: Array.from(new Set([...household.excluded_meals, id])),
      required_meals: household.required_meals.filter((x) => x !== id),
    });
  const showAgain = (id: string) => setHousehold({ excluded_meals: household.excluded_meals.filter((x) => x !== id) });

  const factsFor = (id: string): MealFacts | undefined => facts[id];
  const poolLoaded = Object.keys(meals).length > 0;
  // Insertion order of favorite_meals; ids the pool no longer knows are skipped.
  const saved = household.favorite_meals.map((id) => meals[id]).filter((m): m is Meal => !!m);
  const notInTrip = saved.filter((m) => !isInTrip(m.id));

  return (
    <div className="screen">
      <div className="topbar screen-head screen-head--cookbook">
        <h2>My Cookbook</h2>
        <TopActions />
      </div>
      <p className="subnote cook-intro">Recipes you save show up here, and the planner leans on them when it builds your trip.</p>

      {household.favorite_meals.length === 0 ? (
        <div className="plancard cook-empty">
          <Heart className="ic cook-empty__icon" aria-hidden="true" />
          <h3>Nothing saved yet</h3>
          <p className="subnote">Tap the heart on any recipe to keep it here.</p>
          <button type="button" className="btn-line" onClick={() => navigate("/recipes")}>
            Browse recipes
          </button>
        </div>
      ) : !poolLoaded ? (
        <div className="home-list">
          <SkeletonRow />
          <SkeletonRow />
        </div>
      ) : (
        <>
          <section aria-label="Saved recipes" className="home-list">
            {saved.map((meal) => {
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
          </section>

          {notInTrip.length > 0 && (
            <div className="cook-foot">
              <button type="button" className="btn-line" onClick={() => notInTrip.forEach((m) => pinMeal(m.id))}>
                Add all saved recipes to this trip
              </button>
            </div>
          )}
        </>
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
