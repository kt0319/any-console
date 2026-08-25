import { inject, provide, type ComputedRef, type Ref } from "vue";

/**
 * モーダルホスト（SessionOpenModal / TerminalSettingsModal /
 * WorkspaceDetailModal）が子ビューへ提供する6キーの provide 定型。
 * useModalView() の inject キーと1対1で対応する。
 */
export function provideModalView(nav: {
  modalTitle: Ref<string>,
  modalBranch: Ref<string>,
  viewState: ComputedRef<Record<string, any>>,
  pushView: (view: string, state?: Record<string, any>) => void,
  popView: (result?: any) => void,
  updateViewState: (state: Record<string, any>) => void,
}) {
  provide("modalTitle", nav.modalTitle);
  provide("modalBranch", nav.modalBranch);
  provide("viewState", nav.viewState);
  provide("pushView", nav.pushView);
  provide("popView", nav.popView);
  provide("updateViewState", nav.updateViewState);
}

// provide側（SessionOpenModal.vue / TerminalSettingsModal.vue / WorkspaceDetailModal.vue）
// は全キーを提供する。
// defaultのnullは、部分的にしかprovideしないユニットテストでVueのinject警告を
// 出さないためのもの（実行時は常にprovide値が入る）。
export function useModalView() {
  return {
    modalTitle: inject<Ref<string> | null>("modalTitle", null),
    modalBranch: inject<Ref<string> | null>("modalBranch", null),
    viewState: inject<ComputedRef<Record<string, any>> | null>("viewState", null),
    pushView: inject<((view: string, state?: Record<string, any>) => void) | null>("pushView", null),
    popView: inject<((result?: any) => void) | null>("popView", null),
    updateViewState: inject<((state: Record<string, any>) => void) | null>("updateViewState", null),
  };
}
