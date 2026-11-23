"""账号、会话及治理审计的 InnoDB 读写；事务由调用服务结束。"""
from collections.abc import Sequence
from datetime import datetime

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.models import Account, Audit, UserSession


def first_account_exists_for_update(db: Session) -> bool:
    """在初始化事务中锁定检查首条账号，不把非空实例当作引导目标。"""
    return db.scalar(select(Account.id).limit(1).with_for_update()) is not None


def lock_by_login(db: Session, login: str) -> Account | None:
    """按登录名读取并锁定账号，直到本次认证事务结束。"""
    return db.scalar(select(Account).where(Account.login == login).with_for_update())


def lock_accounts(db: Session, *account_ids: int) -> dict[int, Account]:
    """按主键升序一次锁定操作者和目标，等待后用当前值覆盖身份映射中的旧对象。"""
    query = (select(Account).where(Account.id.in_(set(account_ids))).order_by(Account.id)
             .with_for_update().execution_options(populate_existing=True))
    return {account.id: account for account in db.scalars(query).all()}


def refresh_for_update(db: Session, account: Account) -> None:
    """先锁定并刷新请求中已加载的账号，再由服务复核其状态。"""
    db.refresh(account, with_for_update=True)


def add_account(db: Session, login: str, password_hash: str, *, can_manage: bool,
                can_edit: bool = False, can_publish: bool = False) -> Account:
    """插入并 flush 以取得主键，供同一事务记录审计或返回首管理员 ID。"""
    account = Account(login=login, password_hash=password_hash, can_edit=can_edit,
                      can_publish=can_publish, can_manage=can_manage)
    db.add(account)
    db.flush()
    return account


def apply_capabilities(account: Account, changes: dict[str, bool]) -> dict:
    """仅更新通过服务校验且发生变化的字段，返回对应的审计前后值。"""
    difference = {}
    for field, value in changes.items():
        before = getattr(account, field)
        if before != value:
            difference[field] = {"before": before, "after": value}
            setattr(account, field, value)
    return difference


def set_changed_password(account: Account, encoded: str) -> None:
    """在当前事务内替换摘要并清除首次登录的改密标志。"""
    account.password_hash = encoded
    account.must_change_password = False


def active_session(db: Session, token_hash: str, now: datetime) -> tuple[Account, UserSession] | None:
    """只返回未到期且账号仍启用的会话，与账号同查以读取本次请求的实际能力。"""
    query = select(Account, UserSession).join(UserSession, UserSession.account_id == Account.id).where(
        Account.enabled.is_(True), UserSession.token_hash == token_hash, UserSession.expires_at > now,
    )
    match = db.execute(query).one_or_none()
    return None if match is None else (match[0], match[1])


def add_session(db: Session, account_id: int, token_hash: str, expires_at: datetime) -> None:
    """登记新会话的摘要与 UTC 到期时间，随账号操作一并提交。"""
    db.add(UserSession(token_hash=token_hash, account_id=account_id, expires_at=expires_at))


def delete_session_by_hash(db: Session, token_hash: str) -> None:
    """轮换登录会话时按旧摘要撤销；旧会话不存在时不影响新登录。"""
    db.execute(delete(UserSession).where(UserSession.token_hash == token_hash))


def delete_account_sessions(db: Session, account_id: int) -> None:
    """撤销指定账号的全部会话，包括其他浏览器上的会话。"""
    db.execute(delete(UserSession).where(UserSession.account_id == account_id))


def delete_session(db: Session, stored: UserSession) -> None:
    """注销刚刚认证得到的会话记录。"""
    db.delete(stored)


def add_account_audit(db: Session, actor_id: int, action: str, target_id: int, details: dict) -> None:
    """写入账号治理事件，与同一事务的账号变动具有相同提交结果。"""
    db.add(Audit(actor_id=actor_id, action=action, target_kind="account", target_id=target_id, details=details))


def _page(db: Session, query, page: int, page_size: int):
    # 计数必须沿用所有过滤条件，排序只作用于取页本身。
    total = db.scalar(select(func.count()).select_from(query.order_by(None).subquery()))
    rows = db.scalars(query.offset((page - 1) * page_size).limit(page_size)).all()
    return rows, total


def account_page(db: Session, page: int, page_size: int) -> tuple[Sequence[Account], int]:
    """按稳定的账号主键顺序分页，返回本页账号和总条数。"""
    return _page(db, select(Account).order_by(Account.id), page, page_size)


def audit_page(db: Session, *, include_accounts: bool, include_content: bool,
               receipt: tuple[int, str] | None, actor_id: int | None, target_kind: str | None,
               target_id: int | None, page: int, page_size: int) -> tuple[Sequence[Audit], int]:
    """在服务授予的可见范围内叠加发布回执、操作者和目标过滤，再分页计数。"""
    query = select(Audit)
    if receipt is not None:
        publisher_id, request_key = receipt
        query = query.where(Audit.action == "publish", Audit.actor_id == publisher_id, Audit.request_key == request_key)
    if not include_content:
        query = query.where(Audit.target_kind == "account")
    if not include_accounts:
        query = query.where(Audit.target_kind != "account")
    for column, value in ((Audit.actor_id, actor_id), (Audit.target_kind, target_kind), (Audit.target_id, target_id)):
        if value is not None:
            query = query.where(column == value)
    return _page(db, query.order_by(Audit.occurred_at.desc(), Audit.id.desc()), page, page_size)
