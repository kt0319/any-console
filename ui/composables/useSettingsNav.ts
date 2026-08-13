import { ref, computed } from "vue";
import { on, emit as bridgeEmit } from "../app-bridge.js";
import { useWorkspaceStore } from "../stores/workspace.ts";
import { useLayoutStore } from "../stores/layout.ts";
import { useWorkspaceDetailNav } from "./useWorkspaceDetailNav.ts";
import { useSessionListOverlay } from "./useSessionListOverlay.ts";
import { useExclusiveMobileOverlay } from "./useExclusiveMobileOverlay.ts";

// Settings専用のビュースタック（旧Modal.vueが単独で持っていた状態）を
// モジュールスコープの単一状態に抽出したもの。タブバーの歯車ボタンから
// TerminalSettingsModal.vue（PC/モバイル共通、WorkspaceDetailModal.vueと
// 同じ全面オーバーレイ）が開く。セッション一覧・Open Sessionとは完全に
// 独立した系列で、ルートはModalMenu固定（ここから外れない）。
//
// 個々の設定画面（ModalMenu/TerminalConfig/...）は useModalView() 経由で
// modalTitle/modalBranch/viewState/pushView/popView/updateViewState を
// injectするインターフェースのまま変わらない（provideする側がTerminalSettingsModal.vue
// になるだけ）。

type NavEntry = { view: string, state: Record<string, any> };

const ROOT_VIEW = "ModalMenu";

const rootEntry = (): NavEntry => ({ view: ROOT_VIEW, state: {} });

const viewStack = ref<NavEntry[]>([rootEntry()]);
const modalTitle = ref("");
const modalBranch = ref("");
const isOpen = ref(false);
const currentPaneRef = ref<{ handleBack?: () => boolean } | null>(null);

const currentView = computed(() => viewStack.value.at(-1)?.view ?? null);
const currentState = computed(() => viewStack.value.at(-1)?.state ?? {});
const canNavigateBack = computed(() => viewStack.value.length > 1);

let workspaceStore: ReturnType<typeof useWorkspaceStore> | null = null;

function setPaneRef(el) {
  currentPaneRef.value = el;
}

function pushView(view: string, state: Record<string, any> = {}) {
  modalBranch.value = "";
  viewStack.value = [...viewStack.value, { view, state }];
}

function updateViewState(state: Record<string, any>) {
  if (!viewStack.value.length) return;
  const stack = viewStack.value.slice();
  stack[stack.length - 1] = { ...stack[stack.length - 1], state };
  viewStack.value = stack;
}

function popView(result?: unknown) {
  modalBranch.value = "";
  if (viewStack.value.length <= 1) return; // ModalMenu（ルート）より前には戻れない
  const popped = viewStack.value.at(-1);
  const newStack = viewStack.value.slice(0, -1);
  if (result != null && popped?.state?.onReturn) {
    popped.state.onReturn(result, newStack.at(-1));
  }
  viewStack.value = newStack;
}

function openView(views: string | NavEntry[]) {
  const { closeOthersOn } = useExclusiveMobileOverlay();
  closeOthersOn("settings");
  const list = Array.isArray(views) ? views : [{ view: views, state: {} }];
  viewStack.value = list[0]?.view === ROOT_VIEW ? list : [rootEntry(), ...list];
  isOpen.value = true;
}

function closeNav() {
  viewStack.value = [rootEntry()];
  modalTitle.value = "";
  modalBranch.value = "";
  currentPaneRef.value = null;
  isOpen.value = false;
  bridgeEmit("settings:closed");
}

function onBack() {
  if (currentPaneRef.value?.handleBack?.()) return;
  if (!canNavigateBack.value) {
    closeNav();
    return;
  }
  popView();
}

let listenersRegistered = false;

function registerListeners() {
  // ストア参照は呼び出しの都度、その時点でアクティブなPiniaに合わせて
  // 更新する（テストで setActivePinia(createPinia()) するたびに新しい
  // インスタンスへ切り替わるようにするため）。
  workspaceStore = useWorkspaceStore();

  if (listenersRegistered) return;
  listenersRegistered = true;

  const { registerOverlay } = useExclusiveMobileOverlay();
  registerOverlay("settings", closeNav);

  on("settings:open", (detail) => {
    if (detail?.view) {
      // 保存済み circle keypad 設定・通知タップ等には旧 view 名が残っている
      // 可能性があるため読み替える（TabConfigは旧Tabs & Sessions画面＝現在の
      // セッション一覧。PreviewPorts/PreviewConfigはSessionPreview=Dev Server
      // としてSettings配下の項目に統合済み）。
      let view = detail.view === "PreviewConfig" ? "PreviewPorts" : detail.view;
      if (view === "TabConfig") view = "SessionList";
      if (view === "PreviewPorts") view = "SessionPreview";
      // 旧DispatchQueueConfig/SessionDispatches（グローバルなDispatch一覧）は
      // ワークスペース詳細のDispatchタブへ統合され廃止済みのため読み替え先が無く、
      // Settingsメニューへフォールバックする。
      if (view === "DispatchQueueConfig" || view === "SessionDispatches") {
        openView(ROOT_VIEW);
        return;
      }
      // SessionListは今回のSettings/Open Session分離でセッション一覧
      // オーバーレイ側の管轄になったため、このスタックには積まずリダイレクトする。
      if (view === "SessionList") {
        useSessionListOverlay().open();
        return;
      }
      const state = detail.state || {};
      const stack = [{ view: ROOT_VIEW, state: {} }];
      // PairDeviceConfigは通常AuthConfig配下からのみ遷移するビューのため、
      // 直接開く場合もAuthConfigを積んでおき、戻る操作でAuthConfigに戻れるようにする
      if (view === "PairDeviceConfig") stack.push({ view: "AuthConfig", state: {} });
      stack.push({ view, state });
      openView(stack);
    } else {
      openView(ROOT_VIEW);
    }
  });

  // WorkspaceDetail（Files/Changes/History等）はSettingsのスタックとは
  // 独立したuseWorkspaceDetailNav.jsで開閉する（設定側の表示はそのまま
  // 変えない。WorkspaceDetailModal.vueが全面オーバーレイで表示する）。
  const { open: openWorkspaceDetail } = useWorkspaceDetailNav();

  on("git:openFileModal", (detail) => openWorkspaceDetail(detail));

  on("git:openGitHub", () => openWorkspaceDetail({ pane: "issues" }));

  on("git:openHistory", ({ wsName }: { wsName?: string } = {}) => {
    if (workspaceStore && wsName) workspaceStore.selectedWorkspace = wsName;
    openWorkspaceDetail({ pane: "history" });
  });

  on("modal:close", () => closeNav());
}

export function useSettingsNav() {
  registerListeners();
  return {
    viewStack, currentView, currentState, canNavigateBack, isOpen,
    modalTitle, modalBranch,
    pushView, popView, updateViewState, openView, closeNav, onBack, setPaneRef,
  };
}
