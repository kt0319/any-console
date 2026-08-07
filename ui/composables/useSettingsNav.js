import { ref, computed, watch } from "vue";
import { on, emit as bridgeEmit } from "../app-bridge.js";
import { useWorkspaceStore } from "../stores/workspace.js";
import { useLayoutStore } from "../stores/layout.js";

// 設定画面のビュースタック（旧Modal.vueが単独で持っていた状態）をモジュール
// スコープの単一状態に抽出したもの。モバイルのModal.vue（オーバーレイ表示）と
// PCのSessionSidebar.vue（サイドバーへインライン表示）の両方から同じ
// ナビゲーション状態を参照・操作できるようにする（PCでは歯車ボタンを廃止し、
// ハンバーガー1つでセッション一覧+設定を同じサイドバーにまとめるため）。
//
// スタックの先頭（末尾に何も積まれていない状態）は常にSessionList（開いて
// いるタブの一覧）で、ここから外れない不動のルートになる。ModalMenu以下の
// 設定画面はその先に積まれるビューという扱いになり、設定を見ている間は
// SessionListが隠れる（＝一覧と設定を同時に出さない）。
//
// 個々の設定画面（ModalMenu/WorkspaceOpen/...）は useModalView() 経由で
// modalTitle/modalBranch/viewState/pushView/popView/updateViewState を
// inject するインターフェースのまま変わらない（provideする側がModal.vueから
// SettingsPanel.vueに変わるだけ）。

/** @typedef {{ view: string, state: Record<string, any> }} NavEntry */

const ROOT_VIEW = "SessionList";

/** @returns {NavEntry} */
const rootEntry = () => ({ view: ROOT_VIEW, state: {} });

/** @type {import("vue").Ref<NavEntry[]>} */
const viewStack = ref([{ view: ROOT_VIEW, state: {} }]);
const modalTitle = ref("");
const modalBranch = ref("");
/** @type {import("vue").Ref<{ handleBack?: () => boolean } | null>} */
const currentPaneRef = ref(null);

const currentView = computed(() => viewStack.value.at(-1)?.view ?? null);
const currentState = computed(() => viewStack.value.at(-1)?.state ?? {});
const canNavigateBack = computed(() => currentView.value !== ROOT_VIEW);
// スタックがルートより深い＝設定側の画面を表示すべき状態。モバイルはこれを
// 見てオーバーレイ(Modal.vue)を開閉し、PCはこれを見てサイドバーを開く。
const isNavOpen = computed(() => canNavigateBack.value);

/** @type {ReturnType<typeof useLayoutStore> | null} */
let layoutStore = null;
/** @type {ReturnType<typeof useWorkspaceStore> | null} */
let workspaceStore = null;

function setPaneRef(el) {
  currentPaneRef.value = el;
}

function ensureSidebarOpen() {
  if (layoutStore && !layoutStore.isPanelBottom) layoutStore.isSessionSidebarOpen = true;
}

function pushView(view, state = {}) {
  modalBranch.value = "";
  viewStack.value = [...viewStack.value, { view, state }];
  ensureSidebarOpen();
}

function updateViewState(state) {
  if (!viewStack.value.length) return;
  const stack = viewStack.value.slice();
  stack[stack.length - 1] = { ...stack[stack.length - 1], state };
  viewStack.value = stack;
}

function popView(result) {
  modalBranch.value = "";
  if (viewStack.value.length <= 1) return; // SessionList（ルート）より前には戻れない
  const popped = viewStack.value.at(-1);
  const newStack = viewStack.value.slice(0, -1);
  if (result != null && popped?.state?.onReturn) {
    popped.state.onReturn(result, newStack.at(-1));
  }
  viewStack.value = newStack;
}

/** @param {string | NavEntry[]} views */
function openView(views) {
  const list = Array.isArray(views) ? views : [{ view: views, state: {} }];
  // SessionListが先頭に無ければ根として補い、常にそこまで戻れるようにする。
  viewStack.value = list[0]?.view === ROOT_VIEW ? list : [rootEntry(), ...list];
  ensureSidebarOpen();
}

function closeNav() {
  viewStack.value = [rootEntry()];
  modalTitle.value = "";
  modalBranch.value = "";
  currentPaneRef.value = null;
  if (layoutStore) layoutStore.isSessionSidebarOpen = false;
  bridgeEmit("settings:closed");
}

