// content.js — Live caption scraper for Google Meet and Zoom
// Feeds captions to background.js as fallback when audio capture breaks

let lastSentText = "";
let sendTimer = null;
let pendingText = "";
const MIN_CHARS = 2;  
const DEBOUNCE_MS = 200;

// ── Google Meet selectors (updated for Meet 2025) ────────
// Meet renders captions in a div with jsname="ds:0" or similar,
// but the RELIABLE anchor is the [data-sender-name] attribute on
// the speaker block, with caption text in the sibling span.
// We use a broad net of selectors and take the first match.
const MEET_SELECTORS = [
  // 2025 Meet — primary caption container
  '[jsname="YSg9Nc"]',
  '[jsname="tgaKEf"]',
  '[data-message-text]',
  // caption text spans inside speaker blocks
  '.iTTPOb',
  '.bj2rGe',
  // fallback: any element with aria live caption role
  '[aria-live="polite"]',
  '[aria-live="assertive"]',
  // older Meet selectors kept as last resort
  '.a4cQT',
  '.CNusmb',
];

// ── Zoom selectors ────────────────────────────────────────
const ZOOM_SELECTORS = [
  '.live-transcription-subtitle',
  '.subtitle-text',
  '[class*="transcription"]',
  '[class*="caption"]',
  '[class*="subtitle"]',
];

const isGoogleMeet = window.location.hostname.includes("meet.google.com");
const isZoom = window.location.hostname.includes("app.zoom.us");

const SELECTORS = isGoogleMeet
  ? MEET_SELECTORS
  : isZoom
  ? ZOOM_SELECTORS
  : [...MEET_SELECTORS, ...ZOOM_SELECTORS];

// ── Extract all visible caption text ─────────────────────
function extractAllCaptions() {
  const texts = [];

  for (const selector of SELECTORS) {
    const elements = document.querySelectorAll(selector);
    for (const el of elements) {
      const text =
        el.getAttribute("data-message-text") ||
        el.innerText ||
        el.textContent ||
        "";
      const trimmed = text.trim();
      // FIX: Lower threshold to 3 chars (single words count)
      // and collect ALL visible caption elements, not just first
      if (trimmed.length >= 3) {
        texts.push(trimmed);
      }
    }
  }

  return texts.join(" ").trim();
}

// ── Debounced send — waits 800ms after last DOM change ───
// FIX: Meet updates captions character-by-character. If we send on
// every mutation we get partial words. Debouncing collects the full
// sentence before sending.
function scheduleSend(text) {
  pendingText = text;
  if (sendTimer) clearTimeout(sendTimer);

  sendTimer = setTimeout(() => {
    const toSend = pendingText.trim();

    // Only send if meaningfully different from last sent text
    // FIX: Use includes() check — if new text contains old text it's
    // just the same caption grown longer, send the longer version
    if (
      toSend.length >= MIN_CHARS &&
      toSend !== lastSentText &&
      !lastSentText.includes(toSend)
    ) {
      lastSentText = toSend;
      chrome.runtime.sendMessage(
        { type: "CAPTION_TEXT", text: toSend },
        () => {
          // Consume chrome.runtime.lastError to prevent unchecked error
          // when background service worker is sleeping
          void chrome.runtime.lastError;
        }
      );
      console.log("[content] Caption sent:", toSend.substring(0, 60));
    }

    // Reset lastSentText after 8 seconds so the next speaker's
    // captions aren't blocked by the previous person's text
    setTimeout(() => {
      if (lastSentText === toSend) lastSentText = "";
    }, 8000);
  }, DEBOUNCE_MS);
}

// ── MutationObserver ──────────────────────────────────────
const observer = new MutationObserver(() => {
  const text = extractAllCaptions();
  if (text) scheduleSend(text);
});

function startObserving() {
  if (document.body) {
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      characterDataOldValue: false,
    });
    console.log("[content] Caption observer active on", window.location.hostname);

    // Run once immediately in case captions are already on screen
    const initial = extractAllCaptions();
    if (initial) scheduleSend(initial);
  } else {
    setTimeout(startObserving, 500);
  }
}

startObserving();