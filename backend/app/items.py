"""Maintain stable product and case identities and editable drafts, never release from save."""
from datetime import UTC, datetime
import re
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Path, Query, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import case, delete, exists, func, or_, select
from sqlalchemy.orm import Session

from app.auth import Db, _error, require
from app.models import Account, ContentItem, DirectoryNode, Draft, DraftPlace, Release, ReleasePlace

router = APIRouter(prefix="/api/admin")
Editor = Annotated[Account, Depends(require("edit"))]
ItemId = Annotated[int, Path(ge=1, le=2**63 - 1)]

TEXT_FIELDS = {
    "product": {"name", "short_benefit", "benefit", "ingredients", "highlights", "formula_no", "english_name"},
    "case": {"brand_name", "product_name", "highlight", "series", "description", "case_no", "category_key"},
}
ID_FIELDS = {"product": {"thumbnail_asset_id", "cover_asset_id", "detail_asset_id"},
             "case": {"image_asset_id", "related_product_id"}}
PRODUCTION = {"已生产", "未生产", "待确认"}


class NewDraft(BaseModel):
    """A partial body and its stable display locations; location order lives in the directory."""

    model_config = ConfigDict(extra="forbid")
    body: dict[str, Any]
    place_ids: list[str] = Field(default_factory=list)


class DraftUpdate(NewDraft):
    """Require the revision the editor actually read."""

    expected_revision: str


def _invalid(field: str):
    error = _error(422, "invalid_body", "草稿字段无效")
    error.detail["issues"] = [{"field": field, "reason": "类型、格式或字段不符合此内容契约"}]
    return error


def parse_id(value: Any, field: str, *, zero: bool = False) -> int:
    """Parse decimal wire IDs without rounding or accepting values outside signed BIGINT."""
    if not isinstance(value, str) or re.fullmatch(r"0|[1-9][0-9]{0,18}", value) is None:
        raise _invalid(field)
    parsed = int(value)
    if parsed > 2**63 - 1 or (not zero and parsed == 0):
        raise _invalid(field)
    return parsed


CONFIG_FIELDS = {
    "home_posters": {"poster_asset_ids": "ids"},
    "catalog_cover": {"cover_asset_id": "id", "slogan_top": str, "slogan_bottom": str, "image_has_text": bool},
    "directory": {"nodes": [{"id": "id", "parent_id": "id", "level": str, "name": str,
                              "icon_asset_id": "id", "enabled": bool, "sort_order": int}]},
    "case_header": {"background_asset_id": "id", "title": str, "intro": str, "filters": [{"key": str, "label": str}]},
    "services": {"intro": str, "cards": [{"image_asset_id": "id", "title": str, "description": str}]},
    "business_contact": {"title": str, "intro": str, "qr_asset_id": "id", "wechat_id": str, "phone": str, "email": str},
}
LEVELS = ("board", "category", "subcategory")


def _shape_object(source: dict, fields: dict, path: str = "") -> dict:
    if not isinstance(source, dict):
        raise _invalid(path)
    clean = {}
    for key, value in source.items():
        field = f"{path}.{key}" if path else key
        if key not in fields:
            raise _invalid(field)
        if isinstance(value, str):
            value = value.strip()
        if value is None or value == "":
            continue
        rule = fields[key]
        if rule == "id":
            parse_id(value, field)
        elif rule == "ids":
            if not isinstance(value, list):
                raise _invalid(field)
            for index, ident in enumerate(value):
                parse_id(ident, f"{field}.{index}")
        elif isinstance(rule, list):
            if not isinstance(value, list):
                raise _invalid(field)
            value = [_shape_object(row, rule[0], f"{field}.{i}") for i, row in enumerate(value)]
        elif type(value) is not rule or (rule is int and value < 0):
            raise _invalid(field)
        clean[key] = value
    return clean


def _config_body(slot: str | None, body: dict) -> dict:
    if slot not in CONFIG_FIELDS:
        raise _invalid("config_slot")
    clean = _shape_object(body, CONFIG_FIELDS[slot])
    if slot == "directory":
        nodes = clean.get("nodes", [])
        by_id = {node.get("id"): node for node in nodes}
        if None in by_id or len(by_id) != len(nodes):
            raise _invalid("nodes")
        for index, node in enumerate(nodes):
            level = node.get("level")
            if level not in LEVELS:
                raise _invalid(f"nodes.{index}.level")
            depth = LEVELS.index(level)
            parent_id = node.get("parent_id")
            parent = by_id.get(parent_id)
            # Every edge reduces the tier toward a root, excluding cycles as well as orphan nodes.
            if ((depth == 0 and parent_id is not None)
                or (depth > 0 and (parent is None or parent.get("level") != LEVELS[depth - 1]))):
                raise _invalid(f"nodes.{index}.parent_id")
    if slot == "case_header":
        rows = clean.get("filters", [])
        keys = {row.get("key") for row in rows}
        if None in keys or len(keys) != len(rows):
            raise _invalid("filters")
    return clean


