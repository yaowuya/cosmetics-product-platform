"""Decide image visibility from currently observable published references, not history."""
from sqlalchemy.orm import Session

from app.models import Asset, ContentItem, Release
from app.repositories import public_catalog as releases
from app.repositories.media import get_asset
from app.schemas.content import effective_product_body
from app.services.directory import active_directory
from app.services.media import asset_ids, media_not_found
from app.services.public_catalog import CASE_FIELDS, PRODUCT_CARD, PRODUCT_DETAIL


def _visible_body(db: Session, item: ContentItem, version: Release, nodes: dict[str, dict] | None) -> dict | list | None:
    if item.kind == "product":
        if not releases.has_eligible_placement(db, version.id, nodes or ()):
            return None
        fields = PRODUCT_CARD + PRODUCT_DETAIL
        body = effective_product_body(version.body)
    elif item.kind == "case":
        fields = CASE_FIELDS
        body = version.body
    elif item.config_slot == "directory":
        # Disabled directory paths cannot make their icons public.
        return list((nodes or {}).values())
    else:
        # Other configuration slots expose images from their validated snapshot, without placements.
        return version.body
    return {key: body[key] for key in fields if key in body}


def public_asset(db: Session, ident: int) -> Asset:
    """Require a visible reference on this request; one surviving shared reference is sufficient."""
    asset = get_asset(db, ident)
    if asset is None:
        raise media_not_found()
    nodes = None
    for item, version in releases.media_candidates(db, ident):
        if nodes is None and (item.kind == "product" or item.config_slot == "directory"):
            nodes = active_directory(db)
        if str(ident) in asset_ids(_visible_body(db, item, version, nodes)):
            return asset
    raise media_not_found()
