import base64
import os
import time

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from stretch import explain, generate, locations, nutrition, pantry, solve, speech, stores
from stretch.schemas import Household, Ingredient, Meal, MealFacts, NearbyStore, PantryItem, Plan, load_ingredients

load_dotenv()

APP_NAME = os.getenv("APP_NAME", "Stretch")
INGREDIENTS_CSV = "data/ingredients.csv"
MEALS_CACHE = "data/meals.json"

app = FastAPI(title=APP_NAME)

_origins = [o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",") if o.strip()]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?$|^https://[a-z0-9-]+(\.[a-z0-9-]+)*\.vercel\.app$|^https://(www\.)?ffare\.tech$",
    allow_methods=["*"],
    allow_headers=["*"],
)

# Loaded once at startup. Empty when the data files are missing; endpoints then answer 503.
INGREDIENTS: dict[str, Ingredient] = {}
MEALS: list[Meal] = []
# Per-session candidate pools; only the Phase 3 agent grows these.
SESSION_MEALS: dict[str, list[Meal]] = {}


def _load_data() -> None:
    global INGREDIENTS, MEALS
    try:
        INGREDIENTS = load_ingredients(INGREDIENTS_CSV)
    except FileNotFoundError:
        print(f"startup: {INGREDIENTS_CSV} not found; /solve will return 503 until it exists")
        return
    MEALS = generate.load_cached(MEALS_CACHE)
    if not MEALS:
        print(f"startup: {MEALS_CACHE} not found; run `python -m stretch.generate` to build it")
    print(f"startup: {len(INGREDIENTS)} ingredients, {len(MEALS)} meals")


_load_data()


@app.middleware("http")
async def _log_requests(request: Request, call_next):
    started = time.perf_counter()
    response = await call_next(request)
    print(f"{request.method} {request.url.path} {int((time.perf_counter() - started) * 1000)}ms", flush=True)
    return response


class SolveRequest(BaseModel):
    household: Household
    prev_plan: Plan | None = None
    session_id: str | None = None


class DetectRequest(BaseModel):
    image_b64: str | None = None
    text: str | None = None


class VoiceRequest(BaseModel):
    audio_b64: str
    mime_type: str = "audio/webm"


class VoiceResponse(BaseModel):
    transcript: str
    items: list[PantryItem]


class GramsRequest(BaseModel):
    items: list[PantryItem]


class AgentTurnRequest(BaseModel):
    session_id: str
    text: str
    household: Household


def _pool(session_id: str | None) -> list[Meal]:
    if session_id and session_id in SESSION_MEALS:
        return SESSION_MEALS[session_id]
    return MEALS


def _require_data(need_meals: bool = True) -> None:
    if not INGREDIENTS:
        raise HTTPException(503, detail="Planner data is missing: data/ingredients.csv was not found.")
    if need_meals and not MEALS:
        raise HTTPException(503, detail="No meal pool yet: run `python -m stretch.generate` to build data/meals.json.")


@app.get("/health")
def health() -> dict:
    return {"ok": True, "app_name": APP_NAME}


@app.get("/ingredients")
def get_ingredients(store: str = stores.DEFAULT_STORE) -> list[Ingredient]:
    _require_data(need_meals=False)
    return list(stores.ingredients_for(INGREDIENTS, store).values())


@app.get("/stores")
def get_stores() -> list[dict]:
    """Stores we hold real prices for: Kroger from the CSV, others from data/prices_<store>.csv."""
    _require_data(need_meals=False)
    return stores.available_stores(INGREDIENTS)


@app.get("/nearby")
def get_nearby(zip: str) -> list[NearbyStore]:
    """Nearest branch of each priced chain to a ZIP (OpenStreetMap). Address and distance only; empty on failure."""
    _require_data(need_meals=False)
    if not zip.strip().isdigit() or len(zip.strip()) != 5:
        raise HTTPException(422, detail="Enter a 5-digit ZIP code.")
    ids = [s["id"] for s in stores.available_stores(INGREDIENTS)]
    return locations.nearby_for_zip(zip.strip(), ids)


