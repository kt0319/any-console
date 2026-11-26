import { reactive, computed, watch } from "vue";
import { useTerminalStore } from "../stores/terminal.ts";
import { useExclusiveOverlay } from "./useExclusiveOverlay.ts";

// WorkspaceDetail専用のナビゲーション状態。useSettingsNav.tsのビュースタックとは独立させる
// （Settingsのスタックに積むと、開くたびにセッション一覧/設定側の表示まで切り替わってしまう）。
// provide側はWorkspaceDetailModal.vue。pushView/popViewだけはJobsペインからJobConfigを開くためuseSettingsNav.ts側の実物をprovideする。
//
// 状態はterminalStoreのタブIDをキーにしたMapで保持し、タブごとに開閉状態・表示ペインを独立させる。
// 各エントリはreactive()でラップする。単一の共有トリガーrefで無効化する実装だと、setPaneRefが
// 他フィールドも無効化→再レンダリング→setPaneRef再呼び出しの無限ループでブラウザタブがクラッシュした。

interface TabDetailState {
  isOpen: boolean;
  detail: Record<string, any>;
  modalTitle: string;
  modalBranch: string;
  currentPaneRef: any;
}

const stateByTab = new Map<number | null, TabDetailState>();

function defaultState(): TabDetailState {
  return reactive({ isOpen: false, detail: {}, modalTitle: "", modalBranch: "", currentPaneRef: null });
}

function currentTabId() {
  return useTerminalStore().activeTabId;
}

function entryFor(id: number | null): TabDetailState {
  let e = stateByTab.get(id);
  if (!e) {
    e = defaultState();
    stateByTab.set(id, e);
  }
  return e;
}

function entry(): TabDetailState {
  return entryFor(currentTabId());
}

function makeField<K extends keyof TabDetailState>(key: K) {
  return computed({
    get(): TabDetailState[K] {
      return entry()[key];
    },
    set(v: TabDetailState[K]) {
      entry()[key] = v;
    },
  });
}

const isOpen = makeField("isOpen");
const detail = makeField("detail");
const modalTitle = makeField("modalTitle");
const modalBranch = makeField("modalBranch");

const viewState = computed(() => ({ detail: detail.value }));

function open(newDetail: Record<string, any> = {}) {
  const { closeOthersOn } = useExclusiveOverlay();
  closeOthersOn("workspaceDetail");
  const e = entry();
  e.detail = newDetail;
  e.modalTitle = "";
  e.modalBranch = "";
  e.isOpen = true;
}

function updateViewState(state: { detail?: Record<string, any> } | null | undefined) {
  entry().detail = state?.detail ?? {};
}

function setPaneRef(el: any) {
  entry().currentPaneRef = el;
}

// tabId省略時は現在のアクティブタブを閉じる。DispatchRunViewのRun成功時は新セッション作成でアクティブタブが
// 切り替わった後に呼ばれるため、tabIdを明示しないと元タブが isOpen: true のまま残る。
function close(tabId?: number | null) {
  const e = tabId !== undefined && tabId !== null ? entryFor(tabId) : entry();
  e.isOpen = false;
  e.modalTitle = "";
  e.modalBranch = "";
  e.currentPaneRef = null;
}

function onBack() {
  if (entry().currentPaneRef?.handleBack?.()) return;
  close();
}

let cleanupWatcherRegistered = false;

// リーク防止のため、開いているタブ集合が変わるたびに存在しないタブIDのエントリを間引く。
function registerCleanupWatcher() {
  if (cleanupWatcherRegistered) return;
  cleanupWatcherRegistered = true;

  const { registerOverlay } = useExclusiveOverlay();
  registerOverlay("workspaceDetail", close);
  // getter内で都度useTerminalStore()を呼ぶ（テストのsetActivePinia再生成後も新しいストアを参照するため）。
  watch(
    () => useTerminalStore().openTabs.map((t) => t.id),
    (ids) => {
      const known = new Set(ids);
      for (const id of stateByTab.keys()) {
        if (id !== null && known.has(id)) continue;
        stateByTab.delete(id);
      }
    },
  );
}

export function useWorkspaceDetailNav() {
  registerCleanupWatcher();
  return { isOpen, viewState, modalTitle, modalBranch, open, close, onBack, setPaneRef, updateViewState };
}
