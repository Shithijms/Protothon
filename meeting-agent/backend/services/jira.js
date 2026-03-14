// services/jira.js — pushes action items to Jira as new issues

const PRIORITY_MAP = {
  high:   "High",
  medium: "Medium",
  low:    "Low",
};

// ✅ FIX: Since your project only has 'Task' and 'Epic',
// map everything to 'Task' instead of 'Bug'
const CATEGORY_TO_ISSUETYPE = {
  bug:      "Task",
  feature:  "Task",
  infra:    "Task",
  design:   "Task",
  research: "Task",
};

const userCache = {};

async function findJiraUser(nameOrEmail) {
  if (!nameOrEmail) return null;

  const cacheKey = nameOrEmail.toLowerCase().trim();
  if (userCache[cacheKey] !== undefined) return userCache[cacheKey];

  const host  = process.env.JIRA_HOST;
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  const projectKey = process.env.JIRA_PROJECT_KEY || "TC";
  const auth  = Buffer.from(`${email}:${token}`).toString("base64");

  const searchTerms = [
    nameOrEmail.trim(),
    nameOrEmail.trim().split(" ")[0],
    nameOrEmail.trim().split(" ").pop(),
  ].filter((t, i, arr) => t && arr.indexOf(t) === i);

  for (const term of searchTerms) {
    try {
      // ✅ FIX: Use assignable search scoped to the project
      // This is more reliable than the global user search
      const url = `${host}/rest/api/3/user/assignable/search?projectKey=${projectKey}&query=${encodeURIComponent(term)}&maxResults=5`;

      const res = await fetch(url, {
        headers: {
          "Authorization": `Basic ${auth}`,
          "Accept": "application/json",
        },
      });

      if (!res.ok) continue;

      const users = await res.json();
      if (!users || users.length === 0) continue;

      const match = users[0];
      console.log(`[jira] Resolved "${nameOrEmail}" via "${term}" → ${match.displayName} (${match.accountId})`);
      userCache[cacheKey] = match.accountId;
      return match.accountId;
    } catch (err) {
      continue;
    }
  }

  console.warn(`[jira] No Jira user found for "${nameOrEmail}"`);
  userCache[cacheKey] = null;
  return null;
}

let validIssueTypes = null;

async function getValidIssueTypes() {
  if (validIssueTypes) return validIssueTypes;

  const host  = process.env.JIRA_HOST;
  const email = process.env.JIRA_EMAIL;
  const token = process.env.JIRA_API_TOKEN;
  const projectKey = process.env.JIRA_PROJECT_KEY || "TC";
  const auth  = Buffer.from(`${email}:${token}`).toString("base64");

  try {
    const res = await fetch(
      `${host}/rest/api/3/issue/createmeta?projectKeys=${projectKey}&expand=projects.issuetypes`,
      {
        headers: {
          "Authorization": `Basic ${auth}`,
          "Accept": "application/json",
        },
      }
    );

    const data = await res.json();
    const types = data.projects?.[0]?.issuetypes?.map(t => t.name) || [];
    console.log("[jira] Valid issue types:", types);
    validIssueTypes = types;
    return types;
  } catch (err) {
    console.error("[jira] Could not fetch issue types:", err.message);
    return [];
  }
}

async function createIssue(task) {
  const host       = process.env.JIRA_HOST;
  const email      = process.env.JIRA_EMAIL;
  const token      = process.env.JIRA_API_TOKEN;
  const projectKey = process.env.JIRA_PROJECT_KEY || "ENG";
  const auth       = Buffer.from(`${email}:${token}`).toString("base64");

  const types     = await getValidIssueTypes();
  const preferred = CATEGORY_TO_ISSUETYPE[task.category] || "Task";
  const issueType = types.includes(preferred)
    ? preferred
    : types.includes("Task")
    ? "Task"
    : types.includes("Story")
    ? "Story"
    : types[0] || "Task";

  const priority = PRIORITY_MAP[task.priority] || "Medium";

  // ✅ FIX: Pass task.assignee so assigneeName is never null in response
  const assigneeAccountId = await findJiraUser(task.assignee);

  const description = {
    type: "doc",
    version: 1,
    content: [
      {
        type: "paragraph",
        content: [{ type: "text", text: task.description || task.title }],
      },
      ...(task.deadline ? [{
        type: "paragraph",
        content: [{
          type: "text",
          text: `Deadline: ${task.deadline}`,
          marks: [{ type: "em" }],
        }],
      }] : []),
      {
        type: "paragraph",
        content: [{
          type: "text",
          text: "Created automatically by AI Meeting Agent",
          marks: [{ type: "em" }],
        }],
      },
    ],
  };

  const fields = {
    project:     { key: projectKey },
    summary:     task.title,
    issuetype:   { name: issueType },
    priority:    { name: priority },
    description,
    labels:      ["ai-meeting-agent"],
  };

  if (assigneeAccountId) {
    fields.assignee = { accountId: assigneeAccountId };
  }

  const res = await fetch(`${host}/rest/api/3/issue`, {
    method:  "POST",
    headers: {
      "Authorization": `Basic ${auth}`,
      "Content-Type":  "application/json",
      "Accept":        "application/json",
    },
    body: JSON.stringify({ fields }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Jira API error ${res.status}: ${err}`);
  }

  const data = await res.json();

  return {
    key:              data.key,
    url:              `${host}/browse/${data.key}`,
    id:               data.id,
    assigneeResolved: !!assigneeAccountId,
    // ✅ FIX: assigneeName now correctly pulled from task object
    assigneeName:     task.assignee || null,
  };
}

async function pushTasksToJira(tasks) {
  const results = [];

  for (const task of tasks) {
    try {
      const issue = await createIssue(task);
      results.push({ task: task.title, ...issue, success: true });
      console.log(`[jira] Created ${issue.key}: ${task.title}`);
    } catch (err) {
      console.error(`[jira] Failed for "${task.title}":`, err.message);
      results.push({ task: task.title, success: false, error: err.message });
    }
  }

  return results;
}

module.exports = { pushTasksToJira };