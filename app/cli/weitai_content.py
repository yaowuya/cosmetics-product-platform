"""Fixed Weitai copy for deployment. The command does not read the prototype directory."""
from collections.abc import Callable

PUBLISH_SLOTS = ("catalog_cover", "directory", "case_header", "business_contact")

SLOGAN_TOP = "医研共创为根基"
SLOGAN_BOTTOM = "功效护肤超级工厂"

CASE_HEADER = {
    "title": "品牌案例",
    "intro": "携手品牌，共创高功效产品",
    "filters": [
        {"key": "featured", "label": "精选案例"},
        {"key": "freeze", "label": "冻干案例"},
        {"key": "medical", "label": "二类案例"},
        {"key": "export", "label": "外贸案例"},
    ],
}

CONTACT = {}

# Board, then categories, then subcategories. "全部" is only a prototype filter button.
BOARDS = (
    ("护肤", (
        ("净澈清洁", ("洁面", "卸妆")),
        ("基础维稳", ("精华水", "乳液", "膏霜")),
        ("功效护肤", ()),
        ("电商爆品", ("便携单品", "套组")),
        ("创新剂型", ()),
        ("功效水光", ()),
        ("以油养肤", ("精华油",)),
        ("眼部专项", ()),
        ("底妆专项", ()),
        ("面膜棉片", ("面膜", "棉片")),
        ("院线护理", ("凝膜", "护理乳")),
        ("身体护理", ()),
    )),
    ("冻干", (
        ("冻干粉", ()), ("冻干絮", ()), ("冻干球", ()), ("冻干油", ()), ("冻干乳", ()),
        ("冻干微球", ()), ("冻干冰晶", ()), ("冻干面膜", ()), ("冻干眼膜", ()),
    )),
    ("二类", (
        ("防晒清洁", ("防晒", "清洁")),
        ("重组胶原蛋白", ()), ("重组贻贝蛋白", ()), ("透明质酸钠", ()), ("生物多糖", ()),
        ("海藻糖", ()), ("生物玻璃", ()), ("眼部护理", ()), ("私密护理", ()),
        ("鼻腔护理", ()), ("其他", ()),
    )),
    ("洗护", (
        ("洗发护理", ()), ("护发修护", ()), ("头皮护理", ()), ("沐浴清洁", ()),
    )),
    ("外贸", (
        ("净澈清洁", ("洁面", "卸妆")),
        ("多肽抗老", ()), ("蓝铜肽", ()), ("视觉爆款", ()),
        ("以油养肤", ("精华油",)),
        ("身体头皮", ("身体", "头皮")),
        ("面膜系列", ()),
    )),
)


def slot_action(slot: str, *, live: bool, has_draft: bool = False, archived: bool = False) -> str:
    """Leave a released or archived slot untouched. Contact copy is not seeded."""
    del has_draft
    if archived or slot not in PUBLISH_SLOTS:
        return "skip"
    return "skip" if live else "publish"


def catalog_cover_body(cover_asset_id: str) -> dict:
    return {"cover_asset_id": cover_asset_id, "slogan_top": SLOGAN_TOP, "slogan_bottom": SLOGAN_BOTTOM}


def directory_body(allocate: Callable[[], str]) -> dict:
    """Assign reserved decimal IDs. Sibling order starts at zero and every node is enabled."""
    nodes = []
    for board_index, (board_name, categories) in enumerate(BOARDS):
        board_id = allocate()
        nodes.append(_node(board_id, None, "board", board_name, board_index))
        for category_index, (category_name, subs) in enumerate(categories):
            category_id = allocate()
            nodes.append(_node(category_id, board_id, "category", category_name, category_index))
            for sub_index, sub_name in enumerate(subs):
                nodes.append(_node(allocate(), category_id, "subcategory", sub_name, sub_index))
    return {"nodes": nodes}


def node_names() -> set[str]:
    names = set()
    for board_name, categories in BOARDS:
        names.add(board_name)
        for category_name, subs in categories:
            names.add(category_name)
            names.update(subs)
    return names


def _node(ident: str, parent_id: str | None, level: str, name: str, sort_order: int) -> dict:
    node = {"id": ident, "level": level, "name": name, "enabled": True, "sort_order": sort_order}
    if parent_id is not None:
        node["parent_id"] = parent_id
    return node
