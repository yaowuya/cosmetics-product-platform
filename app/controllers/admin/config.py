"""Admin HTTP endpoints for fixed configuration slots and directory node reservation."""
from fastapi import APIRouter

from app.controllers.dependencies import Db, Editor
from app.schemas.content import NodeRequest
from app.services import directory, items

router = APIRouter(prefix="/api/admin")


@router.get("/config/{slot}")
def fixed_config(slot: str, db: Db, _actor: Editor) -> dict:
    """Resolve one fixed slot by its unique key, without creating or releasing content."""
    return items.fixed_config(db, slot)


@router.post("/directory/nodes", status_code=201)
def new_node(_data: NodeRequest, db: Db, actor: Editor) -> dict:
    """Reserve a stable node ID; this does not add a node to the draft or published tree."""
    return directory.new_node(db, actor)
