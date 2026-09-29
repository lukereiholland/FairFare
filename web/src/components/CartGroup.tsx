import { useState } from "react";
import { fmtMoney } from "../format";
import { useApp } from "../state";
import type { Ingredient, Meal, PlanItem } from "../types";

const AISLE_LABELS: Record<string, string> = {
  produce: "Produce",
  dairy: "Dairy",
  meat: "Meat",
  frozen: "Frozen",
  dry: "Dry goods",
  canned: "Canned",
  bakery: "Bakery",
  other: "Other",
};

/** Names of plan meals (by id) whose ingredients include this id — a membership lookup, not arithmetic. */
function mealNamesFor(ingredientId: string, planMealIds: string[], meals: Record<string, Meal>): string {
  const names: string[] = [];
  for (const mealId of planMealIds) {
    const meal = meals[mealId];
    if (meal && ingredientId in meal.ingredients) names.push(meal.name);
  }
  if (names.length === 0) return "";
  const shown = names.slice(0, 3).join(", ");
  const extra = names.length - 3;
  return extra > 0 ? `${shown} +${extra} more` : shown;
}

export interface CartGroupProps {
  aisle: string;
  items: PlanItem[];
  ingredients: Record<string, Ingredient>;
  checkedIds: Set<string>;
  onToggleChecked: (id: string) => void;
  outOfStock: string[];
  onToggleOutOfStock: (id: string) => void;
  swappedIn: Set<string>;
  meals: Record<string, Meal>;
  planMealIds: string[];
}

/** One aisle's worth of cart rows. Renders only from props (plus plan.leftovers via context); no fetching, no money math. */
export default function CartGroup({
  aisle,
  items,
  ingredients,
  checkedIds,
  onToggleChecked,
  outOfStock,
  onToggleOutOfStock,
  swappedIn,
  meals,
  planMealIds,
}: CartGroupProps) {
  const { plan } = useApp();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  if (items.length === 0) return null;
  return (
    <section>
      <h3 className="section-title section-title--sm">{AISLE_LABELS[aisle] ?? aisle}</h3>
      {items.map((item) => {
        const ing = ingredients[item.ingredient_id];
        const name = ing?.name ?? item.ingredient_id;
        const isOut = outOfStock.includes(item.ingredient_id);
        const isNew = swappedIn.has(item.ingredient_id);
        const inBasket = checkedIds.has(item.ingredient_id);
        const expanded = expandedId === item.ingredient_id;
        const forMeals = mealNamesFor(item.ingredient_id, planMealIds, meals);
        const leftoverG = plan?.leftovers[item.ingredient_id];
        const moneyClass = item.ebt_eligible ? "money-snap" : "money-cash";
        return (
          <div key={item.ingredient_id} className={`ing${inBasket ? " have" : ""}`}>
            <div className="ing-top">
              <button
                type="button"
                className="dot"
                aria-label="In basket"
                onClick={() => onToggleChecked(item.ingredient_id)}
              />
              <button
                type="button"
                className="grow"
                style={{ background: "none", border: "none", padding: 0, textAlign: "left", display: "flex", flexDirection: "column", gap: 4, minHeight: 44 }}
                onClick={() => setExpandedId(expanded ? null : item.ingredient_id)}
                aria-expanded={expanded}
              >
                <span className="row row--between" style={{ gap: 8 }}>
                  <span className="name">{ing?.kroger_product ?? name}</span>
                  <span className={`tag ${item.ebt_eligible ? "elig" : "unv"}`}>{item.ebt_eligible ? "SNAP" : "Card"}</span>
                </span>
                <span className="row" style={{ gap: 8 }}>
                  <span className="subnote">
                    {item.packages}× {ing?.package_g ?? 0} g · <span className={moneyClass}>{fmtMoney(item.line_cents)}</span>
                  </span>
                  {isOut && <span className="tag oos">Out of stock</span>}
                </span>
              </button>
            </div>
            {expanded && (
              <div className="subpanel">
                {forMeals && <p className="subnote">For: {forMeals}</p>}
                {leftoverG !== undefined && (
                  <p className="subnote">Left over after this trip: estimated {leftoverG} g</p>
                )}
                {isNew && (
                  <p>
                    <span className="tag cost">Swapped in</span>
                  </p>
                )}
                <button
                  type="button"
                  className="link"
                  style={{ fontSize: 13, minHeight: 32 }}
                  onClick={() => onToggleOutOfStock(item.ingredient_id)}
                >
                  {isOut ? "Back in stock" : "Mark out of stock"}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </section>
  );
}
