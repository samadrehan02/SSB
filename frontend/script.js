const API_BASE = "http://localhost:8000";
const WS_BASE = `ws://${window.location.hostname || "localhost"}:8000`;

let clientId = null;
let ws = null;
let wsInstanceId = 0;

let recognition = null;
let recognizing = false;
let manuallyStopped = false;

let currentTranscript = "";
let liveAssistantText = "";
let turns = 0;
let ttsEnabled = true;
let autoListen = false;
let currentMode = "personal";

let waveformTimer = null;
let heartbeatTimer = null;
let reconnectTimer = null;

const chat = document.getElementById("chat");
const statusText = document.getElementById("statusText");
const statusDot = document.getElementById("statusDot");
const sessionLabel = document.getElementById("sessionLabel");
const wsInfo = document.getElementById("wsInfo");
const turnCount = document.getElementById("turnCount");
const modeLabel = document.getElementById("modeLabel");
const hintText = document.getElementById("hintText");
const waveform = document.getElementById("waveform");
const micBtn = document.getElementById("micBtn");
const stopBtn = document.getElementById("stopBtn");
const sendBtn = document.getElementById("sendBtn");
const ttsToggle = document.getElementById("ttsToggle");
const autoListenToggle = document.getElementById("autoListenToggle");
const themeBtn = document.getElementById("themeBtn");
const newSessionBtn = document.getElementById("newSessionBtn");

function setStatus(state, text) {
  statusText.textContent = text;
  statusDot.className = "status-dot";
  if (state) statusDot.classList.add(state);
}

function log(...args) {
  console.log("[SSB]", ...args);
}

function showHint(text) {
  hintText.textContent = text;
}

function ensureChatStarted() {
  const emptyState = document.getElementById("emptyState");
  if (emptyState) emptyState.remove();
}

function scrollChatToBottom() {
  chat.scrollTop = chat.scrollHeight;
}

function buildWaveform() {
  waveform.innerHTML = "";
  for (let i = 0; i < 28; i++) {
    const bar = document.createElement("span");
    bar.className = "wave";
    bar.style.height = "6px";
    waveform.appendChild(bar);
  }
}

function startWaveform() {
  stopWaveform();
  const bars = waveform.querySelectorAll(".wave");
  waveformTimer = setInterval(() => {
    bars.forEach((bar) => {
      bar.style.height = `${6 + Math.random() * 28}px`;
      bar.style.opacity = `${0.25 + Math.random() * 0.75}`;
    });
  }, 90);
}

function stopWaveform() {
  if (waveformTimer) {
    clearInterval(waveformTimer);
    waveformTimer = null;
  }
  waveform.querySelectorAll(".wave").forEach((bar) => {
    bar.style.height = "6px";
    bar.style.opacity = "0.3";
  });
}

function makeMessageRow(role, label, avatarText, text) {
  const row = document.createElement("div");
  row.className = `msg-row ${role === "user" ? "user" : ""}`;
  row.innerHTML = `
    <div class="avatar ${role === "user" ? "user" : "ai"}">${avatarText}</div>
    <div>
      <div class="meta">${label}</div>
      <div class="msg ${role}"></div>
    </div>
  `;
  row.querySelector(".msg").textContent = text;
  return row;
}

function addMessage(role, label, avatarText, text) {
  ensureChatStarted();
  const row = makeMessageRow(role, label, avatarText, text);
  chat.appendChild(row);
  scrollChatToBottom();
  return row;
}

function createLiveAssistantBubble() {
  ensureChatStarted();

  const existing = document.getElementById("assistantLiveRow");
  if (existing) existing.remove();

  const row = makeMessageRow("ai", "Interviewer", "IO", "");
  row.id = "assistantLiveRow";
  chat.appendChild(row);
  scrollChatToBottom();
}

function updateLiveAssistantBubble(text) {
  const row = document.getElementById("assistantLiveRow");
  if (!row) return;
  row.querySelector(".msg").textContent = `${text}▋`;
  scrollChatToBottom();
}

