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
 * FIX (Bug 5): Classify the type of content visible in a screenshot.
 * Previously always returned "unknown", causing every screenshot to use
 * the whiteboard prompt regardless of actual content type.
 *
 * Heuristic approach:
 *  - Decode a sample of the base64 PNG bytes
 *  - Measure colour variance to distinguish content types:
 *      - Very low variance + mostly white/light bytes → likely a slide
 *      - Very low variance + mostly dark bytes + sparse bright pixels → likely code editor
 *      - High variance with large solid regions → likely a whiteboard or diagram
 *
 * This is intentionally lightweight — it runs on every screenshot in-process
 * with no external calls. A false classification degrades prompt quality but
 * does not crash anything; the vision model still returns usable JSON.
 *
 * @param {string} base64Image - Base64-encoded PNG
 * @returns {string} region type: "whiteboard" | "slide" | "code" | "unknown"
 */
function classifyRegion(base64Image) {
  try {
    const buf = Buffer.from(base64Image, "base64");

    // Sample 300 bytes from the middle of the file (skipping PNG header)
    const start = Math.min(200, Math.floor(buf.length * 0.1));
    const sampleCount = 300;
    const step = Math.max(1, Math.floor((buf.length - start) / sampleCount));

    let sum = 0;
    let sumSq = 0;
    let darkCount = 0;   // bytes < 60  (dark pixels)
    let lightCount = 0;  // bytes > 200 (light/white pixels)
    let midCount = 0;    // bytes 60-200 (mid-tone pixels)

    const samples = [];
    for (let i = 0; i < sampleCount; i++) {
      const pos = start + i * step;
      if (pos >= buf.length) break;
      const v = buf[pos];
      samples.push(v);
      sum += v;
      sumSq += v * v;
      if (v < 60) darkCount++;
      else if (v > 200) lightCount++;
      else midCount++;
    }

    const n = samples.length;
    if (n === 0) return "unknown";

    const mean = sum / n;
    const variance = sumSq / n - mean * mean;
    const stdDev = Math.sqrt(Math.max(0, variance));

    const lightRatio = lightCount / n;
    const darkRatio = darkCount / n;

    // Slide: predominantly light background, low-to-medium variance
    // (white slide backgrounds with dark text)
    if (lightRatio > 0.55 && stdDev < 90) {
      return "slide";
    }

    // Code editor: predominantly dark background with sparse light pixels
    // (dark theme editors: VSCode, Sublime, etc.)
    if (darkRatio > 0.5 && lightRatio < 0.25) {
      return "code";
    }

    // Whiteboard / diagram: high variance, mix of light background with
    // drawn content — many distinct pixel values
    if (lightRatio > 0.4 && stdDev > 60) {
      return "whiteboard";
    }

    return "unknown";
  } catch (err) {
    console.error("[diffEngine] classifyRegion error:", err.message);
    return "unknown";
  }
}

module.exports = { shouldSendScreenshot, classifyRegion };
