// F2: five-question quiz, skip-with-defaults. Every answer maps straight onto a Household field;
// "See my plan" builds the full Household and hands it to startHousehold (which solves and navigates).
import { useMemo, useState } from "react";
import { DollarSign, Flame, Leaf, Users, Wallet } from "lucide-react";
import { useApp } from "../state";
import { DEFAULT_HOUSEHOLD, type Diet, type Equipment, type Household } from "../types";
import QuizOption from "../components/QuizOption";
import QuizStepper from "../components/QuizStepper";

const TOTAL_STEPS = 5;
const PEOPLE_OPTIONS = [1, 2, 3, 4, 5, 6] as const;
const PREP_OPTIONS = [15, 30, 45, 60] as const;

const DIET_OPTIONS: { id: Diet; label: string }[] = [
  { id: "vegetarian", label: "Vegetarian" },
  { id: "vegan", label: "Vegan" },
  { id: "halal", label: "Halal" },
  { id: "kosher", label: "Kosher" },
];

const EQUIPMENT_OPTIONS: { id: Equipment; label: string }[] = [
  { id: "stovetop", label: "Stovetop" },
  { id: "microwave", label: "Microwave" },
  { id: "oven", label: "Oven" },
];

// Common-exclusion chips: each maps to every ingredient id whose tags match, computed at submit time
// from whatever /ingredients has loaded so the list never goes stale in this component.
const CHIP_DEFS: { key: string; label: string; match: (tags: string[]) => boolean }[] = [
  { key: "pork", label: "No pork", match: (t) => t.includes("pork") },
  { key: "beef", label: "No beef", match: (t) => t.includes("meat") && !t.includes("poultry") },
  { key: "poultry", label: "No poultry", match: (t) => t.includes("poultry") },
  { key: "fish", label: "No fish", match: (t) => t.includes("fish") || t.includes("shellfish") },
  { key: "dairy", label: "No dairy", match: (t) => t.includes("dairy") },
  { key: "egg", label: "No eggs", match: (t) => t.includes("egg") },
];

interface Answers {
  people: number | null;
  kidsBreakfast: number;
  kidsLunch: number;
  depositDate: string | null;
  ebtDollars: string;
  tripDays: number;
  cashDollars: string;
  snapOnly: boolean;
  diet: Diet[];
  chips: string[]; // selected CHIP_DEFS keys
  baselineExcluded: string[]; // excluded_ingredients carried over from an existing household, not chip-derived
  equipment: Equipment[];
  maxPrepMin: number | null;
}

function makeInitialAnswers(h: Household | null): Answers {
  if (!h) {
    return {
      people: null,
      kidsBreakfast: 0,
      kidsLunch: 0,
      depositDate: null,
      ebtDollars: "",
      tripDays: DEFAULT_HOUSEHOLD.trip_days,
      cashDollars: "",
      snapOnly: false,
      diet: [],
      chips: [],
      baselineExcluded: [],
      equipment: [],
      maxPrepMin: null,
    };
  }
  return {
    people: h.people,
    kidsBreakfast: Math.round(h.school_breakfasts / 5),
    kidsLunch: Math.round(h.school_lunches / 5),
    depositDate: h.deposit_date,
    ebtDollars: h.ebt_cents > 0 ? String(h.ebt_cents / 100) : "",
    tripDays: h.trip_days,
    cashDollars: !h.snap_only && h.cash_cents > 0 ? String(h.cash_cents / 100) : "",
    snapOnly: h.snap_only,
    diet: h.diet,
    chips: [],
    baselineExcluded: h.excluded_ingredients,
    equipment: h.equipment,
    maxPrepMin: h.max_prep_min,
  };
}

/** Dollar string typed by a user -> integer cents. The only arithmetic this screen does. */
function toCents(dollars: string): number {
  const n = Number(dollars);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
}

