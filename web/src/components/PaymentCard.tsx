import { AlertCircle } from "lucide-react";
import { fmtMoney } from "../format";
import type { Household, Plan } from "../types";

function pluralize(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** "This budget covers everything except 2 dinners" from plan.uncovered ({} when all covered). */
export function uncoveredSentence(uncovered: Record<string, number>): string | null {
  const parts = Object.entries(uncovered)
    .filter(([, n]) => n > 0)
    .map(([slot, n]) => pluralize(n, slot));
  if (parts.length === 0) return null;
  const joined = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
  return `This budget covers everything except ${joined}.`;
}

/** Payment summary in the FairFare row style. Every number comes from the Plan; nothing is computed here. */
export default function PaymentCard({
  plan,
  household,
  loading,
  title = "Payment summary",
}: {
  plan: Plan;
  household: Household;
  loading?: boolean;
  title?: string | null;
}) {
  let warning: string | null = null;
  if (household.snap_only && plan.cash_cents > 0) {
    warning = `This trip needs ${fmtMoney(plan.cash_cents)} in cash and you're set to SNAP only. Swap or remove an item to close the gap.`;
  } else if (plan.cash_remaining_cents < 0) {
    warning = `This is ${fmtMoney(-plan.cash_remaining_cents)} over your available cash.`;
  }
  const uncoveredMsg = uncoveredSentence(plan.uncovered);
  const isUncovered = Object.keys(plan.uncovered).length > 0;
  const showRelaxedNote = !isUncovered && (plan.relaxed.includes("variety") || plan.relaxed.includes("repeats"));
  const pct = plan.eligible_pct;
  return (
    <section className={`plancard${loading ? " loading" : ""}`} aria-label="Payment summary">
      {title && <h3 className="section-title section-title--sm">{title}</h3>}
      <div className="payrow total">
        <span>Grocery basket</span>
        <b>{fmtMoney(plan.basket_cents)}</b>
      </div>
      <div className="payrow">
        <span>Planned SNAP payment</span>
        <span className="money-snap">{fmtMoney(plan.ebt_cents)}</span>
      </div>
      <div className="payrow">
        <span>Cash you'll need</span>
        <span className="money-cash">{fmtMoney(plan.cash_cents)}</span>
      </div>
      <div className="payrow">
        <span>Cash remaining</span>
        <span className="money-cash">{fmtMoney(plan.cash_remaining_cents)}</span>
      </div>
      <div className="payrow quiet" style={{ alignItems: "center" }}>
        <span>SNAP-eligible</span>
        <div
          className="ring ring--sm"
          style={{ background: `conic-gradient(var(--color-snap) 0% ${pct}%, var(--paper-alt) ${pct}% 100%)` }}
        >
          <span>{pct}%</span>
        </div>
      </div>
      {warning && (
        <div className="warnbox" role="status">
          <AlertCircle className="ic" aria-hidden="true" />
          <span>{warning}</span>
        </div>
      )}
      {uncoveredMsg && (
        <div className="infobox" role="status" style={{ marginTop: 8, marginBottom: 0 }}>
          <AlertCircle className="ic" aria-hidden="true" />
          <span>{uncoveredMsg}</span>
        </div>
      )}
      {showRelaxedNote && <p className="disclaim">Fewer different meals than usual to fit the budget.</p>}
      <p className="disclaim">Entered manually — not connected to your EBT account.</p>
    </section>
  );
}
