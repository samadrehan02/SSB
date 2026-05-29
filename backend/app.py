from uuid import uuid4
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from backend.config import SETTINGS
from backend.schemas import HealthResponse, SessionResponse, ResetResponse, ChatRequest, ChatResponse
from backend.session_manager import SessionManager
from backend.websocket_handler import WsHandler
from backend.ollama_client import healthcheck, chat_once


app = FastAPI(title=SETTINGS.app_name, version=SETTINGS.app_version)

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(SETTINGS.cors_origins),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

session_manager = SessionManager()
ws_handler = WsHandler(session_manager)


@app.get("/", response_model=HealthResponse, tags=["health"])
async def root():
    return HealthResponse(
        status="ok",
        message="SSB Interview Prep Backend is running",
        model=SETTINGS.ollama_model,
    )


@app.get("/health", response_model=HealthResponse, tags=["health"])
async def health():
    ollama_ok = await healthcheck()
    status = "ok" if ollama_ok else "degraded"
    message = "Ollama reachable" if ollama_ok else "Ollama not reachable"
    return HealthResponse(status=status, message=message, model=SETTINGS.ollama_model)


@app.post("/session", response_model=SessionResponse, tags=["session"])
async def create_session():
    client_id = str(uuid4())
    session_manager.create_session(client_id)
    return SessionResponse(client_id=client_id)


@app.post("/session/{client_id}/reset", response_model=ResetResponse, tags=["session"])
async def reset_session(client_id: str):
    session_manager.reset(client_id)
    return ResetResponse(status="reset", client_id=client_id)


@app.get("/session/{client_id}/history", tags=["session"])
async def get_history(client_id: str):
    return {"client_id": client_id, "messages": session_manager.get_history(client_id)}


@app.post("/chat", response_model=ChatResponse, tags=["chat"])
async def chat(req: ChatRequest):
    text = req.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Text cannot be empty")
    session_manager.append_user(req.client_id, text)
    reply = await chat_once(session_manager.get_history(req.client_id))
    session_manager.append_assistant(req.client_id, reply)
    return ChatResponse(reply=reply)


@app.websocket("/ws/{client_id}")
async def websocket_endpoint(websocket: WebSocket, client_id: str):
    await ws_handler.connect(websocket, client_id)
    try:
        while True:
            data = await ws_handler.receive(websocket)
            msg_type = data.get("type")

            if msg_type == "ping":
                await ws_handler.send_json(websocket, {"type": "pong"})
                continue

            if msg_type == "reset":
                session_manager.reset(client_id)
                await ws_handler.send_json(websocket, {"type": "reset_ok"})
                continue

            if msg_type == "user_message":
                text = (data.get("text") or "").strip()
                if text:
                    await ws_handler.handle_user_message(websocket, client_id, text)

    except WebSocketDisconnect:
        ws_handler.disconnect(client_id)
    except Exception as exc:
        try:
            await ws_handler.send_json(websocket, {"type": "error", "message": str(exc)})
        finally:
            ws_handler.disconnect(client_id)