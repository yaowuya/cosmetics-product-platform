"""Confirm impact and transition one item, never changing its related cases."""
from typing import Literal

from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.core.ids import parse_id
from app.models import Account, ContentItem
from app.repositories import lifecycle, releases
from app.repositories.items import get_draft, get_item, has_history, lock_item
from app.schemas.releases import ConfirmDraft, ConfirmLifecycle
from app.services.auth import ensure_editor, publisher_now
from app.services.items import item_view


def _related_cases(db: Session, item: ContentItem, *, lock: bool = False) -> list[dict]:
    if item.kind != "product":
        return []
    result = []
    for ident, draft, live in lifecycle.case_sources(db, lock=lock):
        # A draft pointing elsewhere does not hide a live reference. When both point
        # here, show the draft's labels so the publisher sees the current edit.
        linked = next((body for body in (draft, live) if body and body.get("related_product_id") == str(item.id)), None)
        if linked is not None:
            result.append({"id": str(ident), "brand_name": linked.get("brand_name"), "product_name": linked.get("product_name")})
    return result


def impact(db: Session, item_id: int) -> dict:
    """Show all current draft or live case references without locking or changing them."""
    item = get_item(db, item_id)
    if item is None:
        raise AppError(404, "item_not_found", "内容不存在")
    cases = _related_cases(db, item)
    return {"case_ids": [case["id"] for case in cases], "cases": cases}


def _confirmed_target(db: Session, item_id: int, data: ConfirmDraft) -> ContentItem:
    item = lock_item(db, item_id)
    if item is None:
        raise AppError(404, "item_not_found", "内容不存在")
    if (not data.confirmed or item.archived_at is not None
            or item.revision != parse_id(data.expected_revision, "expected_revision", zero=True)):
        raise AppError(409, "lifecycle_conflict", "确认信息已变化，请重新核对")
    return item


def _confirmed_cases(db: Session, item: ContentItem, case_ids: list[str]) -> set[str]:
    current = {row["id"] for row in _related_cases(db, item, lock=True)}
    supplied = {str(parse_id(value, "case_ids")) for value in case_ids}
    if current != supplied:
        raise AppError(409, "case_impact_conflict", "关联案例已变化，请重新核对")
    return current


def _apply_transition(db: Session, item: ContentItem, action: Literal["unlist", "archive"]) -> None:
    if action == "unlist":
        if item.live_id is None:
            raise AppError(409, "not_live", "没有可下架的线上版本")
        lifecycle.clear_live_pointer(item)
        return
    if item.kind not in {"product", "case"} or item.live_id is not None or not has_history(db, item.id):
        raise AppError(409, "not_archivable", "仅已下架且有历史的产品或案例可归档")
    lifecycle.mark_archived(item)


def transition(db: Session, item_id: int, data: ConfirmLifecycle, actor_id: int, *,
               action: Literal["unlist", "archive"]) -> dict:
    """Recheck publisher, target and reviewed impact, then commit the transition and audit together."""
    # The request's auth snapshot predates confirmation. Lock actor -> target -> cases on a fresh connection.
    with releases.read_committed_session(db) as write, write.begin():
        publisher_now(write, actor_id)
        item = _confirmed_target(write, item_id, data)
        current = _confirmed_cases(write, item, data.case_ids)
        previous = item.live_id
        _apply_transition(write, item, action)
        releases.add_item_audit(write, actor_id, item, action,
                                {"previous_live_id": str(previous) if previous else None, "case_ids": sorted(current)})
        return item_view(write, item)


def delete_first_draft(db: Session, item_id: int, data: ConfirmDraft, actor: Account) -> None:
    """Delete a confirmed never-published draft as its editor; retain the identifying audit."""
    ensure_editor(db, actor)
    item = _confirmed_target(db, item_id, data)
    draft = get_draft(db, item_id)
    if (item.kind not in {"product", "case"} or item.live_id is not None
            or has_history(db, item_id) or draft is None):
        raise AppError(409, "draft_not_deletable", "仅从未发布的产品或案例草稿可删除")
    label = draft.body.get("name") or draft.body.get("product_name")
    lifecycle.delete_draft_item(db, item, actor.id, label)
    db.commit()
