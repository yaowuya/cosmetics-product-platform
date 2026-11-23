"""Wire contracts for checking, publishing and retiring a reviewed revision."""
from pydantic import BaseModel, ConfigDict, Field, StrictBool

from app.schemas.common import Choice


class CheckDraft(BaseModel):
    """Bind checking to the revision the publisher selected."""

    model_config = ConfigDict(extra="forbid")
    expected_revision: str


class CheckBatch(BaseModel):
    """Check only the explicitly selected product revisions."""

    model_config = ConfigDict(extra="forbid")
    items: list[Choice] = Field(max_length=200)


class PublishDraft(CheckDraft):
    """Idempotency is bound to one actor, item and source revision."""

    request_key: str = Field(pattern=r"^[A-Za-z0-9_-]{1,128}$")


class RestoreRequest(BaseModel):
    """Authorize replacing one current draft only if its revision still matches."""

    model_config = ConfigDict(extra="forbid")
    expected_revision: str
    confirm_overwrite: StrictBool


class ConfirmDraft(BaseModel):
    """Bind a destructive operation to an explicit confirmation and current revision."""

    model_config = ConfigDict(extra="forbid")
    expected_revision: str
    confirmed: StrictBool


class ConfirmLifecycle(ConfirmDraft):
    """Accept the exact list of associated cases that was shown for review."""

    case_ids: list[str] = Field(default_factory=list)
