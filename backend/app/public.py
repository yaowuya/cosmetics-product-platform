"""Anonymous read models built only from each item's current released snapshot."""
from typing import Annotated

from fastapi import APIRouter, Query, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.append import active_directory
from app.auth import Db, _error
from app.items import CONFIG_FIELDS, ItemId, parse_id
from app.models import ContentItem, Release, ReleasePlace

router = APIRouter(prefix="/api/public")
Page = Annotated[int, Query(ge=1)]
PageSize = Annotated[int, Query(ge=1, le=100)]
PRODUCT_CARD = ("name", "short_benefit", "thumbnail_asset_id")
PRODUCT_DETAIL = ("name", "benefit", "ingredients", "highlights", "formula_no", "production_status", "cover_asset_id", "detail_asset_id")
CASE_FIELDS = ("brand_name", "product_name", "highlight", "series", "description", "case_no", "category_key", "image_asset_id")


def only_query(request: Request, *allowed: str) -> None:
    """Reject preview parameters or any other unsupported attempt to switch input sources."""
    if set(request.query_params.keys()) - set(allowed):
        raise _error(422, "invalid_query", "公开入口不接受此查询参数")


def _project(body: dict, fields) -> dict:
    result = {}
    for key in fields:
        if key not in body:
            continue
        value = body[key]
        if key.endswith("_asset_id"):
            result[key[:-3] + "_url"] = f"/api/public/media/{value}"
        elif key.endswith("_asset_ids"):
            result[key[:-4] + "_urls"] = [f"/api/public/media/{ident}" for ident in value]
        elif isinstance(fields, dict) and isinstance(fields[key], list):
            result[key] = [_project(row, fields[key][0]) for row in value]
        else:
            result[key] = value
    return result


def _slot(db: Session, slot: str) -> dict | None:
    body = db.scalar(select(Release.body).join(ContentItem, ContentItem.live_id == Release.id)
                     .where(ContentItem.config_slot == slot, ContentItem.archived_at.is_(None)))
    return _project(body, CONFIG_FIELDS[slot]) if body is not None else None


def _descendants(nodes: dict[str, dict], target: str | None) -> set[str]:
    if target is None:
        return set(nodes)
    if target not in nodes:
        return set()
    selected = {target}
    # Only three approved tiers exist; iteration tolerates JSON order independent of hierarchy.
    for _ in range(2):
        selected |= {ident for ident, node in nodes.items() if node.get("parent_id") in selected}
    return selected


def _board(nodes: dict[str, dict], ident: str | None) -> set[str]:
    if ident is not None and nodes.get(ident, {}).get("level") != "board":
        return set()
    return _descendants(nodes, ident)


def _products(db: Session, eligible: set[str], id: int | None = None) -> dict[int, tuple[dict, set[str]]]:
    if not eligible:
        return {}
    query = select(ContentItem.id, Release.body, ReleasePlace.node_id).join(Release, ContentItem.live_id == Release.id).join(
        ReleasePlace, ReleasePlace.release_id == Release.id).where(ContentItem.kind == "product", ContentItem.archived_at.is_(None),
                                                                   ReleasePlace.node_id.in_({int(i) for i in eligible}))
    if id is not None:
        query = query.where(ContentItem.id == id)
    rows: dict[int, tuple[dict, set[str]]] = {}
    for ident, body, position in db.execute(query.order_by(ContentItem.id)):
        rows.setdefault(ident, (body, set()))[1].add(str(position))
    return rows


def _page(rows: list[dict], page: int, size: int) -> dict:
    start = (page - 1) * size
    return {"items": rows[start:start + size], "total": len(rows), "page": page, "page_size": size}


@router.get("/pages/{page}")
def pages(page: str, request: Request, db: Db) -> dict:
    """Render each of the four fixed positions independently from its current release."""
    only_query(request)
    if page == "contact":
        body = {name: _slot(db, name) for name in ("services", "business_contact")}
    else:
        slot = {"home": "home_posters", "catalog": "catalog_cover", "cases": "case_header"}.get(page)
        if slot is None:
            raise _error(404, "not_found", "页面不存在")
        body = _slot(db, slot) or {}
    return {"page": page, "body": body}


