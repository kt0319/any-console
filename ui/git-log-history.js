Object.assign(GitLogModal, {
  renderGitLogEntries(listEl, stdout) {
    const lines = stdout.split("\n");
    let count = 0;
    for (const line of lines) {
      if (!line.trim()) continue;

      const entry = document.createElement("div");
      const commitMatch = line.match(/^(.*?)([0-9a-f]{40})\t(.+?)\t(.+?)\t(.*?)\t(.*)$/);
      if (commitMatch) {
        const [, , hash, time, author, refs, msg] = commitMatch;
        if (gitLogSeenHashes.has(hash)) continue;
        gitLogSeenHashes.add(hash);
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
              `<span class="git-log-entry-meta"><span class="git-log-entry-time">${escapeHtml(time)}</span><span class="git-log-entry-author">${escapeHtml(author)}</span></span>` +
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
    if (!selectedWorkspace || isGitLogLoading || !gitLogHasMore) return;
    isGitLogLoading = true;

    const listEl = $("git-log-list-modal");
    try {
      const res = await apiFetch(workspaceApiPath(selectedWorkspace, `/git-log?limit=${GIT_LOG_ENTRIES_PER_PAGE}&skip=${gitLogLoaded}`));
      if (!res) return;
      const data = await res.json();
      if (!res.ok || data.status !== "ok" || !data.stdout) {
        gitLogHasMore = false;
        return;
      }
      const count = GitLogModal.renderGitLogEntries(listEl, data.stdout);
      gitLogLoaded += count;
      if (count < GIT_LOG_ENTRIES_PER_PAGE) {
        gitLogHasMore = false;
      }
    } catch {
      gitLogHasMore = false;
    } finally {
      isGitLogLoading = false;
    }
  },

  updateGitLogBranchLabel() {
    const ws = allWorkspaces.find((w) => w.name === selectedWorkspace);
    $("git-log-branch-label").textContent = ws ? ws.branch : "";
    GitLogModal.updateStashBtn();
  },

  async updateStashBtn() {
    const btn = $("stash-btn");
    if (!btn) return;
    if (!selectedWorkspace) {
      btn.textContent = "stash";
      return;
    }
    try {
      const res = await apiFetch(workspaceApiPath(selectedWorkspace, "/stash-list"));
      if (!res || !res.ok) {
        btn.textContent = "stash";
        return;
      }
      const data = await res.json();
      const count = (data.status === "ok" && data.entries) ? data.entries.length : 0;
      btn.textContent = count > 0 ? `stash (${count})` : "stash";
    } catch {
      btn.textContent = "stash";
    }
  },

  renderDirtyEntry(listEl) {
    const ws = allWorkspaces.find((w) => w.name === selectedWorkspace);
    const isDirty = ws && ws.clean === false;
    if (!isDirty) return;
    const entry = document.createElement("div");
    entry.className = "git-log-entry git-log-dirty";
    const statText = buildWorkspaceChangeSummaryHtml(ws);
    const badgeHtml = `<span class="git-log-entry-refs"><span class="git-ref git-ref-dirty">${statText}</span></span>`;
    entry.innerHTML =
      `<span class="git-log-entry-body">` +
        `<span class="git-log-entry-row1">${badgeHtml}</span>` +
        '<span class="git-log-entry-msg" style="color:var(--text-muted)">未コミットの変更</span>' +
      `</span>`;
    entry.addEventListener("click", () => {
      GitLogModal.previousModalTab = "commits";
      GitLogModal.showDiffPane("未コミットの変更");
      loadDiffTab();
    });
    listEl.appendChild(entry);
  },

  async reloadGitLog() {
    if (!selectedWorkspace) return;

    const listEl = $("git-log-list-modal");
    listEl.innerHTML = '<div class="git-log-entry-msg" style="color:var(--text-muted);padding:16px">読み込み中...</div>';

    gitLogLoaded = 0;
    isGitLogLoading = false;
    gitLogHasMore = true;
    gitLogSeenHashes.clear();

    try {
      const logRes = await apiFetch(workspaceApiPath(selectedWorkspace, `/git-log?limit=${GIT_LOG_ENTRIES_PER_PAGE}`));

      listEl.innerHTML = "";

      if (!logRes) return;
      const data = await logRes.json();
      if (!logRes.ok || data.status !== "ok") {
        showToast(data.detail || data.stderr || "git log の読み込みに失敗しました");
        return;
      }
      if (!data.stdout) {
        listEl.innerHTML += '<div style="color:var(--text-muted);padding:16px">ログがありません</div>';
        return;
      }

      GitLogModal.renderDirtyEntry(listEl);
      const count = GitLogModal.renderGitLogEntries(listEl, data.stdout);
      gitLogLoaded = count;
      if (count < GIT_LOG_ENTRIES_PER_PAGE) {
        gitLogHasMore = false;
      }
    } catch (e) {
      listEl.innerHTML = "";
      showToast(`git log エラー: ${e.message}`);
    }
  },
});
