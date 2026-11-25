"""Backfill missing thumbnails for currently visible product covers without republishing."""
import sys

from PIL import Image
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import engine
from app.core.errors import AppError
from app.models import Asset
from app.repositories.public_catalog import products_in_nodes
from app.services.directory import active_directory
from app.services.thumbnails import ensure_cover_thumbnail


def visible_covers(db: Session) -> list[Asset]:
    """Find distinct registered originals used as covers by the current public catalog."""
    products = products_in_nodes(db, set(active_directory(db)))
    ids = {int(body["cover_asset_id"]) for body, _ in products.values() if body.get("cover_asset_id")}
    return list(db.scalars(select(Asset).where(Asset.id.in_(ids)).order_by(Asset.id))) if ids else []


def main() -> int:
    """Process one cover at a time, reporting failures so the same command can be retried."""
    with Session(engine()) as db:
        covers = visible_covers(db)
    generated = skipped = failed = 0
    for asset in covers:
        try:
            if ensure_cover_thumbnail(asset):
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
