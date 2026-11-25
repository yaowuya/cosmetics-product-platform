"""Build anonymous page, catalog and case projections from current releases only."""
from collections.abc import Iterator

from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.core.ids import parse_id
from app.repositories import public_catalog as releases
from app.schemas.content import CONFIG_FIELDS, catalog_image_id, catalog_thumbnail_source, effective_product_body
from app.services.directory import active_directory

PRODUCT_CARD = ("name", "short_benefit", "thumbnail_asset_id")
PRODUCT_DETAIL = ("name", "benefit", "ingredients", "highlights", "formula_no", "production_status",
                  "cover_asset_id", "detail_asset_id", "detail_asset_ids")
CASE_FIELDS = ("brand_name", "product_name", "highlight", "series", "description", "case_no",
               "category_key", "image_asset_id")


def _project(body: dict, fields: tuple[str, ...] | dict) -> dict:
    # Traverse the public schema, not the stored keys: private associations and
    # search-only fields must not leak, including in nested configuration rows.
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


def _product_card(body: dict) -> dict:
    """Use the independent square when set, or expose a generated-only card thumbnail."""
    result = _project(body, PRODUCT_CARD)
    if catalog_image_id(body) is None:
        result.pop("thumbnail_asset_url", None)
        if (source := catalog_thumbnail_source(body)) is not None:
            result["catalog_thumbnail_url"] = f"/api/public/media/{source}/catalog-thumbnail"
        return result
    square_url = result["thumbnail_asset_url"]
    result.update(catalog_image_url=square_url, cover_asset_url=square_url,
                  cover_thumbnail_url=f"{square_url}/thumbnail")
    return result


def _slot(db: Session, name: str) -> dict | None:
    body = releases.slot_body(db, name)
    return _project(body, CONFIG_FIELDS[name]) if body is not None else None


def page_content(db: Session, page: str) -> dict:
    """Read fixed page slots independently; the two contact sections may be unpublished."""
    if page == "contact":
        body = {"business_contact": _slot(db, "business_contact")}
    else:
        name = {"home": "home_posters", "catalog": "catalog_cover", "cases": "case_header"}.get(page)
        if name is None:
            raise AppError(404, "not_found", "页面不存在")
        body = _slot(db, name) or {}
    return {"page": page, "body": body}


def _validate_selection(board_id: str | None, node_id: str | None = None) -> None:
    for field, value in (("board_id", board_id), ("node_id", node_id)):
        if value is not None:
            parse_id(value, field)


def _descendants(nodes: dict[str, dict], target: str | None) -> set[str]:
    if target is None:
        return set(nodes)
    if target not in nodes:
        return set()
    selected = {target}
    # Exactly three tiers are supported; expansion must not depend on JSON array order.
    for _ in range(2):
        selected |= {ident for ident, node in nodes.items() if node.get("parent_id") in selected}
    return selected


def _board(nodes: dict[str, dict], ident: str | None) -> set[str]:
    if ident is not None and nodes.get(ident, {}).get("level") != "board":
        return set()
    return _descendants(nodes, ident)


def _lineage(nodes: dict[str, dict], position: str) -> Iterator[str]:
    while position in nodes:
        yield position
        position = nodes[position].get("parent_id")


def _counts(nodes: dict[str, dict], scoped: set[str], products: dict[int, tuple[dict, set[str]]]) -> dict[str, int]:
    # Multiple placements may share an ancestor. Count each product just once there.
    by_node = {ident: set() for ident in scoped}
    for item_id, (_, positions) in products.items():
        for position in positions:
            for ident in _lineage(nodes, position):
                if ident not in scoped:
                    break
                by_node[ident].add(item_id)
    return {key: len(value) for key, value in by_node.items()}


def _node_view(ident: str, node: dict) -> dict:
    icon = node.get("icon_asset_id")
    return {"id": ident, "parent_id": node.get("parent_id"), "level": node["level"], "name": node.get("name"),
            "sort_order": node.get("sort_order", 0), "icon_url": f"/api/public/media/{icon}" if icon else None}


def catalog_tree(db: Session, board_id: str | None) -> dict:
    """Show the selected active board and deduplicated product counts for its subtrees."""
    _validate_selection(board_id)
    nodes = active_directory(db)
    scoped = _board(nodes, board_id)
    products = releases.products_in_nodes(db, scoped)
    ordered = sorted(scoped, key=lambda ident: (nodes[ident].get("sort_order", 0), int(ident)))
    return {"nodes": [_node_view(ident, nodes[ident]) for ident in ordered],
            "counts": _counts(nodes, scoped, products)}


def _page(rows: list[dict], page: int, size: int) -> dict:
    start = (page - 1) * size
    return {"items": rows[start:start + size], "total": len(rows), "page": page, "page_size": size}


def _product_matches(keyword: str, body: dict, positions: set[str], nodes: dict[str, dict]) -> bool:
    if not keyword:
        return True
    names = [body.get(key, "") for key in ("name", "english_name", "formula_no")]
    names.extend(nodes[ident].get("name", "") for pos in positions for ident in _lineage(nodes, pos))
    return any(keyword in str(value).casefold() for value in names)


def list_products(db: Session, board_id: str | None, node_id: str | None, q: str | None,
                  page: int, page_size: int) -> dict:
    """Search eligible product snapshots and their visible location names before paging."""
    _validate_selection(board_id, node_id)
    nodes = active_directory(db)
    scope = _board(nodes, board_id) & _descendants(nodes, node_id)
    keyword = (q or "").strip().casefold()
    rows = [{"id": str(ident), "body": _product_card(body)}
            for ident, (body, positions) in releases.products_in_nodes(db, scope).items()
            if _product_matches(keyword, body, positions, nodes)]
    return _page(rows, page, page_size)


def product_detail(db: Session, item_id: int) -> dict:
    """Expose the wide cover and ordered long images for a product with an active placement."""
    entry = releases.products_in_nodes(db, set(active_directory(db)), item_id).get(item_id)
    if entry is None:
        raise AppError(404, "not_found", "内容不存在")
    result = _project(effective_product_body(entry[0]), PRODUCT_DETAIL)
    legacy = result.get("detail_asset_url")
    gallery = result.setdefault("detail_asset_urls", [legacy] if legacy else [])
    if gallery:
        result["detail_asset_url"] = gallery[0]
    return {"id": str(item_id), "body": result}


def list_cases(db: Session, tag: str | None, q: str | None, page: int, page_size: int) -> dict:
    """List released cases in configured order, using the item ID as a stable tie-breaker."""
    keyword = (q or "").strip().casefold()
    rows = []
    for ident, body in sorted(releases.case_snapshots(db), key=lambda row: (row[1].get("sort_order", 0), row[0])):
        if tag is not None and tag != body.get("category_key"):
            continue
        if keyword and not any(keyword in body.get(key, "").casefold()
                               for key in ("brand_name", "product_name", "highlight", "description")):
            continue
        rows.append({"id": str(ident), "body": _project(body, CASE_FIELDS)})
    return _page(rows, page, page_size)


def case_detail(db: Session, item_id: int) -> dict:
    """Omit private associations even when the independent case is published."""
    rows = releases.case_snapshots(db, item_id)
    if not rows:
        raise AppError(404, "not_found", "内容不存在")
    return {"id": str(item_id), "body": _project(rows[0][1], CASE_FIELDS)}
