// Content script — scrapes live captions from Google Meet and Zoom as fallback

let lastCaption = "";

// ── Google Meet caption selectors ────────────────────────
const MEET_SELECTORS = [
  '[data-message-text]',
  '[class*="caption"]',
  '[aria-label*="captions"]',
  '[jsname="tgaKEf"]',           // known Meet caption container
  '.a4cQT',                      // common Meet caption class
];

// ── Zoom caption selectors ───────────────────────────────
const ZOOM_SELECTORS = [
  '.live-transcription-subtitle',
  '.subtitle-text',
  '[class*="transcription"]',
  '[class*="caption"]',
];

// ── Detect which platform we're on ───────────────────────
const isGoogleMeet = window.location.hostname.includes("meet.google.com");
const isZoom = window.location.hostname.includes("app.zoom.us");

const selectors = isGoogleMeet ? MEET_SELECTORS : isZoom ? ZOOM_SELECTORS : [...MEET_SELECTORS, ...ZOOM_SELECTORS];

// ── Extract caption text from matched elements ───────────
function extractCaptionText() {
  for (const selector of selectors) {
    const elements = document.querySelectorAll(selector);
    for (const el of elements) {
      // Prefer data-message-text attribute (Google Meet)
      let text = el.getAttribute("data-message-text") || el.textContent || "";
      text = text.trim();

      if (text.length > 10 && text !== lastCaption) {
        lastCaption = text;
        chrome.runtime.sendMessage({
          type: "CAPTION_TEXT",
          text: text,
        });
      }
    }
  }
}

// ── MutationObserver — watch for caption DOM changes ─────
const observer = new MutationObserver((mutations) => {
  let hasRelevantChange = false;

  for (const mutation of mutations) {
    // Check added nodes
    if (mutation.addedNodes.length > 0) {
      hasRelevantChange = true;
      break;
    }
    // Check character data changes (text updates in place)
    if (mutation.type === "characterData") {
      hasRelevantChange = true;
      break;
    }
  }

  if (hasRelevantChange) {
    extractCaptionText();
  }
});

// ── Start observing once DOM is ready ────────────────────
function startObserving() {
  if (document.body) {
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    console.log("[content] Caption observer started on", window.location.hostname);
  } else {
    // Body not ready yet — retry
    setTimeout(startObserving, 500);
  }
}

startObserving();
