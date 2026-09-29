import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { DaySchedule, Meal } from "../types";

const SLOTS: { key: "breakfast" | "lunch" | "dinner"; label: string }[] = [
  { key: "breakfast", label: "Breakfast" },
  { key: "lunch", label: "Lunch" },
  { key: "dinner", label: "Dinner" },
];

/** Day-by-day list for this trip. Collapsed days show the three meal names; tap to see details and "Not for me". */
export default function WeekView({
  schedule,
  meals,
  onNotForMe,
  onOpen,
  loading,
}: {
  schedule: DaySchedule[];
  meals: Record<string, Meal>;
  onNotForMe: (mealId: string) => void;
  onOpen?: (meal: Meal) => void;
  loading?: boolean;
}) {
  const [open, setOpen] = useState<number | null>(null);
  if (schedule.length === 0) return null;

  return (
    <div className={loading ? "loading" : ""}>
      {schedule.map((day) => {
        const isOpen = open === day.day;
        return (
          <section key={day.day} className="daycard" aria-label={`Day ${day.day}`}>
            <button
              type="button"
              className="dayhead"
              aria-expanded={isOpen}
              onClick={() => setOpen(isOpen ? null : day.day)}
            >
              <span>{day.day === 1 ? "Day 1 · today" : `Day ${day.day}`}</span>
              <ChevronDown className={`ic chev${isOpen ? " up" : ""}`} aria-hidden="true" />
            </button>
            <div onClick={isOpen ? undefined : () => setOpen(day.day)}>
              {SLOTS.map(({ key, label }) => {
                const value = day[key];
                const isMeal = value !== null && value !== "school";
                const m = isMeal ? meals[value as string] : undefined;
                const name = value === "school" ? "School meal" : value === null ? "Not covered yet" : m?.name ?? value;
                const detail = m ? `${m.prep_min} min${m.description ? ` · ${m.description}` : ""}` : "";
                return (
                  <div key={key} className={`dayrow${isOpen ? " open" : ""}`}>
                    <span className="slotlabel">{label}</span>
                    <span className="name">
                      {isOpen && m && onOpen ? (
                        <button type="button" className="dayrow__open" onClick={() => onOpen(m)} aria-label={`See ${m.name}`}>
                          <span className="mealname">{name}</span>
                          {detail && <span className="subnote">{detail}</span>}
                        </button>
                      ) : (
                        <>
                          <span className={`mealname${isMeal ? "" : " subnote"}`}>{name}</span>
                          {isOpen && detail && <span className="subnote">{detail}</span>}
                        </>
                      )}
                    </span>
                    {isOpen && isMeal && (
                      <button
                        type="button"
                        className="rm"
                        aria-label={`Not for me: ${m?.name ?? value}`}
                        title="Not for me"
                        onClick={() => onNotForMe(value as string)}
                      >
                        ×
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
