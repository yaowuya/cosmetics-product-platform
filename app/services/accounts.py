"""企业账号的初始化、授权变更与范围受限的治理审计。"""
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.db import engine
from app.core.errors import AppError
from app.core.security import hash_password
from app.models import Account, Audit
from app.repositories import accounts as store
from app.schemas.accounts import AccountChange, NewAccount
from app.services.auth import authorize, capability_fields

_CAPABILITIES = ("enabled", "can_edit", "can_publish", "can_manage")


def create_first_admin(login: str, password: str) -> int:
    """仅向空实例写入首个治理账号；非法输入或已有账号沿用 CLI 的拒绝语义。"""
    login = login.strip()
    if not login or len(login) > 190:
        raise ValueError("A nonempty login of at most 190 characters is required")
    encoded = hash_password(password)
    with Session(engine()) as db, db.begin():
        if store.first_account_exists_for_update(db):
            raise RuntimeError("Enterprise accounts are already initialized")
        return store.add_account(db, login, encoded, can_manage=True).id


def _account_row(account: Account) -> dict:
    return {"id": str(account.id), "login": account.login, "enabled": account.enabled, **capability_fields(account)}


def _audit_row(row: Audit) -> dict:
    return {"id": str(row.id), "actor_id": str(row.actor_id), "action": row.action,
            "target_kind": row.target_kind, "target_id": str(row.target_id),
            "occurred_at": row.occurred_at.isoformat() + "Z", "details": row.details,
            "request_key": row.request_key}


def _page(items: list[dict], total: int, page: int, page_size: int) -> dict:
    return {"items": items, "total": total, "page": page, "page_size": page_size}


def _validate_capabilities(edit: bool, publish: bool) -> None:
    if publish and not edit:
        raise AppError(422, "publish_requires_edit", "发布权只能授予有编辑权的账号")


def _managed_accounts(db: Session, actor_id: int, *target_ids: int) -> dict[int, Account]:
    # 管理操作以获取锁后的授权为准，而不是使用路由依赖先前加载的能力。
    locked = store.lock_accounts(db, actor_id, *target_ids)
    authorize(locked.get(actor_id), "manage", "当前账号无权管理账号")
    return locked


def list_accounts(db: Session, page: int, page_size: int) -> dict:
    """向已通过治理鉴权的调用方提供分页账号概要，不返回密码和会话记录。"""
    rows, total = store.account_page(db, page, page_size)
    return _page([_account_row(row) for row in rows], total, page, page_size)


def open_account(db: Session, actor: Account, data: NewAccount) -> dict:
    """复核管理权后，在同一事务内创建账号并记录显式授予的能力。"""
    login = data.login.strip()
    if not login:
        raise AppError(422, "invalid_login", "登录名不能为空")
    _validate_capabilities(data.can_edit, data.can_publish)
    encoded = hash_password(data.password)
    _managed_accounts(db, actor.id)
    try:
        account = store.add_account(db, login, encoded, can_edit=data.can_edit,
                                    can_publish=data.can_publish, can_manage=data.can_manage)
        view = _account_row(account)
        store.add_account_audit(db, actor.id, "account_created", account.id, {k: view[k] for k in _CAPABILITIES})
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        # 只把 MySQL 重复键错误映射为登录名冲突，不掩盖其他完整性错误。
        if exc.orig.args[0] != 1062:
            raise
        raise AppError(409, "login_conflict", "该登录名已存在") from None
    return view


def update_account(db: Session, actor: Account, account_id: int, data: AccountChange) -> dict:
    """在锁内应用有效差异并审计；禁用时撤销旧会话，使重新启用不能恢复它们。"""
    target = _managed_accounts(db, actor.id, account_id).get(account_id)
    if target is None:
        raise AppError(404, "account_not_found", "账号不存在")
    changes = data.model_dump(exclude_unset=True)
    if any(value is None for value in changes.values()):
        raise AppError(422, "invalid_capability", "启停及能力必须为布尔值")
    _validate_capabilities(changes.get("can_edit", target.can_edit), changes.get("can_publish", target.can_publish))
    difference = store.apply_capabilities(target, changes)
    if difference:
        if not target.enabled:
            store.delete_account_sessions(db, target.id)
        store.add_account_audit(db, actor.id, "account_updated", target.id, difference)
    view = _account_row(target)
    db.commit()
    return view


def list_audit(db: Session, actor: Account, *, actor_id: int | None, target_kind: str | None,
               target_id: int | None, page: int, page_size: int, request_key: str | None) -> dict:
    """账号与内容事件分别要求治理权与编辑权；发布回执另限当前发布人。"""
    receipt = None
    if request_key is not None:
        authorize(actor, "publish", "当前账号无权核对发布回执")
        receipt = actor.id, request_key
    rows, total = store.audit_page(db, include_accounts=actor.can_manage, include_content=actor.can_edit,
                                   receipt=receipt, actor_id=actor_id, target_kind=target_kind, target_id=target_id,
                                   page=page, page_size=page_size)
    return _page([_audit_row(row) for row in rows], total, page, page_size)
