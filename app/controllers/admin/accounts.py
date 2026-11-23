"""账号治理和审计查询的 HTTP 路由、权限依赖和分页参数。"""
from typing import Annotated

from fastapi import APIRouter, Depends, Path, Query, Request

from app.controllers.dependencies import Db, Manager, require
from app.core.errors import AppError
from app.models import Account
from app.schemas.accounts import AccountChange, NewAccount
from app.services import accounts as service

router = APIRouter(prefix="/api/admin")
Page = Annotated[int, Query(ge=1)]
PageSize = Annotated[int, Query(ge=1, le=100)]
ResourceId = Annotated[int, Path(ge=1, le=2**63 - 1)]
FilterId = Annotated[int | None, Query(ge=1, le=2**63 - 1)]


@router.get("/accounts")
def accounts(db: Db, _actor: Manager, page: Page = 1, page_size: PageSize = 20) -> dict:
    """List account identities and capabilities without credentials or session data."""
    return service.list_accounts(db, page, page_size)


@router.post("/accounts", status_code=201)
def open_account(data: NewAccount, db: Db, actor: Manager) -> dict:
    """Create the account and its audit event in the same transaction."""
    return service.open_account(db, actor, data)


@router.patch("/accounts/{account_id}")
def update_account(account_id: ResourceId, data: AccountChange, db: Db, actor: Manager) -> dict:
    """Apply permitted differences and invalidate sessions when an account is disabled."""
    return service.update_account(db, actor, account_id, data)


def _audit_actor(request: Request, db: Db) -> Account:
    """治理或编辑身份均能查询；无效会话不是可回退到另一角色的拒绝。"""
    try:
        return require("manage")(request, db)
    except AppError as error:
        if error.status_code != 403:
            raise
    return require("edit")(request, db)


@router.get("/audit")
def audit(db: Db, actor: Annotated[Account, Depends(_audit_actor)], actor_id: FilterId = None,
          target_kind: Annotated[str | None, Query(max_length=32)] = None, target_id: FilterId = None,
          page: Page = 1, page_size: PageSize = 20, request_key: Annotated[str | None, Query(max_length=128)] = None) -> dict:
    """Filter audit events inside the actor's governance or content visibility."""
    return service.list_audit(db, actor, actor_id=actor_id, target_kind=target_kind, target_id=target_id,
                              page=page, page_size=page_size, request_key=request_key)
