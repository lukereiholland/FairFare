import { useEffect, useState } from "react";
import { MapPin, Store } from "lucide-react";
import { api } from "../api";
import { fmtMoney } from "../format";
import { useApp } from "../state";
import type { NearbyStore } from "../types";

/** Same household, same rules, one solve per store we hold real prices for. Tap a store to plan with its prices.
 *  With a ZIP, each row also shows the nearest branch (address and distance from OpenStreetMap). */
export default function StoreCompare() {
  const { household, plan, stores, storePlans, comparing, compareStores, setHousehold } = useApp();
  const [zipDraft, setZipDraft] = useState("");
  const [nearby, setNearby] = useState<Record<string, NearbyStore>>({});
  const [nearbyState, setNearbyState] = useState<"idle" | "busy" | "none">("idle");
  const zip = household?.zip_code ?? "";

  useEffect(() => {
    if (!/^\d{5}$/.test(zip)) {
      setNearby({});
      setNearbyState("idle");
      return;
    }
    let alive = true;
    setNearbyState("busy");
    api
      .nearby(zip)
      .then((list) => {
        if (!alive) return;
        setNearby(Object.fromEntries(list.map((n) => [n.store, n])));
        setNearbyState(list.length ? "idle" : "none");
      })
      .catch(() => alive && setNearbyState("none"));
    return () => {
      alive = false;
    };
  }, [zip]);

  if (!household || !plan || stores.length < 2) return null;

  const current = stores.find((s) => s.id === household.store) ?? stores[0];
  const compared = Object.keys(storePlans).length > 0;
  const totals = stores.map((s) => storePlans[s.id]?.basket_cents).filter((c): c is number => typeof c === "number");
  const cheapest = totals.length ? Math.min(...totals) : null;

  return (
    <section className="plancard storecmp" aria-label="Compare stores">
      <div className="row row--between" style={{ alignItems: "flex-start", gap: 12 }}>
        <div className="grow">
          <h3 className="section-title section-title--sm" style={{ marginBottom: 2 }}>
            <Store className="ic" aria-hidden="true" style={{ verticalAlign: "-4px", marginRight: 6 }} />
            Prices from {current.name}
          </h3>
          <p className="subnote">Online listing prices, so your store may differ a little.</p>
        </div>
        {!compared && (
          <button type="button" className="btn-line storecmp__btn" disabled={comparing} onClick={() => void compareStores()}>
            {comparing ? "Comparing…" : "Compare stores"}
          </button>
        )}
      </div>

      {compared && (
        <div className="storecmp__rows">
          {stores.map((s) => {
            const p = storePlans[s.id];
            const active = s.id === household.store;
            const near = nearby[s.id];
            return (
              <button
                key={s.id}
                type="button"
                className={`storecmp__row${active ? " active" : ""}`}
                onClick={() => !active && setHousehold({ store: s.id })}
                aria-pressed={active}
              >
                <span className="storecmp__name">
                  <span className="row" style={{ gap: 6 }}>
                    {s.name}
                    {active && <span className="tag elig">Using</span>}
                    {p && cheapest !== null && p.basket_cents === cheapest && totals.length > 1 && (
                      <span className="tag cost">Cheapest</span>
                    )}
                  </span>
                  <span className="subnote">
                    {s.priced} of {s.total} items priced
                    {p && Object.keys(p.uncovered).length > 0 ? " · some meals uncovered" : ""}
                  </span>
                  {near ? (
                    <span className="subnote storecmp__near">
                      <MapPin className="ic" aria-hidden="true" />
                      {near.distance_miles} mi · {near.address}
                    </span>
                  ) : (
                    /^\d{5}$/.test(zip) &&
                    nearbyState === "idle" && (
                      <span className="subnote storecmp__near">
                        <MapPin className="ic" aria-hidden="true" />
                        No {s.name} within 15 mi of {zip}
                      </span>
                    )
                  )}
                </span>
                <span className="storecmp__total">{p ? <b>{fmtMoney(p.basket_cents)}</b> : <span className="subnote">no plan</span>}</span>
              </button>
            );
          })}

          {/^\d{5}$/.test(zip) ? (
            <p className="subnote" style={{ marginTop: 8 }}>
              {nearbyState === "busy"
                ? "Finding the nearest branches…"
                : nearbyState === "none"
                  ? `No branches found near ${zip}. `
                  : `Nearest branches to ${zip}. `}
              <button type="button" className="link" style={{ fontSize: 12.5, minHeight: 0 }} onClick={() => setHousehold({ zip_code: "" })}>
                Change ZIP
              </button>
            </p>
          ) : (
            <form
              className="row storecmp__zip"
              onSubmit={(e) => {
                e.preventDefault();
                if (/^\d{5}$/.test(zipDraft)) setHousehold({ zip_code: zipDraft });
              }}
            >
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]{5}"
                maxLength={5}
                placeholder="ZIP for the nearest store"
                value={zipDraft}
                onChange={(e) => setZipDraft(e.target.value.replace(/\D/g, ""))}
                aria-label="ZIP code"
              />
              <button type="submit" className="btn-line storecmp__btn" disabled={!/^\d{5}$/.test(zipDraft)}>
                Find
              </button>
            </form>
          )}

          <p className="disclaim" style={{ marginTop: 6 }}>
            Each total is the same household solved with that store's prices. Items a store does not list are left out
            of its plan, never guessed. Distances come from OpenStreetMap.
          </p>
        </div>
      )}
    </section>
  );
}
