GitLogModal.state.graphVisible = false;
GitLogModal.state.graph = {
  loaded: 0,
  isLoading: false,
  hasMore: true,
  seenHashes: new Set(),
};

Object.assign(GitLogModal, {
  async toggleGraphView() {
    if (GitLogModal.state.graphVisible) {
      GitLogModal.closeGraphView();
      GitLogModal.showDiffHistoryTop();
      return;
    }
    GitLogModal.state.graphVisible = true;
    const graphPane = $("git-graph-pane");
    const diffLayout = graphPane?.parentElement?.querySelector(".diff-layout");
    if (diffLayout) diffLayout.style.display = "none";
    if (graphPane) graphPane.style.display = "";
    GitLogModal.setModalTitle("コミットグラフ", {
      back: true,
      onClick: () => GitLogModal.toggleGraphView(),
    });
    const icon = document.querySelector(".git-log-graph-btn .mdi");
    if (icon) icon.className = "mdi mdi-close";
    await GitLogModal.loadGraphLog();
  },

  closeGraphView() {
    if (!GitLogModal.state.graphVisible) return;
    GitLogModal.state.graphVisible = false;
    const graphPane = $("git-graph-pane");
    const diffLayout = graphPane?.parentElement?.querySelector(".diff-layout");
    if (graphPane) graphPane.style.display = "none";
    if (diffLayout) diffLayout.style.display = "";
    const icon = document.querySelector(".git-log-graph-btn .mdi");
    if (icon) icon.className = "mdi mdi-history";
  },

  async fetchGraphEntries(reset) {
    const graph = GitLogModal.state.graph;
    if (!selectedWorkspace) return;
    const listEl = $("git-graph-list");
    if (!listEl) return;
    if (reset) {
      listEl.innerHTML = "";
      graph.loaded = 0;
      graph.hasMore = true;
      graph.seenHashes.clear();
    } else if (graph.isLoading || !graph.hasMore) {
      return;
    }
    graph.isLoading = true;
    try {
      const skip = reset ? "" : `&skip=${graph.loaded}`;
      const res = await apiFetch(workspaceApiPath(selectedWorkspace, `/git-log?graph=true&limit=${GIT_LOG_ENTRIES_PER_PAGE}${skip}`));
      if (!res) return;
      const data = await res.json();
      if (!res.ok || data.exit_code !== 0 || !data.stdout) {
        graph.hasMore = false;
        return;
      }
      const count = GitLogModal.renderGitLogEntries(listEl, data.stdout, { graph: true, seenHashes: graph.seenHashes });
      graph.loaded += count;
      if (count < GIT_LOG_ENTRIES_PER_PAGE) graph.hasMore = false;
    } catch {
      graph.hasMore = false;
    } finally {
      graph.isLoading = false;
    }
  },

  loadGraphLog() { return GitLogModal.fetchGraphEntries(true); },
  loadMoreGraphLog() { return GitLogModal.fetchGraphEntries(false); },
});
