// Pixel diff engine — filters redundant screenshots before Vision API call

/**
 * Compare two base64 PNG screenshots by sampling pixel bytes.
 * Returns true if the new screenshot is different enough to send to Vision API.
 *
 * @param {string} newBase64 - Base64-encoded PNG of the new screenshot
 * @param {string} previousBase64 - Base64-encoded PNG of the previous screenshot (or null)
 * @returns {boolean} true if the screenshot should be sent for analysis
 */
function shouldSendScreenshot(newBase64, previousBase64) {
  // First screenshot is always sent
  if (!previousBase64 || previousBase64.length === 0) {
    return true;
  }

  const newBuf = Buffer.from(newBase64, "base64");
  const prevBuf = Buffer.from(previousBase64, "base64");

  // If sizes differ dramatically, content definitely changed
  if (Math.abs(newBuf.length - prevBuf.length) > newBuf.length * 0.1) {
    return true;
  }

  // Sample 500 evenly spaced byte positions across both buffers
  const sampleCount = 500;
  const minLen = Math.min(newBuf.length, prevBuf.length);

  // Skip first 100 bytes (PNG header/metadata) to focus on pixel data
  const dataStart = Math.min(100, Math.floor(minLen * 0.05));
  const dataRange = minLen - dataStart;

  if (dataRange <= 0) {
    return true;
  }

  const step = Math.max(1, Math.floor(dataRange / sampleCount));
  let diffCount = 0;

  for (let i = 0; i < sampleCount; i++) {
    const pos = dataStart + i * step;
    if (pos >= minLen) break;

    const diff = Math.abs(newBuf[pos] - prevBuf[pos]);
    if (diff > 10) {
      diffCount++;
    }
  }

  const diffPercent = (diffCount / sampleCount) * 100;
  return diffPercent >= 3;
}

/**
 * Classify the type of content visible in a screenshot.
 * Placeholder — always returns "unknown" for now.
 *
 * @param {string} base64Image - Base64-encoded PNG
 * @returns {string} region type: "whiteboard" | "slide" | "code" | "unknown"
 */
function classifyRegion(base64Image) {
  // TODO: implement smart region classification
  return "unknown";
}

module.exports = { shouldSendScreenshot, classifyRegion };
