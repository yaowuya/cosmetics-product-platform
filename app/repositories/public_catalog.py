"""Read anonymous catalog data through unarchived items' current release pointers."""
from collections.abc import Collection

from sqlalchemy import exists, select
from sqlalchemy.orm import Session

from app.models import ContentItem, Release, ReleaseAsset, ReleasePlace


def _current(*columns):
    # A release row or a reverse index entry can outlive publication. The live
    # pointer, not the latest sequence, is the authority for every public query.
    return (select(*columns).select_from(ContentItem)
            .join(Release, ContentItem.live_id == Release.id)
            .where(ContentItem.archived_at.is_(None)))


def slot_body(db: Session, slot: str) -> dict | None:
    """Return the current configuration snapshot or None for an unpublished slot."""
    return db.scalar(_current(Release.body).where(ContentItem.config_slot == slot))


def products_in_nodes(db: Session, eligible: set[str], item_id: int | None = None) -> dict[int, tuple[dict, set[str]]]:
    """Group current products by identity, retaining distinct eligible placements."""
    if not eligible:
        return {}
    query = (_current(ContentItem.id, Release.body, ReleasePlace.node_id)
             .join(ReleasePlace, ReleasePlace.release_id == Release.id)
             .where(ContentItem.kind == "product", ReleasePlace.node_id.in_({int(i) for i in eligible})))
    if item_id is not None:
        query = query.where(ContentItem.id == item_id)
    rows: dict[int, tuple[dict, set[str]]] = {}
    for ident, body, position in db.execute(query.order_by(ContentItem.id)):
        rows.setdefault(ident, (body, set()))[1].add(str(position))
    return rows


def case_snapshots(db: Session, item_id: int | None = None):
    """Return current case IDs and bodies, without consulting any linked product."""
    query = _current(ContentItem.id, Release.body).where(ContentItem.kind == "case")
    if item_id is not None:
        query = query.where(ContentItem.id == item_id)
    return db.execute(query).all()


def media_candidates(db: Session, asset_id: int):
    """Find live snapshots indexed by asset; projected field visibility is checked separately."""
    query = (_current(ContentItem, Release)
             .join(ReleaseAsset, ReleaseAsset.release_id == Release.id)
             .where(ReleaseAsset.asset_id == asset_id))
    return db.execute(query)


def has_eligible_placement(db: Session, release_id: int, node_ids: Collection[str]) -> bool:
    """Check a product version's placement against the currently enabled directory paths."""
    if not node_ids:
        return False
    match = exists().where(ReleasePlace.release_id == release_id,
                           ReleasePlace.node_id.in_({int(ident) for ident in node_ids}))
    return bool(db.scalar(select(match)))
