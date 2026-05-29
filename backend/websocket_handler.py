import json
from typing import Dict
from fastapi import WebSocket
from backend.ollama_client import stream_chat
from backend.session_manager import SessionManager


class WsHandler:
    def __init__(self, session_mgr: SessionManager):
        self.sm = session_mgr
        self._conns: Dict[str, WebSocket] = {}

    async def connect(self, websocket: WebSocket, client_id: str) -> None:
        await websocket.accept()
        self._conns[client_id] = websocket
        self.sm.get_or_create(client_id)

    def disconnect(self, client_id: str) -> None:
        self._conns.pop(client_id, None)

    async def receive(self, websocket: WebSocket) -> Dict:
        raw = await websocket.receive_text()
        return json.loads(raw)

    async def send_json(self, websocket: WebSocket, payload: Dict) -> None:
        await websocket.send_text(json.dumps(payload))

    async def handle_user_message(self, websocket: WebSocket, client_id: str, user_text: str) -> None:
        self.sm.append_user(client_id, user_text)
        await self.send_json(websocket, {"type": "assistant_start"})
        conv = self.sm.get_history(client_id)
        assistant_reply = ""
        async for token in stream_chat(conv):
            assistant_reply += token
            await self.send_json(websocket, {"type": "assistant_token", "token": token})
        self.sm.append_assistant(client_id, assistant_reply)
        await self.send_json(websocket, {"type": "assistant_end"})