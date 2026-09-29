// Staple chips inside the "On hand" row on Pantry: one chip per Ingredient.staple, all on hand by
// default. Tapping one marks it "out": assume_staples turns off for the whole household and the
// still-selected staples are listed explicitly as PantryItems so the solver keeps crediting them.
// Renders chips only; the parent (Pantry.tsx) owns the surrounding .plist row.
import { useApp } from "../state";
import type { PantryItem } from "../types";

export default function StapleChips() {
  const { household, ingredients, pantryItems, setHousehold, setPantryItems } = useApp();
  if (!household) return null;

  const staples = Object.values(ingredients)
    .filter((i) => i.staple)
    .sort((a, b) => a.name.localeCompare(b.name));
  if (staples.length === 0) return null;

  const staplePantryIds = new Set(
    pantryItems.filter((p) => p.source === "staple").map((p) => p.ingredient_id),
  );
  const isOnHand = (id: string) => (household.assume_staples ? true : staplePantryIds.has(id));

  function toggle(id: string) {
    const currentlySelected = staples.filter((s) => isOnHand(s.id)).map((s) => s.id);
    const nowSelected = currentlySelected.includes(id)
      ? currentlySelected.filter((x) => x !== id)
      : [...currentlySelected, id];
    const nonStapleItems = pantryItems.filter((p) => p.source !== "staple");

    if (nowSelected.length === staples.length) {
      setHousehold({ assume_staples: true });
      setPantryItems(nonStapleItems);
    } else {
      const stapleItems: PantryItem[] = nowSelected.map((sid) => ({
        ingredient_id: sid,
        level: "full",
        source: "staple",
      }));
      setHousehold({ assume_staples: false });
      setPantryItems([...nonStapleItems, ...stapleItems]);
    }
  }

  return (
    <>
      {staples.map((s) => {
        const on = isOnHand(s.id);
        return (
          <button
            key={s.id}
            type="button"
            className={`chip chip--staple${on ? "" : " off"}`}
            aria-pressed={on}
            title={on ? "On hand. Tap if you're out." : "Marked out. Tap if you have it."}
            onClick={() => toggle(s.id)}
          >
            {s.name}
          </button>
        );
      })}
    </>
  );
}
