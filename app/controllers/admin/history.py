"""Editor endpoints for listing versions and restoring one as a draft."""
from typing import Annotated

from fastapi import APIRouter, Path, Query

from app.controllers.dependencies import Db, Editor
from app.schemas.common import ItemId
from app.schemas.releases import RestoreRequest
from app.services import history

router = APIRouter(prefix="/api/admin")
Sequence = Annotated[int, Path(ge=1, le=2**31 - 1)]


@router.get("/items/{id}/versions")
def versions(id: ItemId, db: Db, _actor: Editor, page: Annotated[int, Query(ge=1)] = 1,
             page_size: Annotated[int, Query(ge=1, le=100)] = 20) -> dict:
    """List versions owned by this item, with their original positions and actor."""
    return history.versions(db, id, page, page_size)


@router.post("/items/{id}/versions/{seq}/restore")
def restore(id: ItemId, seq: Sequence, data: RestoreRequest, db: Db, actor: Editor) -> dict:
    """Copy the identified history as a new revision, preserving every existing publication."""
    return history.restore(db, id, seq, data, actor)
