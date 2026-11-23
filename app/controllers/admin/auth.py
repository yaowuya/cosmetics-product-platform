"""后台登录、身份查询、改密与注销的 HTTPS 协议适配。"""
from collections import OrderedDict
import secrets
from threading import Lock
import time

from fastapi import APIRouter, Request, Response

from app.controllers.dependencies import Db, SESSION_COOKIE, check_csrf, csrf_for, current_write_session
from app.core.errors import AppError
from app.schemas.accounts import ChangePasswordInput, LoginInput
from app.services import auth

router = APIRouter(prefix="/api/admin")
_LOGIN_CSRF_COOKIE = "showcase_login_csrf"
_LOGIN_PATH = "/api/admin/login"
_COOKIE_FLAGS = {"secure": True, "httponly": True, "samesite": "strict"}
_attempts: OrderedDict[str, tuple[float, int]] = OrderedDict()
_attempt_lock = Lock()


def _limit_login(request: Request) -> None:
    # 从客户端首次尝试起计 60 秒，窗口内最多十次；表满时淘汰最久未用的来源。
    key = request.client.host if request.client else "unknown"
    now = time.monotonic()
    with _attempt_lock:
        start, count = _attempts.get(key, (now, 0))
        if now - start >= 60:
            start, count = now, 0
        if count >= 10:
            raise AppError(429, "login_limited", "登录尝试过多，请稍后重试")
        _attempts[key] = (start, count + 1)
        _attempts.move_to_end(key)
        if len(_attempts) > 1024:
            _attempts.popitem(last=False)


def _session_view(profile: dict, token: str) -> dict:
    return {**profile, "csrf_token": csrf_for(token)}


def _new_session_response(response: Response, profile: dict, token: str) -> dict:
    # 仅在服务成功提交后发送新的 bearer。读取 /me 不走此路径，也不续期。
    response.set_cookie(SESSION_COOKIE, token, max_age=auth.SESSION_SECONDS, path="/", **_COOKIE_FLAGS)
    return _session_view(profile, token)


@router.get("/login")
def login_challenge(request: Request, response: Response) -> dict[str, str]:
    """Return a short-lived anonymous anti-forgery challenge over HTTPS."""
    if request.url.scheme != "https":
        raise AppError(403, "https_required", "登录必须使用 HTTPS")
    nonce = secrets.token_urlsafe(32)
    response.set_cookie(_LOGIN_CSRF_COOKIE, nonce, max_age=600, path=_LOGIN_PATH, **_COOKIE_FLAGS)
    return {"csrf_token": nonce}


@router.post("/login")
def login(data: LoginInput, request: Request, response: Response, db: Db) -> dict:
    """Authenticate against the current account and rotate the browser session on success."""
    check_csrf(request, request.cookies.get(_LOGIN_CSRF_COOKIE))
    _limit_login(request)
    issued = auth.sign_in(db, data.login, data.password, request.cookies.get(SESSION_COOKIE))
    result = _new_session_response(response, *issued)
    response.delete_cookie(_LOGIN_CSRF_COOKIE, path=_LOGIN_PATH, **_COOKIE_FLAGS)
    return result


@router.get("/me")
def me(request: Request, db: Db) -> dict:
    """Return current capabilities, except during first-login password change."""
    return _session_view(*auth.my_profile(db, request.cookies.get(SESSION_COOKIE)))


@router.post("/change-password")
def change_password(data: ChangePasswordInput, request: Request, response: Response, db: Db) -> dict:
    """Change the password atomically, invalidate older sessions, and permit the new session."""
    actor, _ = current_write_session(request, db)
    issued = auth.change_password(db, actor, data.old_password, data.new_password)
    return _new_session_response(response, *issued)


@router.post("/logout", status_code=204, response_class=Response)
def logout(request: Request, db: Db) -> Response:
    """Invalidate the session digest and clear its cookie, including during first login."""
    _, stored = current_write_session(request, db)
    auth.sign_out(db, stored)
    response = Response(status_code=204)
    response.delete_cookie(SESSION_COOKIE, path="/", **_COOKIE_FLAGS)
    return response
