"""Read-only publication checks shared by single-item, batch and commit paths."""
from collections.abc import Iterator

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import select
from sqlalchemy.orm import Session
from typing import Annotated

from app.append import Choice, active_directory
from app.auth import Db, _error, require
from app.items import ItemId, item_view, parse_id
from app.media import asset_response
from app.models import Account, Asset, ContentItem, Release

router = APIRouter(prefix="/api/admin")
Publisher = Annotated[Account, Depends(require("publish"))]
PRODUCT_REQUIRED = (
    "name", "short_benefit", "benefit", "ingredients", "highlights", "formula_no", "production_status",
    "thumbnail_asset_id", "cover_asset_id", "detail_asset_id",
)
CASE_REQUIRED = ("brand_name", "product_name", "highlight", "image_asset_id")


class CheckDraft(BaseModel):
    """Bind checking to the revision the publisher selected."""

    model_config = ConfigDict(extra="forbid")
    expected_revision: str


class CheckBatch(BaseModel):
    """Check only the explicitly selected product revisions."""

    model_config = ConfigDict(extra="forbid")
    items: list[Choice] = Field(max_length=200)


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


def inspect(db: Session, item: ContentItem) -> dict:
    """Return actionable input issues without writing drafts, releases or audit rows."""
    view = item_view(db, item)
    draft = view["draft"]
    place_ids = view["place_ids"]
    issues = []
    if item.archived_at is not None:
        issues.append({"field": "id", "reason": "条目已归档"})
    if draft is None:
        issues.append({"field": "draft", "reason": "没有可发布的草稿"})
    elif item.kind == "product":
        issues.extend(_required(draft, PRODUCT_REQUIRED))
        if not place_ids or not set(place_ids) <= active_directory(db).keys():
            issues.append({"field": "place_ids", "reason": "产品须关联当前有效展示位置"})
    elif item.kind == "case":
        issues.extend(_required(draft, CASE_REQUIRED))
        key = draft.get("category_key")
        if key:
            header = db.scalar(select(Release.body).join(ContentItem, ContentItem.live_id == Release.id)
                               .where(ContentItem.config_slot == "case_header")) or {}
            if key not in {row["key"] for row in header.get("filters", [])}:
                issues.append({"field": "category_key", "reason": "筛选项未发布或已停用"})
    else:
        issues.extend(_config_issues(item.config_slot, draft))
    references = list(_image_fields(draft))
    assets = {str(asset.id): asset for asset in db.scalars(select(Asset).where(Asset.id.in_({int(i) for _, i in references})))} if references else {}
    for field, ident in references:
        try:
            if ident not in assets:
                raise _error(404, "media_not_found", "素材不存在")
            # Upload decoded and stored immutable bytes; recheck on-disk availability at release time.
            asset_response(assets[ident])
        except HTTPException:
            issues.append({"field": field, "reason": "引用的图片不可用"})
    return {"id": str(item.id), "revision": view["revision"], "eligible": not issues,
            "issues": issues, "place_ids": place_ids}


@router.post("/items/{id}/check")
def check_one(id: ItemId, data: CheckDraft, db: Db, _actor: Publisher) -> dict:
    """Check one confirmed draft revision rather than whatever happens to be newest."""
    item = db.get(ContentItem, id)
    if item is None:
        raise _error(404, "item_not_found", "内容不存在")
    if item.revision != parse_id(data.expected_revision, "expected_revision", zero=True):
        raise _error(409, "draft_conflict", "草稿已变化，请重新核对")
    return inspect(db, item)


@router.post("/products/batch-check")
def check_products(data: CheckBatch, db: Db, _actor: Publisher) -> dict:
    """Report each product independently; cases and stale revisions cannot be eligible."""
    rows, seen = [], set()
    for choice in data.items:
        ident = parse_id(choice.id, "id")
        if ident in seen:
            continue
        seen.add(ident)
        item = db.get(ContentItem, ident)
        if item is None or item.kind != "product":
            issue = {"field": "id", "reason": "仅可批量检查产品"}
        elif item.revision != parse_id(choice.expected_revision, "expected_revision", zero=True):
            issue = {"field": "revision", "reason": "草稿已变化，请重新核对"}
        else:
            rows.append(inspect(db, item))
            continue
        rows.append({"id": choice.id, "revision": str(item.revision) if item else choice.expected_revision,
                     "eligible": False, "issues": [issue], "place_ids": []})
    return {"items": rows}
