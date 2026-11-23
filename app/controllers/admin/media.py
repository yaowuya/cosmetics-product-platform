"""Accept image uploads and serve authorized private image bytes to editors."""
from fastapi import APIRouter, UploadFile
from fastapi.responses import FileResponse

from app.controllers.dependencies import Db, Editor
from app.controllers.media_response import asset_response
from app.schemas.common import ItemId
from app.services import media

router = APIRouter(prefix="/api/admin")


@router.post("/media", status_code=201)
def upload_media(file: UploadFile, db: Db, actor: Editor) -> dict:
    """Validate actual image bytes before committing a new immutable asset registration."""
    ident = media.store_upload(db, actor, file.file, file.content_type)
    return {"id": ident, "url": f"/api/admin/media/{ident}"}


@router.get("/media/{id}")
def private_media(id: ItemId, db: Db, actor: Editor, item_id: str | None = None,
                  revision: str | None = None, seq: int | None = None) -> FileResponse:
    """Read an unassociated upload as its uploader, or prove the specified draft/version reference."""
    return asset_response(media.private_asset(db, id, actor, item_id, revision, seq))
