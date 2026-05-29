from typing import Dict, List
from backend.config import SETTINGS


Message = Dict[str, str]


class SessionManager:
    def __init__(self) -> None:
        self._store: Dict[str, List[Message]] = {}

    def create_session(self, session_id: str) -> List[Message]:
        self._store[session_id] = [{"role": "system", "content": SETTINGS.system_prompt}]
        return self._store[session_id]

    def get_or_create(self, session_id: str) -> List[Message]:
        if session_id not in self._store:
            return self.create_session(session_id)
        return self._store[session_id]

    def append_user(self, session_id: str, text: str) -> None:
        conv = self.get_or_create(session_id)
        conv.append({"role": "user", "content": text})
        self._trim(conv)

    def append_assistant(self, session_id: str, text: str) -> None:
        conv = self.get_or_create(session_id)
        conv.append({"role": "assistant", "content": text})
        self._trim(conv)

    def get_history(self, session_id: str) -> List[Message]:
        return self.get_or_create(session_id)

    def reset(self, session_id: str) -> None:
        self.create_session(session_id)

    def delete(self, session_id: str) -> None:
        self._store.pop(session_id, None)

    def _trim(self, conv: List[Message]) -> None:
        keep_messages = SETTINGS.max_history_turns * 2
        if len(conv) <= keep_messages + 1:
            return
        system_message = conv[0]
        trimmed = conv[-keep_messages:]
        conv[:] = [system_message] + trimmed