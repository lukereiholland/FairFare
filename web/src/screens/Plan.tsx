import StoreCompare from "../components/StoreCompare";
import TopActions from "../components/TopActions";
import DayStrip from "../components/DayStrip";
import { useState } from "react";
import { AlertCircle, Leaf } from "lucide-react";
import { daysUntil, fmtDate, fmtMoney } from "../format";
import { useApp } from "../state";
import type { Household, Meal, MealFacts, Plan as PlanT, Slot } from "../types";
import { uncoveredSentence } from "../components/PaymentCard";
import PlanForm from "../components/PlanForm";
import MealCard from "../components/MealCard";
import MealDetail from "../components/MealDetail";
import AdjustSheet from "../components/AdjustSheet";

const SLOT_ORDER: Record<Slot, number> = { breakfast: 0, lunch: 1, dinner: 2 };
const INTRO_KEY = "stretch.v2.introSeen";

/** Factual label for the first recognised tag on a meal card; equipment tags carry no label. */
const TAG_LABEL = new Map<string, string>([
  ["quick", "Quick"],
  ["budget", "Budget pick"],
  ["high-protein", "High protein"],
  ["high-fiber", "High fiber"],
  ["no-cook", "No cooking"],
]);

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function tagLabel(f: MealFacts | undefined): string | undefined {
  const tag = f?.tags.find((t) => TAG_LABEL.has(t));
  return tag ? TAG_LABEL.get(tag) : undefined;
}

function readIntroSeen(): boolean {
  try {
    return localStorage.getItem(INTRO_KEY) === "1";
  } catch {
    return false;
  }
}

/** Pace line under the basket total: against the deposit when a date is set, otherwise the coverage window. */
function paceLine(plan: PlanT, household: Household): { text: string; warn: boolean } {
  const covers = `Covers ${plural(household.trip_days, "day")}`;
  if (!household.deposit_date) return { text: `${covers} · until ${fmtDate(plan.covers_until)}`, warn: false };
  if (plan.on_pace) return { text: `${covers} · on pace to ${fmtDate(household.deposit_date)}`, warn: false };
  const runOut = plan.projected_run_out_date ? `runs out ${fmtDate(plan.projected_run_out_date)}` : "runs out before your deposit";
  return { text: `${covers} · SNAP ${runOut}, ahead of your ${fmtDate(household.deposit_date)} deposit`, warn: true };
}

