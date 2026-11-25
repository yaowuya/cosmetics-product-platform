"""Wire contracts for content drafts, fixed configuration slots and placement edits."""
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from app.core.ids import invalid, parse_id
from app.schemas.common import Choice


class NewDraft(BaseModel):
    """A partial body and its stable display locations; location order lives in the directory."""

    model_config = ConfigDict(extra="forbid")
    body: dict[str, Any]
    place_ids: list[str] = Field(default_factory=list)


class DraftUpdate(NewDraft):
    """Require the revision the editor actually read."""

    expected_revision: str


class NodeRequest(BaseModel):
    """Allocate an identity only; node attributes belong to the directory draft."""

    model_config = ConfigDict(extra="forbid")


class AppendBatch(BaseModel):
    """Add only the specified positions to the explicitly selected products."""

    model_config = ConfigDict(extra="forbid")
    items: list[Choice] = Field(max_length=200)
    node_ids: list[str] = Field(max_length=200)


CONFIG_FIELDS = {
    "home_posters": {"poster_asset_ids": "ids"},
    "catalog_cover": {"cover_asset_id": "id", "slogan_top": str, "slogan_bottom": str, "image_has_text": bool},
    "directory": {"nodes": [{"id": "id", "parent_id": "id", "level": str, "name": str,
                             "icon_asset_id": "id", "enabled": bool, "sort_order": int}]},
    "case_header": {"background_asset_id": "id", "title": str, "intro": str, "filters": [{"key": str, "label": str}]},
    "services": {"page_title": str, "intro": str, "section_title": str, "sample_label": str, "consult_label": str,
                 "cards": [{"image_asset_id": "id", "title": str, "description": str, "eyebrow": str, "headline": str, "points": str}]},
    "business_contact": {"qr_asset_id": "id", "wechat_id": str, "phone": str, "email": str},
}
DIRECTORY_LEVELS = ("board", "category", "subcategory")

_ITEM_FIELDS = {
    "product": {
        "name": str, "short_benefit": str, "benefit": str, "ingredients": str, "highlights": str,
        "formula_no": str, "english_name": str, "thumbnail_asset_id": "id", "cover_asset_id": "id",
        "detail_asset_id": "id", "detail_asset_ids": "gallery_ids",
        "production_status": frozenset({"已生产", "未生产", "待确认"}),
    },
    "case": {
        "brand_name": str, "product_name": str, "highlight": str, "series": str, "description": str,
        "case_no": str, "category_key": str, "image_asset_id": "id", "related_product_id": "id", "sort_order": int,
    },
}


def _list_value(value: Any, rule: Any, field: str) -> list:
    if not isinstance(value, list) or (rule == "gallery_ids" and len(value) > 3):
        raise invalid(field)
    if rule in ("ids", "gallery_ids"):
        for index, ident in enumerate(value):
            parse_id(ident, f"{field}.{index}")
        return value
    return [_shape_object(row, rule[0], f"{field}.{index}") for index, row in enumerate(value)]


def _field_value(value: Any, rule: Any, field: str) -> Any:
    if rule == "id":
        parse_id(value, field)
    elif rule in ("ids", "gallery_ids") or isinstance(rule, list):
        return _list_value(value, rule, field)
    elif isinstance(rule, frozenset):
        if not isinstance(value, str) or value not in rule:
            raise invalid(field)
    # A JSON boolean is not a sort order, even though bool inherits from int in Python.
    elif type(value) is not rule or (rule is int and value < 0):
        raise invalid(field)
    return value


def _shape_object(source: dict, fields: dict, path: str = "") -> dict:
    if not isinstance(source, dict):
        raise invalid(path)
    clean = {}
    for key, value in source.items():
        field = f"{path}.{key}" if path else key
        if key not in fields:
            raise invalid(field)
        if isinstance(value, str):
            value = value.strip()
        # A provided gallery must be an array. Empty means remove every selected long image.
        if (value is not None and value != "") or fields[key] == "gallery_ids":
            clean[key] = _field_value(value, fields[key], field)
    return clean


def effective_product_body(body: dict) -> dict:
    """Use the explicit gallery, including an empty one, ahead of the legacy single image."""
    if "detail_asset_ids" in body and "detail_asset_id" in body:
        return {field: value for field, value in body.items() if field != "detail_asset_id"}
    return body


def catalog_image_id(body: dict) -> str | None:
    """Return the independent card image without ever substituting the wide detail cover."""
    square = body.get("thumbnail_asset_id")
    return square if square and square != body.get("cover_asset_id") else None


def shape_body(kind: str, config_slot: str | None, body: dict) -> dict:
    """Clean wire fields using the locked item's contract; missing draft fields are allowed."""
    if kind == "config":
        if config_slot not in CONFIG_FIELDS:
            raise invalid("config_slot")
        source = body
        if config_slot == "business_contact":
            allowed = CONFIG_FIELDS[config_slot]
            source = {key: value for key, value in body.items() if key in allowed}
        return _shape_object(source, CONFIG_FIELDS[config_slot])
    if kind not in _ITEM_FIELDS or config_slot is not None:
        raise invalid("kind")
    source = effective_product_body(body) if kind == "product" and isinstance(body, dict) else body
    return _shape_object(source, _ITEM_FIELDS[kind])
