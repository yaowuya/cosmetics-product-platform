"""Reserve stable node identities and resolve enabled paths through the published directory."""
from sqlalchemy.orm import Session

from app.core.ids import invalid
from app.models import Account
from app.repositories import directory
from app.schemas.content import DIRECTORY_LEVELS
from app.services.auth import ensure_editor


def validate_draft_tree(nodes: list[dict]) -> None:
    """Reject repeated identities, orphans and cycles before a directory draft can be saved."""
    by_id = {node.get("id"): node for node in nodes}
    if None in by_id or len(by_id) != len(nodes):
        raise invalid("nodes")
    for index, node in enumerate(nodes):
        level = node.get("level")
        if level not in DIRECTORY_LEVELS:
            raise invalid(f"nodes.{index}.level")
        depth = DIRECTORY_LEVELS.index(level)
        parent_id = node.get("parent_id")
        # Each edge must go up exactly one tier, irrespective of the input order.
        if depth == 0:
            valid_parent = parent_id is None
        else:
            valid_parent = by_id.get(parent_id, {}).get("level") == DIRECTORY_LEVELS[depth - 1]
        if not valid_parent:
            raise invalid(f"nodes.{index}.parent_id")


def new_node(db: Session, actor: Account) -> dict:
    """Commit a reserved node ID without adding it to the current draft or released tree."""
    ensure_editor(db, actor)
    node_id = directory.allocate_node_id(db)
    db.commit()
    return {"id": str(node_id)}


def active_directory(db: Session) -> dict[str, dict]:
    """Return nodes with an enabled path in the current released directory."""
    body = directory.live_directory_body(db) or {}
    nodes = {node["id"]: node for node in body.get("nodes", [])}
    active = {}
    # Visit ancestors first: an enabled child of a hidden or missing branch is not a valid placement.
    for level in DIRECTORY_LEVELS:
        for ident, node in nodes.items():
            if node.get("level") != level or node.get("enabled") is not True:
                continue
            if level == "board" or node.get("parent_id") in active:
                active[ident] = node
    return active
