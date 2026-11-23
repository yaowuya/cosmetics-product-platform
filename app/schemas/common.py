"""Wire types shared by endpoints that operate on stable item identities."""
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field

ItemId = Annotated[int, Field(ge=1, le=2**63 - 1)]


class Choice(BaseModel):
    """A selected resource and the exact revision the caller reviewed."""

    model_config = ConfigDict(extra="forbid")
    id: str
    expected_revision: str
