"""Enterprise account management and role-scoped access to audit records."""
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError

from app.auth import Db, _error, hash_password, require
from app.models import Account, Audit, UserSession

router = APIRouter(prefix="/api/admin")
Manager = Annotated[Account, Depends(require("manage"))]
Page = Annotated[int, Query(ge=1)]
PageSize = Annotated[int, Query(ge=1, le=100)]
ResourceId = Annotated[int, Path(ge=1, le=2**63 - 1)]
FilterId = Annotated[int | None, Query(ge=1, le=2**63 - 1)]
CAPABILITIES = ("enabled", "can_edit", "can_publish", "can_manage")


class NewAccount(BaseModel):
    """Create an account with only the explicitly requested capabilities."""

    model_config = ConfigDict(extra="forbid")
    login: str = Field(min_length=1, max_length=190)
    password: str = Field(min_length=12, max_length=128)
    can_edit: bool = False
    can_publish: bool = False
    can_manage: bool = False


class AccountChange(BaseModel):
    """Change enablement or capabilities without replacing identity or credentials."""

    model_config = ConfigDict(extra="forbid")
    enabled: bool | None = None
    can_edit: bool | None = None
    can_publish: bool | None = None
    can_manage: bool | None = None


def _account_row(account: Account) -> dict:
    return {"id": str(account.id), "login": account.login, "enabled": account.enabled,
            "can_edit": account.can_edit, "can_publish": account.can_publish,
            "can_manage": account.can_manage, "must_change_password": account.must_change_password}


def _audit_row(row: Audit) -> dict:
    return {"id": str(row.id), "actor_id": str(row.actor_id), "action": row.action,
            "target_kind": row.target_kind, "target_id": str(row.target_id),
            "occurred_at": row.occurred_at.isoformat() + "Z", "details": row.details,
            "request_key": row.request_key}


def _page(db: Db, query, row_view, page: int, page_size: int) -> dict:
    count = db.scalar(select(func.count()).select_from(query.order_by(None).subquery()))
    rows = db.scalars(query.offset((page - 1) * page_size).limit(page_size)).all()
    return {"items": [row_view(row) for row in rows], "total": count, "page": page, "page_size": page_size}


def _validate_capabilities(edit: bool, publish: bool) -> None:
    if publish and not edit:
        raise _error(422, "publish_requires_edit", "发布权只能授予有编辑权的账号")


def _lock_accounts(db: Db, actor_id: int, *target_ids: int) -> dict[int, Account]:
    # Lock in stable ID order; populate existing objects to recheck grants after any wait.
    rows = db.scalars(select(Account).where(Account.id.in_({actor_id, *target_ids}))
                      .order_by(Account.id).with_for_update().execution_options(populate_existing=True)).all()
    locked = {account.id: account for account in rows}
    actor = locked.get(actor_id)
    if actor is None or not actor.enabled or not actor.can_manage or actor.must_change_password:
        raise _error(403, "forbidden", "当前账号无权管理账号")
    return locked


@router.get("/accounts")
def accounts(db: Db, _actor: Manager, page: Page = 1, page_size: PageSize = 20) -> dict:
    """List account identities and capabilities without credentials or session data."""
    return _page(db, select(Account).order_by(Account.id), _account_row, page, page_size)


@router.post("/accounts", status_code=201)
def open_account(data: NewAccount, db: Db, actor: Manager) -> dict:
    """Create the account and its audit event in the same transaction."""
    login = data.login.strip()
    if not login:
        raise _error(422, "invalid_login", "登录名不能为空")
    _validate_capabilities(data.can_edit, data.can_publish)
    encoded = hash_password(data.password)
    _lock_accounts(db, actor.id)
    account = Account(login=login, password_hash=encoded, can_edit=data.can_edit,
                      can_publish=data.can_publish, can_manage=data.can_manage)
    try:
        db.add(account)
        db.flush()
        view = _account_row(account)
        db.add(Audit(actor_id=actor.id, action="account_created", target_kind="account",
                     target_id=account.id, details={field: view[field] for field in CAPABILITIES}))
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        if exc.orig.args[0] != 1062:
            raise
        raise _error(409, "login_conflict", "该登录名已存在") from None
    return view


@router.patch("/accounts/{account_id}")
def update_account(account_id: ResourceId, data: AccountChange, db: Db, actor: Manager) -> dict:
    """Apply permitted differences and invalidate sessions when an account is disabled."""
    target = _lock_accounts(db, actor.id, account_id).get(account_id)
    if target is None:
        raise _error(404, "account_not_found", "账号不存在")
    changes = data.model_dump(exclude_unset=True)
    if any(value is None for value in changes.values()):
        raise _error(422, "invalid_capability", "启停及能力必须为布尔值")
    _validate_capabilities(changes.get("can_edit", target.can_edit), changes.get("can_publish", target.can_publish))
    difference = {key: {"before": getattr(target, key), "after": value}
                  for key, value in changes.items() if getattr(target, key) != value}
    for key, value in difference.items():
        setattr(target, key, value["after"])
    if difference:
        if not target.enabled:
            # Re-enabling an account must not resurrect sessions issued before disablement.
            db.execute(delete(UserSession).where(UserSession.account_id == target.id))
        db.add(Audit(actor_id=actor.id, action="account_updated", target_kind="account",
                     target_id=target.id, details=difference))
    view = _account_row(target)
    db.commit()
    return view


def _audit_actor(request: Request, db: Db) -> Account:
    """Allow either editing or management, without granting one from the other."""
    try:
        return require("manage")(request, db)
    except HTTPException as error:
        if error.status_code != 403:
            raise
    return require("edit")(request, db)


@router.get("/audit")
def audit(db: Db, actor: Annotated[Account, Depends(_audit_actor)], actor_id: FilterId = None,
          target_kind: Annotated[str | None, Query(max_length=32)] = None, target_id: FilterId = None,
          page: Page = 1, page_size: PageSize = 20, request_key: Annotated[str | None, Query(max_length=128)] = None) -> dict:
    """Filter audit events inside the actor's governance or content visibility."""
    query = select(Audit)
    if request_key is not None:
        if not actor.can_edit or not actor.can_publish:
            raise _error(403, "forbidden", "当前账号无权核对发布回执")
        query = query.where(Audit.action == "publish", Audit.actor_id == actor.id, Audit.request_key == request_key)
    if not actor.can_edit:
        query = query.where(Audit.target_kind == "account")
    if not actor.can_manage:
        query = query.where(Audit.target_kind != "account")
    for column, value in ((Audit.actor_id, actor_id), (Audit.target_kind, target_kind), (Audit.target_id, target_id)):
        if value is not None:
            query = query.where(column == value)
    return _page(db, query.order_by(Audit.occurred_at.desc(), Audit.id.desc()), _audit_row, page, page_size)
