// @ts-check
import { selectedWorkspace, allWorkspaces } from './state-core.js';
import { escapeHtml, buildWorkspaceChangeSummaryHtml, $ } from './utils.js';
import { GitLogModal } from './git-log-modal.js';
import { apiFetch, workspaceApiPath } from './api-client.js';
import { GIT_LOG_ENTRIES_PER_PAGE } from './state-git.js';

GitLogModal.state.graphVisible = false;
GitLogModal.state.graph = {
  loaded: 0,
  isLoading: false,
  hasMore: true,
  seenHashes: new Set(),
};

Object.assign(GitLogModal, {
  /**
   * Toggles the commit graph view open or closed.
   * @returns {Promise<void>}
   */
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

  /**
   * Closes the commit graph view and restores the diff layout.
   * @returns {void}
   */
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

  /**
   * Fetches and renders graph log entries, optionally resetting the list.
   * @param {boolean} reset - Whether to reset the list before loading.
   * @returns {Promise<void>}
   */
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

  /**
   * Loads the initial graph log (resets existing entries).
   * @returns {Promise<void>}
   */
  loadGraphLog() { return GitLogModal.fetchGraphEntries(true); },

  /**
   * Loads additional graph log entries (pagination).
   * @returns {Promise<void>}
   */
  loadMoreGraphLog() { return GitLogModal.fetchGraphEntries(false); },
});
