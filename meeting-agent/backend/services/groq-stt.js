const fs = require("fs");
const Groq = require("groq-sdk");

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

async function transcribeAudio(filePath) {
  try {
    const response = await groq.audio.transcriptions.create({
      file: fs.createReadStream(filePath),
      // Use the most accurate model (remove '-turbo' if it is there)
      model: "whisper-large-v3", 
      // Force English to stop it from getting confused by accents/noise
      language: "en", 
      // Give it a hint so it knows how to guess words that get cut in half
      prompt: "This is a live meeting transcript. The audio may be cut off at the beginning or end.",
      response_format: "json",
    });

    // Clean up the temp file
    fs.unlinkSync(filePath);

    return response;
  } catch (error) {
    console.error("[groq-stt] Transcription error:", error.message);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    return { text: "" };
  }
}

module.exports = { transcribeAudio };