@app.get("/meals")
def get_meals(session_id: str | None = None) -> list[Meal]:
    _require_data()
    return _pool(session_id)


@app.get("/meal_facts")
def get_meal_facts(session_id: str | None = None, store: str = stores.DEFAULT_STORE) -> list[MealFacts]:
    _require_data()
    return list(solve.meal_facts(_pool(session_id), stores.ingredients_for(INGREDIENTS, store)).values())


@app.post("/solve")
def post_solve(req: SolveRequest) -> Plan:
    _require_data()
    hh = req.household
    if hh.snap_only:
        hh = hh.model_copy(update={"cash_cents": 0})
    merged = sorted(set(hh.excluded_ingredients) | set(nutrition.diet_exclusions(hh.diet, INGREDIENTS)))
    hh = hh.model_copy(update={"excluded_ingredients": merged})

    targets = nutrition.targets_for(hh)
    pool = _pool(req.session_id)
    store_ingredients = stores.ingredients_for(INGREDIENTS, hh.store)
    plan = solve.solve(pool, store_ingredients, hh, targets, time_limit_s=2.0)
    if plan is None:
        # The solver relaxes variety, repeats and coverage before giving up, so this only happens
        # when nothing in the pool fits the household at all.
        if hh.accepted_meals is not None:
            detail = "Not enough meals left to cover every day. Pick a few more."
        else:
            detail = "No meals fit your kitchen setup and food rules yet. Allow another way to cook or remove a restriction."
        print(f"solve: no candidates for people={hh.people} days={hh.trip_days} equipment={hh.equipment} "
              f"diet={hh.diet} excluded_ingredients={len(hh.excluded_ingredients)} accepted={hh.accepted_meals}", flush=True)
        raise HTTPException(422, detail=detail)

    if req.prev_plan is not None:
        try:
            plan.what_changed = explain.explain(req.prev_plan, plan, {m.id: m for m in pool}, INGREDIENTS)
        except Exception as exc:  # the plan is still valid without the sentence
            print(f"explain failed: {exc}")
            plan.what_changed = None
    return plan


@app.post("/pantry/detect")
def post_pantry_detect(req: DetectRequest) -> list[PantryItem]:
    has_image = bool(req.image_b64)
    has_text = bool(req.text and req.text.strip())
    if has_image == has_text:
        raise HTTPException(422, detail="Send exactly one of image_b64 or text.")
    _require_data(need_meals=False)
    if has_image:
        try:
            image = base64.b64decode(req.image_b64.split(",", 1)[-1], validate=False)
        except Exception:
            raise HTTPException(422, detail="image_b64 is not valid base64.")
        return pantry.detect_from_image(image, INGREDIENTS)
    return pantry.detect_from_text(req.text, INGREDIENTS)


@app.post("/pantry/voice")
def post_pantry_voice(req: VoiceRequest) -> VoiceResponse:
    """Spoken pantry input: transcribe the clip (ElevenLabs), then reuse the text-detection path."""
    _require_data(need_meals=False)
    try:
        audio = base64.b64decode(req.audio_b64.split(",", 1)[-1], validate=False)
    except Exception:
        raise HTTPException(422, detail="audio_b64 is not valid base64.")
    if len(audio) < 1000:
        raise HTTPException(422, detail="That clip was too short to hear. Try again closer to the mic.")
    try:
        transcript = speech.transcribe(audio, req.mime_type)
    except Exception as exc:
        print(f"voice: transcription failed: {exc}")
        raise HTTPException(502, detail="Couldn't hear that. Try again, or type what you have.")
    if not transcript:
        return VoiceResponse(transcript="", items=[])
    return VoiceResponse(transcript=transcript, items=pantry.detect_from_text(transcript, INGREDIENTS))


@app.post("/pantry/grams")
def post_pantry_grams(req: GramsRequest) -> dict[str, int]:
    _require_data(need_meals=False)
    return pantry.to_grams(req.items, INGREDIENTS)


@app.post("/agent/turn")
def post_agent_turn(req: AgentTurnRequest) -> dict:
    raise HTTPException(501, detail="The planner's chat assistant arrives in Phase 3.")
