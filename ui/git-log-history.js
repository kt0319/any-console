const GRAPH_COLORS = [
  "#82aaff", "#c3e88d", "#f78c6c", "#c792ea",
  "#89ddff", "#ffcb6b", "#ff5370", "#f07178",
];

const GRAPH_CELL_W = 10;

function renderGraphSvg(graphStr, rowHeight) {
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
}

function renderCommitMeta(author, time) {
  return `<span class="git-log-entry-meta"><span class="git-log-entry-author">${escapeHtml(author)}</span><span class="git-log-entry-time">${escapeHtml(time)}</span></span>`;
}

function renderDirtyWorkspaceLabel(ws) {
  if (ws && ws.clean === false) {
    const statText = buildWorkspaceChangeSummaryHtml(ws);
    return '<span class="git-log-entry-msg git-log-dirty-msg">未コミットの変更</span>'
      + `<span class="git-log-entry-refs"><span class="git-ref git-ref-dirty">${statText}</span></span>`;
  }
  return '<span class="git-log-entry-msg git-log-dirty-msg">変更なし</span>'
    + '<span class="git-log-entry-refs git-log-dirty-replacement" aria-hidden="true"><span class="git-ref git-ref-dirty">0F +0 -0</span></span>';
}

Object.assign(GitLogModal, {
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
          graphLine.innerHTML = renderGraphSvg(line, 16);
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

      const graphHtml = graph && graphPrefix.trim() ? renderGraphSvg(graphPrefix, 44) : "";
      const entry = document.createElement("div");
      entry.className = "git-log-entry git-log-commit";
      entry.innerHTML =
        graphHtml +
        `<span class="git-log-entry-body">` +
          `<span class="git-log-entry-msg">${escapeHtml(msg)}</span>` +
          `<span class="git-log-entry-row1">` +
            `<span class="git-log-entry-row1-left">${refsHtml ? `<span class="git-log-entry-refs">${refsHtml}</span>` : ""}</span>` +
            renderCommitMeta(author, time) +
          `</span>` +
        `</span>`;
      const branches = [...branchSet];
      bindLongPress(entry, {
        onClick: () => openCommitDiffModal(hash, msg, branches),
        onLongPress: () => GitLogModal.toggleCommitActionMenu(entry, hash, msg, branches),
      });
      entry.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        GitLogModal.toggleCommitActionMenu(entry, hash, msg, branches);
      });
      listEl.appendChild(entry);
      count++;
    }
    return count;
  },

  async loadMoreGitLog() {
    const history = GitLogModal.state.history;
    if (!selectedWorkspace || history.isLoading || !history.hasMore) return;
    history.isLoading = true;

    const listEl = $("git-log-list-modal");
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

  async updateStashIndicators(dirtyStashBtn) {
    const count = await GitLogModal.fetchStashCount();
    const actionBtn = $("diff-actions")?.querySelector('[data-action-key="stash-list"]');
    if (actionBtn) {
      actionBtn.textContent = count > 0 ? `Stash一覧 (${count})` : "Stash一覧";
    }
    if (dirtyStashBtn) {
      const badge = dirtyStashBtn.querySelector(".git-log-dirty-stash-badge");
      if (badge) badge.textContent = count > 0 ? count : "";
    }
  },

  renderDirtyEntry(listEl) {
    const ws = allWorkspaces.find((w) => w.name === selectedWorkspace);
    const isDirty = ws && ws.clean === false;
    const entry = document.createElement("div");
    entry.className = "git-log-entry git-log-dirty";
    const commitButtonHtml =
      '<button type="button" class="git-action-btn icon-only git-log-dirty-commit-btn" title="コミット" aria-label="コミット">' +
        '<span class="mdi mdi-check"></span>' +
      "</button>";
    const stashButtonHtml =
      '<button type="button" class="git-action-btn icon-only git-log-dirty-stash-btn" title="Stash一覧" aria-label="Stash一覧">' +
        '<span class="mdi mdi-tray-full"></span><span class="git-log-dirty-stash-badge"></span>' +
      "</button>";
    const branchButtonHtml =
      '<button type="button" class="git-action-btn icon-only git-log-dirty-branch-btn" title="ブランチ" aria-label="ブランチ">' +
        '<span class="mdi mdi-source-branch"></span>' +
      "</button>";
    const fullscreenButtonHtml =
      '<button type="button" class="git-action-btn icon-only git-log-history-fullscreen-btn" title="履歴全画面" aria-label="履歴全画面">' +
        '<span class="mdi mdi-arrow-expand-vertical"></span>' +
      "</button>";
    let bodyHtml =
      '<span class="git-log-entry-body git-log-dirty-body">' +
        '<span class="git-log-dirty-main">';
    bodyHtml += renderDirtyWorkspaceLabel(ws);
    bodyHtml += `</span><span class="git-log-dirty-actions">${isDirty ? commitButtonHtml : ""}${stashButtonHtml}${branchButtonHtml}${fullscreenButtonHtml}</span></span>`;
    entry.innerHTML = bodyHtml;
    const commitBtn = entry.querySelector(".git-log-dirty-commit-btn");
    commitBtn?.addEventListener("click", (event) => {
      event.stopPropagation();
      GitLogModal.showDiffPane("未コミットの変更");
      loadDiffTab().then(() => openCommitForm());
    });
    const stashBtn = entry.querySelector(".git-log-dirty-stash-btn");
    stashBtn?.addEventListener("click", (event) => {
      event.stopPropagation();
      GitLogModal.openStashPane();
    });
    this.updateStashIndicators(stashBtn);
    const branchBtn = entry.querySelector(".git-log-dirty-branch-btn");
    branchBtn?.addEventListener("click", (event) => {
      event.stopPropagation();
      GitLogModal.openLocalBranchPane();
    });
    const fullscreenBtn = entry.querySelector(".git-log-history-fullscreen-btn");
    fullscreenBtn?.addEventListener("click", (event) => {
      event.stopPropagation();
      GitLogModal.toggleHistoryFullscreen();
    });
    if (isDirty) {
      entry.addEventListener("click", () => {
        GitLogModal.showDiffPane("未コミットの変更");
        loadDiffTab();
      });
    } else {
      entry.style.cursor = "default";
    }
    listEl.appendChild(entry);
  },

  async reloadGitLog() {
    if (!selectedWorkspace) return;

    const listEl = $("git-log-list-modal");
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
