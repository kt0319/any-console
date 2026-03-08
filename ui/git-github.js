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

  const githubUrl = getGitHubUrl();
  const repoName = githubUrl ? githubUrl.replace(/^https?:\/\/github\.com\//, "") : "";

  const issuesUrl = githubUrl ? `${githubUrl}/issues` : "";
  const pullsUrl = githubUrl ? `${githubUrl}/pulls` : "";
  const actionsUrl = githubUrl ? `${githubUrl}/actions` : "";

  const loadingHtml = '<div class="github-loading">読み込み中...</div>';
  content.innerHTML =
    `<div class="github-section-title github-section-link github-repo-name" data-url="${escapeHtml(githubUrl || "")}">${escapeHtml(repoName)}</div>` +
    `<div class="github-section-title github-section-link" data-url="${escapeHtml(issuesUrl)}">Issues<span class="github-section-badge github-badge-loading" id="github-badge-issues">…</span></div>` +
    `<div id="github-section-issues">${loadingHtml}</div>` +
    `<div class="github-section-title github-section-link" data-url="${escapeHtml(pullsUrl)}">Pull Requests<span class="github-section-badge github-badge-loading" id="github-badge-pulls">…</span></div>` +
    `<div id="github-section-pulls">${loadingHtml}</div>` +
    `<div class="github-section-title github-section-link" data-url="${escapeHtml(actionsUrl)}">Actions<span class="github-section-badge github-badge-loading" id="github-badge-runs">…</span></div>` +
    `<div id="github-section-runs">${loadingHtml}</div>`;

  const basePath = workspaceApiPath(selectedWorkspace, "/github");

  const loadSection = async (id, badgeId, fetchPath, renderer) => {
    const el = content.querySelector(`#${id}`);
    const badge = content.querySelector(`#${badgeId}`);
    try {
      const res = await apiFetch(fetchPath).then((r) => r && r.json());
      if (badge) {
        const count = res && res.status === "ok" && res.data ? res.data.length : 0;
        badge.textContent = String(count);
        badge.classList.remove("github-badge-loading");
      }
      if (el) el.innerHTML = renderer(res);
    } catch {
      if (badge) { badge.textContent = "?"; badge.classList.remove("github-badge-loading"); }
      if (el) el.innerHTML = renderer(null);
    }
  };

  loadSection("github-section-issues", "github-badge-issues", `${basePath}/issues`, (res) => renderListItems(res, githubUrl, "issues"));
  loadSection("github-section-pulls", "github-badge-pulls", `${basePath}/pulls`, (res) => renderListItems(res, githubUrl, "pull"));
  loadSection("github-section-runs", "github-badge-runs", `${basePath}/runs`, (res) => renderRunItems(res, githubUrl));
}

/**
 * @param {object|null} res
 * @param {string|null} githubUrl
 * @param {"pull"|"issues"} type
 */
function renderListItems(res, githubUrl, type) {
  if (!res || res.status !== "ok") {
    const msg = res && res.message ? res.message : "取得できませんでした";
    return `<div class="github-error">${escapeHtml(msg)}</div>`;
  }

  const items = res.data;
  if (!items || items.length === 0) return "";

  let html = "";
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
 * @param {object|null} res
 * @param {string|null} githubUrl
 */
function renderRunItems(res, githubUrl) {
  if (!res || res.status !== "ok") {
    const msg = res && res.message ? res.message : "取得できませんでした";
    return `<div class="github-error">${escapeHtml(msg)}</div>`;
  }

  const items = res.data;
  if (!items || items.length === 0) return "";

  let html = "";
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
