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
let lastExtractedIndex = 0; // <--- ADD THIS

let previousScreenshotBase64 = null;
let extractionTimer = null;

// ── Groq client ──────────────────────────────────────────
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// ── Rolling extraction — called every 2 minutes ──────────
function startRollingExtraction() {
  stopRollingExtraction(); 
  runWindowExtraction();
  
  // Changed to 1 minute (60 * 1000)
  extractionTimer = setInterval(runWindowExtraction, 30 * 1000); 
}
function stopRollingExtraction() {
  if (extractionTimer) {
    clearInterval(extractionTimer);
    extractionTimer = null;
  }
}

async function runWindowExtraction() {
  // ---> FIX 1: Stop if there is no NEW text to read!
  if (!meetingActive || rollingTranscript.length === lastExtractedIndex) return;

  try {
    // Only grab the lines that have appeared since the last time this ran
    const newLines = rollingTranscript.slice(lastExtractedIndex);
    lastExtractedIndex = rollingTranscript.length; // Move the bookmark forward
    
    let window = newLines.join("\n");

    if (window.length > 12000) {
      window = window.substring(window.length - 12000);
    }

    const result = await groqExtract.extractFromWindow(window);

    // ---> FIX 2: "Fuzzy" Deduplication
    if (result && Array.isArray(result.actionItems)) {
      for (const item of result.actionItems) {
        const incomingTitle = (item.title || "").toLowerCase();
        
        // Check if a task with a very similar name already exists
        const isDuplicate = tasks.some(t => {
          const existingTitle = (t.title || "").toLowerCase();
          // If the new task name is inside the old one, or vice-versa, it's a duplicate
          return existingTitle.includes(incomingTitle) || incomingTitle.includes(existingTitle);
        });

        if (!isDuplicate && incomingTitle.length > 2) {
          tasks.push(item);
        }
      }
    }
    console.log(`[rolling-extract] Tasks so far: ${tasks.length}`);
  } catch (err) {
    console.error("[rolling-extract] Error:", err.message);
  }
}
// ──────────────────────────────────────────────────────────
// 1. GET /test — quick healthcheck via Groq
// ──────────────────────────────────────────────────────────
app.get("/test", async (req, res) => {
  try {
    const chat = await groq.chat.completions.create({
      model: "llama-3.1-8b-instant",
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
app.post("/chunk", (req, res) => {
  upload.single("audio")(req, res, async (err) => {
    if (err) {
      console.warn("[chunk] Upload error:", err.message);
      return res.status(400).json({ error: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ error: "No audio file received" });
    }

    try {
      const timestamp = Date.now();
      const chunkPath = path.join(tempDir, `chunk_${timestamp}.webm`);

      fs.renameSync(req.file.path, chunkPath);

      const result = await groqSTT.transcribeAudio(chunkPath);
      let transcript = result.text ? result.text.trim() : "";

      // ---> FIX: Ignore common Whisper AI hallucinations on silent audio
      const lowerText = transcript.toLowerCase();
      if (
        lowerText === "thank you." || 
        lowerText === "thank you" || 
        lowerText === "thanks for watching." ||
        lowerText === "thanks for watching" ||
        lowerText === "thanks." ||
        lowerText === "you"
      ) {
        transcript = ""; 
      }

      if (transcript.length > 0) {
        rollingTranscript.push(transcript);
      }

      res.json({ ok: true, transcript });
    } catch (err) {
      console.error("Chunk error:", err.message);
      res.status(500).json({ error: err.message });
    }
  });
});

// ──────────────────────────────────────────────────────────
// 3. POST /screenshot — receive base64 screenshot, analyze
// ──────────────────────────────────────────────────────────
app.post("/screenshot", async (req, res) => {
  try {
    const { base64, timestamp } = req.body;

    if (!shouldSendScreenshot(base64, previousScreenshotBase64)) {
      console.log("[screenshot] Skipped — less than 3% pixel change");
      return res.json({ ok: true, skipped: true });
    }

    previousScreenshotBase64 = base64;

    const regionType = classifyRegion(base64);

    const content = await groqVision.analyzeScreenshot(base64, regionType);
    const hasTasks = content.tasks && content.tasks.length > 0;
    const hasDecisions = content.decisions && content.decisions.length > 0;
    const hasText = content.textItems && content.textItems.length > 0;
    const hasBullets = content.bulletPoints && content.bulletPoints.length > 0;

    if (hasTasks || hasDecisions || hasText || hasBullets) {
      const parts = [];
      if (content.title) parts.push(`Slide: "${content.title}"`);
      if (content.textItems?.length) parts.push(`Screen text: ${content.textItems.slice(0, 5).join(", ")}`);
      if (content.bulletPoints?.length) parts.push(`Points: ${content.bulletPoints.slice(0, 3).join(", ")}`);
      if (content.tasks?.length) parts.push(`Tasks on screen: ${content.tasks.join(", ")}`);

      const summary = parts.join(". ");
      if (summary.length > 10) {
        rollingTranscript.push(`[VISUAL at ${timestamp}]: ${summary}`);
      }
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("Screenshot error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ──────────────────────────────────────────────────────────
// 4. GET /state — return current meeting state
// ──────────────────────────────────────────────────────────
app.get("/state", (req, res) => {
  res.json({ rollingTranscript, tasks, meetingActive, report });
});

// ──────────────────────────────────────────────────────────
// 5. POST /meeting/end — finalize meeting, run extraction
// ──────────────────────────────────────────────────────────
app.post("/meeting/end", async (req, res) => {
  if (!meetingActive && report) {
    return res.json(report);
  }
  try {
    meetingActive = false;
    stopRollingExtraction();

    let fullTranscript = rollingTranscript.join("\n");

    // ---> FIX: Hard cap the final report transcript
    // Keep it under ~16,000 characters to fit Groq free tier
    if (fullTranscript.length > 16000) {
      console.log("[meeting/end] Truncating transcript to fit limits...");
      fullTranscript = fullTranscript.substring(fullTranscript.length - 16000);
    }

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
// ──────────────────────────────────────────────────────────
app.post("/meeting/start", (req, res) => {
  meetingActive = true;
  rollingTranscript = [];
  tasks = [];
  report = null;

  previousScreenshotBase64 = null;
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