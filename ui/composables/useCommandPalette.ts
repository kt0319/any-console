import { computed, ref, watch } from "vue";
import { emit } from "../app-bridge.ts";
import { useTerminalStore } from "../stores/terminal.ts";
import { useWorkspaceStore } from "../stores/workspace.ts";
import { useBusListener } from "./useBusListener.ts";
import { useRecentJobs } from "./useRecentJobs.ts";
import { filterPaletteItems, movePaletteIndex, type PaletteItem } from "../utils/command-palette.ts";
import { tabTitleLabel } from "../utils/tab-label.ts";

const TAB_FALLBACK_LABEL = "Terminal";

export function useCommandPalette() {
  const terminalStore = useTerminalStore();
  const workspaceStore = useWorkspaceStore();
  const { recentJobs, loadRecentJobs, runRecentJob } = useRecentJobs();

  const visible = ref(false);
  const query = ref("");
  const activeIndex = ref(0);

  const actionItems: PaletteItem[] = [
    { id: "action:new-terminal", group: "Actions", label: "New Terminal", icon: "mdi-console", run: () => emit("terminal:launch", {}) },
    { id: "action:open-session", group: "Actions", label: "Open Session", icon: "mdi-plus", run: () => emit("workspace:openModal") },
    { id: "action:settings", group: "Actions", label: "Settings", icon: "mdi-cog", run: () => emit("settings:open") },
  ];

  const items = computed<PaletteItem[]>(() => {
    // tab は markRaw のため、ワークスペース紐付けの変化は tabWorkspaceVersion 経由で追う。
    terminalStore.tabWorkspaceVersion;
    const tabItems = terminalStore.openTabs.map((tab): PaletteItem => ({
      id: `tab:${tab.id}`,
      group: "Tabs",
      label: tabTitleLabel(tab, workspaceStore.allWorkspaces) || tab.label || TAB_FALLBACK_LABEL,
      icon: "mdi-tab",
      run: () => emit("tab:select", { tab }),
    }));
    const jobItems = recentJobs.value.map((job): PaletteItem => ({
      id: `job:${job.key}`,
      group: "Jobs",
      label: `${job.workspace} | ${job.jobLabel || job.jobName}`,
      icon: job.pinned ? "mdi-pin" : "mdi-play",
      run: () => { void runRecentJob(job); },
    }));
    return [...actionItems, ...tabItems, ...jobItems];
  });

  const results = computed(() => filterPaletteItems(items.value, query.value));

  watch(query, () => { activeIndex.value = 0; });

  function open() {
    query.value = "";
    activeIndex.value = 0;
    visible.value = true;
    void loadRecentJobs();
  }

  function close() {
    visible.value = false;
  }

  function moveActive(delta: number) {
    activeIndex.value = movePaletteIndex(activeIndex.value, delta, results.value.length);
  }

  function runItem(item: PaletteItem | undefined) {
    if (!item) return;
    close();
    item.run();
  }

  useBusListener("command-palette:open", open);

  return { visible, query, activeIndex, results, close, moveActive, runItem };
}
