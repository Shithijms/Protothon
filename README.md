# 🤖 AI Meeting Agent

> A Chrome Extension that silently sits in your Google Meet or Zoom meeting, listens to everything, understands the screen, extracts action items in real time, and automatically creates Jira tickets + emails the full report to your team — the moment the meeting ends.

**Built at Protothon 2026 · Hackathon Project**

---

## 📌 What It Does

Most meetings end with a vague sense of "someone said they'd handle that." This extension fixes that.

It runs invisibly in your browser during any Google Meet or Zoom call. It captures audio, reads live captions, and takes periodic screenshots of whatever is being shared on screen. Every 30 seconds, an AI reads the latest transcript and pulls out action items in real time — visible in the side panel while the meeting is still happening.

When you end the meeting, it generates a full structured report and automatically:
- **Creates Jira tickets** for every action item, assigned to the right person
- **Emails the full report** to your whole team in a clean formatted email
- **Notifies each assignee** via Jira's own email notification system

---

## ✨ Key Features

- **Invisible participant** — runs as a Chrome extension, no bot to admit, no extra account needed
- **Dual capture** — combines audio transcription (Groq Whisper) + live caption scraping for maximum accuracy
- **Visual context** — screenshots shared screens every 60 seconds and reads them with Vision AI
- **Smart diff engine** — only sends screenshots to Vision API if more than 3% of pixels changed, saving API quota
- **Live task extraction** — LLaMA reads new transcript every 30 seconds, tasks appear during the meeting
- **Human review step** — edit/delete tasks before they go to Jira
- **One-click Jira push** — creates tickets with correct issue types, priorities, assignees, and labels
- **Auto email report** — full HTML meeting report sent to configurable recipients on meeting end
- **Fully local & private** — only leaves your machine to call Groq API and Jira/Gmail

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   CHROME EXTENSION (MV3)                    │
│                                                             │
│  background.js          offscreen.js         content.js    │
│  ┌─────────────┐        ┌────────────┐       ┌──────────┐  │
│  │ Agent toggle│        │MediaRecorder│       │ Caption  │  │
│  │ Screenshots │        │ AudioContext│       │ Scraper  │  │
│  │ Side panel  │        │ 30s chunks │       │ Zoom/Meet│  │
│  └──────┬──────┘        └─────┬──────┘       └────┬─────┘  │
│         │                     │                    │        │
└─────────┼─────────────────────┼────────────────────┼────────┘
          │                     │                    │
          ▼                     ▼                    ▼
┌─────────────────────────────────────────────────────────────┐
│               LOCAL NODE.JS BACKEND (Express)               │
│                                                             │
│  POST /meeting/start   POST /chunk      POST /caption       │
│  POST /meeting/end     POST /screenshot GET  /state         │
│  POST /api/jira/push                                        │
└──────────────────┬──────────────────────────────────────────┘
                   │
        ┌──────────┼──────────┐
        ▼          ▼          ▼
   ┌─────────┐ ┌────────┐ ┌────────┐
   │  Groq   │ │  Jira  │ │ Gmail  │
   │ Whisper │ │  REST  │ │  SMTP  │
   │  LLaMA  │ │   API  │ │        │
   │  Vision │ └────────┘ └────────┘
   └─────────┘
```

### Layer 1 — Chrome Extension (Capture)
- `background.js` — agent toggle, tab capture, screenshot interval
- `offscreen.js` — MediaRecorder with AudioContext keep-alive (prevents Zoom from muting)
- `content.js` — MutationObserver scrapes live captions from Zoom/Meet DOM
- `sidepanel.js` — polls backend every 5s, renders transcript, tasks, board, report

### Layer 2 — Node.js Backend (Orchestration)
- Receives audio chunks, screenshots, and captions
- Maintains rolling transcript and task state in memory
- Orchestrates all AI and integration calls

### Layer 3 — AI + Integrations
- **Groq Whisper** (`whisper-large-v3`) — transcribes 30s audio chunks
- **Groq LLaMA** (`llama-3.1-8b-instant`) — extracts tasks every 30s + final report
- **Groq Vision** (`llama-4-scout-17b-16e-instruct`) — reads screenshots
- **Jira REST API v3** — creates tickets with assignees, priorities, labels
- **Gmail SMTP (Nodemailer)** — sends HTML report email to team

---

## 🚀 Setup

### Prerequisites
- Node.js 18+
- Chrome browser
- Groq API key (free at [console.groq.com](https://console.groq.com))
- Jira workspace (optional)
- Gmail account with App Password (optional)

### 1. Clone the repo

```bash
git clone https://github.com/yourusername/meeting-agent.git
cd meeting-agent
```

### 2. Install backend dependencies

```bash
cd backend
npm install
```

### 3. Configure environment

Create `backend/.env`:

```env
# Required
GROQ_API_KEY=your_groq_api_key_here
PORT=3001

