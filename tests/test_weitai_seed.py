"""The deployment mapping keeps the confirmed copy and does not overwrite a live slot."""
from app.cli.weitai_content import (
    BOARDS, CASE_HEADER, CONTACT, DRAFT_SLOT, PUBLISH_SLOTS, SERVICES, SLOGAN_BOTTOM, SLOGAN_TOP,
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


def test_contact_has_no_qr_or_contact_methods():
    assert {"qr_asset_id", "wechat_id", "phone", "email"}.isdisjoint(CONTACT)
    assert CONTACT["label"] == "商务合作" and CONTACT["method"] == "扫码添加企业微信"
    assert CONTACT["description"] == "沟通具体合作需求"
    assert CONTACT["note"] == "示例预览，不含真实联系方式"
    assert normalize_body("config", "business_contact", CONTACT) == CONTACT


def test_case_filters_and_cover_copy():
    labels = [row["label"] for row in CASE_HEADER["filters"]]
    assert labels == ["精选案例", "冻干案例", "二类案例", "外贸案例"]
    assert "background_asset_id" not in CASE_HEADER
    cover = catalog_cover_body("12")
    assert cover["slogan_top"] == SLOGAN_TOP and cover["slogan_bottom"] == SLOGAN_BOTTOM
    assert normalize_body("config", "case_header", CASE_HEADER)["filters"] == CASE_HEADER["filters"]
    assert normalize_body("config", "catalog_cover", cover)["cover_asset_id"] == "12"


def test_service_cards_stay_text_only():
    assert SERVICES["page_title"] == "服务与合作" and SERVICES["intro"] == "从产品想法，到成品落地"
    assert SERVICES["section_title"] == "我们能为你做什么" and SERVICES["sample_label"] == "服务内容示例"
    assert all("image_asset_id" not in card and card["eyebrow"] and card["headline"] and card["points"] for card in SERVICES["cards"])
    assert len(SERVICES["cards"]) == 3
    assert normalize_body("config", DRAFT_SLOT, SERVICES)["cards"] == SERVICES["cards"]


def test_text_only_service_card_can_publish():
    from app.services.checks import _config_issues

    ready = {"cards": [{"title": "配方研发与打样", "eyebrow": "研发与共创"}]}
    assert _config_issues("services", ready) == []
    assert _config_issues("services", {"cards": [{"description": "只有说明"}]})


def test_live_slot_is_not_overwritten():
    assert slot_action("catalog_cover", live=True, has_draft=False) == "skip"
    assert slot_action("directory", live=False, has_draft=False) == "publish"
    assert slot_action(DRAFT_SLOT, live=False, has_draft=True) == "skip"
    assert slot_action(DRAFT_SLOT, live=True, has_draft=False) == "skip"
    assert slot_action(DRAFT_SLOT, live=False, has_draft=False) == "draft"
    assert slot_action("case_header", live=False, has_draft=False, archived=True) == "skip"
    assert DRAFT_SLOT not in PUBLISH_SLOTS


def _ids():
    counter = 0

    def allocate() -> str:
        nonlocal counter
        counter += 1
        return str(counter)

    return allocate
