"""Admin HTTP endpoint for appending positions to explicitly selected product drafts."""
from fastapi import APIRouter

from app.controllers.dependencies import Db, Editor
from app.schemas.content import AppendBatch
from app.services import placements

router = APIRouter(prefix="/api/admin")


@router.post("/products/batch-append")
def batch_append(data: AppendBatch, db: Db, actor: Editor) -> dict:
    """Merge product positions per transaction; a conflicting product cannot affect its neighbors."""
    return placements.batch_append(db, actor, data.items, data.node_ids)
