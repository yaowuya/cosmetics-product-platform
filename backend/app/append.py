"""Append display positions to a product draft without changing the live version."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import Db, _error
from app.items import Editor, _ensure_editor, item_view, parse_id, save_draft
from app.models import Account, ContentItem, Release

router = APIRouter(prefix="/api/admin")


class Choice(BaseModel):
    """A selected resource and the exact revision the caller reviewed."""

    model_config = ConfigDict(extra="forbid")
    id: str
    expected_revision: str


class AppendBatch(BaseModel):
    """Add only the specified positions to the explicitly selected products."""

    model_config = ConfigDict(extra="forbid")
    items: list[Choice] = Field(max_length=200)
    node_ids: list[str] = Field(max_length=200)


def active_directory(db: Session) -> dict[str, dict]:
    """Return nodes with an enabled path in the current released directory."""
    body = db.scalar(select(Release.body).join(ContentItem, ContentItem.live_id == Release.id)
                     .where(ContentItem.config_slot == "directory")) or {}
    nodes = {node["id"]: node for node in body.get("nodes", [])}
    active = {}
    # Tiered iteration ensures a node is valid only if every ancestor was included.
    for level in ("board", "category", "subcategory"):
        for ident, node in nodes.items():
            if node.get("level") == level and node.get("enabled") is True:
                if level == "board" or node.get("parent_id") in active:
                    active[ident] = node
    return active


def _append_one(db: Session, actor_id: int, choice: Choice, requested: set[str]) -> tuple[str, str]:
    actor = db.get(Account, actor_id)
    if actor is None:
        raise _error(403, "forbidden", "当前账号无编辑权")
    _ensure_editor(db, actor)
    item = db.scalar(select(ContentItem).where(ContentItem.id == parse_id(choice.id, "id")).with_for_update())
    if item is None or item.kind != "product" or item.archived_at is not None:
        raise _error(422, "invalid_product", "仅可为当前产品追加位置")
    if item.revision != parse_id(choice.expected_revision, "expected_revision", zero=True):
        raise _error(409, "draft_conflict", "草稿已变化，请重新核对")
    if not requested <= active_directory(db).keys():
        raise _error(422, "invalid_position", "有位置不在当前有效目录中")
    view = item_view(db, item)
    previous = set(view["place_ids"])
    if requested <= previous:
        return "unchanged", view["revision"]
    draft = view["draft"] if view["draft"] is not None else (view["live"] or {})
    updated = save_draft(db, item.id, choice.expected_revision, draft, sorted(previous | requested), actor)
    return "changed", updated["revision"]


@router.post("/products/batch-append")
def batch_append(data: AppendBatch, db: Db, actor: Editor) -> dict:
    """Merge product positions per transaction; a conflicting product cannot affect its neighbors."""
    requested = {value for value in data.node_ids if parse_id(value, "node_ids")}
    result = []
    seen = set()
    for choice in data.items:
        if choice.id in seen:
            continue
        seen.add(choice.id)
        try:
            with Session(db.get_bind()) as item_db, item_db.begin():
                status, revision = _append_one(item_db, actor.id, choice, requested)
                result.append({"id": choice.id, "status": status, "revision": revision, "issues": []})
        except HTTPException as exc:
            if exc.status_code not in {409, 422}:
                raise
            issues = exc.detail.get("issues") or [{"field": "node_ids" if exc.detail["code"] == "invalid_position" else "id",
                                                   "reason": exc.detail["message"]}]
            result.append({"id": choice.id, "status": "conflict" if exc.status_code == 409 else "invalid",
                           "revision": choice.expected_revision, "issues": issues})
    return {"items": result}
