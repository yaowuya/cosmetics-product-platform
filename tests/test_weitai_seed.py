"""The deployment mapping keeps the confirmed copy and does not overwrite a live slot."""
from app.cli.weitai_content import (
    BOARDS, CASE_HEADER, CONTACT, PUBLISH_SLOTS, SLOGAN_BOTTOM, SLOGAN_TOP,
    catalog_cover_body, directory_body, node_names, slot_action,
)
from app.services.items import normalize_body


def test_directory_keeps_five_boards_and_drops_the_all_button():
    names = node_names()
    assert [board for board, _categories in BOARDS] == ["护肤", "冻干", "二类", "洗护", "外贸"]
    assert "全部" not in names
    assert "净澈清洁" in names and "冻干粉" in names and "防晒清洁" in names
    body = directory_body(_ids())
    assert len(body["nodes"]) == 67
    assert all(node["enabled"] is True and "name" in node for node in body["nodes"])
    assert normalize_body("config", "directory", body) == body


def test_contact_seed_does_not_invent_copy_or_methods():
    assert CONTACT == {}
    assert normalize_body("config", "business_contact", {
        "title": "不要入库", "wechat_id": "weitai", "phone": "13800000000",
    }) == {"wechat_id": "weitai", "phone": "13800000000"}


def test_case_filters_and_cover_copy():
    labels = [row["label"] for row in CASE_HEADER["filters"]]
    assert labels == ["精选案例", "冻干案例", "二类案例", "外贸案例"]
    assert "background_asset_id" not in CASE_HEADER
    cover = catalog_cover_body("12")
    assert cover["slogan_top"] == SLOGAN_TOP and cover["slogan_bottom"] == SLOGAN_BOTTOM
    assert normalize_body("config", "case_header", CASE_HEADER)["filters"] == CASE_HEADER["filters"]
    assert normalize_body("config", "catalog_cover", cover)["cover_asset_id"] == "12"


def test_live_slot_is_not_overwritten():
    assert slot_action("catalog_cover", live=True, has_draft=False) == "skip"
    assert slot_action("directory", live=False, has_draft=False) == "publish"
    assert slot_action("business_contact", live=True, has_draft=False) == "skip"
    assert slot_action("services", live=False, has_draft=False) == "skip"
    assert slot_action("case_header", live=False, has_draft=False, archived=True) == "skip"
    assert "services" not in PUBLISH_SLOTS


def _ids():
    counter = 0

    def allocate() -> str:
        nonlocal counter
        counter += 1
        return str(counter)

    return allocate
