"""HTTPS login, revocable database sessions and live capability checks."""
from collections import OrderedDict
from datetime import UTC, datetime, timedelta
import hashlib
import hmac
import secrets
from threading import Lock
import time
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.db import session
from app.models import Account, UserSession

router = APIRouter(prefix="/api/admin")
Db = Annotated[Session, Depends(session)]
SESSION_COOKIE = "showcase_session"
LOGIN_CSRF_COOKIE = "showcase_login_csrf"
SESSION_SECONDS = 8 * 60 * 60
HASH_ROUNDS = 600_000
_attempts: OrderedDict[str, tuple[float, int]] = OrderedDict()
_attempt_lock = Lock()


class LoginInput(BaseModel):
    """Only the login and password participate in sign-in."""

    login: str = Field(min_length=1, max_length=190)
    password: str = Field(min_length=1, max_length=128)


class ChangePasswordInput(BaseModel):
    """Changing a password requires the existing password and a new usable secret."""

    old_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=12, max_length=128)


def hash_password(password: str) -> str:
    """Store PBKDF2-SHA256 with a new per-password salt, never the password itself."""
    if not 12 <= len(password) <= 128:
        raise ValueError("Passwords must contain between 12 and 128 characters")
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, HASH_ROUNDS)
    return f"pbkdf2_sha256${HASH_ROUNDS}${salt.hex()}${digest.hex()}"


def password_matches(password: str, encoded: str) -> bool:
    """Check the digest in constant time and reject unsupported stored formats."""
    try:
        format_, iterations, salt, digest = encoded.split("$")
        if format_ != "pbkdf2_sha256" or int(iterations) != HASH_ROUNDS:
            return False
        actual = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), HASH_ROUNDS)
        return hmac.compare_digest(actual, bytes.fromhex(digest))
    except ValueError:
        return False


# Consume the same hash work for a login that does not match an account.
DUMMY_PASSWORD_HASH = f"pbkdf2_sha256${HASH_ROUNDS}${'0' * 32}${'0' * 64}"


def _error(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status, {"code": code, "message": message, "issues": []})


def _check_origin(request: Request) -> None:
    if request.url.scheme != "https" or request.headers.get("origin") != f"https://{request.url.netloc}":
        raise _error(403, "invalid_origin", "请求来源无效")


def _check_csrf(request: Request, expected: str | None) -> None:
    _check_origin(request)
    sent = request.headers.get("x-csrf-token", "")
    if not expected or not hmac.compare_digest(sent.encode(), expected.encode()):
        raise _error(403, "invalid_csrf", "请求防伪校验失败")


def _limit_login(request: Request) -> None:
    key = request.client.host if request.client else "unknown"
    now = time.monotonic()
    with _attempt_lock:
        start, count = _attempts.get(key, (now, 0))
        if now - start >= 60:
            start, count = now, 0
        if count >= 10:
            raise _error(429, "login_limited", "登录尝试过多，请稍后重试")
        _attempts[key] = (start, count + 1)
        _attempts.move_to_end(key)
        if len(_attempts) > 1024:
            _attempts.popitem(last=False)


def _digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _csrf_for(token: str) -> str:
    # A returned CSRF value cannot serve as the stored hash or the bearer cookie.
    return _digest(f"csrf:{token}")


def _now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def _current(db: Session, request: Request) -> tuple[Account, UserSession, str]:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        raise _error(401, "session_required", "请登录")
    match = db.execute(select(Account, UserSession).join(UserSession, UserSession.account_id == Account.id).where(
        Account.enabled.is_(True), UserSession.token_hash == _digest(token), UserSession.expires_at > _now(),
    )).one_or_none()
    if match is None:
        raise _error(401, "session_expired", "会话已失效")
    return match[0], match[1], token


def require(action: Literal["edit", "publish", "manage"]):
    """Return a route dependency that checks live capability, change-password state and write CSRF."""
    def guard(request: Request, db: Db) -> Account:
        """Return the current actor; authenticated sessions do not imply any role."""
        actor, _, token = _current(db, request)
        available = {"edit": actor.can_edit, "publish": actor.can_edit and actor.can_publish, "manage": actor.can_manage}
        if actor.must_change_password or not available[action]:
            raise _error(403, "forbidden", "当前账号没有此操作权限")
        if request.method not in {"GET", "HEAD", "OPTIONS"}:
            _check_csrf(request, _csrf_for(token))
        return actor
    return guard


