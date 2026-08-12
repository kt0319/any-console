import { inject } from "vue";

// provide側（SessionOpenModal.vue / TerminalSettingsModal.vue / WorkspaceDetailModal.vue）
// は全キーを提供する。
// defaultのnullは、部分的にしかprovideしないユニットテストでVueのinject警告を
// 出さないためのもの（実行時は常にprovide値が入る）。
export function useModalView() {
  return {
    modalTitle: inject("modalTitle", null),
    modalBranch: inject("modalBranch", null),
    viewState: inject("viewState", null),
    pushView: inject("pushView", null),
    popView: inject("popView", null),
    updateViewState: inject("updateViewState", null),
  };
}
