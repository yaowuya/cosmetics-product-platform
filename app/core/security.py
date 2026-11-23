"""后台口令的存储格式、恒时校验及会话令牌摘要。"""
import hashlib
import hmac
import secrets

HASH_ROUNDS = 600_000
# 登录名不存在时也执行 PBKDF2；这是占位摘要，不是可用于登录的凭据。
DUMMY_PASSWORD_HASH = f"pbkdf2_sha256${HASH_ROUNDS}${'0' * 32}${'0' * 64}"


def hash_password(password: str) -> str:
    """为符合长度要求的新密码生成独立随机盐，沿用已存口令的 PBKDF2 格式。"""
    if not 6 <= len(password) <= 128:
        raise ValueError("Passwords must contain between 6 and 128 characters")
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, HASH_ROUNDS)
    return f"pbkdf2_sha256${HASH_ROUNDS}${salt.hex()}${digest.hex()}"


def password_matches(password: str, encoded: str) -> bool:
    """恒时比较摘要；未知算法、迭代次数或无效编码均不匹配。"""
    try:
        format_, iterations, salt, digest = encoded.split("$")
        if format_ != "pbkdf2_sha256" or int(iterations) != HASH_ROUNDS:
            return False
        actual = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), HASH_ROUNDS)
        return hmac.compare_digest(actual, bytes.fromhex(digest))
    except ValueError:
        return False


def token_digest(token: str) -> str:
    """计算会话协议使用的 SHA-256 十六进制摘要，不存储 bearer 明文。"""
    return hashlib.sha256(token.encode()).hexdigest()
