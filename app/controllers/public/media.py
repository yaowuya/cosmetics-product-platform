"""Deliver a registered image only while a current public projection exposes it."""
from fastapi import APIRouter, Request
from fastapi.responses import FileResponse

from app.controllers.dependencies import Db
from app.controllers.media_response import asset_response
from app.controllers.public.query import only_query
from app.schemas.common import ItemId
from app.services.public_media import public_asset

router = APIRouter(prefix="/api/public")


@router.get("/media/{id}")
def public_media(id: ItemId, request: Request, db: Db) -> FileResponse:
    """Only a currently used image URL is public; old files remain private to history."""
    only_query(request)
    return asset_response(public_asset(db, id))
