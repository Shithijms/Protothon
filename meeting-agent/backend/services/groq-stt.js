// Groq Whisper STT — transcribes 30s audio chunks
const Groq = require("groq-sdk");
const fs = require("node:fs");

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

async function transcribeAudio(filePath) {
  try {
    const response = await groq.audio.transcriptions.create({
      model: "whisper-large-v3-turbo",
      file: fs.createReadStream(filePath),
      response_format: "verbose_json",
      timestamp_granularities: ["word"],
      language: "en",
    });

    // Clean up temp file
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    return response;
  } catch (err) {
    console.error("[groq-stt] Transcription failed:", err.message);

    // Clean up temp file even on error
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    return { text: "", words: [] };
  }
}

module.exports = { transcribeAudio };
