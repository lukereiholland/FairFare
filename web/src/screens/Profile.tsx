import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, UserRound } from "lucide-react";
import { useApp } from "../state";
import type { Diet, Equipment } from "../types";
import AdjustSheet from "../components/AdjustSheet";
import PaymentCard from "../components/PaymentCard";
import PlanForm, { NutritionStrip } from "../components/PlanForm";

type Sheet = "balances" | "diet" | "kitchen" | "hidden" | "nutrition" | "payment";

const DIETS: { key: Diet; label: string; note?: string }[] = [
  { key: "vegetarian", label: "Vegetarian", note: "No meat, poultry, fish, shellfish or gelatin." },
  { key: "vegan", label: "Vegan", note: "Vegetarian, plus no dairy or eggs." },
  { key: "halal", label: "Halal", note: "No pork, alcohol or gelatin." },
  { key: "kosher", label: "Kosher", note: "No pork, shellfish or gelatin. Meat and dairy separation isn't modeled." },
];

const EQUIPMENT: { key: Equipment; label: string }[] = [
  { key: "stovetop", label: "Stovetop" },
  { key: "microwave", label: "Microwave" },
  { key: "oven", label: "Oven" },
];

const DISCLAIM = "Entered manually — not connected to your EBT account.";

function ProfileRow({ label, value, onClick }: { label: string; value?: string; onClick: () => void }) {
  return (
    <button type="button" className="profile-row" onClick={onClick}>
      <span className="profile-row__label">{label}</span>
      <span className="profile-row__value">
        {value && <span>{value}</span>}
        <ChevronRight className="ic" aria-hidden="true" />
      </span>
    </button>
  );
}

