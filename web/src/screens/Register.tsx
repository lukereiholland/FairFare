import { useEffect, type CSSProperties } from "react";
import { ChevronLeft } from "lucide-react";
import { useApp } from "../state";
import { fmtMoney } from "../format";

const FULLSCREEN_STYLE: CSSProperties = {
  position: "fixed",
  inset: 0,
  overflow: "auto",
  background: "var(--green-deep)",
  color: "#fff",
  paddingTop: "calc(16px + env(safe-area-inset-top, 0px))",
  paddingBottom: "calc(24px + env(safe-area-inset-bottom, 0px))",
  paddingLeft: "calc(16px + env(safe-area-inset-left, 0px))",
  paddingRight: "calc(16px + env(safe-area-inset-right, 0px))",
};

const BACK_BTN_STYLE: CSSProperties = {
  background: "transparent",
  borderColor: "rgba(255,255,255,0.5)",
  color: "#fff",
  marginTop: 12,
};

export default function Register() {
  const { plan, ingredients, navigate } = useApp();

  // Keep the screen awake while showing the cashier; fail silently where unsupported.
  useEffect(() => {
    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;
    (async () => {
      try {
        const s = await navigator.wakeLock?.request("screen");
        if (cancelled) {
          void s?.release();
        } else {
          sentinel = s ?? null;
        }
      } catch {
        /* wake lock unavailable; ignore */
      }
    })();
    return () => {
      cancelled = true;
      void sentinel?.release();
    };
  }, []);

  if (!plan) {
    return (
      <div className="stack" style={FULLSCREEN_STYLE}>
        <button type="button" className="quiz-back" style={{ color: "#fff" }} onClick={() => navigate("/list")}>
          <ChevronLeft className="ic" aria-hidden="true" />
        </button>
        <p className="muted" style={{ color: "rgba(255,255,255,0.85)" }}>
          No plan yet.
        </p>
        <button type="button" className="link" style={{ color: "#fff" }} onClick={() => navigate("/plan")}>
          Go to Plan
        </button>
      </div>
    );
  }

  const printOrShare = async () => {
    const lines = plan.cart.map((item) => {
      const product = ingredients[item.ingredient_id]?.kroger_product ?? item.ingredient_id;
      return `${item.packages}× ${product} — ${fmtMoney(item.line_cents)}`;
    });
    const summary = [
      `Swipe EBT first ${fmtMoney(plan.ebt_cents)}.`,
      plan.cash_cents > 0 ? `Then card ${fmtMoney(plan.cash_cents)}.` : "That's everything.",
      ...lines,
    ].join("\n");
    if (navigator.share) {
      try {
        await navigator.share({ text: summary });
      } catch {
        /* share cancelled or unavailable; ignore */
      }
    } else {
      window.print();
    }
  };

  return (
    <div style={FULLSCREEN_STYLE}>
      <div className="stack">
        <button
          type="button"
          className="quiz-back"
          style={{ color: "#fff" }}
          onClick={() => navigate("/list")}
          aria-label="Back to list"
        >
          <ChevronLeft className="ic" aria-hidden="true" />
        </button>

        <div className="stack" style={{ marginTop: 24 }}>
          <p style={{ fontSize: 15, opacity: 0.85 }}>
            Swipe <span className="money-pill money-snap">EBT</span> first
          </p>
          <p style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 60, lineHeight: 1.05, color: "#fff", margin: 0 }}>
            {fmtMoney(plan.ebt_cents)}
          </p>
        </div>

        {plan.cash_cents > 0 ? (
          <div className="stack" style={{ marginTop: 32 }}>
            <p style={{ fontSize: 15, opacity: 0.85 }}>
              Then <span className="money-pill money-cash">card</span>
            </p>
            <p style={{ fontFamily: "var(--font-display)", fontWeight: 600, fontSize: 60, lineHeight: 1.05, color: "#fff", margin: 0 }}>
              {fmtMoney(plan.cash_cents)}
            </p>
          </div>
        ) : (
          <p className="strong" style={{ marginTop: 16, fontSize: 18 }}>
            That's everything.
          </p>
        )}

        {plan.cart.length > 0 && (
          <ul className="stack stack--tight" style={{ marginTop: 28, fontSize: 13, opacity: 0.9 }}>
            {plan.cart.map((item) => {
              const product = ingredients[item.ingredient_id]?.kroger_product ?? item.ingredient_id;
              return (
                <li key={item.ingredient_id}>
                  {item.packages}× {product} —{" "}
                  <span className={item.ebt_eligible ? "money-pill money-snap" : "money-pill money-cash"}>{fmtMoney(item.line_cents)}</span>
                </li>
              );
            })}
          </ul>
        )}

        <p className="small" style={{ marginTop: 40, color: "rgba(255,255,255,0.85)" }}>
          Entered manually — not connected to your EBT account.
        </p>

        <button type="button" className="btn-line" style={BACK_BTN_STYLE} onClick={printOrShare}>
          Print or share
        </button>
        <button type="button" className="btn-line" style={BACK_BTN_STYLE} onClick={() => navigate("/list")}>
          Back to list.
        </button>
      </div>
    </div>
  );
}
