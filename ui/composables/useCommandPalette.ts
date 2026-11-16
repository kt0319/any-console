import { computed, ref } from "vue";
import { emit } from "../app-bridge.ts";
import { useTerminalStore } from "../stores/terminal.ts";
import { useWorkspaceStore } from "../stores/workspace.ts";
import { useLayoutStore } from "../stores/layout.ts";
import { useBusListener } from "./useBusListener.ts";
import { useSessionListOverlay } from "./useSessionListOverlay.ts";
import { useRecentJobs } from "./useRecentJobs.ts";
import { filterPaletteItems, movePaletteIndex, resolvePaletteIcons, type PaletteItem } from "../utils/command-palette.ts";
import { SETTINGS_VIEW_ENTRIES } from "../utils/settings-views.ts";
import { tabTitleLabel, workspaceBranchLabel } from "../utils/tab-label.ts";
import { paletteWorkspacePanes } from "../utils/workspace-panes.ts";

const TAB_FALLBACK_LABEL = "Terminal";

// コマンドパレットはセッションサイドバー（SessionListPanel.vue）の検索入力として統合している。
// 入力・選択位置はサイドバーを開き直しても保たれるようモジュール単位で持つ。
const query = ref("");
const activeIndex = ref(0);

/**
 * command-palette:open でサイドバーを開き、検索入力へフォーカスする。検索入力にフォーカスが
 * ある状態でもう一度受けたら、検索をクリアしてサイドバーを閉じる（トグル）。
 * 常時マウントされる場所から1回だけ呼ぶ。
 */
export function useCommandPaletteOpener() {
  const { open, close, isSearchFocused } = useSessionListOverlay();
  const { loadRecentJobs } = useRecentJobs();
  useBusListener("command-palette:open", () => {
    if (isSearchFocused.value) {
      query.value = "";
      activeIndex.value = 0;
      close();
      return;
    }
    open({ focusSearch: true });
    void loadRecentJobs();
  });
}

export function useCommandPalette() {
  const terminalStore = useTerminalStore();
  const workspaceStore = useWorkspaceStore();
  const layoutStore = useLayoutStore();
  const { close: closeSessionList } = useSessionListOverlay();
  const { recentJobs, loadRecentJobs, runRecentJob } = useRecentJobs();

  const actionItems: PaletteItem[] = [
    { id: "action:new-terminal", group: "Actions", label: "New Terminal", icons: [{ name: "mdi-console" }], run: () => emit("terminal:launch", {}) },
    { id: "action:open-session", group: "Actions", label: "Open Session", icons: [{ name: "mdi-plus" }], run: () => emit("workspace:openModal") },
    { id: "action:settings", group: "Actions", label: "Settings", icons: [{ name: "mdi-cog" }], run: () => emit("settings:open") },
  ];

  const settingsItems = SETTINGS_VIEW_ENTRIES.map(({ view, label, icon }): PaletteItem => ({
    id: `settings:${view}`,
    group: "Settings",
    label: `Settings | ${label}`,
    icons: [{ name: icon }],
    run: () => emit("settings:open", { view }),
  }));

  const items = computed<PaletteItem[]>(() => {
    // tab は markRaw のため、ワークスペース紐付けの変化は tabWorkspaceVersion 経由で追う。
    terminalStore.tabWorkspaceVersion;
    const tabItems = terminalStore.openTabs.map((tab): PaletteItem => ({
      id: `tab:${tab.id}`,
      group: "Tabs",
      label: tabTitleLabel(tab, workspaceStore.allWorkspaces) || tab.label || TAB_FALLBACK_LABEL,
      icons: resolvePaletteIcons([tab.wsIcon, tab.icon], "mdi-tab"),
      run: () => emit("tab:select", { tab, skipFocus: layoutStore.isTabBarAtBottom }),
    }));
    const workspaces = workspaceStore.allWorkspaces;
    const activeWorkspace = workspaces.find((w) => w.name === terminalStore.activeTab?.workspace);
    const detailItems = activeWorkspace
      ? paletteWorkspacePanes(activeWorkspace).map(({ pane, label, icon }): PaletteItem => ({
          id: `detail:${pane}`,
          group: "Detail",
          label: `${workspaceBranchLabel(activeWorkspace.name, workspaces)} | ${label}`,
          icons: [{ name: icon }],
          run: () => {
            workspaceStore.selectedWorkspace = activeWorkspace.name;
            emit("git:openFileModal", { pane });
          },
        }))
      : [];
    const launchItems = workspaces.map((ws): PaletteItem => ({
      id: `launch:${ws.name}`,
      group: "Launch",
      label: workspaceBranchLabel(ws.name, workspaces),
      icons: resolvePaletteIcons([{ name: ws.icon, color: ws.icon_color }], "mdi-console-line"),
      run: () => emit("terminal:launch", { workspace: ws.name, icon: ws.icon, iconColor: ws.icon_color }),
    }));
    const jobItems = recentJobs.value.map((job): PaletteItem => ({
      id: `job:${job.key}`,
      group: "Jobs",
      label: `${job.workspace} | ${job.jobLabel || job.jobName}`,
      icons: resolvePaletteIcons(
        [{ name: job.wsIcon, color: job.wsIconColor }, { name: job.jobIcon, color: job.jobIconColor }],
        job.pinned ? "mdi-pin" : "mdi-play",
      ),
      run: () => { void runRecentJob(job); },
    }));
    return [...actionItems, ...detailItems, ...tabItems, ...jobItems, ...launchItems, ...settingsItems];
  });

  // 検索入力がタブバーと同じ下端に来る設定では、入力に近い下側から候補を積む（最良の候補が入力の真上）。
  const resultsFromBottom = computed(() => layoutStore.isTabBarAtBottom);
  const isSearching = computed(() => query.value.trim() !== "");
  const results = computed(() => filterPaletteItems(items.value, query.value));

  function setQuery(value: string) {
    query.value = value;
    activeIndex.value = 0;
    if (value.trim() !== "") void loadRecentJobs();
  }

  function moveActive(delta: number) {
    activeIndex.value = movePaletteIndex(activeIndex.value, delta, results.value.length);
  }

  // 実行後は検索をクリアしてセッション一覧へ戻す。モバイルは一覧が全面オーバーレイで画面を塞ぐため閉じる。
  function runItem(item: PaletteItem | undefined) {
    if (!item) return;
    setQuery("");
    if (layoutStore.isNarrowViewport) closeSessionList();
    item.run();
  }

  return { query, activeIndex, isSearching, resultsFromBottom, results, setQuery, moveActive, runItem };
}
