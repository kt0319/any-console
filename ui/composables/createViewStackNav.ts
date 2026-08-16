import { ref, computed } from "vue";
import { useExclusiveMobileOverlay, type OverlayKey } from "./useExclusiveMobileOverlay.ts";

// モーダルのビュースタック（push/pop/ルートへリセット）の共通実装。
// useSettingsNav（ルート ModalMenu）と useSessionOpenNav（ルート WorkspaceOpen）が
// 同じ構造を複製していたのをファクトリに抽出したもの。呼び出し側は
// モジュールスコープで1回だけ生成し（系列ごとの単一状態）、イベントリスナーの
// 登録（on(...)）と useExclusiveMobileOverlay への registerOverlay だけを
// 系列固有のコードとして持つ。

export type NavEntry = { view: string, state: Record<string, any> };

export function createViewStackNav({ rootView, overlayKey }: {
  rootView: string,
  overlayKey: OverlayKey,
}) {
  const rootEntry = (): NavEntry => ({ view: rootView, state: {} });

  const viewStack = ref<NavEntry[]>([rootEntry()]);
  const modalTitle = ref("");
  const modalBranch = ref("");
  const isOpen = ref(false);
  const currentPaneRef = ref<{ handleBack?: () => boolean } | null>(null);

  const currentView = computed(() => viewStack.value.at(-1)?.view ?? null);
  const currentState = computed(() => viewStack.value.at(-1)?.state ?? {});
  const canNavigateBack = computed(() => viewStack.value.length > 1);

  function setPaneRef(el: { handleBack?: () => boolean } | null) {
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
    if (viewStack.value.length <= 1) return; // ルートより前には戻れない
    const popped = viewStack.value.at(-1);
    const newStack = viewStack.value.slice(0, -1);
    if (result != null && popped?.state?.onReturn) {
      popped.state.onReturn(result, newStack.at(-1));
    }
    viewStack.value = newStack;
  }

  function openView(views: string | NavEntry[]) {
    const { closeOthersOn } = useExclusiveMobileOverlay();
    closeOthersOn(overlayKey);
    const list = Array.isArray(views) ? views : [{ view: views, state: {} }];
    viewStack.value = list[0]?.view === rootView ? list : [rootEntry(), ...list];
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
    // ルートで戻る操作をされたらフォールバック先が無いため閉じる。
    if (!canNavigateBack.value) {
      closeNav();
      return;
    }
    popView();
  }

  return {
    viewStack, currentView, currentState, canNavigateBack, isOpen,
    modalTitle, modalBranch,
    pushView, popView, updateViewState, openView, closeNav, onBack, setPaneRef,
  };
}
