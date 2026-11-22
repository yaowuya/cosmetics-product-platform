"""Locate fixed workspace positions and allocate durable directory node IDs."""
from fastapi import APIRouter
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select

from app.auth import Db, _error
from app.items import Editor, _ensure_editor, item_view
from app.models import ContentItem, DirectoryNode

router = APIRouter(prefix="/api/admin")


class NodeRequest(BaseModel):
    """Allocate an identity only; node attributes belong to the directory draft."""

    model_config = ConfigDict(extra="forbid")


@router.get("/config/{slot}")
def fixed_config(slot: str, db: Db, _actor: Editor) -> dict:
    """Resolve one fixed slot by its unique key, without creating or releasing content."""
    item = db.scalar(select(ContentItem).where(ContentItem.config_slot == slot))
    if item is None or item.config_slot != slot:
        raise _error(404, "config_not_found", "配置位置不存在")
    return item_view(db, item)


@router.post("/directory/nodes", status_code=201)
def new_node(_data: NodeRequest, db: Db, actor: Editor) -> dict:
    """Reserve a stable node ID; this does not add a node to the draft or published tree."""
    _ensure_editor(db, actor)
    node = DirectoryNode()
    db.add(node)
    db.flush()
    node_id = str(node.id)
    db.commit()
    return {"id": node_id}
