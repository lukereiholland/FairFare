import { useEffect, type ReactNode } from "react";
import { Check, Heart, Leaf, Plus, X } from "lucide-react";
import { fmtMoney } from "../format";
import type { Ingredient, Meal, MealFacts } from "../types";
import MealPhoto from "./MealPhoto";

/** "Rice", "Rice and beans", "Rice, beans and eggs". */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Recipe-detail bottom sheet: photo, per-serving facts, SNAP note, Add/Remove + Save, ingredients with SNAP/Card tags. */
export default function MealDetail({
  meal,
  ingredients,
  facts,
  times,
  favorite,
  inTrip,
  pinnedNotFit,
  canPayWithCard,
  onPayWithCard,
  excluded,
  onClose,
  onToggleFavorite,
  onAdd,
  onRemove,
  onNeverShow,
  onShowAgain,
}: {
  meal: Meal | null;
  ingredients: Record<string, Ingredient>;
  facts?: MealFacts;
  times?: number;
  favorite: boolean;
  inTrip: boolean;
  pinnedNotFit: boolean;
  canPayWithCard?: boolean; // the household has cash and has not yet opted in to card overflow
  onPayWithCard?: () => void;
  excluded: boolean;
  onClose: () => void;
  onToggleFavorite: (id: string) => void;
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
  onNeverShow: (id: string) => void;
  onShowAgain: (id: string) => void;
}) {
  const open = meal !== null;
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  if (!meal) return null;

  const meta = facts
    ? `${meal.prep_min} min · ${fmtMoney(facts.serving_cents)} / serving · ${meal.servings} servings`
    : `${meal.prep_min} min · ${meal.servings} servings`;
  const cashNames = facts ? joinNames(facts.cash_ingredients.map((id) => ingredients[id]?.name ?? id)) : "";

  let status: string | null = null;
  if (inTrip) status = times ? `In your plan · cooked ${times}× this trip` : "In your plan";
  else if (pinnedNotFit) status = "Added, but it didn't fit this trip's budget";
  else if (favorite) status = "Saved in your cookbook";

  let primary: ReactNode;
  if (inTrip) {
    primary = (
      <button type="button" className="btn-line on meal-detail__main" aria-label="Remove from trip" onClick={() => onRemove(meal.id)}>
        In your trip
        <Check className="ic" aria-hidden="true" />
      </button>
    );
  } else if (pinnedNotFit) {
    primary = (
      <span className="meal-detail__main" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {canPayWithCard && onPayWithCard && (
          <button type="button" className="btn-primary" onClick={onPayWithCard}>
            Use my card for what SNAP can't cover
          </button>
        )}
        <button
          type="button"
          className="btn-line meal-detail__main--dim"
          aria-label="Remove from trip"
          onClick={() => onRemove(meal.id)}
        >
          {canPayWithCard ? "Didn't fit your SNAP · remove" : "Didn't fit this trip's budget"}
        </button>
      </span>
    );
  } else {
    primary = (
      <button type="button" className="btn-primary meal-detail__main" onClick={() => onAdd(meal.id)}>
        <Plus className="ic" aria-hidden="true" />
        Add to trip
      </button>
    );
  }

  return (
    <div className="sheet sheet--top" role="dialog" aria-modal="true" aria-label={meal.name}>
      <div className="sheet__backdrop" onClick={onClose} />
      <div className="sheet__panel stack meal-detail">
        <div className="sheet__handle" />

        <div className="meal-detail__hero">
          <MealPhoto meal={meal} variant="hero" />
          <button type="button" className="iconbtn meal-detail__close" aria-label="Close" onClick={onClose}>
            <X className="ic" aria-hidden="true" />
          </button>
        </div>

        <div>
          <h2>{meal.name}</h2>
          {meal.description && <p className="meal-detail__desc">{meal.description}</p>}
          <p className="meal-detail__metaline">{meta}</p>
          {status && <p className="meal-detail__status">{status}</p>}
        </div>

        {facts && (
          <>
            <div className="nutri-row" aria-label="Per serving">
              <div className="nstat">
                <b>{Math.round(facts.kcal)}</b>
                <span>calories</span>
              </div>
              <div className="nstat">
                <b>{Math.round(facts.protein_g)}g</b>
                <span>protein</span>
              </div>
              <div className="nstat">
                <b>{Math.round(facts.fiber_g)}g</b>
                <span>fiber</span>
              </div>
              <div className="nstat">
                <b>{Math.round(facts.sodium_mg)}mg</b>
                <span>sodium</span>
              </div>
            </div>
            <p className="subnote meal-detail__pernote">per serving</p>

            <div className="infobox" role="note">
              <Leaf className="ic" aria-hidden="true" />
              <span className="infobox__text">
                {facts.snap_eligible ? (
                  <>
                    <b>All SNAP-eligible</b>
                    <span>Every ingredient here can go on your EBT card.</span>
                  </>
                ) : (
                  <>
                    <b>Needs some cash</b>
                    <span>{cashNames} must be paid with cash or card.</span>
                  </>
                )}
              </span>
            </div>
          </>
        )}

        <div className="meal-detail__actions">
          <div className="meal-detail__btns">
            {primary}
            <button
              type="button"
              className={`btn-line meal-detail__heart${favorite ? " on" : ""}`}
              aria-label={favorite ? "Saved" : "Save to cookbook"}
              aria-pressed={favorite}
              onClick={() => onToggleFavorite(meal.id)}
            >
              <Heart className="ic" aria-hidden="true" fill={favorite ? "currentColor" : "none"} />
            </button>
          </div>
          {excluded ? (
            <div className="meal-detail__hidden">
              <span className="tag mute">Hidden</span>
              <button type="button" className="meal-detail__quiet" onClick={() => onShowAgain(meal.id)}>
                Show again
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="meal-detail__quiet"
              onClick={() => {
                onNeverShow(meal.id);
                onClose();
              }}
            >
              Don't suggest this again
            </button>
          )}
        </div>

        <section>
          <h3 className="section-title section-title--sm meal-detail__title">Ingredients</h3>
          <ul className="meal-ings">
            {Object.keys(meal.ingredients).map((id) => {
              const ing = ingredients[id];
              const sub = ing ? `${ing.kroger_product} · ${ing.aisle} aisle` : null;
              return (
                <li key={id} className="meal-ing">
                  <span className="meal-ing__text">
                    <span className="meal-ing__name">{ing?.name ?? id}</span>
                    {sub && <span className="subnote">{sub}</span>}
                  </span>
                  <span className="meal-ing__tags">
                    {ing?.staple && <span className="tag mute">basic</span>}
                    {ing && (ing.ebt_eligible ? <span className="tag elig">SNAP eligible</span> : <span className="tag unv">Card only</span>)}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        <div>
          <p className="disclaim">Photo is an AI illustration of the dish, not the exact result.</p>
          {facts && (
            <p className="disclaim">
              Cost per serving is pro-rated by weight from Kroger package prices. Packages are bought whole, so the basket total can differ.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
