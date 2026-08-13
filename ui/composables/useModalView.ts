import { inject, type ComputedRef, type Ref } from "vue";

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
