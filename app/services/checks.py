"""Read-only eligibility rules shared by individual checks, batch checks and publication."""
from collections.abc import Iterator

from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.core.ids import parse_id
from app.models import Asset, ContentItem
from app.repositories import releases
from app.repositories.items import get_item
from app.schemas.common import Choice
from app.schemas.content import effective_product_body, missing_item_fields
from app.services.directory import active_directory
from app.services.items import item_view
from app.services.media import resolve_asset_file

_PUBLICATION_MISSING_REASONS = {
    "detail_asset_id": "至少要有一张详情长图",
    "detail_asset_ids": "至少要有一张详情长图",
    "place_ids": "产品须关联当前有效展示位置",
}


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


def _service_card_issues(cards: object) -> list[dict]:
    """A service card is text. An image is optional; a name or eyebrow is not."""
    if not isinstance(cards, list):
        return []
    issues = []
    for index, row in enumerate(cards):
        if not isinstance(row, dict):
            continue
        title, eyebrow = row.get("title"), row.get("eyebrow")
        named = isinstance(title, str) and title.strip() or isinstance(eyebrow, str) and eyebrow.strip()
        if not named:
            issues.append({"field": f"cards.{index}.title", "reason": "发布必填项未设置"})
    return issues


def _config_issues(slot: str | None, body: dict) -> list[dict]:
    if slot == "home_posters" and len(set(body.get("poster_asset_ids", []))) < 3:
        return [{"field": "poster_asset_ids", "reason": "至少要有三张正式海报"}]
    if slot == "catalog_cover":
        return _required(body, ("cover_asset_id",))
    if slot == "services":
        return _service_card_issues(body.get("cards", []))
    nested = {
        "directory": ("nodes", ("name", "enabled", "sort_order")),
        "case_header": ("filters", ("label",)),
    }
    if slot not in nested:
        return []
    group, fields = nested[slot]
    return [issue for i, row in enumerate(body.get(group, [])) for issue in _required(row, fields, f"{group}.{i}.")]


def _case_issues(db: Session, draft: dict) -> list[dict]:
    key = draft.get("category_key")
    if key:
        header = releases.live_case_header(db)
        if key not in {row["key"] for row in header.get("filters", [])}:
            return [{"field": "category_key", "reason": "筛选项未发布或已停用"}]
    return []


def _body_issues(db: Session, item: ContentItem, draft: dict | None, place_ids: list[str]) -> list[dict]:
    if draft is None:
        return [{"field": "draft", "reason": "没有可发布的草稿"}]
    if item.kind not in {"product", "case"}:
        return _config_issues(item.config_slot, draft)
    missing = missing_item_fields(item.kind, draft, has_placement=bool(place_ids))
    issues = [{"field": field, "reason": _PUBLICATION_MISSING_REASONS.get(field, "发布必填项未设置")}
              for field in missing]
    if item.kind == "case":
        issues.extend(_case_issues(db, draft))
    elif place_ids and not set(place_ids) <= active_directory(db).keys():
        issues.append({"field": "place_ids", "reason": _PUBLICATION_MISSING_REASONS["place_ids"]})
    return issues


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


def review_snapshot(db: Session, item: ContentItem) -> tuple[dict | None, dict]:
    """Return the prospective release body and its eligibility report without modifying the draft."""
    view = item_view(db, item)
    snapshot = view["draft"]
    if item.kind == "product" and snapshot is not None:
        snapshot = effective_product_body(snapshot)
    issues = [{"field": "id", "reason": "条目已归档"}] if item.archived_at is not None else []
    issues.extend(_body_issues(db, item, snapshot, view["place_ids"]))
    issues.extend(_asset_issues(db, snapshot))
    return snapshot, {"id": str(item.id), "revision": view["revision"], "eligible": not issues,
                      "issues": issues, "place_ids": view["place_ids"]}


def inspect(db: Session, item: ContentItem) -> dict:
    """Return ordered field-level eligibility issues without changing the item or its audit."""
    return review_snapshot(db, item)[1]


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
