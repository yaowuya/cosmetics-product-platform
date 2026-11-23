"""Staff endpoints for impact review and explicitly confirmed lifecycle changes."""
from fastapi import APIRouter, Response

from app.controllers.dependencies import Db, Editor, Publisher
from app.schemas.common import ItemId
from app.schemas.releases import ConfirmDraft, ConfirmLifecycle
from app.services import lifecycle

router = APIRouter(prefix="/api/admin")


@router.get("/items/{id}/impact")
def impact(id: ItemId, db: Db, _actor: Publisher) -> dict:
    """List current draft or visible references; cases are never changed by this request."""
    return lifecycle.impact(db, id)


@router.post("/items/{id}/unlist")
def unlist(id: ItemId, data: ConfirmLifecycle, db: Db, actor: Publisher) -> dict:
    """Remove the current live pointer without touching drafts or related cases."""
    return lifecycle.transition(db, id, data, actor.id, action="unlist")


@router.post("/items/{id}/archive")
def archive(id: ItemId, data: ConfirmLifecycle, db: Db, actor: Publisher) -> dict:
    """Archive only an offline item that has a release history; retain its identity."""
    return lifecycle.transition(db, id, data, actor.id, action="archive")


@router.delete("/items/{id}/draft", status_code=204, response_class=Response)
def delete_first_draft(id: ItemId, data: ConfirmDraft, db: Db, actor: Editor) -> Response:
    """Delete only a never-released product or case and preserve its deletion audit."""
    lifecycle.delete_first_draft(db, id, data, actor)
    return Response(status_code=204)
