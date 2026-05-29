import json
from typing import AsyncIterable, List, Dict
import httpx
from backend.config import SETTINGS


async def healthcheck() -> bool:
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(f"{SETTINGS.ollama_host}/api/tags")
            return response.status_code == 200
    except Exception:
        return False


async def stream_chat(messages: List[Dict[str, str]]) -> AsyncIterable[str]:
    payload = {
        "model": SETTINGS.ollama_model,
        "messages": messages,
        "stream": True,
        "options": {
            "temperature": SETTINGS.ollama_temperature,
        },
    }
    async with httpx.AsyncClient(timeout=None) as client:
        async with client.stream(
            "POST",
            f"{SETTINGS.ollama_host}/api/chat",
            json=payload,
        ) as resp:
            resp.raise_for_status()
            async for line in resp.aiter_lines():
                if not line:
                    continue
                data = json.loads(line)
                if "message" in data and data["message"].get("content"):
                    yield data["message"]["content"]
                if data.get("done"):
                    break


async def chat_once(messages: List[Dict[str, str]]) -> str:
    chunks = []
    async for chunk in stream_chat(messages):
        chunks.append(chunk)
    return "".join(chunks)