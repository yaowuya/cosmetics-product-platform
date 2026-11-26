"""Store validated immutable images and enforce reference-bound private access."""
import os
from pathlib import Path
from typing import BinaryIO
from uuid import uuid4

from PIL import Image, UnidentifiedImageError
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.core.ids import parse_id
from app.models import Account, Asset
from app.repositories import media
from app.repositories.history import get_version
from app.repositories.items import get_draft, get_item
from app.schemas.content import effective_product_body
from app.services.auth import ensure_editor

_MIME = {"PNG": "image/png", "JPEG": "image/jpeg", "WEBP": "image/webp"}


def _field_ids(key: str, value: object) -> set[str]:
    if key.endswith("_asset_id") and isinstance(value, str):
        return {value}
    if key.endswith("_asset_ids") and isinstance(value, list):
        return {ident for ident in value if isinstance(ident, str)}
    return asset_ids(value)


def asset_ids(body: object) -> set[str]:
    """Collect distinct string IDs from image fields, not from arbitrary text or other IDs."""
    if isinstance(body, list):
        return {ident for entry in body for ident in asset_ids(entry)}
    if isinstance(body, dict):
        return {ident for key, value in body.items() for ident in _field_ids(key, value)}
    return set()


def media_not_found() -> AppError:
    """Do not distinguish an unknown asset from one the reader cannot see."""
    return AppError(404, "media_not_found", "素材不存在")


def _storage_root() -> Path:
    configured = os.environ.get("ASSET_ROOT")
    if not configured:
        raise AppError(503, "storage_unavailable", "素材存储尚未就绪")
    return Path(configured).resolve()


def resolve_asset_file(asset: Asset) -> Path:
    """Resolve existing registered bytes inside this instance's store; does not grant access."""
    root = _storage_root()
    path = (root / asset.storage_key).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        raise media_not_found()
    return path


def _copy_bounded(source: BinaryIO, output: BinaryIO, limit: int) -> int:
    size = 0
    while chunk := source.read(64 * 1024):
        size += len(chunk)
        if size > limit:
            raise AppError(422, "image_too_large", "图片超过字节限制")
        output.write(chunk)
    return size


def _image_type(path: Path, declared: str | None) -> str:
    limit = int(os.environ.get("ASSET_MAX_PIXELS", "25000000"))
    try:
        with Image.open(path) as image:
            kind = _MIME.get(image.format or "")
            if not kind or kind != declared or image.width * image.height > limit:
                raise AppError(422, "invalid_image", "图片格式或像素范围不符合要求")
            image.verify()
        # Pillow's structural check consumes the first handle; actually decode the bytes too.
        with Image.open(path) as image:
            image.load()
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError, ValueError) as exc:
        raise AppError(422, "invalid_image", "不接受损坏或无法解码的图片") from exc
    return kind


def store_upload(db: Session, actor: Account, source: BinaryIO, declared: str | None) -> str:
    """Validate the stream and commit its registration, returning the new decimal asset ID."""
    root = _storage_root()
    limit = int(os.environ.get("ASSET_MAX_BYTES", str(20 * 1024 * 1024)))
    storage_key = uuid4().hex
    destination = root / storage_key
    owned = False
    try:
        root.mkdir(parents=True, exist_ok=True)
        with destination.open("xb") as output:
            owned = True
            size = _copy_bounded(source, output, limit)
        mime = _image_type(destination, declared)
        # Image decoding may take time; recheck and lock the editor immediately before writing.
        ensure_editor(db, actor)
        asset = media.add_asset(db, storage_key, mime, size, actor.id)
        db.flush()
        ident = str(asset.id)
        db.commit()
        owned = False
        return ident
    except (OSError, SQLAlchemyError) as exc:
        db.rollback()
        raise AppError(503, "storage_unavailable", "素材暂时无法保存") from exc
    finally:
        # Only undo our exclusive create. A collision must never unlink someone else's bytes.
        if owned:
            destination.unlink(missing_ok=True)


def _reference_body(db: Session, item_id: str, revision: str | None, seq: int | None) -> dict | None:
    item = get_item(db, parse_id(item_id, "item_id"))
    # Bind exactly one source; a stale or absent draft cannot fall back to its live version.
    if item is None or (revision is None) == (seq is None):
        return None
    if seq is not None:
        version = get_version(db, item.id, seq)
        body = version.body if version is not None else None
    else:
        draft = get_draft(db, item.id)
        body = draft.body if draft is not None and item.revision == parse_id(revision, "revision", zero=True) else None
    return effective_product_body(body) if body is not None and item.kind == "product" else body


def private_asset(db: Session, ident: int, actor: Account, item_id: str | None,
                  revision: str | None, seq: int | None) -> Asset:
    """Require the exact private reference, or the uploader of a currently unreferenced asset."""
    asset = media.get_asset(db, ident)
    if asset is None:
        raise media_not_found()
    if item_id is None:
        allowed = (revision is None and seq is None and actor.id == asset.created_by
                   and not media.is_referenced(db, ident))
    else:
        allowed = str(ident) in asset_ids(_reference_body(db, item_id, revision, seq))
    if not allowed:
        raise media_not_found()
    return asset
