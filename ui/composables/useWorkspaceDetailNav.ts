import { reactive, computed, watch } from "vue";
import { useTerminalStore } from "../stores/terminal.ts";
import { useExclusiveMobileOverlay } from "./useExclusiveMobileOverlay.ts";

// WorkspaceDetail（Files/Changes/History/Branches/Jobs/Stash）専用のナビゲー
// ション状態。useSettingsNav.tsのビュースタックとは完全に独立させている
// （以前はSettingsのスタックに"WorkspaceDetail"を積んでいたため、開くたびに
// セッション一覧/設定側の表示（currentView・modalTitle）まで巻き込んで
// 切り替わってしまっていた）。WorkspaceDetailを開いても、裏の
// SessionSidebar.vue/Modal.vue側の表示はそのまま変化しない。
//
// WorkspaceDetail.vueはuseModalView()経由でmodalTitle/modalBranch/viewState/
// updateViewStateをinjectする前提のため、WorkspaceDetailModal.vueはこの
// composableの値をその名前でprovideする（pushView/popViewだけは、Jobsペイン
// からJobConfigを開く導線のためuseSettingsNav.ts側の実物をprovideする）。
//
// 状態はterminalStoreのタブID（activeTabId）をキーにしたMapで保持し、
// タブごとに開閉状態・表示中のペイン（detail.pane）を独立させる（タブAで
// Filesを開いたままタブBに切り替えても、Aへ戻れば開いていたFilesのまま
// 復元される）。WorkspaceDetailModal.vueは<WorkspaceDetail :key="activeTabId">
// でタブ切替時に強制的に再マウントし、onMounted内のopen(viewState.detail)で
// Mapに保存されたペイン情報から復元する（ペイン内部の詳細な状態＝スクロール
// 位置・選択中のdiffファイル等までは対象外。isOpen/pane程度の粒度）。
//
// 各タブのエントリはreactive()でラップし、フィールドごとに独立して依存追跡
// させる（isOpen/detail/modalTitle/modalBranch/currentPaneRefの5フィールドを
// 単一の共有トリガーrefで無効化する実装を最初に試したが、setPaneRef（テンプレの
// :ref="setPaneRef"経由で再レンダリングのたびに呼ばれる）がcurrentPaneRefを
// 書き換えるたびに isOpen/modalTitle まで無効化され、それらを参照する
// WorkspaceDetailModal.vueの再レンダリング→setPaneRef再呼び出し→無効化…という
// 無限ループでブラウザタブがクラッシュした。reactive()のプロパティ単位の
// 追跡ならcurrentPaneRefの書き換えは他フィールドに影響しない）。

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

function entry(): TabDetailState {
  const id = currentTabId();
  let e = stateByTab.get(id);
  if (!e) {
    e = defaultState();
    stateByTab.set(id, e);
  }
  return e;
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

function close() {
  const e = entry();
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
