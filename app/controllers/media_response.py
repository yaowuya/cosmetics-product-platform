"""Deliver already authorized images with the same headers on both media routes."""
from fastapi.responses import FileResponse

from app.models import Asset
from app.services.media import resolve_asset_file


def asset_response(asset: Asset) -> FileResponse:
    """Bind the response to the registered bytes, without caching a visibility decision."""
    return FileResponse(resolve_asset_file(asset), media_type=asset.mime,
                        headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "no-store"})
