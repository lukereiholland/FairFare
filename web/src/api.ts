// The only file that knows VITE_API_URL. One wrapper per endpoint; bodies are the Pydantic schemas as JSON.
import type { AgentTurn, Household, Ingredient, Meal, MealFacts, NearbyStore, PantryItem, Plan, StoreInfo } from "./types";

export const API_URL: string = (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:8001";

export class ApiError extends Error {
  status: number;
  detail: string;
  constructor(status: number, detail: string) {
    super(detail);
    this.status = status;
    this.detail = detail;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    let detail = `Request failed (${res.status})`;
    try {
      const body = await res.json();
      if (typeof body?.detail === "string") detail = body.detail;
      else if (Array.isArray(body?.detail)) {
        detail = body.detail
          .map((d: { loc?: unknown[]; msg?: string }) => `${(d.loc ?? []).slice(-1)[0] ?? "field"}: ${d.msg ?? "invalid"}`)
          .join("; ");
      }
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, detail);
  }
  return (await res.json()) as T;
}

export const api = {
  health: () => request<{ ok: boolean; app_name: string }>("/health"),

  ingredients: (store?: string) => request<Ingredient[]>(`/ingredients${store ? `?store=${encodeURIComponent(store)}` : ""}`),

  stores: () => request<StoreInfo[]>("/stores"),

  nearby: (zip: string) => request<NearbyStore[]>(`/nearby?zip=${encodeURIComponent(zip)}`),

  meals: (sessionId?: string | null) =>
    request<Meal[]>(`/meals${sessionId ? `?session_id=${encodeURIComponent(sessionId)}` : ""}`),

  mealFacts: (sessionId?: string | null, store?: string) => {
    const q = new URLSearchParams();
    if (sessionId) q.set("session_id", sessionId);
    if (store) q.set("store", store);
    const qs = q.toString();
    return request<MealFacts[]>(`/meal_facts${qs ? `?${qs}` : ""}`);
  },

  solve: (household: Household, prevPlan: Plan | null, sessionId: string | null) =>
    request<Plan>("/solve", {
      method: "POST",
      body: JSON.stringify({ household, prev_plan: prevPlan, session_id: sessionId }),
    }),

  pantryDetect: (body: { image_b64?: string | null; text?: string | null }) =>
    request<PantryItem[]>("/pantry/detect", { method: "POST", body: JSON.stringify(body) }),

  pantryVoice: (body: { audio_b64: string; mime_type: string }) =>
    request<{ transcript: string; items: PantryItem[] }>("/pantry/voice", { method: "POST", body: JSON.stringify(body) }),

  pantryGrams: (items: PantryItem[]) =>
    request<Record<string, number>>("/pantry/grams", { method: "POST", body: JSON.stringify({ items }) }),

  agentTurn: (sessionId: string, text: string, household: Household) =>
    request<AgentTurn>("/agent/turn", {
      method: "POST",
      body: JSON.stringify({ session_id: sessionId, text, household }),
    }),
};
