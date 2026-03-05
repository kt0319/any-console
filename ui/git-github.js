// @ts-check
import { selectedWorkspace, allWorkspaces } from './state-core.js';
import { apiFetch, workspaceApiPath } from './api-client.js';
import { $, escapeHtml } from './utils.js';
import { GitLogModal } from './git-log-modal.js';

/**
 * Updates the GitHub button visibility based on the current workspace's github_url.
 */
export function updateGitHubButtonVisibility() {
  // no-op: GitHub button is now rendered inline in dirty entry
}

/**
 * Returns the GitHub URL for the currently selected workspace.
 * @returns {string|null}
 */
function getGitHubUrl() {
  const ws = allWorkspaces.find((w) => w.name === selectedWorkspace);
  return ws && ws.github_url ? ws.github_url.replace(/\.git$/, "") : null;
}

/**
 * Opens the GitHub sub-pane with repo info, PRs, and issues.
 */
export async function openGitHubPane() {
  if (!selectedWorkspace) return;
  GitLogModal.showSubPane("github", "GitHub");

  const content = $("git-github-content");
  if (!content) return;
  content.innerHTML = '<div class="github-loading">読み込み中...</div>';

  const basePath = workspaceApiPath(selectedWorkspace, "/github");
  const [infoRes, pullsRes, issuesRes, runsRes] = await Promise.all([
    apiFetch(`${basePath}/info`).then((r) => r && r.json()).catch(() => null),
    apiFetch(`${basePath}/pulls`).then((r) => r && r.json()).catch(() => null),
    apiFetch(`${basePath}/issues`).then((r) => r && r.json()).catch(() => null),
    apiFetch(`${basePath}/runs`).then((r) => r && r.json()).catch(() => null),
  ]);

  const githubUrl = getGitHubUrl();
  let html = "";

  if (infoRes && infoRes.status === "ok") {
    const d = infoRes.data;
    const ownerName = d.owner ? d.owner.login : "";
    html += `<div class="github-section-title github-section-link github-repo-name" data-url="${escapeHtml(githubUrl || "")}">${escapeHtml(ownerName)}/${escapeHtml(d.name || "")}</div>`;
  } else {
    const msg = infoRes && infoRes.message ? infoRes.message : "GitHub情報を取得できませんでした";
    html += `<div class="github-error">${escapeHtml(msg)}</div>`;
  }

  html += renderList("Issues", issuesRes, githubUrl, "issues");
  html += renderList("Pull Requests", pullsRes, githubUrl, "pull");
  html += renderRuns("Actions", runsRes, githubUrl);

  content.innerHTML = html;
}

/**
 * @param {string} title
 * @param {object|null} res
 * @param {string|null} githubUrl
 * @param {"pull"|"issues"} type
 */
function renderList(title, res, githubUrl, type) {
  const url = githubUrl ? (type === "pull" ? `${githubUrl}/pulls` : `${githubUrl}/issues`) : null;
  const count = res && res.status === "ok" && res.data ? res.data.length : 0;
  const badge = `<span class="github-section-badge">${count}</span>`;
  let html = `<div class="github-section-title${url ? " github-section-link" : ""}"${url ? ` data-url="${escapeHtml(url)}"` : ""}>${escapeHtml(title)}${badge}</div>`;

  if (!res || res.status !== "ok") {
    const msg = res && res.message ? res.message : "取得できませんでした";
    html += `<div class="github-error">${escapeHtml(msg)}</div>`;
    return html;
  }

  const items = res.data;
  if (!items || items.length === 0) {
    return html;
  }

  for (const item of items) {
    const num = item.number;
    const itemUrl = githubUrl ? `${githubUrl}/${type === "pull" ? "pull" : "issues"}/${num}` : null;
    const author = item.author ? item.author.login : "";
    const draft = item.isDraft ? '<span class="github-draft">Draft</span>' : "";
    const branch = item.headRefName ? `<span class="github-branch">${escapeHtml(item.headRefName)}</span>` : "";

    html += `<div class="github-item"${itemUrl ? ` data-url="${escapeHtml(itemUrl)}"` : ""}>`;
    html += `<span class="github-item-number">#${num}</span> `;
    html += `<span class="github-item-title">${escapeHtml(item.title)}</span>`;
    if (draft) html += ` ${draft}`;
    if (branch) html += ` ${branch}`;
    if (author) html += ` <span class="github-item-author">${escapeHtml(author)}</span>`;

    if (item.labels && item.labels.length > 0) {
      html += '<span class="github-labels">';
      for (const label of item.labels) {
        const color = label.color ? `#${label.color}` : "";
        const style = color ? ` style="background:${color}33;color:${color}"` : "";
        html += `<span class="github-label"${style}>${escapeHtml(label.name)}</span>`;
      }
      html += "</span>";
    }
    html += "</div>";
  }

  return html;
}

/** @type {Record<string, { icon: string, cls: string }>} */
const RUN_STATUS = {
  success: { icon: "\u2714", cls: "github-run-success" },
  failure: { icon: "\u2716", cls: "github-run-failure" },
  cancelled: { icon: "\u25CB", cls: "github-run-cancelled" },
  in_progress: { icon: "\u25F7", cls: "github-run-progress" },
  queued: { icon: "\u25F7", cls: "github-run-progress" },
  waiting: { icon: "\u25F7", cls: "github-run-progress" },
};

/**
 * @param {string} title
 * @param {object|null} res
 * @param {string|null} githubUrl
 */
function renderRuns(title, res, githubUrl) {
  const actionsUrl = githubUrl ? `${githubUrl}/actions` : null;
  const count = res && res.status === "ok" && res.data ? res.data.length : 0;
  const badge = `<span class="github-section-badge">${count}</span>`;
  let html = `<div class="github-section-title${actionsUrl ? " github-section-link" : ""}"${actionsUrl ? ` data-url="${escapeHtml(actionsUrl)}"` : ""}>${escapeHtml(title)}${badge}</div>`;

  if (!res || res.status !== "ok") {
    const msg = res && res.message ? res.message : "取得できませんでした";
    html += `<div class="github-error">${escapeHtml(msg)}</div>`;
    return html;
  }

  const items = res.data;
  if (!items || items.length === 0) {
    return html;
  }

  for (const run of items) {
    const key = run.conclusion || run.status || "";
    const st = RUN_STATUS[key] || { icon: "?", cls: "" };
    const runUrl = run.url || null;

    html += `<div class="github-item"${runUrl ? ` data-url="${escapeHtml(runUrl)}"` : ""}>`;
    html += `<span class="github-run-icon ${st.cls}">${st.icon}</span> `;
    html += `<span class="github-item-title">${escapeHtml(run.displayTitle || "")}</span>`;
    if (run.workflowName) html += ` <span class="github-run-workflow">${escapeHtml(run.workflowName)}</span>`;
    if (run.headBranch) html += ` <span class="github-branch">${escapeHtml(run.headBranch)}</span>`;
    if (run.event) html += ` <span class="github-item-author">${escapeHtml(run.event)}</span>`;
    html += "</div>";
  }

  return html;
}

export function initGitHubPane() {
  const content = $("git-github-content");
  if (!content) return;
  content.addEventListener("click", (e) => {
    const link = /** @type {HTMLElement} */ (e.target).closest("[data-url]");
    if (link) {
      window.open(link.dataset.url, "_blank");
    }
  });
}
