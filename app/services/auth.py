"""认证后台账号、管理可撤销会话，并在写事务中复核当前能力。"""
from datetime import UTC, datetime, timedelta
import secrets
from typing import Literal

from sqlalchemy.orm import Session

from app.core.errors import AppError
from app.core.security import DUMMY_PASSWORD_HASH, hash_password, password_matches, token_digest
from app.models import Account, UserSession
from app.repositories import accounts as store

Capability = Literal["edit", "publish", "manage"]
SESSION_SECONDS = 8 * 60 * 60


def authorize(actor: Account | None, action: Capability, message: str = "当前账号没有此操作权限") -> Account:
    """拒绝已撤权、未启用或未改临时密码的账号；管理权不蕴含内容权限。"""
    if actor is not None and actor.enabled and not actor.must_change_password:
        available = {"edit": actor.can_edit, "publish": actor.can_edit and actor.can_publish, "manage": actor.can_manage}
        if available[action]:
            return actor
    raise AppError(403, "forbidden", message)


def ensure_editor(db: Session, actor: Account) -> None:
    """在调用方事务中先锁操作者、后锁内容；使用锁后的能力复核编辑权。"""
    store.refresh_for_update(db, actor)
    authorize(actor, "edit", "当前账号没有编辑权限")


def publisher_now(db: Session, actor_id: int) -> Account:
    """在发布或生命周期事务中锁定操作者并复核编辑及发布权，不另行提交。"""
    actor = store.lock_accounts(db, actor_id).get(actor_id)
    return authorize(actor, "publish", "当前没有发布权限")


def capability_fields(account: Account) -> dict:
    """返回允许展示的能力及临时密码状态，不含凭据。"""
    return {"can_edit": account.can_edit, "can_publish": account.can_publish,
            "can_manage": account.can_manage, "must_change_password": account.must_change_password}


def _session_profile(account: Account) -> dict:
    return {"id": str(account.id), "login": account.login, **capability_fields(account)}


def _now() -> datetime:
    # MySQL DATETIME 以无时区 UTC 值存储；到期比较和签发使用同一时钟。
    return datetime.now(UTC).replace(tzinfo=None)


def current_session(db: Session, token: str | None) -> tuple[Account, UserSession, str]:
    """凭令牌摘要实时关联启用的账号和有效会话，区分未登录和会话已失效。"""
    if not token:
        raise AppError(401, "session_required", "请登录")
    match = store.active_session(db, token_digest(token), _now())
    if match is None:
        raise AppError(401, "session_expired", "会话已失效")
    return match[0], match[1], token


def _issue_session(db: Session, account: Account) -> tuple[dict, str]:
    # 仅摘要入库；提前提取公开字段，避免提交后延迟加载读取下一事务的状态。
    token = secrets.token_urlsafe(32)
    store.add_session(db, account.id, token_digest(token), _now() + timedelta(seconds=SESSION_SECONDS))
    return _session_profile(account), token


def sign_in(db: Session, login: str, password: str, previous: str | None) -> tuple[dict, str]:
    """锁定账号并校验口令；成功才原子地撤销旧令牌、签发新会话。"""
    with db.begin():
        actor = store.lock_by_login(db, login.strip())
        encoded = actor.password_hash if actor else DUMMY_PASSWORD_HASH
        valid = password_matches(password, encoded)
        if actor is None or not actor.enabled or not valid:
            raise AppError(401, "invalid_login", "登录名或密码错误")
        if previous:
            store.delete_session_by_hash(db, token_digest(previous))
        return _issue_session(db, actor)


def my_profile(db: Session, token: str | None) -> tuple[dict, str]:
    """普通身份查询要求首次改密已完成；查询不续期或轮换会话。"""
    actor, _, token = current_session(db, token)
    if actor.must_change_password:
        raise AppError(403, "password_change_required", "请先修改临时密码")
    return _session_profile(actor), token


def _current_transaction(db: Session):
    # 当前会话查询已开启事务。复用其上下文，写入成功才提交，失败立即回滚并释放锁。
    transaction = db.get_transaction()
    if transaction is None:
        raise RuntimeError("Current session transaction is required")
    return transaction


def change_password(db: Session, actor: Account, old_password: str, new_password: str) -> tuple[dict, str]:
    """在验证当前会话开启的事务内锁定账号，原子更新密码并撤销所有旧会话。"""
    with _current_transaction(db):
        store.refresh_for_update(db, actor)
        if not actor.enabled:
            raise AppError(401, "session_expired", "会话已失效")
        if not password_matches(old_password, actor.password_hash) or new_password == old_password:
            raise AppError(422, "invalid_password_change", "原密码错误或新旧密码相同")
        store.set_changed_password(actor, hash_password(new_password))
        store.delete_account_sessions(db, actor.id)
        return _issue_session(db, actor)


def sign_out(db: Session, stored: UserSession) -> None:
    """撤销并提交已认证的这一条会话；首次登录尚未改密也允许退出。"""
    with _current_transaction(db):
        store.delete_session(db, stored)
