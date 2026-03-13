# AI Meeting-to-Action Agent 

**Version 2.0 | March 2026 | Hackathon Build**

## 📌 Project Overview
The AI Meeting Agent is a Chrome extension that silently joins any Google Meet or Zoom web meeting as an invisible participant. It captures both the audio stream of all participants and periodic screenshots of the shared screen, processes them through the Groq AI stack, extracts structured tasks and decisions in real time, and surfaces them in a side panel. 

After the meeting ends, it generates a full meeting report, routes it through a human review step, and automatically alerts assignees via browser notifications and email links. The entire AI stack uses Groq's free tier, requiring no credit card.

## ✨ Key Features
* **Invisible Participant:** Operates via a Chrome extension, meaning it doesn't need to be admitted by a host like a traditional meeting bot.
* **Comprehensive Capture:** Uses `chrome.tabCapture` to record all audio from the meeting tab, capturing everyone's voice.
* **Visual Context:** Takes a screenshot of the shared screen every 60 seconds using `captureVisibleTab` to understand whiteboards, slides, and diagrams.
* **Cost-Optimized:** A canvas-based pixel comparison engine ensures screenshots are only sent to the Vision API if more than 3% of pixels have changed.
* **Smart Orchestration:** Classifies screen regions to use tailored prompts, significantly improving extraction quality.
* **Local & Private:** A local Node.js server orchestrates API calls, ensuring data only leaves your machine to go to Groq for processing.

## 🏗️ System Architecture
The system is split into three distinct layers:

### Layer 1: Chrome Extension (MV3) - Capture Layer
* Handles audio capture, screenshots, and the side panel UI.
* Uses an offscreen document for the MediaRecorder to prevent audio loss when the background script sleeps.
* The extension icon acts as the Enable/Disable agent toggle.

### Layer 2: Local Node.js Backend - Orchestration Layer
* Receives audio chunks and screenshots from the extension.
* Calls Groq APIs and maintains the rolling transcript and task state.
* Built with Express.js, `groq-sdk`, Multer, and dotenv.

### Layer 3: Groq AI Stack - Intelligence Layer
* **Speech-to-Text:** Groq Whisper Large v3 Turbo converts 30-second audio chunks into text.
* **Task Extraction:** Groq llama-3.3-70b-versatile reads a 5-minute rolling context window every 2 minutes to extract tasks and decisions.
* **Vision:** Groq llama-4-scout-17b-16e-instruct reads screen changes and splices visual context into the transcript using `[VISUAL]` tags.

## 🚀 End-to-End Workflow

1.  **Setup:** Install the extension and start the local Node.js server (`node server.js`). The agent securely reads your Groq API key from the local `.env` file—**no user UI setup is required!**
2.  **Join Meeting:** Open Google Meet or Zoom in Chrome. 
3.  **Enable Agent:** Click the green extension icon in your browser toolbar. The side panel will open, and the agent will instantly start capturing audio and screen data.
4.  **Live Extraction:** Every 2 minutes, LLaMA extracts tasks and decisions, displaying them live in the side panel.
5.  **End Meeting:** Click the extension icon in your toolbar again to deactivate the agent. The backend will process the final full-meeting report.
6.  **Review & Export:** Switch to the Report tab in the side panel to view the final summary, decisions, and action items, and export them as a JSON file.

## 🗺️ V2 Roadmap (Post-Hackathon)
* **Issue Tracker Integration:** Push approved tasks directly to Linear, Jira, or GitHub Issues via REST API.
* **Duplicate Detection:** Hash title and assignee to prevent duplicate tasks across meeting chunks.
* **Smart Priority Scoring:** Use urgency signals in the transcript (e.g., 'ASAP', 'blocking') to auto-score priority.
* **Multi-Language Support:** Detect transcript language via Whisper and route to localized extraction prompts.
* **Follow-up Tracker:** Surface unresolved tasks from previous meetings at the start of a new one.
* **Cloud Sync:** Replace the local Node.js server with a cloud backend for real-time team sharing.