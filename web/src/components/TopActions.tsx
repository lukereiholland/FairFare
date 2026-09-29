import { ShoppingBasket, UserRound } from "lucide-react";
import { useApp } from "../state";

/** The two shortcuts every main screen carries top-right: Shopping list (dark basket), then Profile (gold person). */
export default function TopActions() {
  const { plan, navigate } = useApp();
  return (
    <div className="topactions">
      <button
        type="button"
        className="iconbtn iconbtn--dark"
        aria-label="Shopping list"
        title={plan ? "Shopping list" : "Your plan is still loading"}
        disabled={!plan}
        onClick={() => navigate("/list")}
      >
        <ShoppingBasket className="ic" aria-hidden="true" />
      </button>
      <button type="button" className="iconbtn iconbtn--gold" aria-label="Profile" title="Profile" onClick={() => navigate("/profile")}>
        <UserRound className="ic" aria-hidden="true" />
      </button>
    </div>
  );
}
