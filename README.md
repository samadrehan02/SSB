# SSB Interview Prep

A local full-stack voice interview simulator for **Indian Army SSB preparation** built with FastAPI, WebSockets, Ollama, and a browser-based voice interface.

This project lets a candidate speak into the browser, stream the spoken response into the UI, send the final transcript to a FastAPI backend over WebSocket, generate an interviewer reply through Ollama, stream the model response token-by-token back to the frontend, and optionally speak the reply using browser TTS. 

## Features

- Live browser speech-to-text using the Web Speech API. 
- Token-streamed interviewer responses over WebSocket. 
- Per-session conversation memory using an in-memory session manager. 
- Ollama-backed local LLM inference with configurable model and host. 
- Browser text-to-speech playback for interviewer replies. 
- Session creation, reset, history fetch, and one-shot HTTP chat endpoints. 
- Split frontend files (`index.html`, `styles.css`, `app.js`) for maintainability. 

## Architecture

```text
Browser Mic
  -> SpeechRecognition (frontend STT)
  -> WebSocket client
  -> FastAPI /ws/{client_id}
  -> SessionManager
  -> Ollama /api/chat
  -> token stream back to frontend
  -> Browser UI render + speechSynthesis TTS
```

The frontend is responsible for microphone capture, interim transcript rendering, WebSocket connection management, waveform animation, and browser TTS. The backend is responsible for session state, WebSocket orchestration, HTTP API endpoints, and proxying conversation context into Ollama. 

## Project Structure

```text
ssb-interview-prep/
├── backend/
│   ├── __init__.py
│   ├── app.py
│   ├── config.py
│   ├── ollama_client.py
│   ├── schemas.py
│   ├── session_manager.py
│   ├── websocket_handler.py
│   └── requirements.txt
├── frontend/
│   ├── index.html
│   ├── styles.css
│   └── app.js
└── README.md
```

## Backend Endpoints

| Method | Route | Purpose |
|---|---|---|
| GET | `/` | Basic service status.  |
| GET | `/health` | Backend and Ollama reachability check.  |
| POST | `/session` | Create a new client session ID.  |
| POST | `/session/{client_id}/reset` | Reset a conversation session.  |
| GET | `/session/{client_id}/history` | Fetch current stored messages for a session.  |
| POST | `/chat` | One-shot HTTP chat response without WebSocket streaming.  |
| WS | `/ws/{client_id}` | Streaming chat channel for token-based replies.  |

## WebSocket Contract

### Client -> server

```json
{ "type": "user_message", "text": "Tell me about yourself" }
```

```json
{ "type": "ping" }
```

```json
{ "type": "reset" }
```

### Server -> client

```json
{ "type": "assistant_start" }
```

```json
{ "type": "assistant_token", "token": "..." }
```

```json
{ "type": "assistant_end" }
```

```json
{ "type": "pong" }
```

```json
{ "type": "reset_ok" }
```

```json
{ "type": "error", "message": "..." }
```

These messages are implemented by the FastAPI WebSocket endpoint and the WebSocket handler layer. 

## Setup

### 1. Install Ollama

Install Ollama on the local machine and ensure the service is running before starting the backend, because the backend streams model output from the Ollama chat endpoint. 

```bash
ollama serve
ollama pull dolphin3:8b
```

If local hostname resolution causes connection issues, set the Ollama host to `http://127.0.0.1:11434` in `backend/config.py` instead of `http://localhost:11434`. 

### 2. Install backend dependencies

```bash
pip install -r backend/requirements.txt
```

### 3. Run the backend

```bash
uvicorn backend.app:app --host 0.0.0.0 --port 8000 --reload
```

### 4. Run the frontend

Use any static file server.

```bash
cd frontend
python -m http.server 8080
```

Then open:

```text
http://localhost:8080
```

## Configuration

The main runtime settings are in `backend/config.py`. The configurable values include the Ollama host, Ollama model, temperature, CORS origins, maximum retained history turns, and the SSB system prompt. 

Example:

```python
ollama_host: str = "http://127.0.0.1:11434"
ollama_model: str = "dolphin3:8b"
ollama_temperature: float = 0.2
max_history_turns: int = 12
```

## Frontend Voice Flow

1. The user clicks the microphone button.
2. Browser `SpeechRecognition` captures speech and produces interim and final transcript chunks.
3. The live transcript is rendered in the chat panel before submission. 
4. The final text is sent as a WebSocket `user_message`. 
5. The backend forwards the conversation to Ollama and streams back `assistant_token` messages. 
6. The browser renders the streaming reply and optionally speaks it using `speechSynthesis`. 

## Session Model

Each session stores a system prompt followed by user and assistant turns. The session manager trims history to the configured maximum number of recent turn pairs while preserving the system message. 

## Troubleshooting

### WebSocket connects but chat fails

If the UI shows a WebSocket connection but the backend returns `All connection attempts failed`, the backend is usually unable to reach the Ollama service. Confirm that Ollama is running and reachable on the configured host and port. 

### GPU usage stays at zero

GPU usage will remain low if Ollama is not running or if no model is actively loaded and generating. Start the Ollama server and send a prompt to trigger model loading. 

### Speech recognition does not start

Browser STT depends on `SpeechRecognition` or `webkitSpeechRecognition`, so Chrome or Edge is recommended. The frontend already guards for unsupported browsers and shows an alert if the API is unavailable. 

### TTS sounds wrong

The current project uses browser-native `speechSynthesis`, so voice quality depends on the OS and installed voices. A future upgrade path is server-side Piper or Coqui TTS. 

## Future Improvements

- Replace browser STT with Whisper-based local transcription.
- Replace browser TTS with Piper or Coqui for consistent voice output.
- Add persistent storage for sessions instead of in-memory retention.
- Add authentication and multi-user support.
- Add interview analytics, OLQ scoring, and structured feedback reports.
- Add Docker support and environment-variable based configuration.

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | FastAPI, Uvicorn, httpx, Pydantic  |
| LLM | Ollama local model streaming  |
| Frontend | HTML, CSS, JavaScript  |
| Realtime | WebSocket streaming  |
| Voice Input | Browser Web Speech API  |
| Voice Output | Browser speechSynthesis