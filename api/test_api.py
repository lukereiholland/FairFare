import pytest
from fastapi.testclient import TestClient

from api import main
from tests.fixtures import INGREDIENTS, MEALS, make_household


@pytest.fixture(autouse=True)
def _fixture_data(monkeypatch):
    monkeypatch.setattr(main, "INGREDIENTS", INGREDIENTS)
    monkeypatch.setattr(main, "MEALS", MEALS)


@pytest.fixture
def client():
    return TestClient(main.app)


def _body(**overrides) -> dict:
    return {"household": make_household(**overrides).model_dump(mode="json"),
            "prev_plan": None, "session_id": None}


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["ok"] is True


def test_ingredients_and_meals(client):
    assert len(client.get("/ingredients").json()) == len(INGREDIENTS)
    assert len(client.get("/meals").json()) == len(MEALS)


def test_solve_returns_plan_with_consistent_totals(client):
    r = client.post("/solve", json=_body())
    assert r.status_code == 200, r.text
    plan = r.json()
    assert plan["basket_cents"] == plan["ebt_cents"] + plan["cash_cents"]
    assert plan["cart"]
    assert plan["what_changed"] is None


def test_solve_snap_only_forces_zero_cash(client):
    # trip_days=4 puts the variety floor at 5 of 6 meals, so the cash-only dinner can be dropped.
    r = client.post("/solve", json=_body(snap_only=True, trip_days=4))
    assert r.status_code == 200, r.text
    assert r.json()["cash_cents"] == 0


def test_solve_too_few_meals_relaxes_and_reports_uncovered(client):
    r = client.post("/solve", json=_body(accepted_meals=["veggie_scramble"]))
    assert r.status_code == 200, r.text
    plan = r.json()
    assert plan["uncovered"]["lunch"] > 0 and plan["uncovered"]["dinner"] > 0
    assert "slots" in plan["relaxed"]


def test_solve_no_candidates_returns_422(client):
    r = client.post("/solve", json=_body(accepted_meals=[]))
    assert r.status_code == 422
    assert "meals" in r.json()["detail"].lower()


def test_pantry_detect_requires_exactly_one_input(client):
    assert client.post("/pantry/detect", json={}).status_code == 422
    assert client.post("/pantry/detect", json={"image_b64": "aGk=", "text": "rice"}).status_code == 422


def test_pantry_grams(client):
    items = [{"ingredient_id": "rice", "level": "half", "source": "manual"}]
    r = client.post("/pantry/grams", json={"items": items})
    assert r.status_code == 200
    assert r.json() == {"rice": INGREDIENTS["rice"].package_g // 2}


def test_pantry_voice_transcribes_then_detects(client, monkeypatch):
    import base64

    from stretch import pantry, speech
    from stretch.schemas import PantryItem

    monkeypatch.setattr(speech, "transcribe", lambda audio, mime_type="audio/webm": "rice and eggs")
    monkeypatch.setattr(
        pantry, "detect_from_text",
        lambda text, ings: [PantryItem(ingredient_id="rice", level="full", source="text")],
    )
    body = {"audio_b64": base64.b64encode(b"x" * 2000).decode(), "mime_type": "audio/webm"}
    r = client.post("/pantry/voice", json=body)
    assert r.status_code == 200
    data = r.json()
    assert data["transcript"] == "rice and eggs"
    assert [i["ingredient_id"] for i in data["items"]] == ["rice"]


def test_pantry_voice_rejects_tiny_clips(client):
    import base64

    r = client.post("/pantry/voice", json={"audio_b64": base64.b64encode(b"tiny").decode()})
    assert r.status_code == 422