@router.get("/catalog")
def catalog(request: Request, db: Db, board_id: str | None = None) -> dict:
    """Return the active tree and deduplicated subtree counts independent of fine filtering."""
    only_query(request, "board_id")
    if board_id is not None:
        parse_id(board_id, "board_id")
    nodes = active_directory(db)
    scoped = _board(nodes, board_id)
    items = _products(db, scoped)
    counts = {ident: set() for ident in scoped}
    for product, (_, positions) in items.items():
        for position in positions:
            # Mirror placement to each visible ancestor, but count an item only once per node.
            while position in scoped:
                counts[position].add(product)
                position = nodes[position].get("parent_id")
    rows = []
    for ident in sorted(scoped, key=lambda n: (nodes[n].get("sort_order", 0), int(n))):
        node = nodes[ident]
        icon = node.get("icon_asset_id")
        rows.append({"id": ident, "parent_id": node.get("parent_id"), "level": node["level"], "name": node.get("name"),
                     "sort_order": node.get("sort_order", 0), "icon_url": f"/api/public/media/{icon}" if icon else None})
    return {"nodes": rows, "counts": {key: len(value) for key, value in counts.items()}}


@router.get("/products")
def products(request: Request, db: Db, board_id: str | None = None, node_id: str | None = None,
             q: Annotated[str | None, Query(max_length=250)] = None, page: Page = 1, page_size: PageSize = 20) -> dict:
    """Search visible products only in the requested board and optional node subtree."""
    only_query(request, "board_id", "node_id", "q", "page", "page_size")
    for field, value in (("board_id", board_id), ("node_id", node_id)):
        if value is not None:
            parse_id(value, field)
    nodes = active_directory(db)
    scope = _board(nodes, board_id) & _descendants(nodes, node_id)
    keyword = (q or "").strip().casefold()
    rows = []
    for ident, (body, positions) in _products(db, scope).items():
        if keyword:
            names = [body.get(key, "") for key in ("name", "english_name", "formula_no")]
            for position in positions:
                while position in nodes:
                    names.append(nodes[position].get("name", ""))
                    position = nodes[position].get("parent_id")
            if not any(keyword in str(value).casefold() for value in names):
                continue
        rows.append({"id": str(ident), "body": _project(body, PRODUCT_CARD)})
    return _page(rows, page, page_size)


@router.get("/products/{id}")
def product(id: ItemId, request: Request, db: Db) -> dict:
    """Expose detail only when at least one valid directory path is still public."""
    only_query(request)
    entry = _products(db, set(active_directory(db)), id).get(id)
    if entry is None:
        raise _error(404, "not_found", "内容不存在")
    return {"id": str(id), "body": _project(entry[0], PRODUCT_DETAIL)}


def _cases(db: Session, id: int | None = None):
    source = select(ContentItem.id, Release.body).join(Release, ContentItem.live_id == Release.id).where(
        ContentItem.kind == "case", ContentItem.archived_at.is_(None))
    return db.execute(source.where(ContentItem.id == id) if id is not None else source).all()


@router.get("/cases")
def cases(request: Request, db: Db, tag: Annotated[str | None, Query(max_length=80)] = None,
          q: Annotated[str | None, Query(max_length=250)] = None, page: Page = 1, page_size: PageSize = 20) -> dict:
    """Read independently published client cases with stable sorting and optional search."""
    only_query(request, "tag", "q", "page", "page_size")
    keyword = (q or "").strip().casefold()
    rows = []
    for ident, body in sorted(_cases(db), key=lambda row: (row.body.get("sort_order", 0), row.id)):
        if tag is not None and tag != body.get("category_key"):
            continue
        if keyword and not any(keyword in body.get(key, "").casefold() for key in ("brand_name", "product_name", "highlight", "description")):
            continue
        rows.append({"id": str(ident), "body": _project(body, CASE_FIELDS)})
    return _page(rows, page, page_size)


@router.get("/cases/{id}")
def case_detail(id: ItemId, request: Request, db: Db) -> dict:
    """Return the released independent case, omitting its private product association."""
    only_query(request)
    rows = _cases(db, id)
    if not rows:
        raise _error(404, "not_found", "内容不存在")
    return {"id": str(id), "body": _project(rows[0].body, CASE_FIELDS)}
