// Detected and hand-added pantry items inside the "On hand" row on Pantry: one chip per item showing
// name + level. Tapping cycles full -> half -> low -> removed, so the chip itself is the review step
// (non-negotiable 9: the user confirms every detected item before it reaches household.pantry).
// Also renders the "+ Add item" chip and its search sheet (the manual path, source="manual").
// Renders chips only; the parent (Pantry.tsx) owns the surrounding .plist row and the Update button.
import { useState } from "react";
import { Plus } from "lucide-react";
import { useApp } from "../state";
import type { PantryLevel } from "../types";

const LEVELS: PantryLevel[] = ["full", "half", "low"];

export default function PantryChecklist() {
  const { ingredients, pantryItems, setPantryItems } = useApp();
  const [addOpen, setAddOpen] = useState(false);
  const [query, setQuery] = useState("");

  const items = pantryItems.filter((p) => p.source !== "staple");

  /** full -> half -> low -> gone. */
  function tapItem(id: string) {
    const item = pantryItems.find((p) => p.ingredient_id === id);
    if (!item) return;
    const next = LEVELS[LEVELS.indexOf(item.level) + 1];
    if (next === undefined) {
      setPantryItems(pantryItems.filter((p) => p.ingredient_id !== id));
    } else {
      setPantryItems(pantryItems.map((p) => (p.ingredient_id === id ? { ...p, level: next } : p)));
    }
  }

  function addItem(id: string) {
    const rest = pantryItems.filter((p) => p.ingredient_id !== id);
    setPantryItems([...rest, { ingredient_id: id, level: "full", source: "manual" }]);
    setAddOpen(false);
    setQuery("");
  }

  function closeSheet() {
    setAddOpen(false);
    setQuery("");
  }

  const alreadyListed = new Set(pantryItems.map((p) => p.ingredient_id));
  const results = Object.values(ingredients)
    .filter((i) => !alreadyListed.has(i.id))
    .filter((i) => i.name.toLowerCase().includes(query.trim().toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 40);

  return (
    <>
      {items.map((item) => {
        const name = ingredients[item.ingredient_id]?.name ?? item.ingredient_id;
        const last = item.level === LEVELS[LEVELS.length - 1];
        return (
          <button
            key={item.ingredient_id}
            type="button"
            className="chip new chip--have"
            aria-label={`${name}, ${item.level}. ${last ? "Tap to remove." : "Tap to change the amount."}`}
            onClick={() => tapItem(item.ingredient_id)}
          >
            {name}
            <span className="chip-lvl">{item.level}</span>
          </button>
        );
      })}

      <button type="button" className="chip chip--add" onClick={() => setAddOpen(true)}>
        <Plus className="ic" aria-hidden="true" />
        Add item
      </button>

      {addOpen && (
        <div className="sheet" role="dialog" aria-modal="true" aria-label="Add an item">
          <div className="sheet__backdrop" onClick={closeSheet} />
          <div className="sheet__panel stack">
            <div className="sheet__handle" />
            <h2>Add an item</h2>
            <input
              type="text"
              placeholder="Search ingredients"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
            <div className="stack stack--tight">
              {results.length === 0 && <p className="muted small">No matches.</p>}
              {results.map((ing) => (
                <button
                  key={ing.id}
                  type="button"
                  className="btn-line"
                  style={{ justifyContent: "flex-start" }}
                  onClick={() => addItem(ing.id)}
                >
                  {ing.name}
                </button>
              ))}
            </div>
            <button type="button" className="link center" onClick={closeSheet}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </>
  );
}
