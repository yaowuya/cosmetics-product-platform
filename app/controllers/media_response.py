"""Deliver already authorized image files without caching their visibility."""
from pathlib import Path

from fastapi.responses import FileResponse

from app.models import Asset
from app.services.media import resolve_asset_file


def asset_response(asset: Asset) -> FileResponse:
    """Bind the response to the registered original bytes."""
    return image_response(resolve_asset_file(asset), asset.mime)


def image_response(path: Path, mime: str) -> FileResponse:
    """Serve an already authorized image with revocation-safe response headers."""
    return FileResponse(path, media_type=mime,
                        headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "no-store"})
