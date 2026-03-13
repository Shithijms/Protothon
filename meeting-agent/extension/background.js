// Background service worker — agent toggle, tabCapture, screenshot interval

const BACKEND = "http://localhost:3001";

let agentActive = false;
let screenshotTimer = null;
let currentTabId = null;
let meetingReport = null;

// ── Restore state on service worker wake ─────────────────
chrome.storage.local.get(["agentActive", "currentTabId"], (data) => {
  agentActive = data.agentActive || false;
  currentTabId = data.currentTabId || null;
  if (agentActive && currentTabId) {
    startScreenshotInterval(currentTabId);
  }
});

// ── 1. Agent toggle — extension icon click ───────────────
chrome.action.onClicked.addListener(async (tab) => {
  if (!agentActive) {
    await activateAgent(tab);
  } else {
    await deactivateAgent();
  }
});

// ── Activate agent: capture tab, start recording ─────────
async function activateAgent(tab) {
  try {
    currentTabId = tab.id;

    // Tell backend a new meeting started
    await fetch(`${BACKEND}/meeting/start`, { method: "POST" });

    // Get stream ID for the current tab
    const streamId = await chrome.tabCapture.getMediaStreamId({
      targetTabId: tab.id,
    });

    // Create offscreen document for MediaRecorder
    try {
      await chrome.offscreen.createDocument({
        url: "offscreen.html",
        reasons: ["AUDIO_PLAYBACK"],
        justification: "Recording tab audio for meeting transcription",
      });
    } catch (e) {
      // Document may already exist from a previous session
      console.log("[bg] Offscreen doc already exists or error:", e.message);
    }

    // Tell offscreen document to start recording
    chrome.runtime.sendMessage({
      type: "START_RECORDING",
      streamId: streamId,
    });

    // Open the side panel
    await chrome.sidePanel.open({ tabId: tab.id });

    // Start screenshot interval
    startScreenshotInterval(tab.id);

    // Persist state
    agentActive = true;
    chrome.storage.local.set({ agentActive: true, currentTabId: tab.id });

    console.log("[bg] Agent activated on tab", tab.id);
  } catch (err) {
    console.error("[bg] Failed to activate agent:", err);
  }
}

// ── Deactivate agent: stop recording, get report ─────────
async function deactivateAgent() {
  try {
    // Stop screenshot interval
    stopScreenshotInterval();

    // Tell offscreen document to stop recording
    chrome.runtime.sendMessage({ type: "STOP_RECORDING" });

    // Small delay to let final chunk flush
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Close offscreen document
    try {
      await chrome.offscreen.closeDocument();
    } catch (e) {
      console.log("[bg] Offscreen close error:", e.message);
    }

    // Tell backend meeting ended — get final report
    try {
      const res = await fetch(`${BACKEND}/meeting/end`, { method: "POST" });
      meetingReport = await res.json();
      console.log("[bg] Meeting report:", meetingReport);
    } catch (e) {
      console.error("[bg] Failed to get meeting report:", e.message);
    }

    // Persist state
    agentActive = false;
    currentTabId = null;
    chrome.storage.local.set({ agentActive: false, currentTabId: null });

    console.log("[bg] Agent deactivated");
  } catch (err) {
    console.error("[bg] Failed to deactivate agent:", err);
  }
}

// ── 2. Screenshot interval — every 60 seconds ───────────
function startScreenshotInterval(tabId) {
  stopScreenshotInterval(); // clear any existing

  screenshotTimer = setInterval(async () => {
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(null, {
        format: "png",
      });

      // Strip the data:image/png;base64, prefix
      const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");

      await fetch(`${BACKEND}/screenshot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          base64: base64,
          timestamp: new Date().toISOString(),
        }),
      });

      console.log("[bg] Screenshot sent");
    } catch (err) {
      console.error("[bg] Screenshot failed:", err.message);
    }
  }, 60000);
}

function stopScreenshotInterval() {
  if (screenshotTimer) {
    clearInterval(screenshotTimer);
    screenshotTimer = null;
  }
}

// ── 3. Caption text from content.js ──────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "CAPTION_TEXT") {
    fetch(`${BACKEND}/caption`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: message.text }),
    }).catch((err) => {
      console.error("[bg] Caption forward failed:", err.message);
    });
    sendResponse({ ok: true });
  }

  // Relay report to side panel if requested
  if (message.type === "GET_REPORT") {
    sendResponse({ report: meetingReport });
  }

  // Relay agent state to side panel
  if (message.type === "GET_STATE") {
    sendResponse({ agentActive, currentTabId });
  }

  return true;
});