function finalizeAssistantBubble() {
  const row = document.getElementById("assistantLiveRow");
  if (!row) return;
  row.querySelector(".msg").textContent = liveAssistantText;
  row.removeAttribute("id");
}

function upsertLiveUserBubble(text) {
  ensureChatStarted();

  let row = document.getElementById("userLiveRow");
  if (!row) {
    row = makeMessageRow("user", "You", "YOU", "");
    row.id = "userLiveRow";
    chat.appendChild(row);
  }

  row.querySelector(".msg").textContent = text;
  scrollChatToBottom();
}

function finalizeUserBubble(text) {
  let row = document.getElementById("userLiveRow");
  if (row) {
    row.querySelector(".msg").textContent = text;
    row.removeAttribute("id");
  } else {
    addMessage("user", "You", "YOU", text);
  }
  scrollChatToBottom();
}

function clearLiveBubbles() {
  const userLive = document.getElementById("userLiveRow");
  const assistantLive = document.getElementById("assistantLiveRow");
  if (userLive) userLive.remove();
  if (assistantLive) assistantLive.remove();
}

function resetUi() {
  clearLiveBubbles();
  chat.innerHTML = `
    <div class="empty-state" id="emptyState">
      <h2>Ready for your SSB?</h2>
      <p>Click the mic and speak. Your words will appear live, and the interviewer will respond over WebSocket.</p>
    </div>
  `;
  turns = 0;
  turnCount.textContent = "0";
  liveAssistantText = "";
  currentTranscript = "";
  document.querySelectorAll("#olqTags span").forEach((tag) => tag.classList.remove("active"));
  showHint("Click the mic to begin speaking.");
}

function activateRandomOlq() {
  const tags = [...document.querySelectorAll("#olqTags span")].filter(
    (tag) => !tag.classList.contains("active")
  );
  if (!tags.length) return;
  tags[Math.floor(Math.random() * tags.length)].classList.add("active");
}

async function createSession() {
  const response = await fetch(`${API_BASE}/session`, { method: "POST" });
  if (!response.ok) {
    throw new Error(`Session creation failed: ${response.status}`);
  }
  const data = await response.json();
  clientId = data.client_id;
  sessionLabel.textContent = `Session: ${clientId.slice(0, 8)}`;
  return clientId;
}

function stopHeartbeat() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function startHeartbeat(localSocket, localInstanceId) {
  stopHeartbeat();
  heartbeatTimer = setInterval(() => {
    if (
      ws === localSocket &&
      wsInstanceId === localInstanceId &&
      localSocket.readyState === WebSocket.OPEN
    ) {
      localSocket.send(JSON.stringify({ type: "ping" }));
    }
  }, 15000);
}

function closeSocketSilently() {
  if (!ws) return;

  try {
    ws.onopen = null;
    ws.onmessage = null;
    ws.onerror = null;
    ws.onclose = null;
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close(1000, "Replacing socket");
    }
  } catch (err) {
    log("Socket close error:", err);
  }

  ws = null;
  stopHeartbeat();
}

function scheduleReconnect() {
  if (reconnectTimer || !clientId) return;

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    log("Attempting reconnect...");
    connectWebSocket();
  }, 1500);
}

