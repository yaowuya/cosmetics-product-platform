"""Build an editor's preview from one nominated saved draft, never a fallback release."""
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.core.ids import parse_id
from app.repositories.items import get_item
from app.repositories.media import registered_ids
from app.services.items import item_view
from app.services.media import asset_ids


def saved_preview(db: Session, item_id: int, revision: str) -> dict:
    """Reject stale revisions and bind each registered image URL to this same draft."""
    expected = parse_id(revision, "revision", zero=True)
    item = get_item(db, item_id)
    if item is None:
        raise AppError(404, "draft_not_found", "草稿不存在")
    if item.revision != expected:
        raise AppError(409, "preview_conflict", "草稿已变化，请重新核对")
    view = item_view(db, item)
    body = view["draft"]
    if body is None:
        raise AppError(404, "draft_not_found", "草稿不存在")
    ids = {int(ident) for ident in asset_ids(body)}
    return {"id": str(item_id), "kind": item.kind, "config_slot": item.config_slot,
            "revision": revision, "body": body, "place_ids": view["place_ids"],
            "media_urls": {str(ident): f"/api/admin/media/{ident}?item_id={item_id}&revision={revision}"
                           for ident in registered_ids(db, ids)}}
