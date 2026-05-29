from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    app_name: str = "SSB Interview Prep Backend"
    app_version: str = "0.1.0"
    ollama_host: str = "http://127.0.0.1:11434"
    ollama_model: str = "dolphin3:8b"
    ollama_temperature: float = 0.2
    max_history_turns: int = 12
    default_stt_lang: str = "en-IN"
    cors_origins: tuple[str, ...] = (
        "http://127.0.0.1:5500",
        "http://localhost:5500",
        "http://127.0.0.1:8080",
        "http://localhost:8080",
        "null",
    )
    system_prompt: str = (
        "You are an Indian Army SSB interviewer conducting a realistic interview. "
        "Ask one question at a time. Keep responses concise, natural, and spoken. "
        "Probe for Officer Like Qualities such as leadership, initiative, courage, "
        "social adaptability, reasoning, integrity, and communication. "
        "If the candidate gives a vague answer, ask a sharp follow-up question. "
        "Do not give long lectures unless the candidate asks for feedback. "
        "When feedback is requested, give practical SSB-focused feedback in bullet style."
    )


SETTINGS = Settings()