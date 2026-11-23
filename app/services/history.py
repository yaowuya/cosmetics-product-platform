"""Inspect immutable history or restore a reviewed version without publishing it."""
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.core.ids import parse_id
from app.models import Account
from app.repositories import history, releases
from app.repositories.items import get_draft, get_item, release_place_ids
from app.schemas.releases import RestoreRequest
from app.services.auth import ensure_editor
from app.services.items import item_view


def versions(db: Session, item_id: int, page: int, page_size: int) -> dict:
    """Return the requested page of snapshots with their original author, body and placements."""
    if get_item(db, item_id) is None:
        raise AppError(404, "item_not_found", "内容不存在")
    total, rows = history.version_page(db, item_id, (page - 1) * page_size, page_size)
    items = []
    for row in rows:
        positions = release_place_ids(db, row.id)
        items.append({"seq": row.seq, "release_id": str(row.id), "source_revision": str(row.source_revision),
                      "actor_id": str(row.actor_id), "created_at": row.created_at.isoformat() + "Z",
                      "body": row.body, "place_ids": [str(node) for node in positions]})
    return {"items": items, "total": total, "page": page, "page_size": page_size}


def restore(db: Session, item_id: int, seq: int, data: RestoreRequest, actor: Account) -> dict:
    """Restore only the selected item's version, checking edit rights and overwrite consent under lock."""
    ensure_editor(db, actor)
    target = releases.lock_release_owner(db, item_id)
    if target is None:
        raise AppError(404, "item_not_found", "内容不存在")
    if target.archived_at is not None or target.revision != parse_id(
        data.expected_revision, "expected_revision", zero=True
    ):
        raise AppError(409, "draft_conflict", "草稿已变化或条目已归档，请重新核对")
    source = history.get_version(db, item_id, seq)
    if source is None:
        raise AppError(404, "version_not_found", "此条目没有该历史版本")
    draft = get_draft(db, item_id)
    if draft is not None and not data.confirm_overwrite:
        raise AppError(409, "confirm_overwrite", "已有草稿，需要确认覆盖")

    # Not an ordinary draft save: even identical history starts a new revision. Inactive
    # placements must survive the copy and will be checked again at publication time.
    history.copy_to_draft(db, target, source, draft, actor.id)
    details = {"source_seq": source.seq, "source_release_id": str(source.id), "revision": str(target.revision)}
    releases.add_item_audit(db, actor.id, target, "restore", details)
    db.flush()
    view = item_view(db, target)
    db.commit()
    return view
