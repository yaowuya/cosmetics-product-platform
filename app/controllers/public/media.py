"""Deliver a registered image only while a current public projection exposes it."""
from pathlib import Path
from stat import S_ISREG
from typing import Literal

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import FileResponse

from app.controllers.dependencies import Db
from app.controllers.public.query import only_query
from app.core.errors import AppError
from app.schemas.common import ItemId
from app.services.media import media_not_found, resolve_asset_file
from app.services.public_media import public_asset
from app.services.thumbnails import existing_cover_thumbnail, existing_display_thumbnail

router = APIRouter(prefix="/api/public")


def _cacheable_image(path: Path, mime: str) -> FileResponse:
    try:
        metadata = path.stat()
    except (FileNotFoundError, NotADirectoryError):
        raise media_not_found() from None
    if not S_ISREG(metadata.st_mode):
        raise media_not_found()
    return FileResponse(path, media_type=mime, stat_result=metadata,
                        headers={"Cache-Control": "private, no-cache", "X-Content-Type-Options": "nosniff"})


def _matches_etag(value: str, etag: str) -> bool:
    return value.strip() == "*" or any(tag.strip().removeprefix("W/") == etag for tag in value.split(","))


def _public_image(id: int, request: Request, db: Db, *,
                  thumbnail: Literal["preferred", "required", "display"] | None = None) -> Response:
    """Revalidate bytes only after checking the current public reference and selected file."""
    try:
        asset = public_asset(db, id)
        source = resolve_asset_file(asset)
        variant = None
        if thumbnail == "display":
            variant = existing_display_thumbnail(source)
        elif thumbnail:
            variant = existing_cover_thumbnail(source)
        if thumbnail == "required" and variant is None:
            raise media_not_found()
        response = _cacheable_image(variant, "image/webp") if variant else _cacheable_image(source, asset.mime)
    except AppError as error:
        if error.status_code != 404:
            raise
        # A previously cached URL can become public again after another publication.
        raise HTTPException(404, detail=error.detail, headers={"Cache-Control": "no-store"}) from error

    validator = ",".join(request.headers.getlist("if-none-match"))
    etag = response.headers["etag"]
    if _matches_etag(validator, etag):
        headers = {"ETag": etag, "Cache-Control": response.headers["cache-control"]}
        return Response(status_code=304, headers=headers)
    return response


@router.get("/media/{id}")
def public_media(id: ItemId, request: Request, db: Db) -> Response:
    """Revalidate a live original and serve the original bytes on a miss."""
    only_query(request)
    return _public_image(id, request, db)


@router.get("/media/{id}/thumbnail")
def public_thumbnail(id: ItemId, request: Request, db: Db) -> Response:
    """Check current visibility of the source asset and serve its card variant when available."""
    only_query(request)
    return _public_image(id, request, db, thumbnail="preferred")


@router.get("/media/{id}/catalog-thumbnail")
def public_catalog_thumbnail(id: ItemId, request: Request, db: Db) -> Response:
    """Serve a generated card image without putting a full detail cover in the list."""
    only_query(request)
    return _public_image(id, request, db, thumbnail="required")


@router.get("/media/{id}/display-thumbnail")
def public_display_thumbnail(id: ItemId, request: Request, db: Db) -> Response:
    """Serve a resized image for banners and case cards after checking current visibility."""
    only_query(request)
    return _public_image(id, request, db, thumbnail="display")
