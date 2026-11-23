"""Editor-only access to the saved revision selected for preview."""
from fastapi import APIRouter

from app.controllers.dependencies import Db, Editor
from app.schemas.common import ItemId
from app.services.preview import saved_preview

router = APIRouter(prefix="/api/admin")


@router.get("/items/{id}/preview")
def preview(id: ItemId, revision: str, db: Db, _actor: Editor) -> dict:
    """Read exactly the saved draft nominated by the editor and bind image URLs to it."""
    return saved_preview(db, id, revision)
