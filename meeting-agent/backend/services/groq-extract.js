// Groq LLaMA — task extraction and final report generation
const Groq = require("groq-sdk");

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const WINDOW_SYSTEM_PROMPT = `You are an AI meeting analyst embedded as a silent agent in an engineering team meeting.
Extract structured action items and decisions from the transcript below.
[VISUAL at HH:MM]: tags describe what was on the shared screen at that time — treat them as equal context to spoken words.
Return ONLY valid JSON. No preamble, no explanation, no markdown fences.
Schema: { "summary": "string", "decisions": [{"decision":"string", "rationale":"string"}], "actionItems": [{"title":"string", "description":"string", "assignee":"string|null", "priority":"high|medium|low", "category":"bug|feature|infra|design|research", "source":"voice|visual|both", "deadline":"string|null"}] }
Rules: Only extract tasks with a clear next action. Do not invent tasks. If nothing actionable, return empty arrays.`;

const FINAL_SYSTEM_PROMPT = `Generate a final engineering meeting report. Return ONLY valid JSON.
Schema: { "meetingTitle":"string|null", "estimatedDuration":"string", "attendees":["string"], "executiveSummary":"string", "keyDecisions":[{"decision":"string","rationale":"string","owner":"string|null"}], "actionItems":[{"title":"string","description":"string","assignee":"string|null","priority":"high|medium|low","category":"bug|feature|infra|design|research","source":"voice|visual|both","deadline":"string|null"}], "openQuestions":["string"], "visualHighlights":["string"] }`;

/**
 * Called every ~2 minutes with the last 5 minutes of transcript.
 * Extracts incremental action items and decisions.
 */
async function extractFromWindow(transcriptWindow) {
  try {
    const response = await groq.chat.completions.create({
      // FIX: Updated to the current, active 8B model on Groq
      model: "llama-3.1-8b-instant",
      messages: [
        { role: "system", content: WINDOW_SYSTEM_PROMPT },
        { role: "user", content: transcriptWindow },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2, 
    });

    const raw = response.choices[0].message.content;
    return JSON.parse(raw);
  } catch (err) {
    console.error("[groq-extract] Window extraction failed:", err.message);
    return {
      summary: "",
      decisions: [],
      actionItems: [],
    };
  }
}

/**
 * Called once at meeting end with the complete session transcript.
 * Generates a comprehensive final report.
 */
async function generateFinalReport(fullTranscript) {
  try {
    const response = await groq.chat.completions.create({
      // FIX: Updated to the current, active 8B model on Groq
      model: "llama-3.1-8b-instant",
      messages: [
        { role: "system", content: FINAL_SYSTEM_PROMPT },
        { role: "user", content: fullTranscript },
      ],
      response_format: { type: "json_object" },
      temperature: 0.2,
    });

    const raw = response.choices[0].message.content;
    return JSON.parse(raw);
  } catch (err) {
    console.error("[groq-extract] Final report failed:", err.message);
    return {
      meetingTitle: null,
      estimatedDuration: "",
      attendees: [],
      executiveSummary: "",
      keyDecisions: [],
      actionItems: [],
      openQuestions: [],
      visualHighlights: [],
    };
  }
}

module.exports = { extractFromWindow, generateFinalReport };