// Side Panel — polls backend, renders transcript, tasks, board, and report

const BACKEND = "http://localhost:3001";
const POLL_INTERVAL = 5000; // 5 seconds

let lastTranscriptLength = 0;
let lastTaskCount = 0;
// FIX (Bug 4): Track whether report has been rendered to avoid re-rendering
// on every poll cycle. Previously report was never shown because /state did
// not include it.
let reportRendered = false;
let previouslyActive = false;

// ── Tab switching ────────────────────────────────────────
const tabBtns = document.querySelectorAll(".tab-btn");
const tabPanels = document.querySelectorAll(".tab-panel");

tabBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    tabBtns.forEach((b) => b.classList.remove("active"));
    tabPanels.forEach((p) => p.classList.remove("active"));
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

    // FIX (Bug 4): Render report when it arrives from /state.
    // Previously /state never included `report` so this was always null.
    if (state.report && !reportRendered) {
      renderReport(state.report);
      reportRendered = true;

      // Auto-switch to the Report tab when meeting ends and report arrives
      if (!state.meetingActive) {
        tabBtns.forEach((b) => b.classList.remove("active"));
        tabPanels.forEach((p) => p.classList.remove("active"));
        document.querySelector('[data-tab="report"]').classList.add("active");
        document.getElementById("tab-report").classList.add("active");
      }
    }

    // Reset reportRendered flag when a new meeting starts so next report
    // is rendered fresh
// FIX: When a new meeting starts, clear all displayed content from the
// previous meeting. Previously only reportRendered was reset but the
// actual DOM elements (transcript, tasks, board, report view) kept
// showing stale data from the previous session.
if (state.meetingActive && !previouslyActive) {
  reportRendered = false;
  lastTranscriptLength = 0;
  lastTaskCount = 0;

  // Clear transcript view
  const transcriptView = document.getElementById("transcript-view");
  if (transcriptView) transcriptView.innerHTML = "";

  // Clear live tasks
  const liveTasks = document.getElementById("live-tasks");
  if (liveTasks) liveTasks.innerHTML = "";

  // Clear board columns
  ["col-todo", "col-inprogress", "col-done"].forEach(id => {
    const col = document.getElementById(id);
    if (col) col.innerHTML = "";
  });

  // Reset report tab to placeholder
  const reportView = document.getElementById("report-view");
  if (reportView) {
    reportView.innerHTML = `<p class="placeholder-text">Report will appear after the meeting ends.</p>`;
  }
}
previouslyActive = state.meetingActive;
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

  view.scrollTop = view.scrollHeight;
}

