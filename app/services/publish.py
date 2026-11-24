"""Install an immutable release and its original-key receipt in one transaction."""
from typing import cast

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.core.ids import parse_id
from app.models import Draft
from app.repositories import releases
from app.repositories.items import get_draft
from app.schemas.releases import PublishDraft
from app.services.auth import publisher_now
from app.services.checks import review_snapshot
from app.services.media import asset_ids


def _read_receipt(db: Session, actor_id: int, item_id: int, data: PublishDraft) -> dict | None:
    event = releases.lock_publish_audit(db, data.request_key)
    if event is None:
        return None
    if (event.actor_id != actor_id or event.action != "publish" or event.target_id != item_id
            or event.details.get("source_revision") != data.expected_revision):
        raise AppError(409, "request_conflict", "请求号不属于这次发布")
    return event.details["receipt"]


def _commit_one(db: Session, actor_id: int, item_id: int, data: PublishDraft) -> dict:
    # Lock the actor, shared directory/header, target, then request key. Even a replay
    # must still have publishing rights, but must not require the now-consumed draft.
    publisher_now(db, actor_id)
    item = releases.lock_publish_target(db, item_id)
    existing = _read_receipt(db, actor_id, item_id, data)
    if existing is not None:
        return existing
    if item is None:
        raise AppError(404, "item_not_found", "内容不存在")
    source = parse_id(data.expected_revision, "expected_revision", zero=True)
    if item.revision != source or item.archived_at is not None:
        raise AppError(409, "draft_conflict", "草稿已变化或条目已归档，请重新核对")
    snapshot, check = review_snapshot(db, item)
    if not check["eligible"]:
        raise AppError(422, "cannot_publish", "草稿不满足发布条件", check["issues"])

    # Eligibility required a draft, and every draft writer takes the same target lock.
    assert snapshot is not None
    draft = cast(Draft, get_draft(db, item_id))
    release = releases.install_snapshot(db, item, draft, actor_id, source, check["place_ids"],
                                        asset_ids(snapshot), body=snapshot)
    receipt = {"id": str(item_id), "revision": str(item.revision), "release_id": str(release.id),
               "seq": release.seq, "request_key": data.request_key}
    releases.add_publish_audit(db, actor_id, item, data.expected_revision, receipt)
    return receipt


def publish_one(db: Session, actor_id: int, item_id: int, data: PublishDraft) -> dict:
    """Commit a qualified revision or replay its receipt; a failed attempt installs nothing."""
    with releases.read_committed_session(db) as write:
        try:
            with write.begin():
                return _commit_one(write, actor_id, item_id, data)
        except IntegrityError as exc:
            if exc.orig.args[0] != 1062:  # Only MySQL duplicate keys can represent another winner.
                raise
            # The failed transaction has rolled back; do not replay under its prior permissions.
            with write.begin():
                publisher_now(write, actor_id)
                replay = _read_receipt(write, actor_id, item_id, data)
                if replay is not None:
                    return replay
            raise AppError(409, "draft_conflict", "此修订已被另一发布处理") from None
