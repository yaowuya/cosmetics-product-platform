"""Admin content reads and revision-checked draft writes; saving never moves the live pointer."""
from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.core.ids import invalid, parse_id
from app.models import Account, ContentItem, Release
from app.repositories import directory, items
from app.schemas.content import shape_body
from app.services.auth import ensure_editor
from app.services.directory import validate_draft_tree


def normalize_body(kind: str, config_slot: str | None, body: dict) -> dict:
    """Normalize partial fields and enforce tree and filter identities without requiring a complete release."""
    clean = shape_body(kind, config_slot, body)
    if config_slot == "directory":
        validate_draft_tree(clean.get("nodes", []))
    elif config_slot == "case_header":
        rows = clean.get("filters", [])
        keys = {row.get("key") for row in rows}
        if None in keys or len(keys) != len(rows):
            raise invalid("filters")
    return clean


def _require_item(item: ContentItem | None) -> ContentItem:
    if item is None:
        raise AppError(404, "item_not_found", "内容不存在")
    return item


def item_view(db: Session, item: ContentItem) -> dict:
    """Return draft and live as separate views; the public projection never uses this."""
    draft = items.get_draft(db, item.id)
    live = items.get_release(db, item.live_id) if item.live_id is not None else None
    if draft is not None:
        positions = items.draft_place_ids(db, item.id)
    elif live is not None:
        positions = items.release_place_ids(db, live.id)
    else:
        positions = []
    return {
        "id": str(item.id), "kind": item.kind, "config_slot": item.config_slot,
        "revision": str(item.revision), "live_id": str(item.live_id) if live is not None else None,
        "draft": draft.body if draft is not None else None, "live": live.body if live is not None else None,
        "place_ids": [str(ident) for ident in positions],
        "archived_at": item.archived_at.isoformat() + "Z" if item.archived_at else None,
        "has_history": items.has_history(db, item.id),
    }


def read_item(db: Session, item_id: int) -> dict:
    """Read a known identity in any lifecycle state, or report item_not_found."""
    return item_view(db, _require_item(items.get_item(db, item_id)))


def fixed_config(db: Session, slot: str) -> dict:
    """Resolve a fixed slot literally even when the database compares slot keys case-insensitively."""
    item = items.find_config(db, slot)
    if item is None or item.config_slot != slot:
        raise AppError(404, "config_not_found", "配置位置不存在")
    return item_view(db, item)


def _require_reserved_nodes(db: Session, node_ids: set[int], field: str) -> None:
    if node_ids and directory.existing_node_ids(db, node_ids) != node_ids:
        raise invalid(field)


def _validate_references(db: Session, item: ContentItem, body: dict, place_ids: list[str]) -> set[int]:
    # Drafts need reserved identities; publication and batch append separately require an active path.
    if item.config_slot == "directory":
        _require_reserved_nodes(db, {int(node["id"]) for node in body.get("nodes", [])}, "nodes")
    places = {parse_id(value, "place_ids") for value in place_ids}
    if places and item.kind != "product":
        raise invalid("place_ids")
    _require_reserved_nodes(db, places, "place_ids")
    linked = body.get("related_product_id")
    if linked is not None and not items.product_exists(db, int(linked)):
        raise invalid("related_product_id")
    return places


def save_draft(db: Session, id: int, expected_revision: str, body: dict, place_ids: list[str], actor: Account) -> dict:
    """Flush a partial draft in the caller's transaction; a repeated identical save keeps its revision."""
    # Match publication's actor-before-item lock order, including when called from another edit.
    ensure_editor(db, actor)
    item = _require_item(items.lock_item(db, id))
    if item.archived_at is not None or item.revision != parse_id(expected_revision, "expected_revision", zero=True):
        raise AppError(409, "draft_conflict", "草稿已变化或条目已归档，请重新核对")

    normalized = normalize_body(item.kind, item.config_slot, body)
    places = _validate_references(db, item, normalized, place_ids)
    draft = items.get_draft(db, id)
    before = set(items.draft_place_ids(db, id))
    if draft is None or draft.body != normalized or before != places:
        items.write_draft(db, item, draft, normalized, actor.id, before, places)
    return item_view(db, item)


def new_item(db: Session, kind: str, body: dict, place_ids: list[str], actor: Account) -> dict:
    """Create the identity and its first draft atomically after rechecking the editor."""
    ensure_editor(db, actor)
    item = items.create_item(db, kind)
    view = save_draft(db, item.id, "0", body, place_ids, actor)
    db.commit()
    return view


def update_draft(db: Session, item_id: int, expected_revision: str, body: dict, place_ids: list[str],
                 actor: Account) -> dict:
    """Commit a standalone save; callers with a larger transaction use save_draft instead."""
    view = save_draft(db, item_id, expected_revision, body, place_ids, actor)
    db.commit()
    return view


def _list_entry(db: Session, item: ContentItem, display_release: Release | None, names: tuple[str, str]) -> dict:
    view = item_view(db, item)
    body = view["draft"] if view["draft"] is not None else (display_release.body if display_release else {})
    if view["draft"] is None and item.live_id is None and display_release is not None:
        # A withdrawn release identifies an offline item to staff; it must not become view["live"].
        view["place_ids"] = [str(ident) for ident in items.release_place_ids(db, display_release.id)]
    return {**view, "summary": {name: body.get(name) for name in names}}


def list_items(db: Session, kind: str, *, q: str | None, node_id: str | None, state: str | None,
               has_draft: bool | None, page: int, page_size: int) -> dict:
    """Page staff summaries, including a withdrawn item's last positions but never a fake live pointer."""
    names = ("name", "formula_no") if kind == "product" else ("brand_name", "product_name")
    node = parse_id(node_id, "node_id") if node_id is not None and kind == "product" else None
    total, rows = items.page_with_display_release(
        db, kind, state=state, has_draft=has_draft, node_id=node, search=q.strip() if q else None,
        names=names, page=page, page_size=page_size,
    )
    return {"items": [_list_entry(db, item, release, names) for item, release in rows],
            "total": total, "page": page, "page_size": page_size}
