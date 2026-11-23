"""Read-only eligibility rules shared by individual checks, batch checks and publication."""
from collections.abc import Iterator

from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.core.ids import parse_id
from app.models import Asset, ContentItem
from app.repositories import releases
from app.repositories.items import get_item
from app.schemas.common import Choice
from app.services.directory import active_directory
from app.services.items import item_view
from app.services.media import resolve_asset_file

PRODUCT_REQUIRED = (
    "name", "short_benefit", "benefit", "ingredients", "highlights", "formula_no", "production_status",
    "thumbnail_asset_id", "cover_asset_id", "detail_asset_id",
)
CASE_REQUIRED = ("brand_name", "product_name", "highlight", "image_asset_id")


def _image_fields(body: object, path: str = "") -> Iterator[tuple[str, str]]:
    if isinstance(body, list):
        for index, entry in enumerate(body):
            yield from _image_fields(entry, f"{path}.{index}")
    elif isinstance(body, dict):
        for key, value in body.items():
            field = f"{path}.{key}" if path else key
            if key.endswith("_asset_id") and isinstance(value, str):
                yield field, value
            elif key.endswith("_asset_ids") and isinstance(value, list):
                for index, ident in enumerate(value):
                    yield f"{field}.{index}", ident
            else:
                yield from _image_fields(value, field)


def _required(body: dict, fields: tuple[str, ...], path: str = "") -> list[dict]:
    return [{"field": f"{path}{field}", "reason": "发布必填项未设置"} for field in fields if field not in body]


def _config_issues(slot: str | None, body: dict) -> list[dict]:
    if slot == "home_posters" and len(set(body.get("poster_asset_ids", []))) < 3:
        return [{"field": "poster_asset_ids", "reason": "至少要有三张正式海报"}]
    if slot == "catalog_cover":
        return _required(body, ("cover_asset_id",))
    nested = {
        "directory": ("nodes", ("name", "enabled", "sort_order")),
        "case_header": ("filters", ("label",)),
        "services": ("cards", ("image_asset_id",)),
    }
    if slot not in nested:
        return []
    group, fields = nested[slot]
    return [issue for i, row in enumerate(body.get(group, [])) for issue in _required(row, fields, f"{group}.{i}.")]


def _case_issues(db: Session, draft: dict) -> list[dict]:
    issues = _required(draft, CASE_REQUIRED)
    key = draft.get("category_key")
    if key:
        header = releases.live_case_header(db)
        if key not in {row["key"] for row in header.get("filters", [])}:
            issues.append({"field": "category_key", "reason": "筛选项未发布或已停用"})
    return issues


def _body_issues(db: Session, item: ContentItem, draft: dict | None, place_ids: list[str]) -> list[dict]:
    if draft is None:
        return [{"field": "draft", "reason": "没有可发布的草稿"}]
    if item.kind == "product":
        issues = _required(draft, PRODUCT_REQUIRED)
        if not place_ids or not set(place_ids) <= active_directory(db).keys():
            issues.append({"field": "place_ids", "reason": "产品须关联当前有效展示位置"})
        return issues
    if item.kind == "case":
        return _case_issues(db, draft)
    return _config_issues(item.config_slot, draft)


def _available(asset: Asset | None) -> bool:
    if asset is None:
        return False
    try:
        # A registered upload is only publishable while its immutable file is available.
        resolve_asset_file(asset)
    except AppError:
        return False
    return True


def _asset_issues(db: Session, draft: dict | None) -> list[dict]:
    references = list(_image_fields(draft))
    assets = releases.check_assets(db, {int(ident) for _, ident in references})
    # Keep every offending field, including repeated references to the same missing image.
    return [{"field": field, "reason": "引用的图片不可用"} for field, ident in references if not _available(assets.get(ident))]


def inspect(db: Session, item: ContentItem) -> dict:
    """Return ordered, field-level eligibility issues without modifying the item or its audit."""
    view = item_view(db, item)
    issues = [{"field": "id", "reason": "条目已归档"}] if item.archived_at is not None else []
    issues.extend(_body_issues(db, item, view["draft"], view["place_ids"]))
    issues.extend(_asset_issues(db, view["draft"]))
    return {"id": str(item.id), "revision": view["revision"], "eligible": not issues,
            "issues": issues, "place_ids": view["place_ids"]}


def check_one(db: Session, item_id: int, expected_revision: str) -> dict:
    """Reject a missing or stale selection rather than inspecting a different revision."""
    item = get_item(db, item_id)
    if item is None:
        raise AppError(404, "item_not_found", "内容不存在")
    if item.revision != parse_id(expected_revision, "expected_revision", zero=True):
        raise AppError(409, "draft_conflict", "草稿已变化，请重新核对")
    return inspect(db, item)


def _product_result(db: Session, item_id: int, choice: Choice) -> dict:
    item = get_item(db, item_id)
    if item is None or item.kind != "product":
        issue = {"field": "id", "reason": "仅可批量检查产品"}
    elif item.revision != parse_id(choice.expected_revision, "expected_revision", zero=True):
        issue = {"field": "revision", "reason": "草稿已变化，请重新核对"}
    else:
        return inspect(db, item)
    return {"id": choice.id, "revision": str(item.revision) if item else choice.expected_revision,
            "eligible": False, "issues": [issue], "place_ids": []}


def check_products(db: Session, choices: list[Choice]) -> dict:
    """Report the first occurrence of each product in selection order, including ineligible rows."""
    rows = []
    seen: set[int] = set()
    for choice in choices:
        item_id = parse_id(choice.id, "id")
        if item_id not in seen:
            seen.add(item_id)
            rows.append(_product_result(db, item_id, choice))
    return {"items": rows}
