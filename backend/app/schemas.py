"""Pydantic request/response models for the API."""
from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel


class ChatRequest(BaseModel):
    message: str
    conversation_id: Optional[str] = None
    user_id: str = "demo-user"


class ArtifactOut(BaseModel):
    id: str
    title: Optional[str] = None
    status: str
    version: int


class ChatResponse(BaseModel):
    conversation_id: str
    plan: dict[str, Any]
    reply: str
    artifact: Optional[ArtifactOut] = None
