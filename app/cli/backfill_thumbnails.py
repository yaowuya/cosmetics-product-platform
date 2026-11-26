"""Backfill missing thumbnails for currently visible display images without republishing."""
import sys

from PIL import Image
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import engine
from app.core.errors import AppError
from app.models import Asset
from app.repositories.public_catalog import case_snapshots, products_in_nodes, slot_body
from app.schemas.content import catalog_thumbnail_source
from app.services.directory import active_directory
from app.services.thumbnails import ensure_cover_thumbnail, ensure_display_thumbnail


def _assets(db: Session, ids: set[int]) -> list[Asset]:
    return list(db.scalars(select(Asset).where(Asset.id.in_(ids)).order_by(Asset.id))) if ids else []


def visible_covers(db: Session) -> list[Asset]:
    """Find distinct thumbnail sources, including covers of products without a square image."""
    products = products_in_nodes(db, set(active_directory(db)))
    ids = {int(ident) for body, _ in products.values() if (ident := catalog_thumbnail_source(body)) is not None}
    return _assets(db, ids)


def visible_display_images(db: Session) -> list[Asset]:
    """Find distinct currently published case images and the current directory banner."""
    ids = {int(ident) for _, body in case_snapshots(db) if (ident := body.get("image_asset_id")) is not None}
    catalog = slot_body(db, "catalog_cover") or {}
    if cover := catalog.get("cover_asset_id"):
        ids.add(int(cover))
    return _assets(db, ids)


def main() -> int:
    """Process one cover at a time, reporting failures so the same command can be retried."""
    with Session(engine()) as db:
        jobs = [(asset, ensure_cover_thumbnail) for asset in visible_covers(db)]
        jobs.extend((asset, ensure_display_thumbnail) for asset in visible_display_images(db))
    generated = skipped = failed = 0
    for asset, ensure in jobs:
        try:
            if ensure(asset):
                generated += 1
            else:
                skipped += 1
        except (AppError, OSError, ValueError, Image.DecompressionBombError):
            failed += 1
            print(f"Thumbnail failed for asset {asset.id}", file=sys.stderr)
    print(f"generated={generated} skipped={skipped} failed={failed}")
    return int(failed > 0)


if __name__ == "__main__":
    raise SystemExit(main())
