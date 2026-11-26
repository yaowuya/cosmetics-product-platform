"""Persistence for publication checks, immutable snapshots and their audit receipts."""
from collections.abc import Iterator
from contextlib import contextmanager

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Asset, Audit, ContentItem, Draft, Release, ReleaseAsset, ReleasePlace


@contextmanager
def read_committed_session(db: Session) -> Iterator[Session]:
    """Open a fresh connection outside the auth snapshot; the caller owns each transaction."""
    with db.get_bind().connect().execution_options(isolation_level="READ COMMITTED") as conn, Session(conn) as write:
        yield write


def lock_release_owner(db: Session, item_id: int) -> ContentItem | None:
    """Take the owner-row lock for release creation or restoration."""
    return db.scalar(select(ContentItem).where(ContentItem.id == item_id).with_for_update())


def lock_publish_target(db: Session, item_id: int) -> ContentItem | None:
    """Lock shared eligibility inputs in ID order before the target, even on a receipt replay."""
    slots = db.scalars(select(ContentItem).where(ContentItem.config_slot.in_(("directory", "case_header")))
                       .order_by(ContentItem.id).with_for_update()).all()
    for slot in slots:
        if slot.id == item_id:
            return slot
    return lock_release_owner(db, item_id)


def lock_publish_audit(db: Session, key: str) -> Audit | None:
    """Read the event for a global request key under a row lock, not just this actor's events."""
    return db.scalar(select(Audit).where(Audit.request_key == key).with_for_update())


def live_case_header(db: Session) -> dict:
    """Only the published header can qualify a case's filter key."""
    return db.scalar(select(Release.body).join(ContentItem, ContentItem.live_id == Release.id)
                     .where(ContentItem.config_slot == "case_header")) or {}


def check_assets(db: Session, ids: set[int]) -> dict[str, Asset]:
    """Fetch the registrations in one read; callers retain individual field paths for issues."""
    if not ids:
        return {}
    return {str(asset.id): asset for asset in db.scalars(select(Asset).where(Asset.id.in_(ids)))}


def install_snapshot(db: Session, item: ContentItem, draft: Draft, actor_id: int, source: int,
                     place_ids: list[str], asset_ids: set[str], *, body: dict) -> Release:
    """Stage the reviewed body, its bindings and the live swap, consuming the locked item's draft."""
    seq = (db.scalar(select(func.max(Release.seq)).where(Release.item_id == item.id)) or 0) + 1
    release = Release(item_id=item.id, seq=seq, source_revision=source, body=body, actor_id=actor_id)
    db.add(release)
    # Both sets of bindings and the composite live FK need the generated release ID.
    db.flush()
    db.add_all(ReleasePlace(release_id=release.id, node_id=int(node)) for node in place_ids)
    db.add_all(ReleaseAsset(release_id=release.id, asset_id=int(ident)) for ident in asset_ids)
    item.live_id = release.id
    item.revision += 1
    db.delete(draft)
    return release


def add_item_audit(db: Session, actor_id: int, item: ContentItem, action: str, details: dict,
                   *, request_key: str | None = None) -> None:
    """Stage an event by stable item identity, so deleting a never-released item retains its audit."""
    db.add(Audit(actor_id=actor_id, action=action, target_kind=item.kind, target_id=item.id,
                 request_key=request_key, details=details))


def add_publish_audit(db: Session, actor_id: int, item: ContentItem, source_revision: str, receipt: dict) -> None:
    """Persist the exact reviewed revision and replayable receipt in the snapshot transaction."""
    add_item_audit(db, actor_id, item, "publish", {"source_revision": source_revision, "receipt": receipt},
                   request_key=receipt["request_key"])
