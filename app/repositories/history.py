"""Read per-item release history and copy a reviewed snapshot into editable storage."""
from collections.abc import Sequence
from datetime import UTC, datetime

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.models import ContentItem, Draft, DraftPlace, Release, ReleasePlace


def version_page(db: Session, item_id: int, offset: int, limit: int) -> tuple[int, Sequence[Release]]:
    """Count and page only this item's immutable versions, newest first."""
    total = db.scalar(select(func.count(Release.id)).where(Release.item_id == item_id))
    rows = db.scalars(select(Release).where(Release.item_id == item_id).order_by(Release.seq.desc())
                      .offset(offset).limit(limit)).all()
    return total, rows


def get_version(db: Session, item_id: int, seq: int) -> Release | None:
    """Resolve a sequence within its owner; sequence numbers are not global IDs."""
    return db.scalar(select(Release).where(Release.item_id == item_id, Release.seq == seq))


def copy_to_draft(db: Session, item: ContentItem, source: Release, draft: Draft | None, actor_id: int) -> None:
    """Stage the exact historical body and placements as a new revision; never touch its live pointer."""
    if draft is None:
        db.add(Draft(item_id=item.id, body=source.body, edited_by=actor_id))
        db.flush()
    else:
        draft.body = source.body
        draft.edited_by = actor_id
        draft.edited_at = datetime.now(UTC).replace(tzinfo=None)
        db.execute(delete(DraftPlace).where(DraftPlace.item_id == item.id))
    positions = db.scalars(select(ReleasePlace.node_id).where(ReleasePlace.release_id == source.id))
    db.add_all(DraftPlace(item_id=item.id, node_id=node) for node in positions)
    item.revision += 1
