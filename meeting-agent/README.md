# AI Meeting-to-Action Agent 

**Version 2.0 | March 2026 | [cite_start]Hackathon Build** [cite: 4]

## 📌 Project Overview
[cite_start]The AI Meeting Agent is a Chrome extension that silently joins any Google Meet or Zoom web meeting as an invisible participant[cite: 6]. [cite_start]It captures both the audio stream of all participants and periodic screenshots of the shared screen, processes them through the Groq AI stack, extracts structured tasks and decisions in real time, and surfaces them in a side panel[cite: 7]. 

[cite_start]After the meeting ends, it generates a full meeting report, routes it through a human review step, and automatically alerts assignees via browser notifications and email links[cite: 8]. [cite_start]The entire AI stack uses Groq's free tier, requiring no credit card[cite: 9].

## ✨ Key Features
* **Invisible Participant:** Operates via a Chrome extension, meaning it doesn't need to be admitted by a host like a traditional meeting bot[cite: 377, 380, 381].
* [cite_start]**Comprehensive Capture:** Uses `chrome.tabCapture` to record all audio from the meeting tab, capturing everyone's voice[cite: 228, 229].
* [cite_start]**Visual Context:** Takes a screenshot of the shared screen every 60 seconds using `captureVisibleTab` to understand whiteboards, slides, and diagrams[cite: 231, 232, 253].
* **Cost-Optimized:** A canvas-based pixel comparison engine ensures screenshots are only sent to the Vision API if more than 3% of pixels have changed[cite: 28, 29].
* [cite_start]**Smart Orchestration:** A lightweight heuristic classifies screen regions (whiteboard, slide, code) to use tailored prompts, significantly improving extraction quality[cite: 31, 32].
* [cite_start]**Local & Private:** A local Node.js server orchestrates API calls, ensuring data only leaves your machine to go to Groq for processing[cite: 388, 389].

## 🏗️ System Architecture
[cite_start]The system is split into three distinct layers[cite: 20]:

### Layer 1: Chrome Extension (MV3) - Capture Layer
* [cite_start]Handles audio capture, screenshots, and the side panel UI[cite: 21].
* Uses an offscreen document for the MediaRecorder to prevent audio loss when the background script sleeps[cite: 26, 27].
* [cite_start]The extension icon acts as the Enable/Disable agent toggle[cite: 22].

### Layer 2: Local Node.js Backend - Orchestration Layer
* [cite_start]Receives audio chunks and screenshots from the extension[cite: 23].
* Calls Groq APIs and maintains the rolling transcript and task state[cite: 23].
* [cite_start]Built with Express.js, `groq-sdk`, Multer, and dotenv[cite: 208, 210, 212, 214].

### Layer 3: Groq AI Stack - Intelligence Layer
* [cite_start]**Speech-to-Text:** Groq Whisper Large v3 Turbo converts 30-second audio chunks into text[cite: 17, 217, 218].
* **Task Extraction:** Groq llama-3.3-70b-versatile reads a 5-minute rolling context window every 2 minutes to extract tasks and decisions[cite: 17, 33, 219, 220].
* [cite_start]**Vision:** Groq llama-4-scout-17b-16e-instruct reads screen changes and splices visual context into the transcript using `[VISUAL]` tags[cite: 17, 35].

## 🚀 End-to-End Workflow

1.  [cite_start]**Setup:** Install the extension, start the local Node.js server (`node server.js`), and enter your Groq API key in the side panel[cite: 47, 282, 284].
2.  [cite_start]**Join Meeting:** Open Google Meet or Zoom in Chrome[cite: 287]. 
3.  [cite_start]**Enable Agent:** Click the extension icon to open the side panel, then click "Enable Agent"[cite: 289, 291, 293].
4.  [cite_start]**Live Capture:** The agent records 30-second audio chunks and takes screenshots every 60 seconds, processing them in the background[cite: 297, 298, 300, 304, 305].
5.  [cite_start]**Live Extraction:** Every 2 minutes, LLaMA extracts tasks and decisions, displaying them live in the side panel[cite: 311, 314, 315, 316].
6.  [cite_start]**Review & Notify:** When the meeting ends, a full report is generated[cite: 318, 322, 324]. [cite_start]The reviewer can edit task details and click "Confirm & Notify" to trigger in-browser alerts and generate email links for assignees[cite: 329, 331, 333, 335, 337].

## 🗺️ V2 Roadmap (Post-Hackathon)
* **Issue Tracker Integration:** Push approved tasks directly to Linear, Jira, or GitHub Issues via REST API[cite: 181].
* [cite_start]**Duplicate Detection:** Hash title and assignee to prevent duplicate tasks across meeting chunks[cite: 182].
* [cite_start]**Smart Priority Scoring:** Use urgency signals in the transcript (e.g., 'ASAP', 'blocking') to auto-score priority[cite: 183].
* **Multi-Language Support:** Detect transcript language via Whisper and route to localized extraction prompts[cite: 184].
* [cite_start]**Follow-up Tracker:** Surface unresolved tasks from previous meetings at the start of a new one[cite: 185].
* [cite_start]**Cloud Sync:** Replace the local Node.js server with a cloud backend for real-time team sharing[cite: 187].