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
const { shouldSendScreenshot } = require("./services/diffEngine");

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

// ── Groq client (for /test route) ────────────────────────
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

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
    const content = await groqVision.analyzeScreenshot(base64, "unknown");
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
// ──────────────────────────────────────────────────────────
app.get("/state", (req, res) => {
  res.json({ rollingTranscript, tasks, meetingActive });
});

// ──────────────────────────────────────────────────────────
// 5. POST /meeting/end — finalize meeting, run extraction
// ──────────────────────────────────────────────────────────
app.post("/meeting/end", async (req, res) => {
  try {
    meetingActive = false;
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
// ──────────────────────────────────────────────────────────
app.post("/meeting/start", (req, res) => {
  meetingActive = true;
  rollingTranscript = [];
  tasks = [];
  report = null;
  console.log("▶  Meeting started");
  res.json({ ok: true });
});

// ── Start server ─────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🤖 AI Meeting Agent server running on http://localhost:${PORT}`);
});
