// The one React context. Any change to `household` re-solves after a 300 ms debounce; List and
// Register only read `plan` from here and never refetch.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { api, ApiError } from "./api";
import {
  DEFAULT_HOUSEHOLD,
  type Household,
  type Ingredient,
  type Meal,
  type MealFacts,
  type PantryItem,
  type Plan,
  type StoreInfo,
} from "./types";

export type Path = "/quiz" | "/plan" | "/recipes" | "/cookbook" | "/pantry" | "/list" | "/register" | "/profile";
const PATHS: Path[] = ["/quiz", "/plan", "/recipes", "/cookbook", "/pantry", "/list", "/register", "/profile"];

// v2 keys: the stored household gained fields and new defaults; older entries are ignored on purpose.
const LS = { household: "stretch.v2.household", pantry: "stretch.v2.pantryItems", session: "stretch.sessionId" };

function readLS<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeLS(key: string, value: unknown) {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}
function newSessionId(): string {
  return typeof crypto?.randomUUID === "function"
    ? crypto.randomUUID()
    : `s-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
function currentPath(): Path {
  const p = window.location.pathname as Path;
  return PATHS.includes(p) ? p : "/plan";
}

export interface AppState {
  household: Household | null; // null until the quiz finishes
  plan: Plan | null;
  prevPlan: Plan | null;
  pantryItems: PantryItem[];
  sessionId: string;
  ingredients: Record<string, Ingredient>; // id -> Ingredient, loaded once from /ingredients
  meals: Record<string, Meal>; // id -> Meal, the candidate pool from /meals
  facts: Record<string, MealFacts>; // id -> per-serving cost, nutrition and tags from /meal_facts
  stores: StoreInfo[]; // stores we hold real prices for, from /stores
  storePlans: Record<string, Plan | null>; // store id -> the same household solved with that store's prices
  comparing: boolean;
  solving: boolean;
  solveError: string | null; // plain-language 422 detail; shown in the ChangedLine slot
  apiOk: boolean | null; // null = not checked yet
  path: Path;
}

export interface AppActions {
  navigate(path: Path): void;
  /** Merge fields into the household; a re-solve follows after 300 ms. */
  setHousehold(patch: Partial<Household>): void;
  /** Quiz completion or "typical settings": replace the household and go to /plan. */
  startHousehold(h: Household): void;
  /** "Redo setup": forget household and plan, go to /quiz. */
  resetHousehold(): void;
  /** Forget everything stored on this device (setup, pantry, cookbook, hidden recipes) and start over. */
  resetAll(): void;
  setPantryItems(items: PantryItem[]): void;
  /** Force a solve now (e.g. after Pantry confirm). */
  resolveNow(): Promise<void>;
  /** Pin a meal: the solver cooks it at least once this trip when the budget allows. */
  pinMeal(id: string): void;
  unpinMeal(id: string): void;
  /** Drop a meal from this trip (unpin + remove from the accepted set). */
  skipMeal(id: string): void;
  /** Allow a skipped meal again. */
  includeMeal(id: string): void;
  /** Save to / remove from the cookbook; the solver leans toward saved recipes. */
  toggleFavorite(id: string): void;
  /** Solve the current household once per known store so the totals can be compared side by side. */
  compareStores(): Promise<void>;
}

const Ctx = createContext<(AppState & AppActions) | null>(null);

export function StateProvider({ children }: { children: ReactNode }) {
  const [household, setHouseholdState] = useState<Household | null>(() => {
    const stored = readLS<Household | null>(LS.household, null);
    return stored ? { ...DEFAULT_HOUSEHOLD, ...stored } : null; // fill fields added since it was saved
  });
  const [plan, setPlan] = useState<Plan | null>(null);
  const [prevPlan, setPrevPlan] = useState<Plan | null>(null);
  const [pantryItems, setPantryItemsState] = useState<PantryItem[]>(() => readLS<PantryItem[]>(LS.pantry, []));
  const [sessionId] = useState<string>(() => {
    const existing = readLS<string | null>(LS.session, null);
    if (existing) return existing;
    const id = newSessionId();
    writeLS(LS.session, id);
    return id;
  });
  const [ingredients, setIngredients] = useState<Record<string, Ingredient>>({});
  const [meals, setMeals] = useState<Record<string, Meal>>({});
  const [facts, setFacts] = useState<Record<string, MealFacts>>({});
  const [stores, setStores] = useState<StoreInfo[]>([]);
  const [storePlans, setStorePlans] = useState<Record<string, Plan | null>>({});
  const [comparing, setComparing] = useState(false);
  const [solving, setSolving] = useState(false);
  const [solveError, setSolveError] = useState<string | null>(null);
  const [apiOk, setApiOk] = useState<boolean | null>(null);
  const [path, setPath] = useState<Path>(() => currentPath());

  const planRef = useRef<Plan | null>(null);
  planRef.current = plan;
  const householdRef = useRef<Household | null>(household);
  householdRef.current = household;
  const mealsRef = useRef<Record<string, Meal>>(meals);
  mealsRef.current = meals;
  const solveSeq = useRef(0);

  // ---- router -------------------------------------------------------------------------------
  const navigate = useCallback((p: Path) => {
    if (window.location.pathname !== p) window.history.pushState(null, "", p);
    setPath(p);
    window.scrollTo(0, 0);
  }, []);
  useEffect(() => {
    const onPop = () => setPath(currentPath());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  useEffect(() => {
    // first run goes to the quiz; a returning household never lands on the quiz by accident
    if (!household && path !== "/quiz") {
      window.history.replaceState(null, "", "/quiz");
      setPath("/quiz");
    }
  }, [household, path]);

  // ---- reference data ------------------------------------------------------------------------
  useEffect(() => {
    let alive = true;
    api
      .health()
      .then(() => alive && setApiOk(true))
      .catch(() => alive && setApiOk(false));
    api
      .ingredients()
      .then((list) => alive && setIngredients(Object.fromEntries(list.map((i) => [i.id, i]))))
      .catch(() => undefined);
    api
      .meals(sessionId)
      .then((list) => alive && setMeals(Object.fromEntries(list.map((m) => [m.id, m]))))
      .catch(() => undefined);
    api
      .stores()
      .then((list) => alive && setStores(list))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [sessionId]);

  // Ingredient names/prices and per-meal facts follow the store the plan uses.
  const store = household?.store ?? "kroger";
  useEffect(() => {
    let alive = true;
    api
      .ingredients(store)
      .then((list) => alive && setIngredients(Object.fromEntries(list.map((i) => [i.id, i]))))
      .catch(() => undefined);
    api
      .mealFacts(sessionId, store)
      .then((list) => alive && setFacts(Object.fromEntries(list.map((f) => [f.meal_id, f]))))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [sessionId, store]);

  // ---- solving -------------------------------------------------------------------------------
  const runSolve = useCallback(async () => {
    const hh = householdRef.current;
    if (!hh) return;
    const seq = ++solveSeq.current;
    setSolving(true);
    try {
      const next = await api.solve(hh, planRef.current, sessionId);
      if (seq !== solveSeq.current) return; // a newer solve superseded this one
      setPrevPlan(planRef.current);
      setPlan(next);
      setSolveError(null);
      setApiOk(true);
      // The meal pool on the server may have changed since this page loaded (regenerated or restarted);
      // if the plan names a meal we have never seen, refresh the pool so names and descriptions render.
      if (Object.keys(next.meals).some((id) => !mealsRef.current[id])) {
        api
          .meals(sessionId)
          .then((list) => setMeals(Object.fromEntries(list.map((m) => [m.id, m]))))
          .catch(() => undefined);
      }
    } catch (err) {
      if (seq !== solveSeq.current) return;
      if (err instanceof ApiError) setSolveError(err.detail);
      else {
        setSolveError("Can't reach the planner right now. Your plan below is the last one we had.");
        setApiOk(false);
      }
    } finally {
      if (seq === solveSeq.current) setSolving(false);
    }
  }, [sessionId]);

  useEffect(() => {
    writeLS(LS.household, household);
    if (!household) return;
    const t = window.setTimeout(() => void runSolve(), 300);
    return () => window.clearTimeout(t);
  }, [household, runSolve]);

  useEffect(() => {
    writeLS(LS.pantry, pantryItems);
  }, [pantryItems]);

  // ---- actions -------------------------------------------------------------------------------
  const setHousehold = useCallback((patch: Partial<Household>) => {
    setHouseholdState((h) => (h ? { ...h, ...patch } : h));
  }, []);
  const startHousehold = useCallback(
    (h: Household) => {
      setPlan(null);
      setPrevPlan(null);
      setSolveError(null);
      setHouseholdState(h);
      navigate("/plan");
    },
    [navigate],
  );
  const resetHousehold = useCallback(() => {
    // Keep the household so the quiz pre-fills; startHousehold() replaces it when they finish.
    setSolveError(null);
    navigate("/quiz");
  }, [navigate]);
  const resetAll = useCallback(() => {
    solveSeq.current += 1; // drop any solve in flight
    writeLS(LS.household, null);
    writeLS(LS.pantry, null);
    try {
      localStorage.removeItem("stretch.v2.introSeen");
    } catch {
      /* storage unavailable */
    }
    setPlan(null);
    setPrevPlan(null);
    setSolveError(null);
    setPantryItemsState([]);
    setHouseholdState(null);
    setSolving(false);
    navigate("/quiz");
  }, [navigate]);
  const setPantryItems = useCallback((items: PantryItem[]) => setPantryItemsState(items), []);

  // ---- meal-level choices (all plain filters on the candidate pool; the solver does the rest) ----
  const pinMeal = useCallback((id: string) => {
    setHouseholdState((h) => {
      if (!h) return h;
      const required = h.required_meals.includes(id) ? h.required_meals : [...h.required_meals, id];
      const accepted = h.accepted_meals && !h.accepted_meals.includes(id) ? [...h.accepted_meals, id] : h.accepted_meals;
      return { ...h, required_meals: required, accepted_meals: accepted, excluded_meals: h.excluded_meals.filter((x) => x !== id) };
    });
  }, []);
  const unpinMeal = useCallback((id: string) => {
    setHouseholdState((h) => (h ? { ...h, required_meals: h.required_meals.filter((x) => x !== id) } : h));
  }, []);
  const skipMeal = useCallback((id: string) => {
    setHouseholdState((h) => {
      if (!h) return h;
      const selectable = Object.keys(mealsRef.current).filter((m) => !h.excluded_meals.includes(m) && m !== id);
      const accepted = h.accepted_meals === null ? selectable : h.accepted_meals.filter((m) => m !== id);
      return { ...h, required_meals: h.required_meals.filter((x) => x !== id), accepted_meals: accepted };
    });
  }, []);
  const includeMeal = useCallback((id: string) => {
    setHouseholdState((h) => {
      if (!h || h.accepted_meals === null) return h;
      const next = h.accepted_meals.includes(id) ? h.accepted_meals : [...h.accepted_meals, id];
      const selectable = Object.keys(mealsRef.current).filter((m) => !h.excluded_meals.includes(m));
      return { ...h, accepted_meals: selectable.every((m) => next.includes(m)) ? null : next };
    });
  }, []);

  const compareStores = useCallback(async () => {
    const hh = householdRef.current;
    if (!hh || stores.length === 0) return;
    setComparing(true);
    try {
      const results = await Promise.all(
        stores.map(async (s) => {
          try {
            return [s.id, await api.solve({ ...hh, store: s.id }, null, sessionId)] as const;
          } catch {
            return [s.id, null] as const;
          }
        }),
      );
      setStorePlans(Object.fromEntries(results));
    } finally {
      setComparing(false);
    }
  }, [stores, sessionId]);

  const toggleFavorite = useCallback((id: string) => {
    setHouseholdState((h) => {
      if (!h) return h;
      const has = h.favorite_meals.includes(id);
      return { ...h, favorite_meals: has ? h.favorite_meals.filter((x) => x !== id) : [...h.favorite_meals, id] };
    });
  }, []);

  const value = useMemo<AppState & AppActions>(
    () => ({
      household,
      plan,
      prevPlan,
      pantryItems,
      sessionId,
      ingredients,
      meals,
      facts,
      stores,
      storePlans,
      comparing,
      solving,
      solveError,
      apiOk,
      path,
      navigate,
      setHousehold,
      startHousehold,
      resetHousehold,
      resetAll,
      setPantryItems,
      resolveNow: runSolve,
      pinMeal,
      unpinMeal,
      skipMeal,
      includeMeal,
      toggleFavorite,
      compareStores,
    }),
    [household, plan, prevPlan, pantryItems, sessionId, ingredients, meals, facts, stores, storePlans, comparing,
     solving, solveError, apiOk, path, navigate, setHousehold, startHousehold, resetHousehold, resetAll,
     setPantryItems, runSolve, pinMeal, unpinMeal, skipMeal, includeMeal, toggleFavorite, compareStores],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppState & AppActions {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp must be used inside StateProvider");
  return v;
}
