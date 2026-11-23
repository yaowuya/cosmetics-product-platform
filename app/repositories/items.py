"""Item identity locks, draft persistence and staff queries over drafts and releases."""
from collections.abc import Sequence
from datetime import UTC, datetime

from sqlalchemy import case, delete, exists, func, or_, select
from sqlalchemy.orm import Session

from app.models import Account, ContentItem, Draft, DraftPlace, Release, ReleasePlace


def get_item(db: Session, id: int) -> ContentItem | None:
    """Look up a stable identity without acquiring a write lock or filtering its lifecycle state."""
    return db.get(ContentItem, id)


def lock_item(db: Session, item_id: int) -> ContentItem | None:
    """Re-read under the row lock even if the caller already loaded this item before a write."""
    return db.scalar(select(ContentItem).where(ContentItem.id == item_id)
                     .with_for_update().execution_options(populate_existing=True))


def create_item(db: Session, kind: str) -> ContentItem:
    """Allocate a revision-zero identity so its first draft can be written in the same transaction."""
    item = ContentItem(kind=kind)
    db.add(item)
    db.flush()
    return item


def find_config(db: Session, slot: str) -> ContentItem | None:
    """Find the fixed identity by its indexed slot under the database's configured collation."""
    return db.scalar(select(ContentItem).where(ContentItem.config_slot == slot))


def get_editing_account(db: Session, actor_id: int) -> Account | None:
    """Load the actor into a batch member's own session before rechecking edit permission."""
    return db.get(Account, actor_id)


def get_draft(db: Session, item_id: int) -> Draft | None:
    """Return the optional editable copy belonging to the identity."""
    return db.get(Draft, item_id)


def get_release(db: Session, release_id: int) -> Release | None:
    """Return the snapshot identified by an item's release pointer."""
    return db.get(Release, release_id)


def has_history(db: Session, item_id: int) -> bool:
    """Test for any release, including one that is no longer live."""
    return bool(db.scalar(select(exists().where(Release.item_id == item_id))))


def product_exists(db: Session, item_id: int) -> bool:
    """Check a draft's related-product identity without imposing publish-time visibility rules."""
    return bool(db.scalar(select(exists().where(ContentItem.id == item_id, ContentItem.kind == "product"))))


def draft_place_ids(db: Session, item_id: int) -> Sequence[int]:
    """Read this draft's distinct positions in stable numeric order."""
    return db.scalars(select(DraftPlace.node_id).where(DraftPlace.item_id == item_id)
                      .order_by(DraftPlace.node_id)).all()


def release_place_ids(db: Session, release_id: int) -> Sequence[int]:
    """Read the frozen positions of this release in the same order as draft positions."""
    return db.scalars(select(ReleasePlace.node_id).where(ReleasePlace.release_id == release_id)
                      .order_by(ReleasePlace.node_id)).all()


def write_draft(db: Session, item: ContentItem, draft: Draft | None, body: dict, actor_id: int,
                before: set[int], places: set[int]) -> None:
    """Flush a changed draft, its placements and one revision increment under the caller's item lock."""
    if draft is None:
        db.add(Draft(item_id=item.id, edited_by=actor_id, body=body))
        # The draft is the FK parent of new placements, even for an empty body.
        db.flush()
    else:
        draft.body = body
        draft.edited_by = actor_id
        draft.edited_at = datetime.now(UTC).replace(tzinfo=None)

    removed = before - places
    if removed:
        db.execute(delete(DraftPlace).where(DraftPlace.item_id == item.id, DraftPlace.node_id.in_(removed)))
    db.add_all(DraftPlace(item_id=item.id, node_id=node) for node in places - before)
    item.revision += 1
    db.flush()


def _display_query(kind: str):
    # Staff can identify offline items by their last release. It is not their live version.
    last_release_id = (select(Release.id).where(Release.item_id == ContentItem.id)
                       .order_by(Release.seq.desc()).limit(1).correlate(ContentItem).scalar_subquery())
    display_release_id = func.coalesce(ContentItem.live_id, last_release_id)
    return (select(ContentItem, Release).outerjoin(Draft, Draft.item_id == ContentItem.id)
            .outerjoin(Release, Release.id == display_release_id).where(ContentItem.kind == kind))


def _state_filters(query, state: str | None, has_draft: bool | None):
    query = query.where(ContentItem.archived_at.is_not(None) if state == "archived" else ContentItem.archived_at.is_(None))
    if state == "online":
        query = query.where(ContentItem.live_id.is_not(None))
    elif state == "offline":
        query = query.where(ContentItem.live_id.is_(None))
    if has_draft is not None:
        query = query.where(Draft.item_id.is_not(None) if has_draft else Draft.item_id.is_(None))
    return query


def _matches_place(node_id: int):
    # EXISTS avoids duplicating identities in the count or page when they have several placements.
    draft_place = exists().where(DraftPlace.item_id == ContentItem.id, DraftPlace.node_id == node_id)
    release_place = exists().where(ReleasePlace.release_id == Release.id, ReleasePlace.node_id == node_id)
    return case((Draft.item_id.is_not(None), draft_place), else_=release_place)


def page_with_display_release(db: Session, kind: str, *, state: str | None, has_draft: bool | None,
                              node_id: int | None, search: str | None, names: tuple[str, str],
                              page: int, page_size: int) -> tuple[int, Sequence[tuple[ContentItem, Release | None]]]:
    """Count and page the same set of identities, filtering the draft ahead of the display release."""
    query = _state_filters(_display_query(kind), state, has_draft)
    if node_id is not None:
        query = query.where(_matches_place(node_id))
    if search:
        body = case((Draft.item_id.is_not(None), Draft.body), else_=Release.body)
        query = query.where(or_(*(func.json_unquote(func.json_extract(body, f"$.{name}")).contains(search, autoescape=True)
                                 for name in names)))
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    rows = db.execute(query.order_by(ContentItem.id).offset((page - 1) * page_size).limit(page_size)).tuples().all()
    return total, rows
