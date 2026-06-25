import { inject } from "vue";

export function useModalView() {
  return {
    modalTitle: inject("modalTitle"),
    modalBranch: inject("modalBranch", null),
    viewState: inject("viewState"),
    pushView: inject("pushView"),
    popView: inject("popView"),
    updateViewState: inject("updateViewState"),
  };
}
