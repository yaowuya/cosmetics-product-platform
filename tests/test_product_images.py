"""Product image roles and ordered galleries keep existing single-image products readable."""
import pytest

from app.core.errors import AppError
from app.models import ContentItem
from app.services import checks, public_catalog
from app.services.items import normalize_body


def test_gallery_draft_is_ordered_bounded_and_displaces_legacy_field():
    """Keep explicit empty galleries, and reject invalid arrays without falling back."""
    body = {"cover_asset_id": "1", "thumbnail_asset_id": "2", "detail_asset_id": "9"}
    assert normalize_body("product", None, body) == body
    dual = {**body, "detail_asset_ids": ["5", "3", "4"]}
    assert normalize_body("product", None, dual) == {
        "cover_asset_id": "1", "thumbnail_asset_id": "2", "detail_asset_ids": ["5", "3", "4"],
    }
    assert normalize_body("product", None, {**dual, "detail_asset_ids": []})["detail_asset_ids"] == []
    for value in (None, "", ["1", "2", "3", "4"], [1]):
        with pytest.raises(AppError) as error:
            normalize_body("product", None, {**body, "detail_asset_ids": value})
        assert error.value.status_code == 422


def test_catalog_never_falls_back_to_detail_cover_and_gallery_projects_in_order(monkeypatch):
    """Older clients' aliases use the catalog image on cards and first long image on details."""
    body = {"name": "Square", "cover_asset_id": "1", "thumbnail_asset_id": "2",
            "detail_asset_id": "9", "detail_asset_ids": ["5", "3", "4"]}
    monkeypatch.setattr(public_catalog, "active_directory", lambda _db: {"1": {}})
    monkeypatch.setattr(public_catalog.releases, "products_in_nodes", lambda *_: {1: (body, {"1"})})

    def card():
        return public_catalog.list_products(None, None, None, None, 1, 20)["items"][0]["body"]

    def detail():
        return public_catalog.product_detail(None, 1)["body"]

    square = "/api/public/media/2"
    assert card() == {"name": "Square", "catalog_image_url": square, "thumbnail_asset_url": square,
                      "cover_asset_url": square, "cover_thumbnail_url": f"{square}/thumbnail"}
    assert detail() == {"name": "Square", "cover_asset_url": "/api/public/media/1",
                        "detail_asset_url": "/api/public/media/5",
                        "detail_asset_urls": [f"/api/public/media/{id}" for id in (5, 3, 4)]}
    body["thumbnail_asset_id"] = body["cover_asset_id"]
    assert card() == {"name": "Square"}
    del body["thumbnail_asset_id"]
    assert card() == {"name": "Square"}
    body["detail_asset_ids"] = []
    assert detail()["detail_asset_urls"] == [] and "detail_asset_url" not in detail()
    del body["detail_asset_ids"]
    assert detail()["detail_asset_urls"] == [detail()["detail_asset_url"]] == ["/api/public/media/9"]


def test_publish_review_requires_explicit_nonempty_gallery(monkeypatch):
    """Review every chosen gallery asset and keep the independent catalog square in the release."""
    body = {field: "文本" for field in ("name", "short_benefit", "benefit", "ingredients", "highlights",
                                       "formula_no", "production_status")}
    body.update({"cover_asset_id": "1", "thumbnail_asset_id": "2", "detail_asset_id": "9", "detail_asset_ids": []})
    monkeypatch.setattr(checks, "item_view", lambda *_: {"draft": body, "revision": "1", "place_ids": ["1"]})
    monkeypatch.setattr(checks, "active_directory", lambda _db: {"1": {}})
    ids = set()

    def available_assets(_db, data):
        ids.clear()
        ids.update(data)
        return {str(id): id for id in data if id != 4}

    monkeypatch.setattr(checks.releases, "check_assets", available_assets)
    monkeypatch.setattr(checks, "_available", lambda asset: asset is not None)
    item = ContentItem(id=1, kind="product")
    _, report = checks.review_snapshot(None, item)
    assert [issue["field"] for issue in report["issues"]] == ["detail_asset_ids"]
    assert ids == {1, 2}

    body["detail_asset_ids"] = ["5", "4"]
    snapshot, report = checks.review_snapshot(None, item)
    assert [issue["field"] for issue in report["issues"]] == ["detail_asset_ids.1"]
    assert snapshot["thumbnail_asset_id"] == "2" and "detail_asset_id" not in snapshot
    assert ids == {1, 2, 4, 5}

    body["detail_asset_ids"] = ["3", "5"]
    _, report = checks.review_snapshot(None, item)
    assert report["eligible"] and ids == {1, 2, 3, 5}
