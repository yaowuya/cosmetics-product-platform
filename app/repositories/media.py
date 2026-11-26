"""Persist immutable asset registrations and look up the references used by editors."""
from sqlalchemy import exists, func, select
from sqlalchemy.orm import Session

from app.models import Asset, Draft, ReleaseAsset

# A draft has no reverse index. Search only the declared image fields: a matching
# number in a title, a node ID or another text field is not an asset reference.
_ASSET_PATHS = (
    "$.thumbnail_asset_id", "$.cover_asset_id", "$.detail_asset_id", "$.detail_asset_ids[*]", "$.image_asset_id",
    "$.poster_asset_ids[*]", "$.nodes[*].icon_asset_id", "$.background_asset_id",
    "$.cards[*].image_asset_id", "$.qr_asset_id",
)


def add_asset(db: Session, storage_key: str, mime: str, size: int, uploader_id: int) -> Asset:
    """Stage one registration; the upload transaction obtains its ID and commits it."""
    asset = Asset(storage_key=storage_key, mime=mime, bytes=size, created_by=uploader_id)
    db.add(asset)
    return asset


def get_asset(db: Session, ident: int) -> Asset | None:
    """Find an asset registration without implying that its bytes may be served."""
    return db.get(Asset, ident)


def registered_ids(db: Session, ids: set[int]) -> list[int]:
    """Return only registrations which exist for the nominated draft's images."""
    if not ids:
        return []
    return list(db.scalars(select(Asset.id).where(Asset.id.in_(ids))))


def is_referenced(db: Session, ident: int) -> bool:
    """Check any snapshot (including history) or explicitly bound draft image field."""
    if db.scalar(select(exists().where(ReleaseAsset.asset_id == ident))):
        return True
    match = func.json_search(Draft.body, "one", str(ident), None, *_ASSET_PATHS).is_not(None)
    return bool(db.scalar(select(exists().where(match))))
