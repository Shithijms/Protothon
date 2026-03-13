// Side Panel — polls backend, renders transcript, tasks, board, and report

const BACKEND = "http://localhost:3001";
const POLL_INTERVAL = 5000; // 5 seconds

let lastTranscriptLength = 0;
let knownTaskIds = new Set();

// ── Tab switching ────────────────────────────────────────
const tabBtns = document.querySelectorAll(".tab-btn");
const tabPanels = document.querySelectorAll(".tab-panel");

tabBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    // Deactivate all
    tabBtns.forEach((b) => b.classList.remove("active"));
    tabPanels.forEach((p) => p.classList.remove("active"));

    // Activate clicked tab
    btn.classList.add("active");
    const target = document.getElementById(`tab-${btn.dataset.tab}`);
    if (target) target.classList.add("active");
  });
});

// ── Main poll loop ───────────────────────────────────────
async function pollState() {
  try {
    const res = await fetch(`${BACKEND}/state`);
    const state = await res.json();

    updateStatusDot(state.meetingActive);
    updateTranscript(state.rollingTranscript);
    updateLiveTasks(state.tasks);
    updateBoard(state.tasks);
  } catch (err) {
    // Backend might not be running yet — silently retry
  }
}

// ── Status dot ───────────────────────────────────────────
function updateStatusDot(active) {
  const dot = document.getElementById("status-dot");
  dot.className = `status-dot ${active ? "active" : "inactive"}`;
  dot.title = active ? "Recording" : "Inactive";
}

// ── Transcript view — show last 10 lines ─────────────────
function updateTranscript(lines) {
  if (!lines || lines.length === lastTranscriptLength) return;
  lastTranscriptLength = lines.length;

  const view = document.getElementById("transcript-view");
  const last10 = lines.slice(-10);

  view.innerHTML = last10
    .map((line) => {
      const isVisual = line.startsWith("[VISUAL");
      const cls = isVisual ? "transcript-line visual" : "transcript-line";
      return `<div class="${cls}">${escapeHtml(line)}</div>`;
    })
    .join("");

  // Auto-scroll to bottom
  view.scrollTop = view.scrollHeight;
}

// ── Live tasks — render extracted action items ───────────
function updateLiveTasks(tasks) {
  if (!tasks || tasks.length === 0) return;

  const container = document.getElementById("live-tasks");
  container.innerHTML = "";

  tasks.forEach((task, i) => {
    const card = document.createElement("div");
    card.className = "task-card";
    card.innerHTML = `
      <div class="task-title">${escapeHtml(task.title || "Untitled Task")}</div>
      <div class="task-meta">
        ${priorityBadge(task.priority)}
        ${task.assignee ? `<span class="badge badge-assignee">👤 ${escapeHtml(task.assignee)}</span>` : ""}
        ${task.source ? `<span class="badge badge-source">${sourceIcon(task.source)} ${task.source}</span>` : ""}
      </div>
    `;
    container.appendChild(card);
  });
}

// ── Board — sync tasks to Kanban columns ─────────────────
function updateBoard(tasks) {
  if (!tasks) return;

  const colTodo = document.getElementById("col-todo");
  const colInProgress = document.getElementById("col-inprogress");
  const colDone = document.getElementById("col-done");

  colTodo.innerHTML = "";
  colInProgress.innerHTML = "";
  colDone.innerHTML = "";

  tasks.forEach((task) => {
    const card = document.createElement("div");
    card.className = "board-card";
    card.innerHTML = `
      <div class="task-title">${escapeHtml(task.title || "Untitled")}</div>
      ${priorityBadge(task.priority)}
    `;

    // Route to correct column based on status
    const status = (task.status || "todo").toLowerCase();
    if (status === "in-progress" || status === "inprogress") {
      colInProgress.appendChild(card);
    } else if (status === "done") {
      colDone.appendChild(card);
    } else {
      colTodo.appendChild(card);
    }
  });
}

// ── Export JSON button ───────────────────────────────────
document.getElementById("btn-export").addEventListener("click", async () => {
  try {
    const res = await fetch(`${BACKEND}/state`);
    const state = await res.json();

    const blob = new Blob([JSON.stringify(state, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "meeting-report.json";
    a.click();

    URL.revokeObjectURL(url);
  } catch (err) {
    console.error("[sidepanel] Export failed:", err);
  }
});

// ── Helpers ──────────────────────────────────────────────

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function priorityBadge(priority) {
  const p = (priority || "medium").toLowerCase();
  const label = p.charAt(0).toUpperCase() + p.slice(1);
  return `<span class="badge badge-priority-${p}">${label}</span>`;
}

function sourceIcon(source) {
  if (source === "voice") return "🎤";
  if (source === "visual") return "👁️";
  if (source === "both") return "🎤👁️";
  return "📝";
}

// ── Start polling ────────────────────────────────────────
pollState();
setInterval(pollState, POLL_INTERVAL);
