import type { DaySchedule, Meal } from "../types";

const SLOTS: { key: "breakfast" | "lunch" | "dinner"; label: string }[] = [
  { key: "breakfast", label: "Breakfast" },
  { key: "lunch", label: "Lunch" },
  { key: "dinner", label: "Dinner" },
];

/** Day by day as a horizontal strip: one compact column per day, today first. Tap a meal to open it. */
export default function DayStrip({
  schedule,
  meals,
  loading,
  onOpen,
}: {
  schedule: DaySchedule[];
  meals: Record<string, Meal>;
  loading?: boolean;
  onOpen?: (meal: Meal) => void;
}) {
  if (schedule.length === 0) {
    return (
      <div className="daystrip" aria-label="Day by day, loading">
        {[0, 1, 2].map((i) => (
          <div key={i} className="daycol">
            <div className="skeleton" style={{ width: "50%", marginBottom: 8 }} />
            <div className="skeleton" style={{ width: "90%", marginBottom: 6 }} />
            <div className="skeleton" style={{ width: "80%", marginBottom: 6 }} />
            <div className="skeleton" style={{ width: "85%" }} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={`daystrip${loading ? " loading" : ""}`} aria-label="Day by day">
      {schedule.map((day) => (
        <div key={day.day} className={`daycol${day.day === 1 ? " daycol--today" : ""}`}>
          <div className="daycol__head">{day.day === 1 ? "Today" : `Day ${day.day}`}</div>
          {SLOTS.map(({ key, label }) => {
            const value = day[key];
            const meal = value && value !== "school" ? meals[value] : undefined;
            if (meal) {
              return (
                <button key={key} type="button" className="daycol__slot" onClick={() => onOpen?.(meal)}>
                  <span className="daycol__label">{label}</span>
                  <span className="daycol__name">{meal.name}</span>
                </button>
              );
            }
            return (
              <div key={key} className="daycol__slot daycol__slot--empty">
                <span className="daycol__label">{label}</span>
                <span className="daycol__name subnote">{value === "school" ? "School meal" : "Not covered yet"}</span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