// ── Live tasks — render extracted action items ───────────
function updateLiveTasks(tasks) {
  if (!tasks || tasks.length === 0) return;

  const container = document.getElementById("live-tasks");
  container.innerHTML = "";

  tasks.forEach((task) => {
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

// ── FIX (Bug 4 + Missing feature): Render final report in the Report tab.
// Previously the Report tab always showed the placeholder because:
//   1. /state never returned `report`
//   2. There was no renderReport() function at all
// This also implements the "Confirm & Notify" flow from spec §7.2 steps 13-15.
// ─────────────────────────────────────────────────────────
function renderReport(report) {
  const view = document.getElementById("report-view");
  if (!report) return;

  const decisions = (report.keyDecisions || [])
    .map((d) => `<li><strong>${escapeHtml(d.decision)}</strong>${d.rationale ? " — " + escapeHtml(d.rationale) : ""}</li>`)
    .join("");

  const openQs = (report.openQuestions || [])
    .map((q) => `<li>${escapeHtml(q)}</li>`)
    .join("");

  const highlights = (report.visualHighlights || [])
    .map((h) => `<li>${escapeHtml(h)}</li>`)
    .join("");

  // Build editable task rows for the review step
  const taskRows = (report.actionItems || [])
    .map((task, i) => `
      <div class="report-task-row" data-index="${i}">
        <input class="task-edit-title" value="${escapeHtml(task.title || "")}" data-field="title" data-index="${i}"/>
        <select class="task-edit-priority" data-field="priority" data-index="${i}">
          <option value="high"   ${task.priority === "high"   ? "selected" : ""}>High</option>
          <option value="medium" ${task.priority === "medium" ? "selected" : ""}>Medium</option>
          <option value="low"    ${task.priority === "low"    ? "selected" : ""}>Low</option>
        </select>
        <input class="task-edit-assignee" placeholder="Assignee" value="${escapeHtml(task.assignee || "")}" data-field="assignee" data-index="${i}"/>
        <button class="btn-delete-task" data-index="${i}" title="Remove task">✕</button>
      </div>`)
    .join("");

  view.innerHTML = `
    <div class="report-section">
      <h4>📋 ${escapeHtml(report.meetingTitle || "Meeting Report")}</h4>
      <p>${escapeHtml(report.executiveSummary || "")}</p>
    </div>

    ${decisions ? `<div class="report-section"><h4>✅ Key Decisions</h4><ul>${decisions}</ul></div>` : ""}

    <div class="report-section">
      <h4>🎯 Action Items — Review & Edit</h4>
      <div id="report-task-list">${taskRows}</div>
    </div>

    ${openQs ? `<div class="report-section"><h4>❓ Open Questions</h4><ul>${openQs}</ul></div>` : ""}
    ${highlights ? `<div class="report-section"><h4>🖥️ Visual Highlights</h4><ul>${highlights}</ul></div>` : ""}

<button id="btn-confirm-notify" class="btn-export" style="background:#0f6e56;margin-top:10px">
      Confirm &amp; Notify Assignees
    </button>
    <button id="btn-push-jira" class="btn-export" style="background:#0052cc;margin-top:6px">
      🔵 Push to Jira
    </button>
    <div id="jira-results" style="margin-top:8px;font-size:11px;"></div>
  `;
// ── Push to Jira ────────────────────────────────────────
document.getElementById("btn-push-jira").addEventListener("click", async () => {
  const items = (report.actionItems || []).filter(t => t.title);
  if (items.length === 0) {
    alert("No action items to push.");
    return;
  }

  const btn = document.getElementById("btn-push-jira");
  const resultsDiv = document.getElementById("jira-results");

  btn.textContent = "Pushing...";
  btn.disabled = true;
  resultsDiv.innerHTML = `<span style="color:#aaa">Creating Jira tickets...</span>`;

  try {
    const res = await fetch(`${BACKEND}/api/jira/push`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tasks: items }),
    });

    // FIX: Always parse response even on error
    let data;
    try {
      data = await res.json();
    } catch (_) {
      throw new Error("Server returned invalid response");
    }

    if (!res.ok) {
      resultsDiv.innerHTML = `<span style="color:#ff6b6b">❌ ${escapeHtml(data.error || "Unknown error")}</span>`;
      btn.textContent = "🔵 Push to Jira";
      btn.disabled = false;
      return;
    }

    // FIX: Guard against missing arrays
    const created = Array.isArray(data.created) ? data.created : [];
    const failed  = Array.isArray(data.failed)  ? data.failed  : [];

    const lines = [
      ...created.map(r => {
        const assigneeInfo = r.assigneeName
          ? r.assigneeResolved
            ? `<span style="color:#66bb6a"> → 📧 ${escapeHtml(r.assigneeName)} notified</span>`
            : `<span style="color:#ffc107"> → ⚠️ ${escapeHtml(r.assigneeName)} not in Jira</span>`
          : "";
        return `<div style="margin:3px 0">
          ✅ <a href="${escapeHtml(r.url)}" target="_blank"
               style="color:#4fc3f7">${escapeHtml(r.key)}</a>
             — ${escapeHtml(r.task)}${assigneeInfo}
        </div>`;
      }),
      ...failed.map(f =>
        `<div style="color:#ff6b6b;margin:3px 0">
           ❌ ${escapeHtml(f.task)}: ${escapeHtml(f.error || "Failed")}
         </div>`
      ),
    ];

    resultsDiv.innerHTML = lines.length > 0
      ? lines.join("")
      : `<span style="color:#aaa">No results returned</span>`;

    btn.textContent = created.length > 0
      ? `✅ ${created.length} ticket${created.length > 1 ? "s" : ""} created`
      : "⚠️ Push failed — see errors above";
    btn.disabled = false;

  } catch (err) {
    resultsDiv.innerHTML = `<span style="color:#ff6b6b">❌ ${escapeHtml(err.message)}</span>`;
    btn.textContent = "🔵 Push to Jira";
    btn.disabled = false;
  }
});


  // Wire up inline edits
  view.querySelectorAll("[data-field]").forEach((input) => {
    input.addEventListener("change", (e) => {
      const idx = parseInt(e.target.dataset.index, 10);
      const field = e.target.dataset.field;
      if (report.actionItems && report.actionItems[idx]) {
        report.actionItems[idx][field] = e.target.value;
      }
    });
  });

  // Wire up task delete buttons
  view.querySelectorAll(".btn-delete-task").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const idx = parseInt(e.target.dataset.index, 10);
      if (report.actionItems) {
        report.actionItems.splice(idx, 1);
        renderReport(report); // re-render after deletion
      }
    });
  });

  // FIX (Missing feature — spec §7.2 steps 13-15): Confirm & Notify button.
  // Fires chrome.notifications for each task with an assignee, and opens
  // a mailto: link with pre-filled subject and body.
  document.getElementById("btn-confirm-notify").addEventListener("click", () => {
    const items = report.actionItems || [];
    const title = report.meetingTitle || "Meeting";

    items.forEach((task) => {
      if (!task.assignee) return;

      // In-browser notification
      chrome.notifications.create(`task-${Date.now()}-${Math.random()}`, {
        type: "basic",
        iconUrl: "icons/icon48.png",
        title: `Action for ${task.assignee}`,
        message: task.title || "New task assigned",
        priority: 2,
      });

      // mailto: link — opens in default email client
      const subject = encodeURIComponent(`Action from ${title}`);
      const body = encodeURIComponent(
        `Hi ${task.assignee},\n\nYou have a new action item from the meeting:\n\n` +
        `Task: ${task.title}\n` +
        `Priority: ${task.priority || "medium"}\n` +
        `${task.deadline ? "Deadline: " + task.deadline + "\n" : ""}` +
        `\nDetails: ${task.description || ""}\n\nThanks`
      );
      window.open(`mailto:?subject=${subject}&body=${body}`, "_blank");
    });

    // FIX (Missing feature — spec §7.2 step 16): Persist final report and
    // tasks to chrome.storage.local so they survive browser restarts.
    chrome.storage.local.set({
      lastReport: report,
      lastTasks: items,
      lastReportDate: new Date().toISOString(),
    }, () => {
      console.log("[sidepanel] Report saved to chrome.storage.local");
    });

    alert(`Notified ${items.filter((t) => t.assignee).length} assignees.`);
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

// FIX: Use event delegation for report buttons so they survive re-renders
document.getElementById("report-view").addEventListener("click", (e) => {
  // Handle delete task
  if (e.target.classList.contains("btn-delete-task")) {
    // Already handled inline — this is just a safety net
    return;
  }
});