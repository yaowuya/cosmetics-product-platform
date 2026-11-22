"""Confirm lifecycle transitions without modifying a product's related cases."""
from datetime import UTC, datetime

from fastapi import APIRouter, Response
from pydantic import BaseModel, ConfigDict, Field, StrictBool
from sqlalchemy import exists, select
from sqlalchemy.orm import Session

from app.auth import Db, _error
from app.checks import Publisher
from app.items import Editor, ItemId, _ensure_editor, item_view, parse_id
from app.models import Account, Audit, ContentItem, Draft, Release
from app.publish import _publisher_now

router = APIRouter(prefix="/api/admin")


class ConfirmDraft(BaseModel):
    """Bind a destructive operation to an explicit confirmation and current revision."""

    model_config = ConfigDict(extra="forbid")
    expected_revision: str
    confirmed: StrictBool


class ConfirmLifecycle(ConfirmDraft):
    """Accept the exact list of associated cases that was shown for review."""

    case_ids: list[str] = Field(default_factory=list)


def _cases(db: Session, item: ContentItem, *, lock: bool = False) -> list[dict]:
    if item.kind != "product":
        return []
    query = select(ContentItem.id, Draft.body, Release.body).outerjoin(Draft, Draft.item_id == ContentItem.id).outerjoin(
        Release, Release.id == ContentItem.live_id).where(ContentItem.kind == "case").order_by(ContentItem.id)
    if lock:
        # Read current references under row locks while making the confirmed transition.
        query = query.with_for_update()
    result = []
    for ident, draft, live in db.execute(query):
        linked = next((body for body in (draft, live) if body and body.get("related_product_id") == str(item.id)), None)
        if linked is not None:
            result.append({"id": str(ident), "brand_name": linked.get("brand_name"), "product_name": linked.get("product_name")})
    return result


def _target(db: Session, id: int, data: ConfirmDraft) -> ContentItem:
    item = db.scalar(select(ContentItem).where(ContentItem.id == id).with_for_update().execution_options(populate_existing=True))
    if item is None:
        raise _error(404, "item_not_found", "内容不存在")
    if not data.confirmed or item.archived_at is not None or item.revision != parse_id(data.expected_revision, "expected_revision", zero=True):
        raise _error(409, "lifecycle_conflict", "确认信息已变化，请重新核对")
    return item


def _seen_release(db: Session, id: int) -> bool:
    return bool(db.scalar(select(exists().where(Release.item_id == id))))


@router.get("/items/{id}/impact")
def impact(id: ItemId, db: Db, _actor: Publisher) -> dict:
    """List current draft or visible references; cases are never changed by this request."""
    item = db.get(ContentItem, id)
    if item is None:
        raise _error(404, "item_not_found", "内容不存在")
    cases = _cases(db, item)
    return {"case_ids": [case["id"] for case in cases], "cases": cases}


def _transition(id: int, data: ConfirmLifecycle, db: Db, actor: Account, mode: str) -> dict:
    with db.get_bind().connect().execution_options(isolation_level="READ COMMITTED") as conn, Session(conn) as write, write.begin():
        _publisher_now(write, actor.id)
        item = _target(write, id, data)
        current = {row["id"] for row in _cases(write, item, lock=True)}
        supplied = {str(parse_id(value, "case_ids")) for value in data.case_ids}
        if current != supplied:
            raise _error(409, "case_impact_conflict", "关联案例已变化，请重新核对")
        previous = item.live_id
        if mode == "unlist":
            if previous is None:
                raise _error(409, "not_live", "没有可下架的线上版本")
            item.live_id = None
        elif item.kind not in {"product", "case"} or previous is not None or not _seen_release(write, id):
            raise _error(409, "not_archivable", "仅已下架且有历史的产品或案例可归档")
        else:
            item.archived_at = datetime.now(UTC).replace(tzinfo=None)
        item.revision += 1
        write.add(Audit(actor_id=actor.id, action=mode, target_kind=item.kind, target_id=id,
                        details={"previous_live_id": str(previous) if previous else None, "case_ids": sorted(current)}))
        return item_view(write, item)


@router.post("/items/{id}/unlist")
def unlist(id: ItemId, data: ConfirmLifecycle, db: Db, actor: Publisher) -> dict:
    """Remove the current live pointer without touching drafts or related cases."""
    return _transition(id, data, db, actor, "unlist")


@router.post("/items/{id}/archive")
def archive(id: ItemId, data: ConfirmLifecycle, db: Db, actor: Publisher) -> dict:
    """Archive only an offline item that has a release history; retain its identity."""
    return _transition(id, data, db, actor, "archive")


@router.delete("/items/{id}/draft", status_code=204, response_class=Response)
def delete_first_draft(id: ItemId, data: ConfirmDraft, db: Db, actor: Editor) -> Response:
    """Delete only a never-released product or case and preserve its deletion audit."""
    _ensure_editor(db, actor)
    item = _target(db, id, data)
    draft = db.get(Draft, id)
    if item.kind not in {"product", "case"} or item.live_id is not None or _seen_release(db, id) or draft is None:
        raise _error(409, "draft_not_deletable", "仅从未发布的产品或案例草稿可删除")
    label = draft.body.get("name") or draft.body.get("product_name")
    db.add(Audit(actor_id=actor.id, action="delete_draft", target_kind=item.kind, target_id=id,
                 details={"label": label, "revision": str(item.revision)}))
    db.delete(item)
    db.commit()
    return Response(status_code=204)
