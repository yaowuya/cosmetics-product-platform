"""Read a private saved revision without falling back to any other content source."""
from fastapi import APIRouter
from sqlalchemy import select

from app.auth import Db, _error
from app.items import Editor, ItemId, item_view, parse_id
from app.media import asset_ids
from app.models import Asset, ContentItem

router = APIRouter(prefix="/api/admin")


@router.get("/items/{id}/preview")
def preview(id: ItemId, revision: str, db: Db, _actor: Editor) -> dict:
    """Read exactly the saved draft nominated by the editor and bind image URLs to it."""
    expected = parse_id(revision, "revision", zero=True)
    item = db.get(ContentItem, id)
    if item is None:
        raise _error(404, "draft_not_found", "草稿不存在")
    if item.revision != expected:
        raise _error(409, "preview_conflict", "草稿已变化，请重新核对")
    view = item_view(db, item)
    body = view["draft"]
    if body is None:
        raise _error(404, "draft_not_found", "草稿不存在")
    ids = {int(ident) for ident in asset_ids(body)}
    available = db.scalars(select(Asset.id).where(Asset.id.in_(ids))) if ids else []
    return {"id": str(id), "kind": item.kind, "config_slot": item.config_slot,
            "revision": revision, "body": body, "place_ids": view["place_ids"],
            "media_urls": {str(ident): f"/api/admin/media/{ident}?item_id={id}&revision={revision}"
                           for ident in available}}
