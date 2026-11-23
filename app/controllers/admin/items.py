"""Admin HTTP endpoints for product and case drafts and staff listings."""
from typing import Annotated, Literal

from fastapi import APIRouter, Query, Request

from app.controllers.dependencies import Db, Editor
from app.schemas.common import ItemId
from app.schemas.content import DraftUpdate, NewDraft
from app.services import items

router = APIRouter(prefix="/api/admin")


def _kind(request: Request) -> str:
    return "product" if request.url.path.endswith("/products") else "case"


@router.post("/products", status_code=201)
@router.post("/cases", status_code=201)
def new_item(request: Request, data: NewDraft, db: Db, actor: Editor) -> dict:
    """Create one independent draft and leave the publication pointer empty."""
    return items.new_item(db, _kind(request), data.body, data.place_ids, actor)


@router.get("/items/{id}")
def get_item(id: ItemId, db: Db, _actor: Editor) -> dict:
    """Read one known item and its separate draft and release."""
    return items.read_item(db, id)


@router.put("/items/{id}/draft")
def update_draft(id: ItemId, data: DraftUpdate, db: Db, actor: Editor) -> dict:
    """Save only if the editor's revision is still current."""
    return items.update_draft(db, id, data.expected_revision, data.body, data.place_ids, actor)


@router.get("/products")
@router.get("/cases")
def list_items(request: Request, db: Db, _actor: Editor,
               q: Annotated[str | None, Query(max_length=250)] = None,
               node_id: Annotated[str | None, Query()] = None,
               state: Literal["online", "offline", "archived"] | None = None, has_draft: bool | None = None,
               page: Annotated[int, Query(ge=1)] = 1, page_size: Annotated[int, Query(ge=1, le=100)] = 20) -> dict:
    """Filter a single row per identity, using EXISTS rather than joining each placement."""
    return items.list_items(db, _kind(request), q=q, node_id=node_id, state=state,
                            has_draft=has_draft, page=page, page_size=page_size)
