"""Read case references and stage changes to one confirmed item's visibility or lifetime."""
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.engine import Result
from sqlalchemy.orm import Session

from app.models import ContentItem, Draft, Release
from app.repositories.releases import add_item_audit


def case_sources(db: Session, *, lock: bool) -> Result[tuple[int, dict | None, dict | None]]:
    """Read both draft and live case references; confirmations lock their rows in item ID order."""
    query = (select(ContentItem.id, Draft.body, Release.body)
             .outerjoin(Draft, Draft.item_id == ContentItem.id)
             .outerjoin(Release, Release.id == ContentItem.live_id)
             .where(ContentItem.kind == "case").order_by(ContentItem.id))
    if lock:
        query = query.with_for_update()
    return db.execute(query)


def clear_live_pointer(item: ContentItem) -> None:
    """Stage the unlisting and invalidate any outstanding confirmations of this revision."""
    item.live_id = None
    item.revision += 1


def mark_archived(item: ContentItem) -> None:
    """Stamp a locked offline item without changing its historical snapshots or draft."""
    item.archived_at = datetime.now(UTC).replace(tzinfo=None)
    item.revision += 1


def delete_draft_item(db: Session, item: ContentItem, actor_id: int, label: str | None) -> None:
    """Retain an independent audit and delete the item; its draft and placements cascade."""
    add_item_audit(db, actor_id, item, "delete_draft", {"label": label, "revision": str(item.revision)})
    db.delete(item)
