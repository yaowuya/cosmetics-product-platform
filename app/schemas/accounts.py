"""后台登录、首次改密和账号治理的请求体契约。"""
from pydantic import BaseModel, ConfigDict, Field


class LoginInput(BaseModel):
    """Only the login and password participate in sign-in."""

    login: str = Field(min_length=1, max_length=190)
    password: str = Field(min_length=1, max_length=128)


class ChangePasswordInput(BaseModel):
    """Changing a password requires the existing password and a new usable secret."""

    old_password: str = Field(min_length=1, max_length=128)
    new_password: str = Field(min_length=6, max_length=128)


class NewAccount(BaseModel):
    """Create an account with only the explicitly requested capabilities."""

    model_config = ConfigDict(extra="forbid")
    login: str = Field(min_length=1, max_length=190)
    password: str = Field(min_length=6, max_length=128)
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
