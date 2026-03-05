// @ts-check
import { selectedWorkspace, allWorkspaces } from './state-core.js';
import { apiFetch, workspaceApiPath } from './api-client.js';
import { $, escapeHtml } from './utils.js';
import { GitLogModal } from './git-log-modal.js';

/**
 * Updates the GitHub button visibility based on the current workspace's github_url.
 */
export function updateGitHubButtonVisibility() {
  const btn = $("git-modal-github-btn");
  if (!btn) return;
  const ws = allWorkspaces.find((w) => w.name === selectedWorkspace);
  btn.style.display = ws && ws.github_url ? "" : "none";
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
  const [infoRes, pullsRes, issuesRes] = await Promise.all([
    apiFetch(`${basePath}/info`).then((r) => r && r.json()).catch(() => null),
    apiFetch(`${basePath}/pulls`).then((r) => r && r.json()).catch(() => null),
    apiFetch(`${basePath}/issues`).then((r) => r && r.json()).catch(() => null),
  ]);

  const githubUrl = getGitHubUrl();
  let html = "";

  if (infoRes && infoRes.status === "ok") {
    const d = infoRes.data;
    const ownerName = d.owner ? d.owner.login : "";
    const visibility = d.isPrivate ? "Private" : "Public";
    const lang = d.primaryLanguage ? d.primaryLanguage.name : "";
    const defaultBranch = d.defaultBranchRef ? d.defaultBranchRef.name : "";
    html += '<div class="github-repo-info">';
    html += `<div class="github-repo-name">${escapeHtml(ownerName)}/${escapeHtml(d.name || "")}</div>`;
    if (d.description) html += `<div class="github-repo-desc">${escapeHtml(d.description)}</div>`;
    html += '<div class="github-repo-meta">';
    html += `<span>${escapeHtml(visibility)}</span>`;
    if (lang) html += `<span>${escapeHtml(lang)}</span>`;
    if (defaultBranch) html += `<span>${escapeHtml(defaultBranch)}</span>`;
    html += `<span>\u2605 ${d.stargazerCount ?? 0}</span>`;
    html += `<span>\ud83c\udf74 ${d.forkCount ?? 0}</span>`;
    html += "</div></div>";
  } else {
    const msg = infoRes && infoRes.message ? infoRes.message : "GitHub情報を取得できませんでした";
    html += `<div class="github-error">${escapeHtml(msg)}</div>`;
  }

  html += renderList("Pull Requests", pullsRes, githubUrl, "pull");
  html += renderList("Issues", issuesRes, githubUrl, "issues");

  content.innerHTML = html;
}

/**
 * @param {string} title
 * @param {object|null} res
 * @param {string|null} githubUrl
 * @param {"pull"|"issues"} type
 */
function renderList(title, res, githubUrl, type) {
  let html = `<div class="github-section-title">${escapeHtml(title)}`;
  if (githubUrl) {
    const url = type === "pull" ? `${githubUrl}/pulls` : `${githubUrl}/issues`;
    html += ` <a href="${escapeHtml(url)}" target="_blank" rel="noopener" class="github-section-link">Open</a>`;
  }
  html += "</div>";

  if (!res || res.status !== "ok") {
    const msg = res && res.message ? res.message : "取得できませんでした";
    html += `<div class="github-error">${escapeHtml(msg)}</div>`;
    return html;
  }

  const items = res.data;
  if (!items || items.length === 0) {
    html += '<div class="github-empty">なし</div>';
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

export function initGitHubPane() {
  const content = $("git-github-content");
  if (!content) return;
  content.addEventListener("click", (e) => {
    const item = /** @type {HTMLElement} */ (e.target).closest(".github-item[data-url]");
    if (item) {
      window.open(item.dataset.url, "_blank", "noopener");
    }
  });
}
