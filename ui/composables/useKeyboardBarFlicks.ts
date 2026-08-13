import { onMounted, type ComputedRef, type Ref } from "vue";
import { arrowResolver } from "../utils/flick-resolvers.ts";
import { createArrowFlickHandler } from "../utils/arrow-flick.ts";
import { useEnterAction } from "./useEnterAction.ts";

export function useKeyboardBarFlicks({
  arrowEl, enterEl,
  inputFocused, hasDraft, draft,
  keyboardInput,
  historyPrev, historyNext,
  setupFlickRepeat, sendKeyToTerminal,
  dismissKeyboard,
}: {
  arrowEl: Ref<HTMLElement | null>,
  enterEl: Ref<HTMLElement | null>,
  inputFocused: Ref<boolean>,
  hasDraft: ComputedRef<boolean>,
  draft: Ref<string>,
  keyboardInput: Ref<any>,
  historyPrev: () => void,
  historyNext: () => void,
  setupFlickRepeat: (
    el: HTMLElement,
    resolveKey: (dx: number, dy: number, threshold: number) => any,
    onTap?: (() => void) | null,
    opts?: {
      accelerateRepeat?: boolean,
      onLongPress?: () => void,
      longPressGuard?: () => boolean,
      onFlick?: (key: any, dx: number, dy: number) => boolean | void,
    },
  ) => void,
  sendKeyToTerminal: (keyDef: { key: string, ctrl?: boolean, shift?: boolean }) => void,
  dismissKeyboard: () => void,
}) {
  const { onEnter, makeFlickResolver } = useEnterAction({ keyboardInput, sendKeyToTerminal }) as {
    onEnter: () => void,
    makeFlickResolver: (
      extraGuard?: ((dx: number, dy: number, threshold: number) => any) | null,
    ) => (dx: number, dy: number, threshold: number) => any,
  };
  onMounted(() => {
    if (arrowEl.value) {
      const arrowFlick = createArrowFlickHandler({
        isInputFocused: () => inputFocused.value,
        historyPrev, historyNext,
      });
      arrowEl.value.addEventListener("touchstart", () => arrowFlick.reset(), { passive: true });
      setupFlickRepeat(arrowEl.value, arrowResolver, dismissKeyboard, {
        accelerateRepeat: true,
        onFlick: arrowFlick.onFlick,
      });
    }

    if (enterEl.value) {
      const enterFlickResolver = makeFlickResolver((dx, dy, threshold) => {
        if (hasDraft.value && Math.abs(dx) > Math.abs(dy) && dx < -threshold) return { _clear: true };
        return inputFocused.value && hasDraft.value ? true : false;
      });
      setupFlickRepeat(enterEl.value, enterFlickResolver, onEnter, {
        accelerateRepeat: true,
        onFlick: (resolved) => {
          if (resolved?._clear) { draft.value = ""; return true; }
        },
      });
    }
  });
}
