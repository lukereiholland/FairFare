import { useEffect, useRef, useState } from "react";
import { Leaf } from "lucide-react";
import { useApp } from "../state";
import { fmtMoney } from "../format";
import type { Plan } from "../types";

const SHOW_MS = 7000;
const QUIET_AFTER_MS = 400;

/** Feedback for every re-solve: a dropped pin is announced once, when it first fails; otherwise the plan's
 *  what_changed line. A quiet "Updating your plan…" shows while a solve runs longer than 400 ms. */
export default function Toast() {
  const { plan, prevPlan, solving, household, meals } = useApp();
  const [message, setMessage] = useState<string | null>(null);
  const [quiet, setQuiet] = useState(false);
  const shownFor = useRef<Plan | null>(null);
  const seenDropped = useRef<Set<string>>(new Set()); // pins already announced as not fitting
  const hideTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!plan || plan === shownFor.current) return;
    shownFor.current = plan;

    let text = plan.what_changed?.trim() || "";
    if (text === "No changes.") text = "";

    const required = household?.required_meals ?? [];
    const droppedAll = plan.relaxed.includes("pins") ? required.filter((id) => !(plan.meals[id] > 0)) : [];
    const fresh = droppedAll.filter((id) => !seenDropped.current.has(id));
    seenDropped.current = new Set(droppedAll);
    const dropped = fresh[fresh.length - 1]; // pins are appended in tap order; the last new one is the recipe just added
    if (dropped && prevPlan) {
      const m = meals[dropped];
      const name = m?.name ?? "That recipe";
      const missingEq = m ? m.equipment.filter((e) => !(household?.equipment ?? []).includes(e)) : [];
      if (missingEq.length > 0) {
        text = `${name} needs ${missingEq.join(" and ")}. Add it under Kitchen setup in Profile.`;
      } else if (m && household && m.prep_min > household.max_prep_min) {
        text = `${name} takes ${m.prep_min} minutes, over your ${household.max_prep_min}-minute limit. Raise it in Profile.`;
      } else {
        const cardOffer = household && household.cash_cents > 0 && !household.card_covers_snap_gap
          ? " Or open the recipe and let your card cover what SNAP can't."
          : "";
        text = `${name} didn't fit this trip's ${fmtMoney(plan.trip_snap_cap_cents)} of SNAP. Raise your balance or remove a meal.${cardOffer}`;
      }
    }

    if (!text || !prevPlan) return;
    setMessage(text);
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      setMessage(null);
      hideTimer.current = null;
    }, SHOW_MS);
  }, [plan, prevPlan, household, meals]);

  useEffect(
    () => () => {
      if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    },
    [],
  );

  // Only solves that take a noticeable moment get the quiet toast, so quick ones don't flicker.
  useEffect(() => {
    if (!solving) {
      setQuiet(false);
      return;
    }
    const t = window.setTimeout(() => setQuiet(true), QUIET_AFTER_MS);
    return () => window.clearTimeout(t);
  }, [solving]);

  const dismiss = () => {
    if (hideTimer.current !== null) window.clearTimeout(hideTimer.current);
    hideTimer.current = null;
    setMessage(null);
  };

  if (message) {
    return (
      <div className="toast" role="status" aria-live="polite" onClick={dismiss}>
        <Leaf className="ic" aria-hidden="true" />
        <span className="toast__text">{message}</span>
      </div>
    );
  }
  if (quiet) {
    return (
      <div className="toast toast--quiet" role="status" aria-live="polite">
        <span className="toast__text">Updating your plan…</span>
      </div>
    );
  }
  return null;
}
