import csv

from stretch import stores
from tests.fixtures import INGREDIENTS


def test_overlay_prices_replace_and_unpriced_go_out_of_stock(tmp_path, monkeypatch):
    path = tmp_path / "prices_walmart.csv"
    ids = list(INGREDIENTS)
    with open(path, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=["id", "price_cents", "size", "product", "url", "checked_at", "note"])
        w.writeheader()
        w.writerow({"id": ids[0], "price_cents": "123", "product": "Great Value Thing", "url": "https://www.walmart.com/ip/1"})
        w.writerow({"id": ids[1], "price_cents": "", "note": "not found"})
    monkeypatch.setattr(stores, "_path", lambda store: str(path))

    out = stores.ingredients_for(INGREDIENTS, "walmart")
    assert out[ids[0]].price_cents == 123
    assert out[ids[0]].kroger_product == "Great Value Thing"
    assert out[ids[0]].in_stock is True
    assert out[ids[1]].in_stock is False
    assert all(out[i].in_stock is False for i in ids[2:])
    # the default store is untouched
    assert stores.ingredients_for(INGREDIENTS, "kroger") is INGREDIENTS
    listing = stores.available_stores(INGREDIENTS)
    assert listing[0]["id"] == "kroger" and listing[0]["priced"] == len(INGREDIENTS)
    assert any(s["id"] == "walmart" and s["priced"] == 1 for s in listing)
