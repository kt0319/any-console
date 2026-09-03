import { reactive, computed, watch } from "vue";
import { useTerminalStore } from "../stores/terminal.ts";
import { useExclusiveMobileOverlay } from "./useExclusiveMobileOverlay.ts";

// WorkspaceDetail専用のナビゲーション状態。useSettingsNav.tsのビュースタックとは
// 完全に独立させている（以前はSettingsのスタックに積んでいたため、開くたびに
// セッション一覧/設定側の表示まで巻き込んで切り替わってしまっていた）。
//
// WorkspaceDetail.vueはuseModalView()経由でこの値をinjectする前提（provide側は
// WorkspaceDetailModal.vue。pushView/popViewだけはJobsペインからJobConfigを開く
// 導線のためuseSettingsNav.ts側の実物をprovideする）。
//
// 状態はterminalStoreのタブID（activeTabId）をキーにしたMapで保持し、タブごとに
// 開閉状態・表示中のペインを独立させる（isOpen/pane程度の粒度。スクロール位置等の
// ペイン内部状態までは対象外）。
//
// 各タブのエントリはreactive()でラップする（単一の共有トリガーrefで無効化する
// 実装を最初に試したが、setPaneRefがcurrentPaneRefを書き換えるたびに他フィールドも
// 無効化され、それを参照するコンポーネントの再レンダリング→setPaneRef再呼び出し
// →無効化…の無限ループでブラウザタブがクラッシュした。reactive()のプロパティ単位
// 追跡ならこれが起きない）。

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
const currentPaneRef = makeField("currentPaneRef");

const viewState = computed(() => ({ detail: detail.value }));

function open(newDetail: Record<string, any> = {}) {
  const { closeOthersOn } = useExclusiveMobileOverlay();
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

// tabId省略時は現在アクティブなタブを閉じる。DispatchRunView経由のRun成功時は
// Runで新規セッションが作られアクティブタブが切り替わった後に呼ばれるため、
// tabIdを明示しないと元タブではなく切り替わった後の新タブを閉じてしまい、
// 元タブが isOpen: true のまま残ってしまう（再マウント時のopen()で意図せず
// 再度開いて見えることがあった）。
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

// 閉じたタブのエントリはMapに残り続けるとリークするため、開いているタブの
// 集合が変わるたびに、もう存在しないタブIDのエントリを間引く。
function registerCleanupWatcher() {
  if (cleanupWatcherRegistered) return;
  cleanupWatcherRegistered = true;

  const { registerOverlay } = useExclusiveMobileOverlay();
  registerOverlay("workspaceDetail", close);
  // getter内でuseTerminalStore()を都度呼ぶ（テストでsetActivePinia(createPinia())
  // されるたびに新しいストアへ切り替わるようにするため。クロージャで一度だけ
  // ストア参照を固定すると、Pinia再生成後も古いストアを見続けてしまう）。
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
