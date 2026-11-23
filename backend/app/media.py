"""Validate immutable image bytes and authorize private delivery by actual reference."""
import os
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, UploadFile
from fastapi.responses import FileResponse
from PIL import Image, UnidentifiedImageError
from sqlalchemy import exists, func, select
from sqlalchemy.exc import SQLAlchemyError

from app.auth import Db, _error
from app.items import Editor, ItemId, _ensure_editor, parse_id
from app.models import Asset, ContentItem, Draft, Release, ReleaseAsset

router = APIRouter(prefix="/api/admin")
MIME = {"PNG": "image/png", "JPEG": "image/jpeg", "WEBP": "image/webp"}
ASSET_PATHS = (
    "$.thumbnail_asset_id", "$.cover_asset_id", "$.detail_asset_id", "$.image_asset_id",
    "$.poster_asset_ids[*]", "$.nodes[*].icon_asset_id", "$.background_asset_id",
    "$.cards[*].image_asset_id", "$.qr_asset_id",
)


def asset_ids(body: object) -> set[str]:
    """Collect registered image IDs only from the defined asset fields, not text values."""
    if isinstance(body, list):
        return {ident for entry in body for ident in asset_ids(entry)}
    if not isinstance(body, dict):
        return set()
    ids: set[str] = set()
    for key, value in body.items():
        if key.endswith("_asset_id") and isinstance(value, str):
            ids.add(value)
        elif key.endswith("_asset_ids") and isinstance(value, list):
            ids.update(ident for ident in value if isinstance(ident, str))
        elif isinstance(value, (dict, list)):
            ids.update(asset_ids(value))
    return ids


def _storage_root() -> Path:
    configured = os.environ.get("ASSET_ROOT")
    if not configured:
        raise _error(503, "storage_unavailable", "素材存储尚未就绪")
    return Path(configured).resolve()


def _image_type(path: Path, declared: str | None) -> str:
    limit = int(os.environ.get("ASSET_MAX_PIXELS", "25000000"))
    try:
        with Image.open(path) as image:
            kind = MIME.get(image.format or "")
            if not kind or kind != declared or image.width * image.height > limit:
                raise _error(422, "invalid_image", "图片格式或像素范围不符合要求")
            image.verify()
        with Image.open(path) as image:
            image.load()
    except (UnidentifiedImageError, Image.DecompressionBombError, OSError, ValueError) as exc:
        raise _error(422, "invalid_image", "不接受损坏或无法解码的图片") from exc
    return kind


def asset_response(asset: Asset) -> FileResponse:
    """Serve only the registered immutable path; authorization must already have succeeded."""
    root = _storage_root()
    path = (root / asset.storage_key).resolve()
    if not path.is_relative_to(root) or not path.is_file():
        raise _error(404, "media_not_found", "素材不存在")
    return FileResponse(path, media_type=asset.mime, headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "no-store"})


@router.post("/media", status_code=201)
def upload_media(file: UploadFile, db: Db, actor: Editor) -> dict:
    """Validate actual image bytes before committing a new immutable asset registration."""
    root = _storage_root()
    limit = int(os.environ.get("ASSET_MAX_BYTES", str(20 * 1024 * 1024)))
    storage_key = uuid4().hex
    destination = root / storage_key
    size = 0
    owned_file = False
    try:
        root.mkdir(parents=True, exist_ok=True)
        with destination.open("xb") as output:
            owned_file = True
            while chunk := file.file.read(64 * 1024):
                size += len(chunk)
                if size > limit:
                    raise _error(422, "image_too_large", "图片超过字节限制")
                output.write(chunk)
        mime = _image_type(destination, file.content_type)
        _ensure_editor(db, actor)
        asset = Asset(storage_key=storage_key, mime=mime, bytes=size, created_by=actor.id)
        db.add(asset)
        db.flush()
        ident = str(asset.id)
        db.commit()
        owned_file = False
        return {"id": ident, "url": f"/api/admin/media/{ident}"}
    except (OSError, SQLAlchemyError) as exc:
        db.rollback()
        raise _error(503, "storage_unavailable", "素材暂时无法保存") from exc
    finally:
        if owned_file:
            destination.unlink(missing_ok=True)


def _referenced(db: Db, ident: int) -> bool:
    if db.scalar(select(exists().where(ReleaseAsset.asset_id == ident))):
        return True
    match = func.json_search(Draft.body, "one", str(ident), None, *ASSET_PATHS).is_not(None)
    return bool(db.scalar(select(exists().where(match))))


def _reference_body(db: Db, item_id: str, revision: str | None, seq: int | None) -> dict | None:
    target = db.get(ContentItem, parse_id(item_id, "item_id"))
    if target is None or (revision is None) == (seq is None):
        return None
    if revision is not None:
        draft = db.get(Draft, target.id)
        if draft is not None and target.revision == parse_id(revision, "revision", zero=True):
            return draft.body
        return None
    version = db.scalar(select(Release).where(Release.item_id == target.id, Release.seq == seq))
    return version.body if version is not None else None


@router.get("/media/{id}")
def private_media(id: ItemId, db: Db, actor: Editor, item_id: str | None = None,
                  revision: str | None = None, seq: int | None = None) -> FileResponse:
    """Read an unassociated upload as its uploader, or prove the specified draft/version reference."""
    asset = db.get(Asset, id)
    if asset is None:
        raise _error(404, "media_not_found", "素材不存在")
    if item_id is None:
        allowed = revision is None and seq is None and actor.id == asset.created_by and not _referenced(db, id)
    else:
        allowed = str(id) in asset_ids(_reference_body(db, item_id, revision, seq))
    if not allowed:
        raise _error(404, "media_not_found", "素材不存在")
    return asset_response(asset)
