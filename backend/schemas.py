from typing import Literal, Optional
from pydantic import BaseModel


class HealthResponse(BaseModel):
    status: str
    message: str
    model: str


class SessionResponse(BaseModel):
    client_id: str


class ResetResponse(BaseModel):
    status: str
    client_id: str


class ChatRequest(BaseModel):
    client_id: str
    text: str


class ChatResponse(BaseModel):
    reply: str


class FrontendMessage(BaseModel):
    type: Literal["user_message", "ping", "reset"]
    text: Optional[str] = None


class BackendTokenMessage(BaseModel):
    type: Literal["assistant_start", "assistant_token", "assistant_end", "error", "pong", "reset_ok"]
    token: Optional[str] = None
    message: Optional[str] = None