"""Editor saves validate required fields before changing persisted drafts or item identities."""
from types import SimpleNamespace

import pytest

from app.core.errors import AppError
from app.models import Account, ContentItem
from app.services import items


@pytest.mark.parametrize("new", [True, False])
@pytest.mark.parametrize(("kind", "body", "missing"), [
    ("product", {"name": "  ", "detail_asset_ids": []}, {"name", "detail_asset_ids", "place_ids"}),
    ("case", {"brand_name": "测试品牌"}, {"product_name", "highlight", "image_asset_id"}),
])
def test_editor_rejects_incomplete_draft_without_writes(monkeypatch, kind, body, missing, new):
    """Incomplete bodies cannot allocate an item or write a draft through either editor entry."""
    actor = Account(id=100, can_edit=True)
    item = ContentItem(id=10, kind=kind, revision=0)
    writes = []
    db = SimpleNamespace(commit=lambda: writes.append("commit"))

    def allocate(*_):
        writes.append("identity")
        return item

    monkeypatch.setattr(items, "ensure_editor", lambda *_: None)
    monkeypatch.setattr(items.items, "create_item", allocate)
    monkeypatch.setattr(items.items, "lock_item", lambda *_: item)
    monkeypatch.setattr(items.items, "get_draft", lambda *_: None)
    monkeypatch.setattr(items.items, "draft_place_ids", lambda *_: [])
    monkeypatch.setattr(items.items, "write_draft", lambda *_: writes.append("draft"))
    monkeypatch.setattr(items, "item_view", lambda *_: {})

    with pytest.raises(AppError) as rejected:
        if new:
            items.new_item(db, kind, body, [], actor)
        else:
            items.update_draft(db, item.id, "0", body, [], actor)

    assert rejected.value.status_code == 422
    assert rejected.value.detail["code"] == "invalid_body"
    assert missing <= {issue["field"] for issue in rejected.value.detail["issues"]}
    assert writes == []
