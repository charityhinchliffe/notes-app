from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field, field_validator, model_validator


def clean_tag_name(value: str) -> str:
    return " ".join(value.split())


class TagCreate(BaseModel):
    name: str = Field(min_length=1, max_length=24)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        cleaned = clean_tag_name(value)
        if not cleaned:
            raise ValueError("Tag name is required")
        if len(cleaned) > 24:
            raise ValueError("Tag name must be 24 characters or fewer")
        return cleaned


class TagOut(BaseModel):
    id: str
    name: str
    created_at: datetime


class NoteCreate(BaseModel):
    title: str = Field(default="", max_length=300)
    content: str = Field(default="", max_length=50000)
    tag_ids: List[str] = Field(default_factory=list)

    @field_validator("title", "content")
    @classmethod
    def strip_text(cls, value: str) -> str:
        return value.strip()

    @field_validator("tag_ids")
    @classmethod
    def dedupe_tag_ids(cls, value: List[str]) -> List[str]:
        seen = []
        for tag_id in value:
            if tag_id not in seen:
                seen.append(tag_id)
        return seen

    @model_validator(mode="after")
    def require_text(self):
        if not self.title and not self.content:
            raise ValueError("A note needs a title or content")
        return self


class NoteUpdate(BaseModel):
    title: Optional[str] = Field(default=None, max_length=300)
    content: Optional[str] = Field(default=None, max_length=50000)

    @model_validator(mode="after")
    def require_a_field(self):
        if self.title is None and self.content is None:
            raise ValueError("Provide a title or content to update")
        return self


class AttachTags(BaseModel):
    tag_ids: List[str] = Field(min_length=1)

    @field_validator("tag_ids")
    @classmethod
    def dedupe_tag_ids(cls, value: List[str]) -> List[str]:
        seen = []
        for tag_id in value:
            cleaned = tag_id.strip()
            if not cleaned:
                raise ValueError("Tag id cannot be empty")
            if cleaned not in seen:
                seen.append(cleaned)
        return seen


class PasswordCheck(BaseModel):
    password: str = Field(min_length=1)


class PasswordCheckResult(BaseModel):
    valid: bool


class PasswordChange(BaseModel):
    current_password: str = Field(min_length=1)
    new_password: str = Field(min_length=1)


class PasswordChangeResult(BaseModel):
    updated: bool


class LockStatus(BaseModel):
    locked: bool


class NoteOut(BaseModel):
    id: str
    title: str
    content: str
    tags: List[TagOut]
    created_at: datetime
    updated_at: datetime