export default function Quiz() {
  const { household, ingredients, startHousehold } = useApp();
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState<Answers>(() => makeInitialAnswers(household));

  const peopleCap = answers.people ?? 6;

  const canContinue = useMemo(() => {
    switch (step) {
      case 0:
        return answers.people !== null;
      case 1:
        return Number(answers.ebtDollars) > 0;
      case 2:
        return answers.snapOnly || answers.cashDollars.trim() !== "";
      case 3:
        return true;
      case 4:
        return answers.equipment.length > 0 && answers.maxPrepMin !== null;
      default:
        return false;
    }
  }, [step, answers]);

  function useTypical() {
    startHousehold(DEFAULT_HOUSEHOLD);
  }

  function finish() {
    if (answers.people === null || answers.maxPrepMin === null || answers.equipment.length === 0) return;
    const excluded = new Set(answers.baselineExcluded);
    for (const key of answers.chips) {
      const def = CHIP_DEFS.find((c) => c.key === key);
      if (!def) continue;
      for (const ing of Object.values(ingredients)) {
        if (def.match(ing.tags)) excluded.add(ing.id);
      }
    }
    const h: Household = {
      ...DEFAULT_HOUSEHOLD,
      people: answers.people,
      trip_days: answers.tripDays,
      deposit_date: answers.depositDate,
      school_breakfasts: answers.kidsBreakfast * 5,
      school_lunches: answers.kidsLunch * 5,
      ebt_cents: toCents(answers.ebtDollars),
      cash_cents: answers.snapOnly ? 0 : toCents(answers.cashDollars),
      snap_only: answers.snapOnly,
      max_prep_min: answers.maxPrepMin,
      equipment: answers.equipment,
      diet: answers.diet,
      excluded_ingredients: Array.from(excluded),
      excluded_meals: [],
      accepted_meals: null,
      out_of_stock: [],
      pantry: {},
      assume_staples: true,
    };
    startHousehold(h);
  }

  function onContinue() {
    if (!canContinue) return;
    if (step === TOTAL_STEPS - 1) finish();
    else setStep((s) => s + 1);
  }

  return (
    <div className="screen">
      <div className="quiz-top">
        <button
          type="button"
          className="quiz-back"
          style={{ visibility: step === 0 ? "hidden" : "visible" }}
          onClick={() => setStep((s) => s - 1)}
          aria-label="Back"
        >
          &#8249;
        </button>
        <div className="quiz-track" role="progressbar" aria-valuenow={step + 1} aria-valuemin={1} aria-valuemax={TOTAL_STEPS}>
          <div className="quiz-fill" style={{ width: `${((step + 1) / TOTAL_STEPS) * 100}%` }} />
        </div>
      </div>

      {step === 0 && (
        <div className="quiz-q">
          <Users className="quiz-icon" aria-hidden="true" />
          <h1>Who eats here?</h1>
          <p className="quiz-sub">Count everyone eating from this trip's groceries.</p>
          <div className="quiz-opts">
            {PEOPLE_OPTIONS.map((n) => (
              <QuizOption
                key={n}
                selected={answers.people === n}
                onClick={() =>
                  setAnswers((a) => ({
                    ...a,
                    people: n,
                    kidsBreakfast: Math.min(a.kidsBreakfast, n),
                    kidsLunch: Math.min(a.kidsLunch, n),
                  }))
                }
              >
                {n === 6 ? "6 or more people" : `${n} ${n === 1 ? "person" : "people"}`}
              </QuizOption>
            ))}
          </div>
          <div className="stack stack--tight quiz-follow">
            <p className="small strong">Kids getting school meals</p>
            <QuizStepper
              label="School breakfast"
              value={answers.kidsBreakfast}
              max={peopleCap}
              onChange={(v) => setAnswers((a) => ({ ...a, kidsBreakfast: v }))}
            />
            <QuizStepper
              label="School lunch"
              value={answers.kidsLunch}
              max={peopleCap}
              onChange={(v) => setAnswers((a) => ({ ...a, kidsLunch: v }))}
            />
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="quiz-q">
          <DollarSign className="quiz-icon" aria-hidden="true" />
          <h1>When does your SNAP load, and how much do you have for this trip?</h1>
          <p className="quiz-sub">This covers one shopping trip, not a full month.</p>
          <div className="planform">
            <div>
              <label>Next deposit date (optional)</label>
              <input
                type="date"
                value={answers.depositDate ?? ""}
                onChange={(e) => setAnswers((a) => ({ ...a, depositDate: e.target.value || null }))}
              />
            </div>
          </div>
          <div className="planform">
            <div>
              <label>SNAP available for this trip</label>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                placeholder="150"
                value={answers.ebtDollars}
                onChange={(e) => setAnswers((a) => ({ ...a, ebtDollars: e.target.value }))}
              />
            </div>
          </div>
          <p className="disclaim">Entered manually — not connected to your EBT account.</p>
          <div className="stack stack--tight quiz-follow">
            <p className="small strong">Shopping for the next {answers.tripDays} days</p>
            <input
              type="range"
              className="range"
              min={1}
              max={14}
              value={answers.tripDays}
              onChange={(e) => setAnswers((a) => ({ ...a, tripDays: Number(e.target.value) }))}
            />
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="quiz-q">
          <Wallet className="quiz-icon" aria-hidden="true" />
          <h1>Any cash for groceries this trip?</h1>
          <p className="quiz-sub">Card or cash you can add on top of SNAP.</p>
          <div className="quiz-opts">
            <QuizOption
              selected={!answers.snapOnly}
              onClick={() => setAnswers((a) => (a.snapOnly ? { ...a, snapOnly: false } : a))}
            >
              I have some cash
            </QuizOption>
            <QuizOption
              selected={answers.snapOnly}
              onClick={() => setAnswers((a) => ({ ...a, snapOnly: true, cashDollars: "" }))}
            >
              SNAP only
            </QuizOption>
          </div>
          {!answers.snapOnly && (
            <div className="planform">
              <div>
                <label>Cash or card for this trip</label>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  placeholder="20"
                  value={answers.cashDollars}
                  onChange={(e) => setAnswers((a) => ({ ...a, cashDollars: e.target.value }))}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {step === 3 && (
        <div className="quiz-q">
          <Leaf className="quiz-icon" aria-hidden="true" />
          <h1>Anything you don't eat?</h1>
          <p className="quiz-sub">We'll keep meals and the cart within these limits.</p>
          <p className="small strong">Simplified rules</p>
          <div className="quiz-opts">
            {DIET_OPTIONS.map((d) => (
              <QuizOption
                key={d.id}
                selected={answers.diet.includes(d.id)}
                onClick={() =>
                  setAnswers((a) => ({
                    ...a,
                    diet: a.diet.includes(d.id) ? a.diet.filter((x) => x !== d.id) : [...a.diet, d.id],
                  }))
                }
              >
                {d.label}
              </QuizOption>
            ))}
          </div>
          <p className="tiny muted">
            Kosher here means no pork, shellfish or gelatin; meat/dairy separation isn't modeled.
          </p>
          <p className="small strong">Common exclusions</p>
          <div className="plist">
            {CHIP_DEFS.map((c) => (
              <button
                key={c.key}
                type="button"
                className={`chip${answers.chips.includes(c.key) ? " new" : ""}`}
                aria-pressed={answers.chips.includes(c.key)}
                onClick={() =>
                  setAnswers((a) => ({
                    ...a,
                    chips: a.chips.includes(c.key) ? a.chips.filter((x) => x !== c.key) : [...a.chips, c.key],
                  }))
                }
              >
                {c.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="quiz-q">
          <Flame className="quiz-icon" aria-hidden="true" />
          <h1>What can you cook with?</h1>
          <p className="quiz-sub">Pick everything you have — the plan won't call for anything else.</p>
          <div className="quiz-opts">
            {EQUIPMENT_OPTIONS.map(({ id, label }) => (
              <QuizOption
                key={id}
                selected={answers.equipment.includes(id)}
                onClick={() =>
                  setAnswers((a) => ({
                    ...a,
                    equipment: a.equipment.includes(id) ? a.equipment.filter((x) => x !== id) : [...a.equipment, id],
                  }))
                }
              >
                {label}
              </QuizOption>
            ))}
          </div>
          <p className="small strong">Most minutes you want to spend cooking</p>
          <div className="quiz-opts">
            {PREP_OPTIONS.map((m) => (
              <QuizOption key={m} selected={answers.maxPrepMin === m} onClick={() => setAnswers((a) => ({ ...a, maxPrepMin: m }))}>
                {m} minutes or less
              </QuizOption>
            ))}
          </div>
        </div>
      )}

      <div className="quiz-cta">
        <button type="button" className="btn-primary" disabled={!canContinue} onClick={onContinue}>
          {step === TOTAL_STEPS - 1 ? "See my plan" : "Continue"}
        </button>
        {step === 0 && (
          <button type="button" className="btn-line" onClick={useTypical}>
            Use typical settings
          </button>
        )}
      </div>
    </div>
  );
}
