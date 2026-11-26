import { inject, provide, type ComputedRef, type Ref } from "vue";

/** モーダルホストが子ビューへ提供する provide キー群。useModalView() の inject と1対1で対応する。 */
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

// default の null は、部分的にしか provide しないユニットテストで inject 警告を出さないためのもの。
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
