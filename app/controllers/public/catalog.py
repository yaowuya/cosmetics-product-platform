"""Anonymous HTTP endpoints for published pages, the product directory and cases."""
from typing import Annotated

from fastapi import APIRouter, Query, Request

from app.controllers.dependencies import Db
from app.controllers.public.query import only_query
from app.schemas.common import ItemId
from app.services import public_catalog

router = APIRouter(prefix="/api/public")
Page = Annotated[int, Query(ge=1)]
PageSize = Annotated[int, Query(ge=1, le=100)]


@router.get("/pages/{page}")
def pages(page: str, request: Request, db: Db) -> dict:
    """Render each of the four fixed positions independently from its current release."""
    only_query(request)
    return public_catalog.page_content(db, page)


@router.get("/catalog")
def catalog(request: Request, db: Db, board_id: str | None = None) -> dict:
    """Return the active tree and deduplicated subtree counts independent of fine filtering."""
    only_query(request, "board_id")
    return public_catalog.catalog_tree(db, board_id)


@router.get("/products")
def products(request: Request, db: Db, board_id: str | None = None, node_id: str | None = None,
             q: Annotated[str | None, Query(max_length=250)] = None, page: Page = 1, page_size: PageSize = 20) -> dict:
    """Search visible products only in the requested board and optional node subtree."""
    only_query(request, "board_id", "node_id", "q", "page", "page_size")
    return public_catalog.list_products(db, board_id, node_id, q, page, page_size)


@router.get("/products/{id}")
def product(id: ItemId, request: Request, db: Db) -> dict:
    """Expose detail only when at least one valid directory path is still public."""
    only_query(request)
    return public_catalog.product_detail(db, id)


@router.get("/cases")
def cases(request: Request, db: Db, tag: Annotated[str | None, Query(max_length=80)] = None,
          q: Annotated[str | None, Query(max_length=250)] = None, page: Page = 1, page_size: PageSize = 20) -> dict:
    """Read independently published client cases with stable sorting and optional search."""
    only_query(request, "tag", "q", "page", "page_size")
    return public_catalog.list_cases(db, tag, q, page, page_size)


@router.get("/cases/{id}")
def case_detail(id: ItemId, request: Request, db: Db) -> dict:
    """Return the released independent case, omitting its private product association."""
    only_query(request)
    return public_catalog.case_detail(db, id)
