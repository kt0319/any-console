import { ref, computed } from "vue";
import { on } from "../app-bridge.js";
import { useExclusiveMobileOverlay } from "./useExclusiveMobileOverlay.ts";

// Open Session系列（WorkspaceOpen/WorkspaceAdd/WorkspaceEdit/JobConfig/
// IconPicker）専用のビュースタック。useSettingsNav.jsと同じ構造をルート
// ビュー"WorkspaceOpen"で複製したもの（SessionOpenModal.vueがホストする）。
// タブバーの「+」ボタンから開き、SettingsやSessionListとは完全に独立して
// 開閉する。
//
// isOpenはスタック深さ（canNavigateBack相当）では判定できない —
// WorkspaceOpenルート自体が「開いている」状態を表すため、明示的なrefで持つ
// （useWorkspaceDetailNav.jsと同様の考え方）。

type NavEntry = { view: string, state: Record<string, any> };

const ROOT_VIEW = "WorkspaceOpen";

const rootEntry = (): NavEntry => ({ view: ROOT_VIEW, state: {} });

const viewStack = ref<NavEntry[]>([rootEntry()]);
const modalTitle = ref("");
const modalBranch = ref("");
const isOpen = ref(false);
const currentPaneRef = ref<{ handleBack?: () => boolean } | null>(null);

const currentView = computed(() => viewStack.value.at(-1)?.view ?? null);
const currentState = computed(() => viewStack.value.at(-1)?.state ?? {});
const canNavigateBack = computed(() => viewStack.value.length > 1);

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
  if (viewStack.value.length <= 1) return;
  const popped = viewStack.value.at(-1);
  const newStack = viewStack.value.slice(0, -1);
  if (result != null && popped?.state?.onReturn) {
    popped.state.onReturn(result, newStack.at(-1));
  }
  viewStack.value = newStack;
}

function openView(views: string | NavEntry[]) {
  const { closeOthersOn } = useExclusiveMobileOverlay();
  closeOthersOn("sessionOpen");
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
}

function onBack() {
  if (currentPaneRef.value?.handleBack?.()) return;
  // ルートで戻る操作をされたら、他系列と違いフォールバック先が無いため閉じる。
  if (!canNavigateBack.value) {
    closeNav();
    return;
  }
  popView();
}

let listenersRegistered = false;

function registerListeners() {
  if (listenersRegistered) return;
  listenersRegistered = true;

  const { registerOverlay } = useExclusiveMobileOverlay();
  registerOverlay("sessionOpen", closeNav);

  on("workspace:openModal", () => openView([{ view: "WorkspaceOpen", state: {} }]));

  on("workspace:openAdd", (detail) => openView([
    { view: "WorkspaceOpen", state: {} },
    { view: "WorkspaceAdd", state: { ...detail } },
  ]));
}

export function useSessionOpenNav() {
  registerListeners();
  return {
    viewStack, currentView, currentState, canNavigateBack, isOpen,
    modalTitle, modalBranch,
    pushView, popView, updateViewState, openView, closeNav, onBack, setPaneRef,
  };
}
