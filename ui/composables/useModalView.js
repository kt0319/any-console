import { inject } from "vue";

export function useModalView() {
  return {
    modalTitle: inject("modalTitle"),
    viewState: inject("viewState"),
    pushView: inject("pushView"),
    popView: inject("popView"),
  };
}