export default function Plan() {
  const { household, plan, meals, ingredients, facts, solving, solveError, setHousehold, navigate, pinMeal, skipMeal, toggleFavorite } =
    useApp();
  const [adjusting, setAdjusting] = useState(false);
  const [openMeal, setOpenMeal] = useState<Meal | null>(null);
  const [introSeen, setIntroSeen] = useState<boolean>(readIntroSeen);
  if (!household) return null;

  const dismissIntro = () => {
    try {
      localStorage.setItem(INTRO_KEY, "1");
    } catch {
      /* storage unavailable; hide it for this visit anyway */
    }
    setIntroSeen(true);
  };

  const days = daysUntil(household.deposit_date);
  const capApplies = days !== null && days > household.trip_days; // the solver paces SNAP across the deposit gap
  const pace = plan ? paceLine(plan, household) : null;
  const uncoveredMsg = plan ? uncoveredSentence(plan.uncovered) : null;
  const staples = plan ? plan.staples_assumed.map((id) => ingredients[id]?.name ?? id) : [];
  const chosen: { meal: Meal; times: number }[] = plan
    ? Object.entries(plan.meals)
        .flatMap(([id, times]) => (meals[id] && times > 0 ? [{ meal: meals[id], times }] : []))
        .sort((a, b) => SLOT_ORDER[a.meal.slot] - SLOT_ORDER[b.meal.slot] || b.times - a.times)
    : [];

  const inTrip = (id: string) => (plan?.meals[id] ?? 0) > 0;
  const openId = openMeal?.id ?? null;

  return (
    <div className="screen">
      <div className="topbar screen-head screen-head--plan">
        <h2>Your Plan</h2>
        <TopActions />
      </div>

      <section className={`hero${plan && solving ? " loading" : ""}`} aria-label="This trip">
        {plan && pace ? (
          <>
            <div className="amt">
              {fmtMoney(plan.basket_cents)}
              <small>this trip</small>
            </div>
            <p className={`pace${pace.warn ? " warn" : ""}`} role={pace.warn ? "status" : undefined}>
              {pace.warn && <AlertCircle className="ic" aria-hidden="true" />}
              <span>{pace.text}</span>
            </p>
            <div className="split" aria-label="How this splits">
              <span className="money-pill money-snap">SNAP {fmtMoney(plan.ebt_cents)}</span>
              <span className="money-pill money-cash">Card {fmtMoney(plan.cash_cents)}</span>
            </div>
          </>
        ) : solveError ? (
          <>
            <div className="amt quiet">No plan yet</div>
            <p className="pace">
              <span>Change your budget or dates below and we'll try again.</span>
            </p>
          </>
        ) : (
          <>
            <div className="skeleton hero-skel" aria-hidden="true" />
            <div className="skeleton hero-skel hero-skel--sub" aria-hidden="true" />
            <p className="pace">
              <span>Working it out from real store prices</span>
            </p>
          </>
        )}
      </section>

      {solveError && (
        <div className="warnbox warnbox--plan" role="alert">
          <AlertCircle className="ic" aria-hidden="true" />
          <span className="warnbox__text">
            <span>{solveError}</span>
            <button type="button" className="link warnbox__link" onClick={() => setAdjusting(true)}>
              Change budget or dates
            </button>
          </span>
        </div>
      )}

      {plan && !introSeen && (
        <div className="infobox intro" role="note">
          <Leaf className="ic" aria-hidden="true" />
          <span className="infobox__text">
            <span>
              We picked {plural(chosen.length, "meal")} for the next {plural(household.trip_days, "day")} that fit your{" "}
              {fmtMoney(household.ebt_cents)} of SNAP. Remove any you don't want, or add favorites from Recipes.
            </span>
            <button type="button" className="link intro__dismiss" onClick={dismissIntro}>
              Got it
            </button>
          </span>
        </div>
      )}

      {!solveError && plan?.what_changed && (
        <div className="infobox" role="status">
          <Leaf className="ic" aria-hidden="true" />
          <span>{plan.what_changed}</span>
        </div>
      )}

      {plan && uncoveredMsg && (
        <div className="infobox" role="status" style={{ flexDirection: "column", gap: 10 }}>
          <div className="row" style={{ gap: 10, alignItems: "flex-start" }}>
            <AlertCircle className="ic" aria-hidden="true" />
            <span>
              {uncoveredMsg}{" "}
              {capApplies && !household.use_more_snap
                ? `This trip is held to ${fmtMoney(plan.trip_snap_cap_cents)} so your SNAP lasts until ${fmtDate(household.deposit_date)}.`
                : "Add cash under Change budget or dates, or remove a meal, to cover the rest."}
              {plan.relaxed.includes("variety") && Object.keys(plan.meals).length <= 3
                ? " At this budget only a few meals fit, so they repeat."
                : ""}
            </span>
          </div>
          {capApplies && !household.use_more_snap && (
            <button type="button" className="btn-line" onClick={() => setHousehold({ use_more_snap: true })}>
              Use more of my balance this trip
            </button>
          )}
        </div>
      )}

      <StoreCompare />

      <section className="daybyday" aria-label="Day by day">
        <h3 className="section-title">Day by day</h3>
        <DayStrip schedule={plan?.schedule ?? []} meals={meals} loading={solving} onOpen={setOpenMeal} />
      </section>

      {plan && chosen.length > 0 && (
        <section className="triplist" aria-label="Meals this trip">
          <h3 className="section-title">Your meals ({chosen.length})</h3>
          <div className="meal-list">
            {chosen.map(({ meal, times }) => (
              <MealCard
                key={meal.id}
                meal={meal}
                servingCents={facts[meal.id]?.serving_cents}
                times={times}
                tag={tagLabel(facts[meal.id])}
                favorite={household.favorite_meals.includes(meal.id)}
                inTrip
                onOpen={() => setOpenMeal(meal)}
                onToggleFavorite={() => toggleFavorite(meal.id)}
                onRemove={() => skipMeal(meal.id)}
                loading={solving}
              />
            ))}
          </div>
          <button type="button" className="btn-line triplist__more" onClick={() => navigate("/recipes")}>
            Add more from Recipes
          </button>
        </section>
      )}

      {plan && plan.snap_overflow_cents > 0 && (
        <div className="infobox" role="status" style={{ flexDirection: "column", gap: 10 }}>
          <div className="row" style={{ gap: 10, alignItems: "flex-start" }}>
            <AlertCircle className="ic" aria-hidden="true" />
            <span>
              <span className="money-cash">{fmtMoney(plan.snap_overflow_cents)}</span> of SNAP-eligible food goes on your card this trip
              because it did not fit under your SNAP. That is your own money.
            </span>
          </div>
          <button type="button" className="btn-line" onClick={() => setHousehold({ card_covers_snap_gap: false })}>
            Keep it to SNAP only
          </button>
        </div>
      )}

      {plan && staples.length > 0 && (
        <p className="basics">
          Basics you have: {staples.join(", ")}.{" "}
          <button type="button" className="link" onClick={() => navigate("/pantry")}>
            Out of one? Update Pantry
          </button>
        </p>
      )}

      <div className="center" style={{ marginTop: 8 }}>
        <button type="button" className="link" onClick={() => setAdjusting(true)}>
          Change budget or dates
        </button>
      </div>
      <p className="disclaim center" style={{ marginTop: 4 }}>
        Entered manually — not connected to your EBT account.{plan ? ` · ${plan.solve_ms} ms` : ""}
      </p>

      <MealDetail
        meal={openMeal}
        ingredients={ingredients}
        facts={openId ? facts[openId] : undefined}
        times={openId ? plan?.meals[openId] : undefined}
        favorite={openId ? household.favorite_meals.includes(openId) : false}
        inTrip={openId ? inTrip(openId) : false}
        pinnedNotFit={openId ? !solving && (plan?.relaxed ?? []).includes("pins") && household.required_meals.includes(openId) && !inTrip(openId) : false}
        canPayWithCard={household.cash_cents > 0 && !household.card_covers_snap_gap}
        onPayWithCard={() => setHousehold({ card_covers_snap_gap: true })}
        excluded={openId ? household.excluded_meals.includes(openId) : false}
        onClose={() => setOpenMeal(null)}
        onToggleFavorite={toggleFavorite}
        onAdd={pinMeal}
        onRemove={skipMeal}
        onNeverShow={(id) => {
          setHousehold({ excluded_meals: Array.from(new Set([...household.excluded_meals, id])) });
          setOpenMeal(null);
        }}
        onShowAgain={(id) => setHousehold({ excluded_meals: household.excluded_meals.filter((x) => x !== id) })}
      />

      <AdjustSheet open={adjusting} onClose={() => setAdjusting(false)} title="Budget and dates">
        <div className="seg" role="group" aria-label="How you'll pay">
          <button type="button" className={household.snap_only ? "" : "active"} onClick={() => setHousehold({ snap_only: false })}>
            SNAP + cash
          </button>
          <button type="button" className={household.snap_only ? "active" : ""} onClick={() => setHousehold({ snap_only: true, cash_cents: 0 })}>
            SNAP only
          </button>
        </div>
        <PlanForm
          household={household}
          onSave={(patch) => {
            setHousehold(patch);
            setAdjusting(false);
          }}
        />
        {capApplies && (
          <label className="checkrow">
            <input type="checkbox" checked={household.use_more_snap} onChange={(e) => setHousehold({ use_more_snap: e.target.checked })} />
            <span className="grow">
              Use more of my balance this trip
              <br />
              <span className="subnote">
                {plan
                  ? household.use_more_snap
                    ? `This leaves ${fmtMoney(plan.snap_remaining_after_cents)} for the remaining ${plural(plan.days_remaining_after, "day")}.`
                    : `Held to ${fmtMoney(plan.trip_snap_cap_cents)} this trip so your SNAP lasts until ${fmtDate(household.deposit_date)}.`
                  : ""}
              </span>
            </span>
          </label>
        )}
      </AdjustSheet>
    </div>
  );
}
