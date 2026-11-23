"""Merge explicitly selected positions into product drafts, one transaction per identity."""
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.core.ids import parse_id
from app.models import Account
from app.repositories import items
from app.schemas.common import Choice
from app.services.auth import ensure_editor
from app.services.directory import active_directory
from app.services.items import item_view, save_draft


def _append_one(db: Session, actor_id: int, choice: Choice, requested: set[str]) -> tuple[str, str]:
    # This transaction needs its own attached actor and the same actor-before-item lock order as save.
    actor = items.get_editing_account(db, actor_id)
    if actor is None:
        raise AppError(403, "forbidden", "当前账号无编辑权")
    ensure_editor(db, actor)
    item = items.lock_item(db, parse_id(choice.id, "id"))
    if item is None or item.kind != "product" or item.archived_at is not None:
        raise AppError(422, "invalid_product", "仅可为当前产品追加位置")
    if item.revision != parse_id(choice.expected_revision, "expected_revision", zero=True):
        raise AppError(409, "draft_conflict", "草稿已变化，请重新核对")
    if not requested <= active_directory(db).keys():
        raise AppError(422, "invalid_position", "有位置不在当前有效目录中")

    view = item_view(db, item)
    previous = set(view["place_ids"])
    if requested <= previous:
        return "unchanged", view["revision"]
    draft = view["draft"] if view["draft"] is not None else (view["live"] or {})
    updated = save_draft(db, item.id, choice.expected_revision, draft, sorted(previous | requested), actor)
    return "changed", updated["revision"]


def _append_result(db: Session, actor: Account, choice: Choice, requested: set[str]) -> dict:
    try:
        # A bad or stale selection rolls back just this member; do not carry locks to the next one.
        with Session(db.get_bind()) as item_db, item_db.begin():
            status, revision = _append_one(item_db, actor.id, choice, requested)
        return {"id": choice.id, "status": status, "revision": revision, "issues": []}
    except AppError as exc:
        if exc.status_code not in {409, 422}:
            raise
        issues = exc.detail.get("issues") or [{
            "field": "node_ids" if exc.detail["code"] == "invalid_position" else "id",
            "reason": exc.detail["message"],
        }]
        return {"id": choice.id, "status": "conflict" if exc.status_code == 409 else "invalid",
                "revision": choice.expected_revision, "issues": issues}


def batch_append(db: Session, actor: Account, choices: list[Choice], node_ids: list[str]) -> dict:
    """Validate shared node IDs upfront, then report one outcome for the first choice of each product."""
    requested = set()
    for value in node_ids:
        parse_id(value, "node_ids")
        requested.add(value)
    seen = set()
    result = []
    for choice in choices:
        if choice.id not in seen:
            seen.add(choice.id)
            result.append(_append_result(db, actor, choice, requested))
    return {"items": result}