# Jira integration (optional)
JIRA_HOST=https://yourworkspace.atlassian.net
JIRA_EMAIL=you@yourcompany.com
JIRA_API_TOKEN=your_jira_api_token
JIRA_PROJECT_KEY=ENG

# Email report (optional)
MAIL_USER=you@gmail.com
MAIL_PASS=your_gmail_app_password
MAIL_TO=team@yourcompany.com,manager@yourcompany.com
```

> **Get Groq API key:** [console.groq.com](https://console.groq.com)  
> **Get Jira API token:** [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens)  
> **Get Gmail App Password:** [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)

### 4. Start the backend

```bash
cd backend
node server.js
# → 🤖 AI Meeting Agent server running on http://localhost:3001
```

### 5. Load the Chrome extension

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked**
4. Select the `extension/` folder
5. The 🤖 robot icon appears in your toolbar

---

## 📖 How To Use

### Starting a meeting

1. Open Google Meet or Zoom in Chrome
2. Join your meeting
3. **Enable captions in Zoom:** click `...` More → Captions → Enable Auto-Transcription
4. Click the 🤖 extension icon in the toolbar
5. The side panel opens and recording begins immediately

### During the meeting

The **Live tab** shows:
- Rolling transcript (audio + captions + screen content)
- Extracted tasks appearing in real time as AI finds them

The **Board tab** shows extracted tasks in a Kanban layout (Todo / In Progress / Done).

### Ending the meeting

1. Click the 🤖 extension icon again to stop recording
2. Wait 5–10 seconds for the AI to generate the final report
3. The side panel automatically switches to the **Report tab**

### The Report tab

Shows the full AI-generated report:
- Meeting title and executive summary
- Key decisions made
- All action items — **editable before pushing to Jira**
- Open questions
- Visual highlights from screen captures

**Buttons:**
- **Confirm & Notify Assignees** — sends browser notifications + opens mailto links
- **Push to Jira** — creates Jira tickets for all action items with assignees and priorities
- **Export JSON** — downloads raw data for integrations

### After the meeting ends

Automatically (no button needed):
- ✅ Full HTML report emailed to all addresses in `MAIL_TO`
- ✅ Jira tickets created and assignees notified (if Push to Jira clicked)

---

## 📁 Project Structure

```
meeting-agent/
├── backend/
│   ├── server.js                 # Express server, all API routes
│   ├── services/
│   │   ├── groq-stt.js           # Whisper transcription
│   │   ├── groq-extract.js       # LLaMA task extraction + report
│   │   ├── groq-vision.js        # Vision API for screenshots
│   │   ├── diffEngine.js         # Pixel diff + screen classifier
│   │   ├── jira.js               # Jira REST API integration
│   │   └── mailer.js             # Nodemailer HTML email
│   ├── package.json
│   └── .env                      # Your secrets (never commit this)
│
└── extension/
    ├── manifest.json             # Chrome MV3 manifest
    ├── background.js             # Service worker, agent toggle
    ├── offscreen.html            # Offscreen document shell
    ├── offscreen.js              # MediaRecorder + AudioContext
    ├── content.js                # Caption scraper (Zoom/Meet)
    ├── sidepanel.html            # Side panel markup
    ├── sidepanel.js              # Side panel logic + polling
    ├── sidepanel.css             # Dark theme styles
    └── icons/                    # Extension icons
