// @ts-check

import { selectedWorkspace, allWorkspaces } from './state-core.js';
import { apiFetch, workspaceApiPath, getActionFailureMessage } from './api-client.js';
import { $, escapeHtml, formatCommitTime, renderIcon, showToast, buildWorkspaceChangeSummaryHtml, bindLongPress } from './utils.js';
import { GitLogModal } from './git-log-modal.js';
import { GIT_LOG_ENTRIES_PER_PAGE } from './state-git.js';

// Circular deps (only used in function bodies)
import { openCommitDiffModal, loadDiffTab, initDiffPane, openCommitForm } from './git-diff.js';
import { openGitHubPane } from './git-github.js';

/** @type {string[]} */
export const GRAPH_COLORS = [
  "#82aaff", "#c3e88d", "#f78c6c", "#c792ea",
  "#89ddff", "#ffcb6b", "#ff5370", "#f07178",
];

/** @type {number} */
export const GRAPH_CELL_W = 10;

Object.assign(GitLogModal, {
  /**
   * Renders an SVG graph cell string into an SVG element HTML string.
   * @param {string} graphStr
   * @param {number} rowHeight
   * @returns {string}
   */
  renderGraphSvg(graphStr, rowHeight) {
    const cw = GRAPH_CELL_W;
    const cols = graphStr.length;
    if (!cols) return "";
    const cy = rowHeight / 2;
    const sw = 1.5;
    let svgContent = "";
    for (let i = 0; i < cols; i++) {
      const ch = graphStr[i];
      if (ch === " ") continue;
      const lane = Math.floor(i / 2);
      const color = GRAPH_COLORS[lane % GRAPH_COLORS.length];
      const x = i * cw;
      const cx = x + cw / 2;
      switch (ch) {
        case "*":
          svgContent += `<circle cx="${cx}" cy="${cy}" r="3" fill="${color}"/>`;
          svgContent += `<line x1="${cx}" y1="0" x2="${cx}" y2="${cy - 3}" stroke="${color}" stroke-width="${sw}"/>`;
          svgContent += `<line x1="${cx}" y1="${cy + 3}" x2="${cx}" y2="${rowHeight}" stroke="${color}" stroke-width="${sw}"/>`;
          break;
        case "|":
          svgContent += `<line x1="${cx}" y1="0" x2="${cx}" y2="${rowHeight}" stroke="${color}" stroke-width="${sw}"/>`;
          break;
        case "/":
          svgContent += `<line x1="${x + cw}" y1="0" x2="${x}" y2="${rowHeight}" stroke="${color}" stroke-width="${sw}"/>`;
          break;
        case "\\":
          svgContent += `<line x1="${x}" y1="0" x2="${x + cw}" y2="${rowHeight}" stroke="${color}" stroke-width="${sw}"/>`;
          break;
        case "_":
          svgContent += `<line x1="${x}" y1="${cy}" x2="${x + cw}" y2="${cy}" stroke="${color}" stroke-width="${sw}"/>`;
          break;
      }
    }
    const width = cols * cw;
    return `<svg class="git-log-graph-svg" width="${width}" height="${rowHeight}" viewBox="0 0 ${width} ${rowHeight}">${svgContent}</svg>`;
  },

  /**
   * Renders commit author and time metadata as HTML.
   * @param {string} author
   * @param {string} time
   * @returns {string}
   */
  renderCommitMeta(author, time) {
    return `<span class="git-log-entry-meta"><span class="git-log-entry-author">${escapeHtml(author)}</span><span class="git-log-entry-time">${escapeHtml(time)}</span></span>`;
  },

  /**
   * Renders the dirty workspace label for the top entry in the git log.
   * @param {{ clean?: boolean } | undefined} ws
   * @returns {string}
   */
  renderDirtyWorkspaceLabel(ws) {
    if (ws && ws.clean === false) {
      const statText = buildWorkspaceChangeSummaryHtml(ws);
      return '<span class="git-log-entry-msg git-log-dirty-msg">未コミットの変更</span>'
        + `<span class="git-log-entry-refs"><span class="git-ref git-ref-dirty">${statText}</span></span>`;
    }
    return '<span class="git-log-entry-msg git-log-dirty-msg">変更なし</span>'
      + '<span class="git-log-entry-refs git-dirty-spacer" aria-hidden="true"><span class="git-ref git-ref-dirty">0F +0 -0</span></span>';
  },

  /**
   * Parses a git ref string into an HTML badge and optional branch name.
   * @param {string} name
   * @returns {{ html: string, branchName: string | null } | null}
   */
  parseRef(name) {
    if (!name || name === "origin/HEAD" || name === "HEAD") return null;
    const isTag = name.startsWith("tag: ");
    const isHead = name.startsWith("HEAD -> ");
    const remoteMatch = name.match(/^(origin|upstream)\/(.*)/);
    const isRemote = remoteMatch && !isTag && !isHead;
    let cls, label, branchName;
    if (isTag) {
      cls = "git-ref-tag";
      label = `<span class="mdi mdi-tag-outline"></span> ${escapeHtml(name.replace("tag: ", ""))}`;
      branchName = null;
    } else if (isHead) {
      branchName = name.replace("HEAD -> ", "");
      cls = "git-ref-head";
      label = `<span class="mdi mdi-source-branch"></span> ${escapeHtml(branchName)}`;
    } else if (isRemote) {
      const icon = remoteMatch[1] === "origin" ? "mdi-github" : "mdi-server";
      cls = "git-ref-remote";
      label = `<span class="mdi ${icon}"></span> ${escapeHtml(remoteMatch[2])}`;
      branchName = remoteMatch[2];
    } else {
      cls = "git-ref-branch";
      label = `<span class="mdi mdi-source-branch"></span> ${escapeHtml(name)}`;
      branchName = name;
    }
    return { html: `<span class="git-ref ${cls}">${label}</span>`, branchName };
  },

  /**
   * Renders git log entries from stdout into the given list element.
   * @param {HTMLElement} listEl
   * @param {string} stdout
   * @param {{ graph?: boolean, seenHashes?: Set<string> | null }} [options]
   * @returns {number}
   */
  renderGitLogEntries(listEl, stdout, { graph = false, seenHashes = null } = {}) {
    const seen = seenHashes || GitLogModal.state.history.seenHashes;
    const lines = stdout.split("\n");
    let count = 0;
    for (const line of lines) {
      if (!line.trim()) continue;

      const commitMatch = line.match(/^(.*?)([0-9a-f]{40})\t(.+?)\t(.+?)\t(.*?)\t(.*)$/);
      if (!commitMatch) {
        if (graph) {
          const graphLine = document.createElement("div");
          graphLine.className = "git-log-graph-line";
          graphLine.innerHTML = GitLogModal.renderGraphSvg(line, 16);
          listEl.appendChild(graphLine);
        }
        continue;
      }

      const [, graphPrefix, hash, time, author, refs, msg] = commitMatch;
      if (seen.has(hash)) continue;
      seen.add(hash);

      let refsHtml = "";
      const branchSet = new Set();
      if (refs) {
        const htmlParts = [];
        for (const r of refs.split(",")) {
          const parsed = GitLogModal.parseRef(r.trim());
          if (!parsed) continue;
          htmlParts.push(parsed.html);
          if (parsed.branchName) branchSet.add(parsed.branchName);
        }
        refsHtml = htmlParts.join("");
      }

      const graphHtml = graph && graphPrefix.trim() ? GitLogModal.renderGraphSvg(graphPrefix, 44) : "";
      const entry = document.createElement("div");
      entry.className = "git-log-entry git-log-commit";
      entry.innerHTML =
        graphHtml +
        `<span class="git-log-entry-body">` +
          `<span class="git-log-entry-msg">${escapeHtml(msg)}</span>` +
          `<span class="git-log-entry-row1">` +
            `<span class="git-log-entry-row1-left">${refsHtml ? `<span class="git-log-entry-refs">${refsHtml}</span>` : ""}</span>` +
            GitLogModal.renderCommitMeta(author, time) +
          `</span>` +
        `</span>`;
      const branches = [...branchSet];
      bindLongPress(entry, {
        onClick: () => openCommitDiffModal(hash, msg, branches),
        onLongPress: () => GitLogModal.toggleCommitActionMenu(entry, hash, msg, branches),
      });
      listEl.appendChild(entry);
      count++;
    }
    return count;
  },

  /** @returns {Promise<void>} */
  async loadMoreGitLog() {
    const history = GitLogModal.state.history;
    if (!selectedWorkspace || history.isLoading || !history.hasMore) return;
    history.isLoading = true;

    const listEl = $("git-history-list");
    try {
      const res = await apiFetch(workspaceApiPath(selectedWorkspace, `/git-log?limit=${GIT_LOG_ENTRIES_PER_PAGE}&skip=${history.loaded}`));
      if (!res) return;
      const data = await res.json();
      if (!res.ok || data.status !== "ok" || !data.stdout) {
        history.hasMore = false;
        return;
      }
      const count = GitLogModal.renderGitLogEntries(listEl, data.stdout);
      history.loaded += count;
      if (count < GIT_LOG_ENTRIES_PER_PAGE) {
        history.hasMore = false;
      }
    } catch {
      history.hasMore = false;
    } finally {
      history.isLoading = false;
    }
  },

  /**
   * Fetches the current stash count for the selected workspace.
   * @returns {Promise<number>}
   */
  async fetchStashCount() {
    if (!selectedWorkspace) return 0;
    try {
      const res = await apiFetch(workspaceApiPath(selectedWorkspace, "/stash-list"));
      if (!res || !res.ok) return 0;
      const data = await res.json();
      return (data.status === "ok" && data.entries) ? data.entries.length : 0;
    } catch {
      return 0;
    }
  },

  /**
   * Updates stash count badge on the diff-actions button.
   * @returns {Promise<void>}
   */
  async updateStashIndicators() {
    const count = await GitLogModal.fetchStashCount();
    const actionBtn = $("diff-actions")?.querySelector('[data-action-key="stash-list"]');
    if (actionBtn) {
      actionBtn.textContent = count > 0 ? `Stash一覧 (${count})` : "Stash一覧";
    }
  },

  /**
   * Renders the dirty workspace entry at the top of the git log list.
   * @param {HTMLElement} listEl
   * @returns {void}
   */
  renderDirtyEntry(listEl) {
    const ws = allWorkspaces.find((w) => w.name === selectedWorkspace);
    const isDirty = ws && ws.clean === false;
    const entry = document.createElement("div");
    entry.className = "git-log-entry git-log-dirty";
    const branchButtonHtml =
      '<button type="button" class="git-action-btn icon-only git-log-dirty-branch-btn" title="ブランチ" aria-label="ブランチ">' +
        '<span class="mdi mdi-source-branch"></span>' +
      "</button>";
    const graphButtonHtml =
      '<button type="button" class="git-action-btn icon-only git-log-graph-btn" title="コミットグラフ" aria-label="コミットグラフ">' +
        '<span class="mdi mdi-history"></span>' +
      "</button>";
    const githubButtonHtml = ws && ws.github_url
      ? '<button type="button" class="git-action-btn icon-only git-log-github-btn" title="GitHub" aria-label="GitHub">' +
          '<span class="mdi mdi-github"></span>' +
        "</button>"
      : "";
    let bodyHtml =
      '<span class="git-log-entry-body git-log-dirty-body">' +
        '<span class="git-log-dirty-main">';
    bodyHtml += GitLogModal.renderDirtyWorkspaceLabel(ws);
    bodyHtml += `</span><span class="git-log-dirty-actions">${branchButtonHtml}${graphButtonHtml}${githubButtonHtml}</span></span>`;
    entry.innerHTML = bodyHtml;
    const branchBtn = entry.querySelector(".git-log-dirty-branch-btn");
    branchBtn?.addEventListener("click", (event) => {
      event.stopPropagation();
      GitLogModal.openLocalBranchPane();
    });
    const graphBtn = entry.querySelector(".git-log-graph-btn");
    graphBtn?.addEventListener("click", (event) => {
      event.stopPropagation();
      GitLogModal.toggleGraphView();
    });
    const githubBtn = entry.querySelector(".git-log-github-btn");
    githubBtn?.addEventListener("click", (event) => {
      event.stopPropagation();
      openGitHubPane();
    });
    if (isDirty) {
      entry.addEventListener("click", () => {
        GitLogModal.showDiffPane("未コミットの変更");
        loadDiffTab();
      });
    } else {
      entry.addEventListener("click", () => {
        GitLogModal.showDiffPane("変更なし");
        initDiffPane([
          { label: "コミット", fn: () => openCommitForm() },
          { label: "Stash一覧", key: "stash-list", fn: () => GitLogModal.openStashPane() },
        ]);
        $("diff-file-list").innerHTML = "";
      });
    }
    listEl.appendChild(entry);
  },

  /** @returns {Promise<void>} */
  async reloadGitLog() {
    if (!selectedWorkspace) return;

    const listEl = $("git-history-list");
    const historyPane = $("git-history-pane");
    for (const id of ["git-create-branch-area", "git-commit-action-menu"]) {
      const el = $(id);
      if (el && listEl.contains(el)) {
        el.style.display = "none";
        historyPane.appendChild(el);
      }
    }
    listEl.innerHTML = '<div class="git-log-entry-msg" style="color:var(--text-muted);padding:16px">読み込み中...</div>';

    const history = GitLogModal.state.history;
    history.loaded = 0;
    history.isLoading = true;
    history.hasMore = true;
    history.seenHashes.clear();

    try {
      const logRes = await apiFetch(workspaceApiPath(selectedWorkspace, `/git-log?limit=${GIT_LOG_ENTRIES_PER_PAGE}`));

      listEl.innerHTML = "";

      if (!logRes) return;
      const data = await logRes.json();
      if (!logRes.ok || data.status !== "ok") {
        GitLogModal.state.gitLogLoadedWorkspace = null;
        showToast(getActionFailureMessage(data, "git log の読み込みに失敗しました"));
        return;
      }
      if (!data.stdout) {
        GitLogModal.state.gitLogLoadedWorkspace = selectedWorkspace;
        listEl.innerHTML += '<div style="color:var(--text-muted);padding:16px">ログがありません</div>';
        return;
      }

      GitLogModal.renderDirtyEntry(listEl);
      const count = GitLogModal.renderGitLogEntries(listEl, data.stdout);
      GitLogModal.state.gitLogLoadedWorkspace = selectedWorkspace;
      history.loaded = count;
      if (count < GIT_LOG_ENTRIES_PER_PAGE) {
        history.hasMore = false;
      }
    } catch (e) {
      GitLogModal.state.gitLogLoadedWorkspace = null;
      listEl.innerHTML = "";
      showToast(`git log エラー: ${e.message}`);
    } finally {
      history.isLoading = false;
    }
  },
});
