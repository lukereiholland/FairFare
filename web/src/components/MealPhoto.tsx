import { useState } from "react";
import { Egg, Sandwich, Soup } from "lucide-react";
import type { Meal, Slot } from "../types";

const ICON: Record<Slot, typeof Egg> = { breakfast: Egg, lunch: Sandwich, dinner: Soup };

/** Photo at /meals/<id>.jpg over a slot-tinted tile; the tile and its icon stay when the file is missing. */
export default function MealPhoto({
  meal,
  variant = "card",
  className,
}: {
  meal: Meal;
  variant?: "thumb" | "card" | "hero";
  className?: string;
}) {
  const [failedId, setFailedId] = useState<string | null>(null);
  const failed = failedId === meal.id;
  const Icon = ICON[meal.slot] ?? Soup;
  const cls = `meal-photo meal-photo--${variant} meal-photo--${meal.slot}${className ? ` ${className}` : ""}`;

  return (
    <div className={cls} aria-hidden="true">
      <span className="meal-photo__fallback">
        <Icon className="ic" />
      </span>
      {!failed && (
        <img
          key={meal.id}
          className="meal-photo__img"
          src={`/meals/${meal.id}.jpg`}
          alt=""
          loading="lazy"
          onError={() => setFailedId(meal.id)}
        />
      )}
    </div>
  );
}
