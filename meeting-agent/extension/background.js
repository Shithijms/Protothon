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
// FIX (Error 1): sidePanel.open() MUST be called first, synchronously,
// before any await. Chrome only allows it inside a direct user gesture.
chrome.action.onClicked.addListener(async (tab) => {
  if (!agentActive) {
    // Open side panel FIRST — before any awaits
    try {
      await chrome.sidePanel.open({ tabId: tab.id });
    } catch (e) {
      console.warn("[bg] sidePanel.open error:", e.message);
    }
    await activateAgent(tab);
  } else {
    await deactivateAgent();
  }
});

async function activateAgent(tab) {
  try {
    currentTabId = tab.id;

    // Tell backend a new meeting started
    await fetch(`${BACKEND}/meeting/start`, { method: "POST" });

    // FIX (Error 2): "Cannot capture a tab with an active stream."
    // Close any stale offscreen doc first to release the previous stream.
    try {
      await chrome.offscreen.closeDocument();
      console.log("[bg] Closed stale offscreen doc");
      await new Promise((r) => setTimeout(r, 300));
    } catch (_) {
      // No stale doc — this is fine, ignore
    }

    // Get stream ID for the tab
    let streamId;
    try {
      streamId = await chrome.tabCapture.getMediaStreamId({
        targetTabId: tab.id,
      });
    } catch (e) {
      console.error("[bg] tabCapture failed:", e.message,
        "\n  If this keeps happening, reload the tab or disable/re-enable the extension.");
      return;
    }

    // Create fresh offscreen document
    try {
      await chrome.offscreen.createDocument({
        url: "offscreen.html",
        reasons: ["AUDIO_PLAYBACK"],
        justification: "Recording tab audio for meeting transcription",
      });
    } catch (e) {
      console.log("[bg] Offscreen doc error:", e.message);
    }

    // Tell offscreen doc to start recording
    chrome.runtime.sendMessage({ type: "START_RECORDING", streamId });

    startScreenshotInterval(tab.id);

    agentActive = true;
    chrome.storage.local.set({ agentActive: true, currentTabId: tab.id });

    console.log("[bg] Agent activated on tab", tab.id);
  } catch (err) {
    // FIX (Error 3): "Failed to fetch" = backend not running
    if (err.message && err.message.includes("fetch")) {
      console.error(
        "[bg] ❌ Backend unreachable at http://localhost:3001\n" +
        "    Run: cd meeting-agent/backend && node server.js"
      );
    } else {
      console.error("[bg] Failed to activate agent:", err);
    }
  }
}

async function deactivateAgent() {
  try {
    stopScreenshotInterval();

    chrome.runtime.sendMessage({ type: "STOP_RECORDING" });

    // Wait for final chunk to flush
    await new Promise((resolve) => setTimeout(resolve, 600));

    try {
      await chrome.offscreen.closeDocument();
    } catch (e) {
      console.log("[bg] Offscreen close error:", e.message);
    }

    try {
      const res = await fetch(`${BACKEND}/meeting/end`, { method: "POST" });
      meetingReport = await res.json();
      console.log("[bg] Meeting report received");
    } catch (e) {
      console.error("[bg] Failed to end meeting:", e.message);
    }

    agentActive = false;
    currentTabId = null;
    chrome.storage.local.set({ agentActive: false, currentTabId: null });

    console.log("[bg] Agent deactivated");
  } catch (err) {
    console.error("[bg] Failed to deactivate agent:", err);
  }
}

function startScreenshotInterval(tabId) {
  stopScreenshotInterval();

  screenshotTimer = setInterval(async () => {
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(null, { format: "png" });
      const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");

      await fetch(`${BACKEND}/screenshot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base64, timestamp: new Date().toISOString() }),
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
if (message.type === "CAPTION_TEXT") {
  // FIX: Deduplicate at background level — content.js fires on every
  // DOM mutation so we may get the same text multiple times in quick
  // succession even after debouncing.
  const text = (message.text || "").trim();
  if (text.length > 0) {
    fetch(`${BACKEND}/caption`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    }).catch((err) => {
      console.error("[bg] Caption forward failed:", err.message);
    });
  }
  sendResponse({ ok: true });
}

  if (message.type === "GET_REPORT")  sendResponse({ report: meetingReport });
  if (message.type === "GET_STATE")   sendResponse({ agentActive, currentTabId });

  if (message.type === "START_AGENT_FROM_UI") {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (tabs[0] && !agentActive) await activateAgent(tabs[0]);
    });
    sendResponse({ ok: true });
  }

  if (message.type === "STOP_AGENT_FROM_UI") {
    if (agentActive) deactivateAgent();
    sendResponse({ ok: true });
  }

  return true;
});
