"""HTTP confirmation of a reviewed draft by a publisher."""
from fastapi import APIRouter

from app.controllers.dependencies import Db, Publisher
from app.schemas.common import ItemId
from app.schemas.releases import PublishDraft
from app.services import publish

router = APIRouter(prefix="/api/admin")


@router.post("/items/{id}/publish")
def publish_one(id: ItemId, data: PublishDraft, db: Db, actor: Publisher) -> dict:
    """Return the original receipt on replay; never partially install a new version."""
    return publish.publish_one(db, actor.id, id, data)
