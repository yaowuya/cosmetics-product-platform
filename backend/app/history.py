"""Read historical snapshots and restore them as new drafts without releasing them."""
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Path, Query
from pydantic import BaseModel, ConfigDict, StrictBool
from sqlalchemy import delete, func, select

from app.auth import Db, _error
from app.items import Editor, ItemId, _ensure_editor, item_view, parse_id
from app.models import Audit, ContentItem, Draft, DraftPlace, Release, ReleasePlace

router = APIRouter(prefix="/api/admin")
Sequence = Annotated[int, Path(ge=1, le=2**31 - 1)]


class RestoreRequest(BaseModel):
    """Authorize replacing one current draft only if its revision still matches."""

    model_config = ConfigDict(extra="forbid")
    expected_revision: str
    confirm_overwrite: StrictBool


@router.get("/items/{id}/versions")
def versions(id: ItemId, db: Db, _actor: Editor, page: Annotated[int, Query(ge=1)] = 1,
             page_size: Annotated[int, Query(ge=1, le=100)] = 20) -> dict:
    """List versions owned by this item, with their original positions and actor."""
    if db.get(ContentItem, id) is None:
        raise _error(404, "item_not_found", "内容不存在")
    total = db.scalar(select(func.count(Release.id)).where(Release.item_id == id))
    rows = db.scalars(select(Release).where(Release.item_id == id).order_by(Release.seq.desc())
                      .offset((page - 1) * page_size).limit(page_size)).all()
    out = []
    for row in rows:
        positions = db.scalars(select(ReleasePlace.node_id).where(ReleasePlace.release_id == row.id)
                               .order_by(ReleasePlace.node_id))
        out.append({"seq": row.seq, "release_id": str(row.id), "source_revision": str(row.source_revision),
                    "actor_id": str(row.actor_id), "created_at": row.created_at.isoformat() + "Z",
                    "body": row.body, "place_ids": [str(ident) for ident in positions]})
    return {"items": out, "total": total, "page": page, "page_size": page_size}


@router.post("/items/{id}/versions/{seq}/restore")
def restore(id: ItemId, seq: Sequence, data: RestoreRequest, db: Db, actor: Editor) -> dict:
    """Copy the identified history as a new revision, preserving every existing publication."""
    _ensure_editor(db, actor)
    target = db.scalar(select(ContentItem).where(ContentItem.id == id).with_for_update())
    if target is None:
        raise _error(404, "item_not_found", "内容不存在")
    if target.archived_at is not None or target.revision != parse_id(data.expected_revision, "expected_revision", zero=True):
        raise _error(409, "draft_conflict", "草稿已变化或条目已归档，请重新核对")
    source = db.scalar(select(Release).where(Release.item_id == id, Release.seq == seq))
    if source is None:
        raise _error(404, "version_not_found", "此条目没有该历史版本")
    draft = db.get(Draft, id)
    if draft is not None and not data.confirm_overwrite:
        raise _error(409, "confirm_overwrite", "已有草稿，需要确认覆盖")
    if draft is None:
        draft = Draft(item_id=id, body=source.body, edited_by=actor.id)
        db.add(draft)
        db.flush()
    else:
        draft.body = source.body
        draft.edited_by = actor.id
        draft.edited_at = datetime.now(UTC).replace(tzinfo=None)
        db.execute(delete(DraftPlace).where(DraftPlace.item_id == id))
    # Preserve historical positions even if they are no longer active; a future publish rechecks them.
    positions = db.scalars(select(ReleasePlace.node_id).where(ReleasePlace.release_id == source.id))
    db.add_all(DraftPlace(item_id=id, node_id=ident) for ident in positions)
    target.revision += 1
    db.add(Audit(actor_id=actor.id, action="restore", target_kind=target.kind, target_id=id,
                 details={"source_seq": source.seq, "source_release_id": str(source.id), "revision": str(target.revision)}))
    db.flush()
    view = item_view(db, target)
    db.commit()
    return view
