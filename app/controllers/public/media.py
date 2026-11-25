"""Deliver a registered image only while a current public projection exposes it."""
from fastapi import APIRouter, Request
from fastapi.responses import FileResponse

from app.controllers.dependencies import Db
from app.controllers.media_response import asset_response, image_response
from app.controllers.public.query import only_query
from app.schemas.common import ItemId
from app.services.media import resolve_asset_file
from app.services.public_media import public_asset
from app.services.thumbnails import existing_cover_thumbnail

router = APIRouter(prefix="/api/public")


@router.get("/media/{id}")
def public_media(id: ItemId, request: Request, db: Db) -> FileResponse:
    """Only a currently used image URL is public; old files remain private to history."""
    only_query(request)
    return asset_response(public_asset(db, id))


@router.get("/media/{id}/thumbnail")
def public_thumbnail(id: ItemId, request: Request, db: Db) -> FileResponse:
    """Check current visibility of the source asset and serve its card variant when available."""
    only_query(request)
    asset = public_asset(db, id)
    source = resolve_asset_file(asset)
    thumbnail = existing_cover_thumbnail(source)
    if thumbnail is None:
        return image_response(source, asset.mime)
    return image_response(thumbnail, "image/webp")
