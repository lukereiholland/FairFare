import { AlertCircle, Check, Heart, Plus } from "lucide-react";
import { fmtMoney } from "../format";
import type { Meal } from "../types";
import MealPhoto from "./MealPhoto";

/** Photo-left row card. The body opens the meal; the right column holds the heart (save to cookbook) and Add / Added. */
export default function MealCard({
  meal,
  servingCents,
  times,
  tag,
  favorite,
  inTrip,
  onOpen,
  onToggleFavorite,
  onAdd,
  onRemove,
  pinnedNotFit,
  loading,
}: {
  meal: Meal;
  servingCents?: number;
  times?: number;
  tag?: string;
  favorite?: boolean;
  inTrip?: boolean;
  pinnedNotFit?: boolean;
  onOpen: () => void;
  onToggleFavorite?: () => void;
  onAdd?: () => void;
  onRemove?: () => void;
  loading?: boolean;
}) {
  const showNoFit = !!pinnedNotFit && !inTrip && !!onRemove;
  const showAdd = !!onAdd && !inTrip && !showNoFit;
  const showAdded = !!inTrip && !!onRemove;
  const hasActions = !!onToggleFavorite || showAdd || showAdded || showNoFit;
  const cls = `meal-card${hasActions ? "" : " meal-card--plain"}${loading ? " loading" : ""}`;

  return (
    <div className={cls}>
      <button type="button" className="meal-card__body" onClick={onOpen}>
        <MealPhoto meal={meal} variant="card" />
        <span className="meal-card__text">
          <span className="meal-card__name">{meal.name}</span>
          {meal.description && <span className="subnote meal-card__desc">{meal.description}</span>}
          <span className="meal-card__tags">
            {typeof servingCents === "number" && <span className="tag cost">{fmtMoney(servingCents)}/serving</span>}
            {tag && <span className="tag fact">{tag}</span>}
            {times !== undefined && times > 0 && <span className="tag nutri">{times}× this trip</span>}
          </span>
        </span>
      </button>

      {hasActions && (
        <div className="meal-card__actions">
          {onToggleFavorite && (
            <button
              type="button"
              className={`meal-card__heart${favorite ? " on" : ""}`}
              aria-label={favorite ? "Saved, tap to remove" : "Save to cookbook"}
              aria-pressed={!!favorite}
              onClick={(e) => {
                e.stopPropagation();
                onToggleFavorite();
              }}
            >
              <Heart className="ic" fill={favorite ? "currentColor" : "none"} aria-hidden="true" />
            </button>
          )}

          {showAdd && (
            <button
              type="button"
              className="meal-card__pillbtn"
              aria-label="Add to this trip"
              onClick={(e) => {
                e.stopPropagation();
                onAdd?.();
              }}
            >
              <span className="meal-card__pill">
                <Plus className="ic" aria-hidden="true" />
                Add
              </span>
            </button>
          )}

          {showNoFit && (
            <button
              type="button"
              className="meal-card__pillbtn"
              aria-label="Added, but it did not fit this trip's budget. Tap to remove."
              onClick={(e) => {
                e.stopPropagation();
                onRemove?.();
              }}
            >
              <span className="meal-card__pill meal-card__pill--nofit">
                <AlertCircle className="ic" aria-hidden="true" />
                Didn't fit
              </span>
            </button>
          )}

          {showAdded && (
            <button
              type="button"
              className="meal-card__pillbtn"
              aria-label="In your trip, tap to remove"
              onClick={(e) => {
                e.stopPropagation();
                onRemove?.();
              }}
            >
              <span className="meal-card__pill meal-card__pill--in">
                <Check className="ic" aria-hidden="true" />
                Added
              </span>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
