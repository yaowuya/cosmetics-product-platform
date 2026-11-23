"""Re-evaluate public image permission from the current visible releases on each request."""
from fastapi import APIRouter, Request
from fastapi.responses import FileResponse
from sqlalchemy import exists, select

from app.append import active_directory
from app.auth import Db, _error
from app.items import ItemId
from app.media import asset_ids, asset_response
from app.models import Asset, ContentItem, Release, ReleaseAsset, ReleasePlace
from app.public import CASE_FIELDS, PRODUCT_CARD, PRODUCT_DETAIL, only_query

router = APIRouter(prefix="/api/public")


def _visible(db: Db, id: int) -> bool:
    entries = db.execute(select(ContentItem, Release).join(Release, ContentItem.live_id == Release.id)
                         .join(ReleaseAsset, ReleaseAsset.release_id == Release.id)
                         .where(ReleaseAsset.asset_id == id, ContentItem.archived_at.is_(None)))
    active = None
    for item, version in entries:
        if item.kind == "product" or item.config_slot == "directory":
            active = active_directory(db) if active is None else active
        if item.kind == "product":
            if not active or not db.scalar(select(exists().where(
                ReleasePlace.release_id == version.id, ReleasePlace.node_id.in_({int(ident) for ident in active})
            ))):
                continue
            body = {key: version.body[key] for key in set(PRODUCT_CARD + PRODUCT_DETAIL) if key in version.body}
        elif item.kind == "case":
            body = {key: version.body[key] for key in CASE_FIELDS if key in version.body}
        elif item.config_slot == "directory":
            body = list((active or {}).values())
        else:
            body = version.body
        if str(id) in asset_ids(body):
            return True
    return False


@router.get("/media/{id}")
def public_media(id: ItemId, request: Request, db: Db) -> FileResponse:
    """Only a currently used image URL is public; old files remain private to history."""
    only_query(request)
    asset = db.get(Asset, id)
    if asset is None or not _visible(db, id):
        raise _error(404, "media_not_found", "素材不存在")
    return asset_response(asset)
