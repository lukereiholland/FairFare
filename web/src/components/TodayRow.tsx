import type { ReactNode } from "react";
import type { DaySchedule, Meal } from "../types";
import MealPhoto from "./MealPhoto";

const SLOTS: { key: "breakfast" | "lunch" | "dinner"; label: string }[] = [
  { key: "breakfast", label: "Breakfast" },
  { key: "lunch", label: "Lunch" },
  { key: "dinner", label: "Dinner" },
];

/** Day-1 snapshot: three small photo cards, breakfast/lunch/dinner, shown above the full day list. */
export default function TodayRow({
  day,
  meals,
  loading,
  onOpen,
}: {
  day: DaySchedule | undefined;
  meals: Record<string, Meal>;
  loading?: boolean;
  onOpen?: (meal: Meal) => void;
}) {
  const cardClass = `card-div today-card${loading ? " loading" : ""}`;

  return (
    <div>
      <h3 className="section-title section-title--sm">Today's meals</h3>
      <div className="today-row">
        {SLOTS.map(({ key, label }) => {
          if (!day) {
            return (
              <div key={key} className="card-div today-card">
                <span className="subnote">{label}</span>
                <div className="skeleton" style={{ width: "80%" }} />
                <div className="skeleton" style={{ width: "50%" }} />
              </div>
            );
          }

          const value = day[key];
          const m = value !== null && value !== "school" ? meals[value] : undefined;

          if (m) {
            return (
              <button
                key={key}
                type="button"
                className={cardClass}
                onClick={onOpen ? () => onOpen(m) : undefined}
                aria-label={`${label}: ${m.name}`}
              >
                <MealPhoto meal={m} variant="thumb" />
                <span className="subnote">{label}</span>
                <span className="today-card__name">{m.name}</span>
                <span className="subnote">{m.prep_min} min</span>
              </button>
            );
          }

          let body: ReactNode;
          if (value === "school") body = <span className="subnote">School meal</span>;
          else if (value === null) body = <span className="subnote">Not covered yet</span>;
          else body = <span className="today-card__name">{value}</span>;

          return (
            <div key={key} className={cardClass}>
              <span className="subnote">{label}</span>
              {body}
            </div>
          );
        })}
      </div>
    </div>
  );
}
