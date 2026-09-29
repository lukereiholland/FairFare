import { useState } from "react";
import type { Household, NutrientTargets, Plan } from "../types";

const NUTRIENTS: { key: string; label: string; target: keyof NutrientTargets }[] = [
  { key: "kcal", label: "calories", target: "kcal_min" },
  { key: "protein", label: "protein", target: "protein_g_min" },
  { key: "fiber", label: "fiber", target: "fiber_g_min" },
  { key: "sodium", label: "sodium", target: "sodium_mg_max" },
  { key: "sugar", label: "sugar", target: "sugar_g_max" },
];

/** Dollars typed by the user -> integer cents. The only arithmetic in the form. */
function toCents(dollars: string): number {
  const n = Number(dollars);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : 0;
}

/** Balances, deposit date, trip length, people and prep-time form; saves one patch onto the household. */
export default function PlanForm({ household, onSave }: { household: Household; onSave: (patch: Partial<Household>) => void }) {
  const [snap, setSnap] = useState(String(household.ebt_cents / 100));
  const [cash, setCash] = useState(String(household.cash_cents / 100));
  const [date, setDate] = useState(household.deposit_date ?? "");
  const [days, setDays] = useState(household.trip_days);
  const [people, setPeople] = useState(household.people);
  const [prep, setPrep] = useState(household.max_prep_min);

  const save = () =>
    onSave({
      ebt_cents: toCents(snap),
      cash_cents: household.snap_only ? 0 : toCents(cash),
      deposit_date: date || null,
      trip_days: days,
      people,
      max_prep_min: prep,
    });

  return (
    <div>
      <div className="planform">
        <div>
          <label htmlFor="pf-snap">SNAP balance right now</label>
          <input id="pf-snap" type="number" inputMode="decimal" min={0} step="0.01" value={snap} onChange={(e) => setSnap(e.target.value)} />
        </div>
        {!household.snap_only && (
          <div>
            <label htmlFor="pf-cash">Cash available for groceries</label>
            <input id="pf-cash" type="number" inputMode="decimal" min={0} step="0.01" value={cash} onChange={(e) => setCash(e.target.value)} />
          </div>
        )}
        <div>
          <label htmlFor="pf-date">Next expected deposit date</label>
          <input id="pf-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="row row--between">
          <div>
            <label>Days this trip covers</label>
            <div className="stepper" aria-label="Days this trip covers">
              <button type="button" aria-label="One day fewer" onClick={() => setDays((d) => Math.max(1, d - 1))}>-</button>
              <span>{days}</span>
              <button type="button" aria-label="One day more" onClick={() => setDays((d) => Math.min(14, d + 1))}>+</button>
            </div>
          </div>
          <div>
            <label>People eating</label>
            <div className="stepper" aria-label="People eating">
              <button type="button" aria-label="One person fewer" onClick={() => setPeople((p) => Math.max(1, p - 1))}>-</button>
              <span>{people}</span>
              <button type="button" aria-label="One person more" onClick={() => setPeople((p) => Math.min(12, p + 1))}>+</button>
            </div>
          </div>
        </div>
        <div>
          <label htmlFor="pf-prep">Most minutes you'll spend cooking a meal</label>
          <select id="pf-prep" value={prep} onChange={(e) => setPrep(Number(e.target.value))}>
            {[15, 30, 45, 60].map((m) => (
              <option key={m} value={m}>{m} minutes</option>
            ))}
          </select>
        </div>
      </div>
      <button type="button" className="btn-primary" style={{ marginTop: 8 }} onClick={save}>
        Save changes
      </button>
      <p className="disclaim">Entered manually — not connected to your EBT account.</p>
    </div>
  );
}

/** One tile per nutrient: "met" or "85%" of target. Numbers come from the Plan; nothing is computed here beyond the percent display. */
export function NutritionStrip({ plan }: { plan: Plan }) {
  return (
    <div className="nutri-row" aria-label="Nutrition this trip">
      {NUTRIENTS.map(({ key, label, target }) => {
        const short = plan.shortfalls[key] ?? 0;
        const goal = plan.targets[target];
        const value = short > 0 && goal > 0 ? `${Math.round((100 * (plan.nutrition[key] ?? 0)) / goal)}%` : "met";
        return (
          <div key={key} className="nstat">
            <b>{value}</b>
            <span>{label}</span>
          </div>
        );
      })}
    </div>
  );
}
