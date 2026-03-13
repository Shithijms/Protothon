// AI Meeting Agent — Express Backend
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const Groq = require("groq-sdk");

const groqSTT = require("./services/groq-stt");
const groqVision = require("./services/groq-vision");
const groqExtract = require("./services/groq-extract");
// FIX (Bug 2): Import shouldSendScreenshot and actually use it below
const { shouldSendScreenshot, classifyRegion } = require("./services/diffEngine");

const app = express();
app.use(cors());
app.use(express.json({ limit: "50mb" }));

// Multer setup — save audio chunks to temp folder
const tempDir = path.join(__dirname, "temp");
if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);

const upload = multer({ dest: tempDir });

// ── In-memory state ──────────────────────────────────────
let rollingTranscript = [];
let tasks = [];
let meetingActive = false;
let report = null;

// FIX (Bug 2): Track previous screenshot to diff against
let previousScreenshotBase64 = null;

// FIX (Bug 1): Rolling extraction timer handle
let extractionTimer = null;

// ── Groq client (for /test route) ────────────────────────
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ── Rolling extraction — called every 2 minutes ──────────
// FIX (Bug 1): This function was never called before. It now runs on an
// interval started by /meeting/start and stopped by /meeting/end.
function startRollingExtraction() {
  stopRollingExtraction(); // clear any stale timer

  // Run immediately once, then every 2 minutes
  runWindowExtraction();
  extractionTimer = setInterval(runWindowExtraction, 2 * 60 * 1000);
}

function stopRollingExtraction() {
  if (extractionTimer) {
    clearInterval(extractionTimer);
    extractionTimer = null;
  }
}

async function runWindowExtraction() {
  if (!meetingActive || rollingTranscript.length === 0) return;

  try {
    // Use the last 5 minutes worth of transcript lines (approx 10 lines per minute)
    const windowLines = rollingTranscript.slice(-50);
    const window = windowLines.join("\n");

    const result = await groqExtract.extractFromWindow(window);

    // Merge new action items into tasks, avoiding exact-title duplicates
    if (result && Array.isArray(result.actionItems)) {
      const existingTitles = new Set(tasks.map((t) => t.title));
      for (const item of result.actionItems) {
        if (!existingTitles.has(item.title)) {
          tasks.push(item);
          existingTitles.add(item.title);
        }
      }
    }
    console.log(`[rolling-extract] Tasks so far: ${tasks.length}`);
  } catch (err) {
    console.error("[rolling-extract] Error:", err.message);
  }
}

// ──────────────────────────────────────────────────────────
// 1. GET /test — quick healthcheck via Groq LLaMA
// ──────────────────────────────────────────────────────────
app.get("/test", async (req, res) => {
  try {
    const chat = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: "Reply with just the word READY" }],
    });
    const reply = chat.choices[0].message.content.trim();
    res.json({ status: reply });
  } catch (err) {
    console.error("Groq /test error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────────────────
// 2. POST /chunk — receive audio blob, transcribe via Groq
// ──────────────────────────────────────────────────────────
app.post("/chunk", upload.single("audio"), async (req, res) => {
  try {
    const timestamp = Date.now();
    const chunkPath = path.join(tempDir, `chunk_${timestamp}.webm`);

    // Multer saves to a temp name; rename to our convention
    fs.renameSync(req.file.path, chunkPath);

    const result = await groqSTT.transcribeAudio(chunkPath);
    const transcript = result.text || "";

    if (transcript.trim().length > 0) {
      rollingTranscript.push(transcript);
    }

    // Temp file is cleaned up by groqSTT.transcribeAudio

    res.json({ ok: true, transcript });
  } catch (err) {
    console.error("Chunk error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────────────────
// 3. POST /screenshot — receive base64 screenshot, analyze
// ──────────────────────────────────────────────────────────
app.post("/screenshot", async (req, res) => {
  try {
    const { base64, timestamp } = req.body;

    // FIX (Bug 2): Gate Vision API call with pixel diff check.
    // Previously every screenshot was sent to Groq Vision regardless of
    // whether anything had changed, burning free-tier quota.
    if (!shouldSendScreenshot(base64, previousScreenshotBase64)) {
      console.log("[screenshot] Skipped — less than 3% pixel change");
      return res.json({ ok: true, skipped: true });
    }

    // Update stored screenshot for next diff comparison
    previousScreenshotBase64 = base64;

    // FIX (Bug 5): Use classifyRegion to pick the right vision prompt.
    // Previously regionType was always hardcoded to "unknown" which fell
    // back to the whiteboard prompt for every screenshot type.
    const regionType = classifyRegion(base64);

    const content = await groqVision.analyzeScreenshot(base64, regionType);
    const summary = JSON.stringify(content);

    if (summary && summary.length > 2) {
      rollingTranscript.push(`[VISUAL at ${timestamp}]: ${summary}`);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("Screenshot error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────────────────
// 4. GET /state — return current meeting state
// FIX (Bug 4): Added `report` to the response so sidepanel.js can
// render the Report tab from polling. Previously report was never
// included and the tab always showed the placeholder text.
// ──────────────────────────────────────────────────────────
app.get("/state", (req, res) => {
  res.json({ rollingTranscript, tasks, meetingActive, report });
});

// ──────────────────────────────────────────────────────────
// 5. POST /meeting/end — finalize meeting, run extraction
// ──────────────────────────────────────────────────────────
app.post("/meeting/end", async (req, res) => {
  try {
    meetingActive = false;

    // FIX (Bug 1): Stop the rolling extraction timer when meeting ends
    stopRollingExtraction();

    const fullTranscript = rollingTranscript.join("\n");

    report = await groqExtract.generateFinalReport(fullTranscript);
    if (report && report.actionItems) {
      tasks = report.actionItems;
    }

    res.json(report);
  } catch (err) {
    console.error("Meeting end error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────────────────
// 6. POST /meeting/start — reset state, begin new meeting
// FIX (Bug 1): Start the rolling extraction timer here so LLaMA runs
// every 2 minutes during the meeting, not only at meeting end.
// ──────────────────────────────────────────────────────────
app.post("/meeting/start", (req, res) => {
  meetingActive = true;
  rollingTranscript = [];
  tasks = [];
  report = null;

  // FIX (Bug 2): Reset previous screenshot so first frame is always sent
  previousScreenshotBase64 = null;

  // FIX (Bug 1): Start live rolling extraction
  startRollingExtraction();

  console.log("▶  Meeting started");
  res.json({ ok: true });
});

// ──────────────────────────────────────────────────────────
// 7. POST /caption — receive fallback captions from extension
// ──────────────────────────────────────────────────────────
app.post("/caption", (req, res) => {
  const { text } = req.body;
  if (meetingActive && text && text.trim().length > 0) {
    rollingTranscript.push(`[CAPTION]: ${text.trim()}`);
  }
  res.json({ ok: true });
});

// ── Start server ─────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🤖 AI Meeting Agent server running on http://localhost:${PORT}`);
});
