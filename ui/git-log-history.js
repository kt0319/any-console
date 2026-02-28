function renderCommitMeta(author, time) {
  return `<span class="git-log-entry-meta"><span class="git-log-entry-author">${escapeHtml(author)}</span><span class="git-log-entry-time">${escapeHtml(time)}</span></span>`;
}

Object.assign(GitLogModal, {
  renderGitLogEntries(listEl, stdout) {
    const history = GitLogModal.state.history;
    const lines = stdout.split("\n");
    let count = 0;
    for (const line of lines) {
      if (!line.trim()) continue;

      const entry = document.createElement("div");
      const commitMatch = line.match(/^(.*?)([0-9a-f]{40})\t(.+?)\t(.+?)\t(.*?)\t(.*)$/);
      if (commitMatch) {
        const [, , hash, time, author, refs, msg] = commitMatch;
        if (history.seenHashes.has(hash)) continue;
        history.seenHashes.add(hash);
        entry.className = "git-log-entry git-log-commit";
        let refsHtml = "";
        if (refs) {
          refsHtml = refs.split(",").map((r) => {
            const name = r.trim();
            if (!name || name === "origin/HEAD" || name === "HEAD") return "";
            const isTag = name.startsWith("tag: ");
            const isHead = name.startsWith("HEAD -> ");
            const remoteMatch = name.match(/^(origin|upstream)\/(.*)/);
            const isRemote = remoteMatch && !isTag && !isHead;
            const cls = isTag ? "git-ref-tag" : isHead ? "git-ref-head" : isRemote ? "git-ref-remote" : "git-ref-branch";
            let label;
            if (isRemote) {
              const icon = remoteMatch[1] === "origin" ? "mdi-github" : "mdi-server";
              label = `<span class="mdi ${icon}"></span> ${escapeHtml(remoteMatch[2])}`;
            } else if (isTag) {
              label = `<span class="mdi mdi-tag-outline"></span> ${escapeHtml(name.replace("tag: ", ""))}`;
            } else if (isHead) {
              const branchName = name.replace("HEAD -> ", "");
              label = `<span class="mdi mdi-source-branch"></span> ${escapeHtml(branchName)}`;
            } else {
              label = `<span class="mdi mdi-source-branch"></span> ${escapeHtml(name)}`;
            }
            return `<span class="git-ref ${cls}">${label}</span>`;
          }).join("");
        }
        entry.innerHTML =
          `<span class="git-log-entry-body">` +
            `<span class="git-log-entry-msg">${escapeHtml(msg)}</span>` +
            `<span class="git-log-entry-row1">` +
              `<span class="git-log-entry-row1-left">${refsHtml ? `<span class="git-log-entry-refs">${refsHtml}</span>` : ""}</span>` +
              renderCommitMeta(author, time) +
            `</span>` +
          `</span>`;
        const branchSet = new Set();
        if (refs) {
          for (const r of refs.split(",")) {
            const name = r.trim();
            if (!name || name === "origin/HEAD" || name === "HEAD") continue;
            if (name.startsWith("HEAD -> ")) {
              branchSet.add(name.replace("HEAD -> ", ""));
            } else if (name.startsWith("tag: ")) {
              continue;
            } else {
              const rm = name.match(/^(?:origin|upstream)\/(.*)/);
              branchSet.add(rm ? rm[1] : name);
            }
          }
        }
        const branches = [...branchSet];
        entry.addEventListener("click", () => {
          openCommitDiffModal(hash, msg, branches);
        });
        count++;
      } else {
        continue;
      }
      listEl.appendChild(entry);
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

  updateGitLogBranchLabel() {
    GitLogModal.updateStashBtn();
  },

  async updateStashBtn() {
    const btn = $("diff-actions")?.querySelector('[data-action-key="stash-list"]');
    if (!btn) return;
    if (!selectedWorkspace) {
      btn.textContent = "Stash一覧";
      return;
    }
    try {
      const res = await apiFetch(workspaceApiPath(selectedWorkspace, "/stash-list"));
      if (!res || !res.ok) {
        btn.textContent = "Stash一覧";
        return;
      }
      const data = await res.json();
      const count = (data.status === "ok" && data.entries) ? data.entries.length : 0;
      btn.textContent = count > 0 ? `Stash一覧 (${count})` : "Stash一覧";
    } catch {
      btn.textContent = "Stash一覧";
    }
  },

  renderDirtyEntry(listEl) {
    const ws = allWorkspaces.find((w) => w.name === selectedWorkspace);
    const isDirty = ws && ws.clean === false;
    const entry = document.createElement("div");
    entry.className = "git-log-entry git-log-dirty";
    const branchLabel = escapeHtml((ws && ws.branch) ? ws.branch : "");
    const branchButtonHtml =
      '<button type="button" class="git-log-branch-select-btn git-log-dirty-branch-btn">' +
        `<span class="mdi mdi-source-branch"></span> <span class="git-log-dirty-branch-label">${branchLabel}</span>` +
      "</button>";
    let bodyHtml =
      '<span class="git-log-entry-body git-log-dirty-body">' +
        '<span class="git-log-dirty-main">';
    if (isDirty) {
      const statText = buildWorkspaceChangeSummaryHtml(ws);
      const badgeHtml = `<span class="git-log-entry-refs"><span class="git-ref git-ref-dirty">${statText}</span></span>`;
      bodyHtml +=
        '<span class="git-log-entry-msg git-log-dirty-msg">未コミットの変更</span>' +
        `${badgeHtml}`;
    } else {
      bodyHtml += '<span class="git-log-entry-msg git-log-dirty-msg">変更なし</span>';
    }
    bodyHtml += `</span>${branchButtonHtml}</span>`;
    entry.innerHTML = bodyHtml;
    const branchBtn = entry.querySelector(".git-log-dirty-branch-btn");
    branchBtn?.addEventListener("click", (event) => {
      event.stopPropagation();
      GitLogModal.openLocalBranchPane();
    });
    if (isDirty) {
      entry.addEventListener("click", () => {
        GitLogModal.state.previousModalTab = "diff";
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
    history.isLoading = false;
    history.hasMore = true;
    history.seenHashes.clear();

    try {
      const logRes = await apiFetch(workspaceApiPath(selectedWorkspace, `/git-log?limit=${GIT_LOG_ENTRIES_PER_PAGE}`));

      listEl.innerHTML = "";

      if (!logRes) return;
      const data = await logRes.json();
      if (!logRes.ok || data.status !== "ok") {
        GitLogModal.state.gitLogLoadedWorkspace = null;
        showToast(data.detail || data.stderr || "git log の読み込みに失敗しました");
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
    }
  },
});
