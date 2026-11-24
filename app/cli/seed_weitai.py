"""Publish the fixed Weitai catalog, case filters and contact copy. Does not grant permissions."""
import os
import sys
from pathlib import Path
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.cli.weitai_content import (
    CASE_HEADER, CONTACT, PUBLISH_SLOTS, catalog_cover_body, directory_body, slot_action,
)
from app.core.errors import AppError
from app.models import Account
from app.repositories import directory, items, media, releases
from app.repositories.accounts import lock_accounts
from app.services.checks import review_snapshot
from app.services.items import normalize_body
from app.services.media import _image_type, asset_ids


def main() -> None:
    """Initialize unpublished slots. A slot that already has a live release is left unchanged."""
    _configure_stdio()
    project_root = Path(__file__).resolve().parents[2]
    try:
        _load_local_database(project_root)
        asset_root = _asset_root(project_root)
        lines = apply(asset_root)
    except (AppError, OSError, RuntimeError) as exc:
        raise SystemExit(f"{exc}\n") from None
    print("\n".join(lines))


def apply(asset_root: Path) -> list[str]:
    """Validate and publish in one transaction. A failed attempt installs nothing."""
    from app.core.db import engine

    owned: list[Path] = []
    try:
        with Session(engine()) as db, db.begin():
            actor = db.scalar(select(Account).order_by(Account.id).limit(1))
            if actor is None:
                raise RuntimeError("还没有管理员。请先执行 make bootstrap LOGIN=登录名")
            lock_accounts(db, actor.id)
            lines = [_publish(db, actor.id, asset_root, owned, slot) for slot in PUBLISH_SLOTS]
        owned.clear()
        return lines
    finally:
        for path in owned:
            path.unlink(missing_ok=True)


def _publish(db: Session, actor_id: int, asset_root: Path, owned: list[Path], slot: str) -> str:
    item = _config_item(db, slot)
    if slot_action(slot, live=item.live_id is not None, has_draft=False,
                   archived=item.archived_at is not None) == "skip":
        return f"{slot}: skipped"
    body = _publish_body(db, actor_id, asset_root, owned, slot)
    _write(db, item, actor_id, body)
    snapshot, check = review_snapshot(db, item)
    if not check["eligible"]:
        raise RuntimeError(f"{slot} 不满足发布条件: {check['issues']}")
    assert snapshot is not None
    draft = items.get_draft(db, item.id)
    source = item.revision
    release = releases.install_snapshot(
        db, item, draft, actor_id, source, check["place_ids"], asset_ids(snapshot), body=snapshot,
    )
    request_key = f"seed-weitai-{slot}-{uuid4().hex}"
    receipt = {"id": str(item.id), "revision": str(item.revision), "release_id": str(release.id),
               "seq": release.seq, "request_key": request_key}
    releases.add_publish_audit(db, actor_id, item, str(source), receipt)
    return f"{slot}: published"


def _config_item(db: Session, slot: str):
    item = items.find_config(db, slot)
    if item is None:
        item = items.create_item(db, "config")
        item.config_slot = slot
        db.flush()
    return items.lock_item(db, item.id)


def _publish_body(db: Session, actor_id: int, asset_root: Path, owned: list[Path], slot: str) -> dict:
    if slot == "catalog_cover":
        return normalize_body("config", slot, catalog_cover_body(_store_cover(db, actor_id, asset_root, owned)))
    if slot == "directory":
        return normalize_body("config", slot, directory_body(lambda: str(directory.allocate_node_id(db))))
    if slot == "case_header":
        return normalize_body("config", slot, CASE_HEADER)
    return normalize_body("config", slot, CONTACT)


def _write(db: Session, item, actor_id: int, body: dict) -> None:
    draft = items.get_draft(db, item.id)
    items.write_draft(db, item, draft, body, actor_id, set(items.draft_place_ids(db, item.id)), set())


def _store_cover(db: Session, actor_id: int, asset_root: Path, owned: list[Path]) -> str:
    source = Path(__file__).parent / "assets" / "cover.webp"
    if not source.is_file():
        raise RuntimeError("缺少随程序携带的产品目录封面")
    destination = asset_root / uuid4().hex
    destination.write_bytes(source.read_bytes())
    owned.append(destination)
    mime = _image_type(destination, "image/webp")
    asset = media.add_asset(db, destination.name, mime, destination.stat().st_size, actor_id)
    db.flush()
    return str(asset.id)


def _load_local_database(project_root: Path) -> None:
    if os.environ.get("DATABASE_URL", "").strip():
        return
    path = project_root / ".local" / "showcase" / "database.url"
    try:
        url = path.read_text(encoding="utf-8-sig").strip()
    except (OSError, UnicodeError):
        url = ""
    if not url:
        raise RuntimeError("DATABASE_URL is unset and .local/showcase/database.url cannot be read")
    os.environ["DATABASE_URL"] = url


def _asset_root(project_root: Path) -> Path:
    configured = os.environ.get("ASSET_ROOT", "").strip()
    root = Path(configured) if configured else project_root / ".local" / "showcase" / "media"
    if not configured:
        os.environ["ASSET_ROOT"] = str(root)
    root.mkdir(parents=True, exist_ok=True)
    return root


def _configure_stdio() -> None:
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if reconfigure is not None:
            try:
                reconfigure(encoding="utf-8")
            except (OSError, ValueError):
                pass


if __name__ == "__main__":
    main()
