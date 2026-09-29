import { BookHeart, CalendarDays, Refrigerator, UtensilsCrossed } from "lucide-react";
import { useApp, type Path } from "../state";

const TABS: { path: Path; label: string; Icon: typeof CalendarDays }[] = [
  { path: "/plan", label: "Plan", Icon: CalendarDays },
  { path: "/recipes", label: "Recipes", Icon: UtensilsCrossed },
  { path: "/cookbook", label: "Cookbook", Icon: BookHeart },
  { path: "/pantry", label: "Pantry", Icon: Refrigerator },
];

/** Bottom navigation. List, Register and Profile are reached from the plan, not from here. */
export default function TabBar() {
  const { path, navigate } = useApp();
  const active = (p: Path) => path === p || (p === "/plan" && (path === "/list" || path === "/register" || path === "/profile"));
  return (
    <nav className="navbar" aria-label="Main">
      {TABS.map(({ path: p, label, Icon }) => (
        <button
          key={p}
          type="button"
          className={`navbtn${active(p) ? " active" : ""}`}
          onClick={() => navigate(p)}
          aria-current={active(p) ? "page" : undefined}
        >
          <Icon className="ic" aria-hidden="true" />
          {label}
        </button>
      ))}
    </nav>
  );
}
