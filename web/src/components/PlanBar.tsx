import { fmtMoney } from "../format";
import { useApp } from "../state";

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** Sticky one-line summary of the current plan above the tab bar; the whole bar goes back to /plan. Null until a plan exists. */
export default function PlanBar() {
  const { plan, solving, navigate } = useApp();
  if (!plan) return null;
  const n = Object.keys(plan.meals).length;

  return (
    <button
      type="button"
      className={`planbar${solving ? " loading" : ""}`}
      onClick={() => navigate("/plan")}
      aria-label="Back to plan"
    >
      <span className="planbar__text">
        {plural(n, "meal")} · {fmtMoney(plan.basket_cents)} · SNAP {fmtMoney(plan.ebt_cents)}
      </span>
      <span className="planbar__cta" aria-hidden="true">Back to plan ›</span>
    </button>
  );
}