function connectWebSocket() {
  if (!clientId) return;

  closeSocketSilently();

  const localInstanceId = ++wsInstanceId;
  const socketUrl = `${WS_BASE}/ws/${clientId}`;
  const localSocket = new WebSocket(socketUrl);

  ws = localSocket;
  wsInfo.textContent = socketUrl;

  setStatus("", "Connecting…");
  showHint("Connecting to interviewer...");
  log("Connecting WS:", socketUrl, "instance:", localInstanceId);

  localSocket.onopen = () => {
    if (ws !== localSocket || wsInstanceId !== localInstanceId) return;

    log("WS open:", clientId, "instance:", localInstanceId);
    setStatus("connected", "Connected");
    showHint("Click the mic to begin speaking.");
    startHeartbeat(localSocket, localInstanceId);
    localSocket.send(JSON.stringify({ type: "ping" }));
  };

  localSocket.onmessage = (event) => {
    if (ws !== localSocket || wsInstanceId !== localInstanceId) return;

    const data = JSON.parse(event.data);
    log("WS message:", data);

    if (data.type === "pong") {
      return;
    }

    if (data.type === "reset_ok") {
      resetUi();
      setStatus("connected", "Connected");
      showHint("Session reset. Click the mic to begin speaking.");
      return;
    }

    if (data.type === "assistant_start") {
      liveAssistantText = "";
      createLiveAssistantBubble();
      setStatus("responding", "Responding…");
      showHint("Interviewer is responding…");
      return;
    }

    if (data.type === "assistant_token") {
      liveAssistantText += data.token || "";
      updateLiveAssistantBubble(liveAssistantText);
      return;
    }

    if (data.type === "assistant_end") {
      finalizeAssistantBubble();
      setStatus("connected", "Connected");
      showHint("Click the mic to continue.");
      if (ttsEnabled) speakText(liveAssistantText);
      if (autoListen) {
        setTimeout(() => {
          if (!recognizing) startListening();
        }, 900);
      }
      return;
    }

    if (data.type === "error") {
      console.error("[SSB] server error:", data.message);
      setStatus("error", data.message || "Server error");
      showHint("Server error. Check backend logs.");
    }
  };

  localSocket.onerror = (event) => {
    if (ws !== localSocket || wsInstanceId !== localInstanceId) return;
    console.error("[SSB] WS error:", event);
    setStatus("error", "WebSocket error");
    showHint("WebSocket error. Check backend and console.");
  };

  localSocket.onclose = (event) => {
    if (ws !== localSocket || wsInstanceId !== localInstanceId) return;

    stopHeartbeat();
    log("WS closed:", event.code, event.reason || "(no reason)");

    if (event.code === 1000) {
      setStatus("", "Socket closed");
      return;
    }

    setStatus("error", "Disconnected");
    showHint("Connection lost. Reconnecting...");
    scheduleReconnect();
  };
}

function initSpeechRecognition() {
  const SpeechRecognitionClass =
    window.SpeechRecognition || window.webkitSpeechRecognition;

  if (!SpeechRecognitionClass) {
    alert("SpeechRecognition is not supported in this browser. Use Chrome or Edge.");
    return null;
  }

  const rec = new SpeechRecognitionClass();
  rec.continuous = true;
  rec.interimResults = true;
  rec.lang = "en-IN";

  rec.onstart = () => {
    recognizing = true;
    manuallyStopped = false;
    micBtn.classList.add("listening");
    startWaveform();
    setStatus("listening", "Listening…");
    showHint("Speak now. Click Stop when done.");
  };

  rec.onresult = (event) => {
    let interim = "";
    let finalPart = "";

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalPart += transcript;
      } else {
        interim += transcript;
      }
    }

    if (finalPart) currentTranscript += `${finalPart} `;
    upsertLiveUserBubble((currentTranscript + interim).trim());
  };

  rec.onerror = (event) => {
    console.error("[SSB] SpeechRecognition error:", event.error);
    recognizing = false;
    micBtn.classList.remove("listening");
    stopWaveform();

    if (event.error === "not-allowed") {
      setStatus("error", "Mic permission denied");
      showHint("Allow microphone access and try again.");
      return;
    }

    if (event.error === "no-speech") {
      setStatus("connected", "Connected");
      showHint("No speech detected. Try again.");
      return;
    }

    setStatus("error", "Mic/STT error");
    showHint(`Speech error: ${event.error}`);
  };

  rec.onend = () => {
    recognizing = false;
    micBtn.classList.remove("listening");
    stopWaveform();

    const text = currentTranscript.trim();
    currentTranscript = "";

    if (manuallyStopped && !text) {
      setStatus("connected", "Connected");
      showHint("Listening stopped.");
      manuallyStopped = false;
      return;
    }

    if (text) {
      finalizeUserBubble(text);
      sendUserMessage(text);
      manuallyStopped = false;
      return;
    }

    setStatus("connected", "Connected");
    showHint("Click the mic to begin speaking.");
    manuallyStopped = false;
  };

  return rec;
}

