"""Commit a single reviewed draft as an immutable, idempotent release."""
from fastapi import APIRouter
from pydantic import Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import Db, _error
from app.checks import CheckDraft, Publisher, inspect
from app.items import ItemId, parse_id
from app.media import asset_ids
from app.models import Account, Audit, ContentItem, Draft, Release, ReleaseAsset, ReleasePlace

router = APIRouter(prefix="/api/admin")


class PublishDraft(CheckDraft):
    """Idempotency is bound to one actor, item and source revision."""

    request_key: str = Field(pattern=r"^[A-Za-z0-9_-]{1,128}$")


def _publisher_now(db: Session, actor_id: int) -> Account:
    actor = db.scalar(select(Account).where(Account.id == actor_id).with_for_update())
    if actor is None or not actor.enabled or not actor.can_edit or not actor.can_publish or actor.must_change_password:
        raise _error(403, "forbidden", "当前没有发布权限")
    return actor


def _read_receipt(db: Session, actor_id: int, item_id: int, key: str, revision: str) -> dict | None:
    found = db.scalar(select(Audit).where(Audit.request_key == key).with_for_update())
    if found is None:
        return None
    if (found.actor_id != actor_id or found.action != "publish" or found.target_id != item_id
        or found.details.get("source_revision") != revision):
        raise _error(409, "request_conflict", "请求号不属于这次发布")
    return found.details["receipt"]


def _add_audit(db: Session, actor_id: int, item: ContentItem, source_revision: str, receipt: dict) -> None:
    db.add(Audit(actor_id=actor_id, action="publish", target_kind=item.kind, target_id=item.id,
                 request_key=receipt["request_key"], details={"source_revision": source_revision, "receipt": receipt}))


def _commit_one(db: Session, actor_id: int, id: int, data: PublishDraft) -> dict:
    _publisher_now(db, actor_id)
    # All publication paths lock directory/header positions before the target.
    # This serializes qualification against changes to the two shared lookup sets.
    slots = db.scalars(select(ContentItem).where(ContentItem.config_slot.in_(("directory", "case_header")))
                       .order_by(ContentItem.id).with_for_update()).all()
    item = next((slot for slot in slots if slot.id == id), None)
    if item is None:
        item = db.scalar(select(ContentItem).where(ContentItem.id == id).with_for_update())
    existing = _read_receipt(db, actor_id, id, data.request_key, data.expected_revision)
    if existing is not None:
        return existing
    if item is None:
        raise _error(404, "item_not_found", "内容不存在")
    source = parse_id(data.expected_revision, "expected_revision", zero=True)
    if item.revision != source or item.archived_at is not None:
        raise _error(409, "draft_conflict", "草稿已变化或条目已归档，请重新核对")
    check = inspect(db, item)
    if not check["eligible"]:
        error = _error(422, "cannot_publish", "草稿不满足发布条件")
        error.detail["issues"] = check["issues"]
        raise error
    draft = db.get(Draft, item.id)
    seq = (db.scalar(select(func.max(Release.seq)).where(Release.item_id == id)) or 0) + 1
    release = Release(item_id=id, seq=seq, source_revision=source, body=draft.body, actor_id=actor_id)
    db.add(release)
    db.flush()
    db.add_all(ReleasePlace(release_id=release.id, node_id=int(node)) for node in check["place_ids"])
    db.add_all(ReleaseAsset(release_id=release.id, asset_id=int(ident)) for ident in asset_ids(draft.body))
    item.live_id = release.id
    item.revision += 1
    db.delete(draft)
    receipt = {"id": str(id), "revision": str(item.revision), "release_id": str(release.id),
               "seq": seq, "request_key": data.request_key}
    _add_audit(db, actor_id, item, data.expected_revision, receipt)
    return receipt


@router.post("/items/{id}/publish")
def publish_one(id: ItemId, data: PublishDraft, db: Db, actor: Publisher) -> dict:
    """Return the original receipt on replay; never partially install a new version."""
    # A separate READ COMMITTED transaction avoids the request dependency's earlier snapshot.
    with db.get_bind().connect().execution_options(isolation_level="READ COMMITTED") as conn, Session(conn) as write:
        try:
            with write.begin():
                return _commit_one(write, actor.id, id, data)
        except IntegrityError as exc:
            if exc.orig.args[0] != 1062:
                raise
            with write.begin():
                _publisher_now(write, actor.id)
                replay = _read_receipt(write, actor.id, id, data.request_key, data.expected_revision)
                if replay is not None:
                    return replay
            raise _error(409, "draft_conflict", "此修订已被另一发布处理") from None