/** Household settings as a list of rows; each opens a sheet that patches the household (and re-solves). Reached from Plan, not a tab. */
export default function Profile() {
  const { household, plan, meals, setHousehold, resetHousehold, resetAll, navigate } = useApp();
  const [resetArmed, setResetArmed] = useState(false);
  useEffect(() => {
    if (!resetArmed) return;
    const t = window.setTimeout(() => setResetArmed(false), 5000); // disarm if the second tap never comes
    return () => window.clearTimeout(t);
  }, [resetArmed]);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  if (!household) return null;

  const close = () => setSheet(null);
  const dietValue = household.diet.length ? household.diet.join(", ") : "None";
  const kitchenValue = household.equipment.length ? household.equipment.join(" + ") : "No cooking";
  const hiddenCount = household.excluded_meals.length;
  const savedCount = household.favorite_meals.length;

  const toggleDiet = (d: Diet, on: boolean) => {
    const next = on ? Array.from(new Set([...household.diet, d])) : household.diet.filter((x) => x !== d);
    setHousehold({ diet: next });
  };
  const toggleEquipment = (e: Equipment, on: boolean) => {
    const next = on ? Array.from(new Set([...household.equipment, e])) : household.equipment.filter((x) => x !== e);
    setHousehold({ equipment: next });
  };
  const showAgain = (id: string) => setHousehold({ excluded_meals: household.excluded_meals.filter((x) => x !== id) });

  return (
    <div className="screen">
      <div className="topbar screen-head screen-head--profile">
        <div className="row profile-topbar">
          <button type="button" className="quiz-back profile-back" aria-label="Back to plan" onClick={() => navigate("/plan")}>
            <ChevronLeft className="ic" aria-hidden="true" />
          </button>
          <h2>Profile</h2>
        </div>
      </div>

      <div className="profile-head">
        <div className="profile-avatar" aria-hidden="true">
          <UserRound className="ic" />
        </div>
        <h3>Household of {household.people}</h3>
      </div>

      <div className="profile-list">
        <ProfileRow label="Retake setup quiz" onClick={resetHousehold} />
        <ProfileRow label="Deposit & balances" onClick={() => setSheet("balances")} />
        <ProfileRow label="Dietary needs" value={dietValue} onClick={() => setSheet("diet")} />
        <ProfileRow label="Kitchen setup" value={kitchenValue} onClick={() => setSheet("kitchen")} />
      </div>

      <div className="profile-list">
        <ProfileRow label="Saved recipes" value={String(savedCount)} onClick={() => navigate("/cookbook")} />
        <ProfileRow label="Hidden recipes" value={String(hiddenCount)} onClick={() => setSheet("hidden")} />
        <ProfileRow label="Nutrition this trip" onClick={() => setSheet("nutrition")} />
        <ProfileRow label="Payment summary" onClick={() => setSheet("payment")} />
      </div>

      <div className="profile-foot">
        <p className="disclaim" style={{ marginTop: 0 }}>{DISCLAIM}</p>
        {plan && <p className="tiny muted">Planner answered in {plan.solve_ms} ms</p>}
        <button
          type="button"
          className={`link link--danger${resetArmed ? " armed" : ""}`}
          onClick={() => (resetArmed ? resetAll() : setResetArmed(true))}
        >
          {resetArmed ? "Tap again to erase everything on this phone" : "Reset this phone and start over"}
        </button>
        {resetArmed && <p className="tiny muted">Setup, balances, pantry, cookbook and hidden recipes are erased. Recipes and prices stay.</p>}
      </div>

      <AdjustSheet open={sheet === "balances"} onClose={close} title="Deposit & balances">
        <PlanForm
          household={household}
          onSave={(patch) => {
            setHousehold(patch);
            close();
          }}
        />
      </AdjustSheet>

      <AdjustSheet open={sheet === "diet"} onClose={close} title="Dietary needs">
        <p className="sheet-note">Simplified rules: each choice removes the matching ingredients from every meal.</p>
        <div>
          {DIETS.map(({ key, label, note }) => (
            <label key={key} className="checkrow">
              <input type="checkbox" checked={household.diet.includes(key)} onChange={(e) => toggleDiet(key, e.target.checked)} />
              <span className="grow">
                {label}
                {note && (
                  <>
                    <br />
                    <span className="subnote">{note}</span>
                  </>
                )}
              </span>
            </label>
          ))}
        </div>
        <button type="button" className="btn-primary" onClick={close}>
          Done
        </button>
      </AdjustSheet>

      <AdjustSheet open={sheet === "kitchen"} onClose={close} title="Kitchen setup">
        <div>
          {EQUIPMENT.map(({ key, label }) => (
            <label key={key} className="checkrow">
              <input type="checkbox" checked={household.equipment.includes(key)} onChange={(e) => toggleEquipment(key, e.target.checked)} />
              <span className="grow">{label}</span>
            </label>
          ))}
        </div>
        <div className="planform">
          <div>
            <label htmlFor="profile-prep">Most minutes you'll spend cooking a meal</label>
            <select id="profile-prep" value={household.max_prep_min} onChange={(e) => setHousehold({ max_prep_min: Number(e.target.value) })}>
              {[15, 30, 45, 60].map((m) => (
                <option key={m} value={m}>{m} minutes</option>
              ))}
            </select>
          </div>
        </div>
        <button type="button" className="btn-primary" onClick={close}>
          Done
        </button>
      </AdjustSheet>

      <AdjustSheet open={sheet === "hidden"} onClose={close} title="Hidden recipes">
        {hiddenCount === 0 ? (
          <p className="sheet-note">Nothing is hidden. Open any recipe and tap "Don't suggest this again" to keep it out of your plans.</p>
        ) : (
          <div>
            {household.excluded_meals.map((id) => (
              <div key={id} className="weekitem">
                <span className="name">{meals[id]?.name ?? id}</span>
                <button type="button" className="link" onClick={() => showAgain(id)}>
                  Show again
                </button>
              </div>
            ))}
          </div>
        )}
        <button type="button" className="btn-primary" onClick={close}>
          Done
        </button>
      </AdjustSheet>

      <AdjustSheet open={sheet === "nutrition"} onClose={close} title="Nutrition this trip">
        {plan ? <NutritionStrip plan={plan} /> : <p className="sheet-note">Your plan is still loading.</p>}
        <p className="sheet-note">Shown as met or percent of target.</p>
        <button type="button" className="btn-primary" onClick={close}>
          Done
        </button>
      </AdjustSheet>

      <AdjustSheet open={sheet === "payment"} onClose={close} title="Payment summary">
        {plan ? <PaymentCard plan={plan} household={household} title={null} /> : <p className="sheet-note">Your plan is still loading.</p>}
        <button type="button" className="btn-primary" onClick={close}>
          Done
        </button>
      </AdjustSheet>
    </div>
  );
}
