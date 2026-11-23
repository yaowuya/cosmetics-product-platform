"""Persist stable node identities and read the directory selected by its live pointer."""
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import ContentItem, DirectoryNode, Release


def allocate_node_id(db: Session) -> int:
    """Allocate an identity in the caller's transaction without modifying a directory snapshot."""
    node = DirectoryNode()
    db.add(node)
    db.flush()
    return node.id


def existing_node_ids(db: Session, node_ids: set[int]) -> set[int]:
    """Find reserved identities, including those not yet in the published directory."""
    return set(db.scalars(select(DirectoryNode.id).where(DirectoryNode.id.in_(node_ids))))


def live_directory_body(db: Session) -> dict | None:
    """Read only the current released directory; an offline slot has no active nodes."""
    return db.scalar(
        select(Release.body).join(ContentItem, ContentItem.live_id == Release.id)
        .where(ContentItem.config_slot == "directory")
    )