def normalize_body(kind: str, config_slot: str | None, body: dict) -> dict:
    """Normalize missing values, but reject invalid structure; completeness belongs to publish."""
    if kind == "config":
        return _config_body(config_slot, body)
    if kind not in TEXT_FIELDS or config_slot is not None:
        raise _invalid("kind")
    extra = {"production_status"} if kind == "product" else {"sort_order"}
    fields = TEXT_FIELDS[kind] | ID_FIELDS[kind] | extra
    cleaned = {}
    for field, value in body.items():
        if field not in fields:
            raise _invalid(field)
        if isinstance(value, str):
            value = value.strip()
        if value is None or value == "":
            continue
        if field in TEXT_FIELDS[kind] and not isinstance(value, str):
            raise _invalid(field)
        if field in ID_FIELDS[kind]:
            parse_id(value, field)
        if field == "production_status" and (not isinstance(value, str) or value not in PRODUCTION):
            raise _invalid(field)
        if field == "sort_order" and (type(value) is not int or value < 0):
            raise _invalid(field)
        cleaned[field] = value
    return cleaned


def item_view(db: Session, item: ContentItem) -> dict:
    """Return draft and live as separate views; the public projection never uses this."""
    draft = db.get(Draft, item.id)
    live = db.get(Release, item.live_id) if item.live_id is not None else None
    if draft is not None:
        positions = db.scalars(select(DraftPlace.node_id).where(DraftPlace.item_id == item.id).order_by(DraftPlace.node_id)).all()
    elif live is not None:
        positions = db.scalars(select(ReleasePlace.node_id).where(ReleasePlace.release_id == live.id).order_by(ReleasePlace.node_id)).all()
    else:
        positions = []
    return {"id": str(item.id), "kind": item.kind, "config_slot": item.config_slot,
            "revision": str(item.revision), "live_id": str(item.live_id) if live else None,
            "draft": draft.body if draft is not None else None, "live": live.body if live is not None else None,
            "place_ids": [str(i) for i in positions],
            "archived_at": item.archived_at.isoformat() + "Z" if item.archived_at else None,
            "has_history": bool(db.scalar(select(exists().where(Release.item_id == item.id))))}


def _ensure_editor(db: Session, actor: Account) -> None:
    # Match the lock order used by publication: actor before content.
    db.refresh(actor, with_for_update=True)
    if not actor.enabled or not actor.can_edit or actor.must_change_password:
        raise _error(403, "forbidden", "当前账号没有编辑权限")


def save_draft(db: Session, id: int, expected_revision: str, body: dict, place_ids: list[str], actor: Account) -> dict:
    """Persist a partial draft in the caller's transaction after checking its current revision."""
    _ensure_editor(db, actor)
    item = db.scalar(select(ContentItem).where(ContentItem.id == id).with_for_update().execution_options(populate_existing=True))
    if item is None:
        raise _error(404, "item_not_found", "内容不存在")
    if item.archived_at is not None or item.revision != parse_id(expected_revision, "expected_revision", zero=True):
        raise _error(409, "draft_conflict", "草稿已变化或条目已归档，请重新核对")
    normalized = normalize_body(item.kind, item.config_slot, body)
    if item.config_slot == "directory":
        node_ids = {int(node["id"]) for node in normalized.get("nodes", [])}
        if node_ids and set(db.scalars(select(DirectoryNode.id).where(DirectoryNode.id.in_(node_ids)))) != node_ids:
            raise _invalid("nodes")
    places = {parse_id(value, "place_ids") for value in place_ids}
    if places and item.kind != "product":
        raise _invalid("place_ids")
    if places and set(db.scalars(select(DirectoryNode.id).where(DirectoryNode.id.in_(places)))) != places:
        raise _invalid("place_ids")
    linked = normalized.get("related_product_id")
    if linked is not None and not db.scalar(select(exists().where(ContentItem.id == int(linked), ContentItem.kind == "product"))):
        raise _invalid("related_product_id")
    draft = db.get(Draft, id)
    before = set(db.scalars(select(DraftPlace.node_id).where(DraftPlace.item_id == id)))
    if draft is not None and draft.body == normalized and before == places:
        return item_view(db, item)
    if draft is None:
        draft = Draft(item_id=id, edited_by=actor.id, body=normalized)
        db.add(draft)
        db.flush()
    else:
        draft.body = normalized
        draft.edited_by = actor.id
        draft.edited_at = datetime.now(UTC).replace(tzinfo=None)
    if before - places:
        db.execute(delete(DraftPlace).where(DraftPlace.item_id == id, DraftPlace.node_id.in_(before - places)))
    db.add_all(DraftPlace(item_id=id, node_id=node) for node in places - before)
    item.revision += 1
    db.flush()
    return item_view(db, item)


