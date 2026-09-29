import { useMemo, useState } from "react";
import { RotateCcw } from "lucide-react";
import PaymentCard from "../components/PaymentCard";
import CartGroup from "../components/CartGroup";
import { api } from "../api";
import { useApp } from "../state";
import { fmtMoney } from "../format";
import type { Ingredient, PantryItem, PlanItem } from "../types";

const AISLE_ORDER = ["produce", "dairy", "meat", "frozen", "dry", "canned", "bakery", "other"];

/**
 * The one place in the frontend (besides the running total below) allowed to add money: sums
 * line_cents of the checked cart rows, split EBT vs. cash. Local UI state only, never persisted.
 */
function basketTotals(cart: PlanItem[], checkedIds: Set<string>): { ebt: number; cash: number } {
  let ebt = 0;
  let cash = 0;
  for (const item of cart) {
    if (!checkedIds.has(item.ingredient_id)) continue;
    if (item.ebt_eligible) ebt += item.line_cents;
    else cash += item.line_cents;
  }
  return { ebt, cash };
}

/** Leftover grams -> the pantry levels the Pantry screen understands. Grams are re-derived server-side. */
function leftoversToItems(leftovers: Record<string, number>, ingredients: Record<string, Ingredient>): PantryItem[] {
  const items: PantryItem[] = [];
  for (const [id, grams] of Object.entries(leftovers)) {
    const pack = ingredients[id]?.package_g ?? 0;
    if (pack <= 0 || grams <= 0) continue;
    const frac = grams / pack;
    if (frac < 0.1) continue; // a spoonful left is not worth tracking
    items.push({ ingredient_id: id, level: frac >= 0.75 ? "full" : frac >= 0.35 ? "half" : "low", source: "manual" });
  }
  return items;
}

export default function List() {
  const { plan, prevPlan, household, ingredients, meals, solving, setHousehold, setPantryItems, navigate } = useApp();
  const [checkedIds, setCheckedIds] = useState<Set<string>>(() => new Set());
  const [carrying, setCarrying] = useState<"idle" | "busy" | "error">("idle");

  /** "Start next trip with what's left": leftovers become the pantry, then the plan re-solves. */
  const startNextTrip = async () => {
    if (!plan) return;
    setCarrying("busy");
    try {
      const items = leftoversToItems(plan.leftovers, ingredients);
      const grams = await api.pantryGrams(items);
      setPantryItems(items);
      setHousehold({ pantry: grams });
      setCarrying("idle");
      navigate("/plan");
    } catch {
      setCarrying("error");
    }
  };

  const toggleChecked = (id: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleOutOfStock = (id: string) => {
    if (!household) return;
    const current = household.out_of_stock;
    const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
    setHousehold({ out_of_stock: next });
  };

  const groups = useMemo(() => {
    const g: Record<string, PlanItem[]> = {};
    for (const item of plan?.cart ?? []) {
      (g[item.aisle] ??= []).push(item);
    }
    return g;
  }, [plan]);

  const swappedIn = useMemo(() => {
    if (!plan || !prevPlan) return new Set<string>();
    const prevIds = new Set(prevPlan.cart.map((i) => i.ingredient_id));
    return new Set(plan.cart.filter((i) => !prevIds.has(i.ingredient_id)).map((i) => i.ingredient_id));
  }, [plan, prevPlan]);

  if (!plan || !household) {
    return (
      <div className="screen">
        <p className="muted">No plan yet.</p>
        <button type="button" className="link" onClick={() => navigate("/plan")}>
          Go to Plan
        </button>
      </div>
    );
  }

  const { ebt, cash } = basketTotals(plan.cart, checkedIds);
  const aisleKeys = [...AISLE_ORDER, ...Object.keys(groups).filter((a) => !AISLE_ORDER.includes(a))];
  const pantryEntries = Object.entries(plan.from_pantry);
  const leftoverEntries = Object.entries(plan.leftovers).sort((a, b) => b[1] - a[1]);
  const planMealIds = Object.keys(plan.meals);

  return (
    <div className="screen">
      <div className="topbar screen-head screen-head--list">
        <div className="topbar__text">
          <h2>Shopping List</h2>
          <p className="subnote">Everything your plan needs, nothing extra. Tick items as they go in your basket.</p>
        </div>
      </div>

      <PaymentCard plan={plan} household={household} loading={solving} />
      <p className="disclaim" style={{ margin: "0 0 16px" }}>SNAP can't cover delivery fees or tips if you order for delivery.</p>

      <div
        className="card-div"
        style={{ position: "sticky", top: 0, zIndex: 5, fontWeight: 600, fontSize: 14 }}
      >
        <span>
          In basket · SNAP <span className="money-snap">{fmtMoney(ebt)}</span> · Card{" "}
          <span className="money-cash">{fmtMoney(cash)}</span>
        </span>
      </div>

      <div className="stack" style={{ gap: 18, marginTop: 6 }}>
      {aisleKeys.map((aisle) => (
        <CartGroup
          key={aisle}
          aisle={aisle}
          items={groups[aisle] ?? []}
          ingredients={ingredients}
          checkedIds={checkedIds}
          onToggleChecked={toggleChecked}
          outOfStock={household.out_of_stock}
          onToggleOutOfStock={toggleOutOfStock}
          swappedIn={swappedIn}
          meals={meals}
          planMealIds={planMealIds}
        />
      ))}
      </div>

      {pantryEntries.length > 0 && (
        <section style={{ marginTop: 26 }}>
          <h3 className="section-title section-title--sm">From your kitchen</h3>
          <p className="subnote" style={{ marginBottom: 4 }}>
            Not on the list because you already have them. Amounts are what the meals use, estimated.
          </p>
          {pantryEntries.map(([id, grams]) => (
            <div key={id} className="ing have">
              <div className="ing-top">
                <span className="dot" aria-hidden="true" />
                <span className="name">{ingredients[id]?.name ?? id}</span>
                <span className="subnote">about {grams} g</span>
              </div>
            </div>
          ))}
        </section>
      )}

      <button type="button" className="btn-primary" style={{ marginTop: 26 }} onClick={() => navigate("/register")}>
        Show the cashier
      </button>

      {leftoverEntries.length > 0 && (
        <section className="plancard" style={{ marginTop: 26 }} aria-label="Left after this trip">
          <h3 className="section-title section-title--sm">Left after this trip</h3>
          <p className="subnote" style={{ marginBottom: 6 }}>
            Packages are bought whole, so some food carries over. Estimated amounts.
          </p>
          {leftoverEntries.map(([id, grams]) => (
            <div key={id} className="payrow quiet">
              <span>{ingredients[id]?.name ?? id}</span>
              <span>about {grams} g</span>
            </div>
          ))}
          <button type="button" className="btn-line" style={{ marginTop: 10 }} onClick={startNextTrip} disabled={carrying === "busy"}>
            <RotateCcw className="ic" aria-hidden="true" />
            Start next trip with what's left
          </button>
          {carrying === "error" && <p className="disclaim">Couldn't save that. Check the planner is reachable and try again.</p>}
        </section>
      )}
    </div>
  );
}