function onBack() {
  if (currentPaneRef.value?.handleBack?.()) return;
  popView();
}

let listenersRegistered = false;

function registerListeners() {
  // ストア参照は呼び出しの都度、その時点でアクティブなPiniaに合わせて
  // 更新する（テストで setActivePinia(createPinia()) するたびに新しい
  // インスタンスへ切り替わるようにするため。閉じるモジュールスコープの
  // 単一変数を経由するので、以下のイベントリスナ内のクロージャからも
  // 常に最新のストアが見える）。
  workspaceStore = useWorkspaceStore();
  layoutStore = useLayoutStore();

  if (listenersRegistered) return;
  listenersRegistered = true;

  // isSettingsOpenは「設定画面が(モバイルのオーバーレイでもPCのサイドバー
  // インラインでも)表示中か」を表す既存フラグ（useTerminalInput/
  // useGlobalShortcutsがショートカット抑止に使う）。isNavOpenとそのまま同期する。
  watch(isNavOpen, (open) => {
    if (layoutStore) layoutStore.isSettingsOpen = open;
  }, { immediate: true });

  on("settings:open", (detail) => {
    if (detail?.view) {
      // 保存済み circle keypad 設定には旧 view 名が残っている可能性があるため読み替える
      const view = detail.view === "PreviewConfig" ? "PreviewPorts" : detail.view;
      const stack = [{ view: "ModalMenu", state: {} }];
      // PairDeviceConfigは通常AuthConfig配下からのみ遷移するビューのため、
      // 直接開く場合もAuthConfigを積んでおき、戻る操作でAuthConfigに戻れるようにする
      if (view === "PairDeviceConfig") stack.push({ view: "AuthConfig", state: {} });
      stack.push({ view, state: detail.state || {} });
      openView(stack);
    } else {
      openView("ModalMenu");
    }
  });

  on("workspace:openModal", () => openView([
    { view: "ModalMenu", state: {} },
    { view: "WorkspaceOpen", state: {} },
  ]));

  on("workspace:openAdd", (detail) => openView([
    { view: "ModalMenu", state: {} },
    { view: "WorkspaceOpen", state: {} },
    { view: "WorkspaceAdd", state: { ...detail } },
  ]));

  on("git:openFileModal", (detail) => openView([
    { view: "ModalMenu", state: {} },
    { view: "WorkspaceOpen", state: {} },
    { view: "WorkspaceDetail", state: { detail } },
  ]));

  on("preview:showPorts", () => openView([
    { view: "ModalMenu", state: {} },
    { view: "PreviewPorts", state: {} },
  ]));

  on("git:openGitHub", () => openView([
    { view: "ModalMenu", state: {} },
    { view: "WorkspaceOpen", state: {} },
    { view: "WorkspaceDetail", state: { detail: { pane: "issues" } } },
  ]));

  on("git:openHistory", (/** @type {{ wsName?: string }} */ { wsName } = {}) => {
    if (workspaceStore && wsName) workspaceStore.selectedWorkspace = wsName;
    openView([
      { view: "ModalMenu", state: {} },
      { view: "WorkspaceOpen", state: {} },
      { view: "WorkspaceDetail", state: { detail: { pane: "history" } } },
    ]);
  });

  on("modal:close", () => closeNav());

  // 設定表示中にタブを切り替えたら閉じてセッション一覧へ戻す（モバイルの
  // オーバーレイがターミナルを隠したままにならないようにするための挙動）。
  // PCはサイドバーがターミナルを覆わないので対象外。TabConfig（Tabs &
  // Sessionsペイン）自体もラジオ切り替えで同じイベントを発火するため、
  // そのビュー表示中は対象外にする。
  on("tab:select", () => {
    if (!layoutStore?.isPanelBottom) return;
    if (isNavOpen.value && currentView.value !== "TabConfig") closeNav();
  });
}

export function useSettingsNav() {
  registerListeners();
  return {
    viewStack, currentView, currentState, canNavigateBack, isNavOpen,
    modalTitle, modalBranch,
    pushView, popView, updateViewState, openView, closeNav, onBack, setPaneRef,
  };
}
