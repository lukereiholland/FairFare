from stretch import prices
from tests.fixtures import INGREDIENTS


def _fake_get_factory(products_by_term):
    def fake_get(path, params):
        if path.startswith("/locations/"):
            return {"data": {"locationId": "01400376", "name": "Kroger Test", "address": {}}}
        return {"data": products_by_term.get(params["filter.term"], [])}
    return fake_get


def test_refresh_updates_only_size_matched_products(monkeypatch, tmp_path):
    monkeypatch.setattr(prices, "CACHE_PATH", str(tmp_path / "cache.json"))
    monkeypatch.setattr(prices, "get_token", lambda: "t")
    subset = {k: INGREDIENTS[k] for k in ("rice", "black_beans")}   # 907 g and 425 g packages
    fake = _fake_get_factory({
        INGREDIENTS["rice"].kroger_product: [{
            "description": "Kroger Long Grain Rice", "items": [
                {"size": "32 oz", "price": {"regular": 1.79}, "inventory": {"stockLevel": "HIGH"}}]}],
        INGREDIENTS["black_beans"].kroger_product: [{
            "description": "Kroger Black Beans Family Size", "items": [
                {"size": "5 lb", "price": {"regular": 4.99}, "inventory": {"stockLevel": "HIGH"}}]}],
    })
    monkeypatch.setattr(prices, "_get", fake)

    updated, report = prices.refresh_prices(subset, "01400376")

    assert updated["rice"].price_cents == 179
    assert updated["rice"].price_source == "api"
    assert updated["black_beans"].price_cents == INGREDIENTS["black_beans"].price_cents
    assert updated["black_beans"].price_source == "csv"
    assert report["updated"] == 1 and report["kept_csv"] == 1
    assert "error" not in report


def test_refresh_failure_returns_ingredients_unchanged(monkeypatch, tmp_path):
    monkeypatch.setattr(prices, "CACHE_PATH", str(tmp_path / "cache.json"))
    monkeypatch.setattr(prices, "get_token", lambda: "t")

    def boom(path, params):
        raise ConnectionError("kroger api down")
    monkeypatch.setattr(prices, "_get", boom)

    updated, report = prices.refresh_prices(INGREDIENTS, "01400376")

    assert updated == INGREDIENTS
    assert report["updated"] == 0
    assert "error" in report


def test_size_matching_rules():
    rice = INGREDIENTS["rice"]           # 907 g
    assert prices.size_matches("32 oz", rice)
    assert prices.size_matches("2 lb", rice)
    assert not prices.size_matches("5 lb", rice)
    eggs = INGREDIENTS["eggs"]           # "... Eggs 12 ct"
    assert prices.size_matches("12 ct", eggs)
    assert not prices.size_matches("18 ct", eggs)
    assert prices.size_to_grams("12 x 3 oz") == round(36 * 28.3495)
    assert prices.size_to_grams("1 gal") == 3785
    tortillas = INGREDIENTS["tortillas"]  # 500 g; "10 ct / 17.5 oz" is 496 g total, not 10 x 17.5 oz
    assert prices.size_matches("10 ct / 17.5 oz", tortillas)
    assert prices.size_to_grams("10 ct / 17.5 oz") is None