```

---

## 🔌 API Endpoints

| Method | Route | Description |
|--------|-------|-------------|
| `POST` | `/meeting/start` | Reset state, start rolling extraction timer |
| `POST` | `/meeting/end` | Stop recording, generate final report, send email |
| `GET` | `/state` | Current transcript, tasks, meetingActive, report |
| `POST` | `/chunk` | Receive audio blob, transcribe via Whisper |
| `POST` | `/screenshot` | Receive base64 PNG, diff check, Vision analysis |
| `POST` | `/caption` | Receive caption text from content script |
| `POST` | `/api/jira/push` | Push approved tasks to Jira |
| `GET` | `/test` | Health check — verifies Groq API connection |

---

## 🐛 Debugging

### Backend not starting
```bash
# Check port is free
netstat -ano | findstr :3001
# Kill any existing node process
taskkill /F /IM node.exe
```

### Captions not showing in transcript
Open the Zoom/Meet tab console (F12) and run:
```js
console.log(document.querySelector('.live-transcription-subtitle__box'));
// Should return the element, not null
// If null → enable captions in Zoom first (click CC button)
```

### Jira user not found
```powershell
$token = "YOUR_TOKEN"
$email = "you@company.com"
$auth = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("${email}:${token}"))
Invoke-RestMethod `
  -Uri "https://yourworkspace.atlassian.net/rest/api/3/user/search?query=firstname" `
  -Headers @{ Authorization = "Basic $auth"; Accept = "application/json" } `
  -Method Get | ConvertTo-Json
```

### Audio not recording
Check the offscreen document DevTools:
1. `chrome://extensions` → AI Meeting Agent → **Service Worker** → Console
2. Look for `[offscreen] Recording started`
3. If missing → check `tabCapture` permission in manifest

### Test Jira connection manually
```powershell
$body = @{ fields = @{ project = @{ key = "TC" }; summary = "Test from AI Agent"; issuetype = @{ name = "Task" } } } | ConvertTo-Json -Depth 5
Invoke-RestMethod -Uri "https://yourworkspace.atlassian.net/rest/api/3/issue" `
  -Headers @{ Authorization = "Basic $auth"; "Content-Type" = "application/json" } `
  -Method Post -Body $body
```

---

## ⚠️ Known Limitations

- **Whisper latency** — audio transcription has 5–8s lag due to 30s chunk collection + API call. Use Zoom/Meet captions for real-time text.
- **Caption selectors** — Zoom and Meet update their DOM class names periodically. If captions stop working, inspect the DOM and update selectors in `content.js`.
- **Groq free tier** — Vision API limited to ~1,000 requests/day. The diff engine prevents most wasted calls but long meetings may hit limits.
- **Local only** — backend must run on the same machine as the browser. No cloud deployment in this version.
- **English only** — Whisper is configured for `language: "en"`. Remove that parameter for multilingual support.

---

## 🗺️ Roadmap

- [ ] **GitHub Issues integration** — push tasks directly to a repo
- [ ] **Linear integration** — alternative to Jira
- [ ] **Multi-language support** — detect language via Whisper, route to localized prompts
- [ ] **Follow-up tracker** — surface unresolved tasks from previous meetings
- [ ] **Duplicate detection** — hash title + assignee to prevent cross-chunk duplicates
- [ ] **Cloud backend** — replace local Node.js with deployed server for team sharing
- [ ] **Smart priority scoring** — detect urgency signals (ASAP, blocking, critical) in transcript
- [ ] **Notion integration** — create pages for meeting reports

---

## 🛠️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Chrome Extension | Manifest V3, tabCapture, offscreen API, sidePanel API |
| Backend | Node.js, Express 5, Multer, dotenv |
| Speech-to-Text | Groq Whisper Large v3 |
| Task Extraction | Groq LLaMA 3.1 8B Instant |
| Vision | Groq LLaMA 4 Scout 17B |
| Jira | Atlassian REST API v3 |
| Email | Nodemailer + Gmail SMTP |

---

## 🔐 Security Notes

- Never commit your `.env` file — it's in `.gitignore`
- Regenerate your Jira API token immediately if exposed
- Audio data only leaves your machine to reach Groq's API — never stored
- Gmail App Password is different from your real password — revoke it at [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) anytime

---

## 👥 Team

Built by **Shithij**, **Santhosh**, and **Krrish** at Protothon 2026.

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.