function startListening() {
  if (!recognition) {
    recognition = initSpeechRecognition();
  }

  if (!recognition || recognizing) return;

  if (!ws || ws.readyState !== WebSocket.OPEN) {
    setStatus("error", "WebSocket not connected");
    showHint("Waiting for backend connection.");
    return;
  }

  currentTranscript = "";
  try {
    recognition.start();
  } catch (err) {
    console.error("[SSB] Failed to start recognition:", err);
  }
}

function stopListening() {
  if (!recognition || !recognizing) return;
  manuallyStopped = true;
  recognition.stop();
}

function sendUserMessage(text) {
  const cleanText = (text || "").trim();
  if (!cleanText) return;

  if (!ws || ws.readyState !== WebSocket.OPEN) {
    setStatus("error", "WebSocket not connected");
    showHint("Backend socket is not connected.");
    return;
  }

  turns += 1;
  turnCount.textContent = String(turns);
  activateRandomOlq();

  log("Sending user message:", cleanText);
  ws.send(JSON.stringify({ type: "user_message", text: cleanText }));
  setStatus("connected", "Connected");
  showHint("Waiting for interviewer...");
}

function speakText(text) {
  if (!ttsEnabled || !("speechSynthesis" in window) || !text.trim()) return;

  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-IN";
  utterance.rate = 0.96;
  utterance.pitch = 1;

  const voices = window.speechSynthesis.getVoices();
  const preferredVoice =
    voices.find((voice) => voice.lang === "en-IN") ||
    voices.find((voice) => voice.lang.startsWith("en")) ||
    null;

  if (preferredVoice) {
    utterance.voice = preferredVoice;
  }

  window.speechSynthesis.speak(utterance);
}

function requestSessionReset() {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    resetUi();
    return;
  }
  ws.send(JSON.stringify({ type: "reset" }));
}

function setMode(mode) {
  currentMode = mode;
  const labelMap = {
    personal: "Personal Interview",
    gd: "GD / Lecturette",
    psych: "Psych Prep",
  };
  modeLabel.textContent = labelMap[mode] || "Personal Interview";
}

async function newSession() {
  try {
    stopListening();
    closeSocketSilently();
    resetUi();
    setStatus("", "Creating session…");
    showHint("Preparing a new interview session...");
    await createSession();
    connectWebSocket();
  } catch (error) {
    console.error("[SSB] newSession error:", error);
    setStatus("error", "Failed to create session");
    showHint("Backend session creation failed.");
  }
}

document.querySelectorAll(".mode-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".mode-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    setMode(btn.dataset.mode);
  });
});

ttsToggle.addEventListener("change", () => {
  ttsEnabled = ttsToggle.checked;
});

autoListenToggle.addEventListener("change", () => {
  autoListen = autoListenToggle.checked;
});

micBtn.addEventListener("click", () => {
  if (recognizing) {
    stopListening();
  } else {
    startListening();
  }
});

stopBtn.addEventListener("click", stopListening);

sendBtn.addEventListener("click", () => {
  const liveRow = document.getElementById("userLiveRow");
  const text = liveRow ? liveRow.querySelector(".msg").textContent.trim() : currentTranscript.trim();

  if (!text) return;

  if (recognizing) {
    manuallyStopped = true;
    recognition.stop();
  } else {
    finalizeUserBubble(text);
    currentTranscript = "";
    sendUserMessage(text);
  }
});

newSessionBtn.addEventListener("click", newSession);

themeBtn.addEventListener("click", () => {
  document.documentElement.classList.toggle("light");
});

window.addEventListener("beforeunload", () => {
  stopHeartbeat();
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    ws.close(1000, "Page unload");
  }
});

buildWaveform();
setMode(currentMode);
newSession();