// Offscreen document — keeps MediaRecorder alive past service worker sleep

const BACKEND = "http://localhost:3001";
const CHUNK_INTERVAL_MS = 5000; // 5 seconds

let mediaRecorder = null;
let chunks = [];
let stream = null;
let chunkTimer = null;

// FIX (Missing feature — spec §9): AudioContext keep-alive for Zoom.
// Zoom mutes tab audio when the browser window loses focus. Routing the
// captured stream through an AudioContext (even silently) keeps Chrome
// from treating the tab as silent, preventing Zoom from cutting the feed.
let audioContext = null;
let audioSourceNode = null;

// ── Listen for commands from service worker ──────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "START_RECORDING") {
    startRecording(message.streamId);
    sendResponse({ ok: true });
  } else if (message.type === "STOP_RECORDING") {
    stopRecording();
    sendResponse({ ok: true });
  }
  return true; // keep channel open for async
});

// ── Start recording ──────────────────────────────────────
async function startRecording(streamId) {
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: streamId,
        },
      },
    });

    // FIX (Missing feature — spec §9): Create AudioContext and route the
    // stream through it. The destination is the offscreen document's audio
    // output (silent to user). This marks the stream as actively consumed
    // so Zoom and Chrome do not suspend or mute the tab audio track.
    audioContext = new AudioContext();
    audioSourceNode = audioContext.createMediaStreamSource(stream);
    audioSourceNode.connect(audioContext.destination);

    createAndStartRecorder();

    // Every 30s: flush chunks to backend and restart recorder
    chunkTimer = setInterval(() => {
      flushAndRestart();
    }, CHUNK_INTERVAL_MS);

    chrome.runtime.sendMessage({ type: "RECORDING_STARTED" });
    console.log("[offscreen] Recording started");
  } catch (err) {
    console.error("[offscreen] Failed to start recording:", err);
  }
}

// ── Create a new MediaRecorder and start it ──────────────
function createAndStartRecorder() {
  chunks = [];
  mediaRecorder = new MediaRecorder(stream, {
    mimeType: "audio/webm;codecs=opus",
  });

  mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) {
      chunks.push(e.data);
    }
  };

  mediaRecorder.start(1000);
}

// ── Flush current chunks to backend, then restart ────────
async function flushAndRestart() {
  if (!mediaRecorder || mediaRecorder.state === "inactive") return;

  // Stop current recorder — triggers final ondataavailable
  mediaRecorder.stop();

  // Small delay to let the final ondataavailable fire
  await new Promise((resolve) => setTimeout(resolve, 100));

  // Send collected chunks
  await sendChunksToBackend();

  // Start a fresh recorder on the same stream
  if (stream && stream.active) {
    createAndStartRecorder();
  }
}

// ── Stop recording entirely ──────────────────────────────
async function stopRecording() {
  try {
    // Clear the periodic flush timer
    if (chunkTimer) {
      clearInterval(chunkTimer);
      chunkTimer = null;
    }

    // Stop the recorder
    if (mediaRecorder && mediaRecorder.state !== "inactive") {
      mediaRecorder.stop();
      // Wait for final ondataavailable
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    // Send any remaining chunks
    await sendChunksToBackend();

    // FIX (Missing feature — spec §9): Clean up AudioContext keep-alive
    if (audioSourceNode) {
      audioSourceNode.disconnect();
      audioSourceNode = null;
    }
    if (audioContext) {
      await audioContext.close();
      audioContext = null;
    }

    // Stop all tracks on the stream
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
    }

    mediaRecorder = null;

    chrome.runtime.sendMessage({ type: "RECORDING_STOPPED" });
    console.log("[offscreen] Recording stopped");
  } catch (err) {
    console.error("[offscreen] Error stopping recording:", err);
  }
}

// ── Send chunk blob to backend /chunk endpoint ───────────
async function sendChunksToBackend() {
  if (chunks.length === 0) return;

  const blob = new Blob(chunks, { type: "audio/webm;codecs=opus" });
  chunks = [];

  if (blob.size < 1000) {
    // FIX: Skip tiny/empty blobs — they cause "Request aborted" on the server
    // A valid 30s audio chunk is always well above 1KB
    console.log("[offscreen] Skipping tiny blob:", blob.size, "bytes");
    return;
  }

  try {
    const formData = new FormData();
    formData.append("audio", blob, `chunk_${Date.now()}.webm`);

    const res = await fetch(`${BACKEND}/chunk`, {
      method: "POST",
      body: formData,
    });

    const data = await res.json();
    console.log("[offscreen] Chunk sent, transcript:", data.transcript);
  } catch (err) {
    console.error("[offscreen] Failed to send chunk:", err);
  }
}