"""Publisher-only endpoints for single and batch eligibility checks."""
from fastapi import APIRouter

from app.controllers.dependencies import Db, Publisher
from app.schemas.common import ItemId
from app.schemas.releases import CheckBatch, CheckDraft
from app.services import checks

router = APIRouter(prefix="/api/admin")


@router.post("/items/{id}/check")
def check_one(id: ItemId, data: CheckDraft, db: Db, _actor: Publisher) -> dict:
    """Check one confirmed draft revision rather than whatever happens to be newest."""
    return checks.check_one(db, id, data.expected_revision)


@router.post("/products/batch-check")
def check_products(data: CheckBatch, db: Db, _actor: Publisher) -> dict:
    """Report each product independently; cases and stale revisions cannot be eligible."""
    return checks.check_products(db, data.items)
