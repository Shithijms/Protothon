// Groq Vision — reads screenshots of whiteboards, slides, and code
const Groq = require("groq-sdk");

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const PROMPTS = {
  whiteboard:
    'You are reading a screenshot of a whiteboard from an engineering meeting. Extract all text, arrows, shapes, task assignments, and names. Return ONLY valid JSON: { "type":"whiteboard", "textItems":[], "relationships":[], "tasks":[], "names":[], "confidence":"high|medium|low" }',
  slide:
    'You are reading a presentation slide. Return ONLY valid JSON: { "type":"slide", "title":"", "bulletPoints":[], "numbers":[], "decisions":[], "confidence":"high|medium|low" }',
  code:
    'You are reading a code editor screenshot. Return ONLY valid JSON: { "type":"code", "language":"", "fileName":"", "summary":"", "confidence":"high|medium|low" }',
};

async function analyzeScreenshot(base64Image, regionType) {
  try {
    const prompt = PROMPTS[regionType] || PROMPTS.whiteboard;

    const response = await groq.chat.completions.create({
      model: "meta-llama/llama-4-scout-17b-16e-instruct",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "image_url",
              image_url: {
                url: `data:image/png;base64,${base64Image}`,
              },
            },
          ],
        },
      ],
      response_format: { type: "json_object" },
    });

    const raw = response.choices[0].message.content;
    return JSON.parse(raw);
  } catch (err) {
    console.error("[groq-vision] Analysis failed:", err.message);
    return { type: regionType || "unknown", content: "parse error", confidence: "low" };
  }
}

module.exports = { analyzeScreenshot };
