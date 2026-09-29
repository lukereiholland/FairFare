import json

from stretch import llm, pantry
from stretch.schemas import PantryItem
from tests.fixtures import INGREDIENTS


def test_detect_drops_unknown_ids(monkeypatch):
    def fake_complete(messages, tools=None, json_only=False, temperature=None, images=None):
        return {"text": json.dumps([
            {"ingredient_id": "rice", "level": "half"},
            {"ingredient_id": "unicorn_steak", "level": "full"},
        ]), "tool_calls": [], "raw": None}

    monkeypatch.setattr(llm, "complete", fake_complete)
    items = pantry.detect_from_text("I have half a bag of rice and a unicorn steak", INGREDIENTS)
    assert items == [PantryItem(ingredient_id="rice", level="half", source="text")]


def test_to_grams_sums_duplicates():
    pkg = INGREDIENTS["rice"].package_g
    items = [
        PantryItem(ingredient_id="rice", level="full", source="manual"),
        PantryItem(ingredient_id="rice", level="half", source="manual"),
    ]
    assert pantry.to_grams(items, INGREDIENTS) == {"rice": pkg + pkg // 2}