def _capabilities(account: Account, token: str) -> dict:
    return {"id": str(account.id), "login": account.login, "can_edit": account.can_edit,
            "can_publish": account.can_publish, "can_manage": account.can_manage,
            "must_change_password": account.must_change_password, "csrf_token": _csrf_for(token)}


def _new_session(db: Session, account: Account, response: Response) -> str:
    token = secrets.token_urlsafe(32)
    db.add(UserSession(token_hash=_digest(token), account_id=account.id,
                       expires_at=_now() + timedelta(seconds=SESSION_SECONDS)))
    response.set_cookie(SESSION_COOKIE, token, max_age=SESSION_SECONDS, secure=True, httponly=True,
                        samesite="strict", path="/")
    return token


@router.get("/login")
def login_challenge(request: Request, response: Response) -> dict[str, str]:
    """Return a short-lived anonymous anti-forgery challenge over HTTPS."""
    if request.url.scheme != "https":
        raise _error(403, "https_required", "登录必须使用 HTTPS")
    nonce = secrets.token_urlsafe(32)
    response.set_cookie(LOGIN_CSRF_COOKIE, nonce, max_age=600, secure=True, httponly=True,
                        samesite="strict", path="/api/admin/login")
    return {"csrf_token": nonce}


@router.post("/login")
def login(data: LoginInput, request: Request, response: Response, db: Db) -> dict:
    """Authenticate against the current account and rotate the browser session on success."""
    _check_csrf(request, request.cookies.get(LOGIN_CSRF_COOKIE))
    _limit_login(request)
    with db.begin():
        actor = db.scalar(select(Account).where(Account.login == data.login.strip()).with_for_update())
        encoded = actor.password_hash if actor else DUMMY_PASSWORD_HASH
        valid = password_matches(data.password, encoded)
        if actor is None or not actor.enabled or not valid:
            raise _error(401, "invalid_login", "登录名或密码错误")
        previous = request.cookies.get(SESSION_COOKIE)
        if previous:
            db.execute(delete(UserSession).where(UserSession.token_hash == _digest(previous)))
        token = _new_session(db, actor, response)
        result = _capabilities(actor, token)
    response.delete_cookie(LOGIN_CSRF_COOKIE, path="/api/admin/login", secure=True, httponly=True, samesite="strict")
    return result


@router.get("/me")
def me(request: Request, db: Db) -> dict:
    """Return current capabilities, except during first-login password change."""
    actor, _, token = _current(db, request)
    if actor.must_change_password:
        raise _error(403, "password_change_required", "请先修改临时密码")
    return _capabilities(actor, token)


@router.post("/change-password")
def change_password(data: ChangePasswordInput, request: Request, response: Response, db: Db) -> dict:
    """Change the password atomically, invalidate older sessions, and permit the new session."""
    with db.begin():
        actor, _, token = _current(db, request)
        _check_csrf(request, _csrf_for(token))
        db.refresh(actor, with_for_update=True)
        if not actor.enabled:
            raise _error(401, "session_expired", "会话已失效")
        if not password_matches(data.old_password, actor.password_hash) or data.new_password == data.old_password:
            raise _error(422, "invalid_password_change", "原密码错误或新旧密码相同")
        actor.password_hash = hash_password(data.new_password)
        actor.must_change_password = False
        db.execute(delete(UserSession).where(UserSession.account_id == actor.id))
        token = _new_session(db, actor, response)
        return _capabilities(actor, token)


@router.post("/logout", status_code=204, response_class=Response)
def logout(request: Request, db: Db) -> Response:
    """Invalidate the session digest and clear its cookie, including during first login."""
    with db.begin():
        _, stored, token = _current(db, request)
        _check_csrf(request, _csrf_for(token))
        db.delete(stored)
    response = Response(status_code=204)
    response.delete_cookie(SESSION_COOKIE, path="/", secure=True, httponly=True, samesite="strict")
    return response