@router.post("/products", status_code=201)
@router.post("/cases", status_code=201)
def new_item(request: Request, data: NewDraft, db: Db, actor: Editor) -> dict:
    """Create one independent draft and leave the publication pointer empty."""
    _ensure_editor(db, actor)
    item = ContentItem(kind="product" if request.url.path.endswith("/products") else "case")
    db.add(item)
    db.flush()
    view = save_draft(db, item.id, "0", data.body, data.place_ids, actor)
    db.commit()
    return view


@router.get("/items/{id}")
def get_item(id: ItemId, db: Db, _actor: Editor) -> dict:
    """Read one known item and its separate draft and release."""
    item = db.get(ContentItem, id)
    if item is None:
        raise _error(404, "item_not_found", "内容不存在")
    return item_view(db, item)


@router.put("/items/{id}/draft")
def update_draft(id: ItemId, data: DraftUpdate, db: Db, actor: Editor) -> dict:
    """Save only if the editor's revision is still current."""
    view = save_draft(db, id, data.expected_revision, data.body, data.place_ids, actor)
    db.commit()
    return view


@router.get("/products")
@router.get("/cases")
def list_items(request: Request, db: Db, _actor: Editor,
               q: Annotated[str | None, Query(max_length=250)] = None,
               node_id: Annotated[str | None, Query()] = None,
               state: Literal["online", "offline", "archived"] | None = None, has_draft: bool | None = None,
               page: Annotated[int, Query(ge=1)] = 1, page_size: Annotated[int, Query(ge=1, le=100)] = 20) -> dict:
    """Filter a single row per identity, using EXISTS rather than joining each placement."""
    kind = "product" if request.url.path.endswith("/products") else "case"
    # An offline item's last release identifies it to staff; it is never returned as live content.
    last_release_id = (select(Release.id).where(Release.item_id == ContentItem.id)
                       .order_by(Release.seq.desc()).limit(1).correlate(ContentItem).scalar_subquery())
    display_release_id = func.coalesce(ContentItem.live_id, last_release_id)
    query = select(ContentItem, Release).outerjoin(Draft, Draft.item_id == ContentItem.id).outerjoin(
        Release, Release.id == display_release_id).where(ContentItem.kind == kind)
    query = query.where(ContentItem.archived_at.is_not(None) if state == "archived" else ContentItem.archived_at.is_(None))
    if state == "online":
        query = query.where(ContentItem.live_id.is_not(None))
    if state == "offline":
        query = query.where(ContentItem.live_id.is_(None))
    if has_draft is not None:
        query = query.where(Draft.item_id.is_not(None) if has_draft else Draft.item_id.is_(None))
    if node_id is not None and kind == "product":
        node = parse_id(node_id, "node_id")
        draft_place = exists().where(DraftPlace.item_id == ContentItem.id, DraftPlace.node_id == node)
        release_place = exists().where(ReleasePlace.release_id == Release.id, ReleasePlace.node_id == node)
        query = query.where(case((Draft.item_id.is_not(None), draft_place), else_=release_place))
    if q and q.strip():
        body = case((Draft.item_id.is_not(None), Draft.body), else_=Release.body)
        names = ("name", "formula_no") if kind == "product" else ("brand_name", "product_name")
        query = query.where(or_(*(func.json_unquote(func.json_extract(body, f"$.{name}")).contains(q.strip(), autoescape=True)
                                 for name in names)))
    total = db.scalar(select(func.count()).select_from(query.subquery()))
    rows = db.execute(query.order_by(ContentItem.id).offset((page - 1) * page_size).limit(page_size))
    items = []
    for row, display_release in rows:
        view = item_view(db, row)
        body = view["draft"] if view["draft"] is not None else (display_release.body if display_release else {})
        if view["draft"] is None and row.live_id is None and display_release is not None:
            positions = db.scalars(select(ReleasePlace.node_id).where(ReleasePlace.release_id == display_release.id)
                                   .order_by(ReleasePlace.node_id))
            view["place_ids"] = [str(ident) for ident in positions]
        names = ("name", "formula_no") if kind == "product" else ("brand_name", "product_name")
        items.append({**view, "summary": {name: body.get(name) for name in names}})
    return {"items": items, "total": total, "page": page, "page_size": page_size}
