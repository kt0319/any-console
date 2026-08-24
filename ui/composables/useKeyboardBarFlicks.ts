import { onMounted, type ComputedRef, type Ref } from "vue";
import { arrowResolver } from "../utils/flick-resolvers.ts";
import { createArrowFlickHandler } from "../utils/arrow-flick.ts";
import { useEnterAction } from "./useEnterAction.ts";

export function useKeyboardBarFlicks({
  arrowEl, enterEl,
  inputFocused, hasDraft, draft,
  keyboardInput,
  historyPrev, historyNext,
  snippetPrev, snippetNext,
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
  snippetPrev: () => void,
  snippetNext: () => void,
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
        historyPrev, historyNext, snippetPrev, snippetNext,
      });
      arrowEl.value.addEventListener("touchstart", () => arrowFlick.reset(), { passive: true });
      setupFlickRepeat(arrowEl.value, arrowResolver, dismissKeyboard, {
        accelerateRepeat: true,
        onFlick: arrowFlick.onFlick,
      });
    }

    if (enterEl.value) {
      // 改行挿入はclear（_clear）と違って冪等ではないため、touchmoveの度に
      // onFlickが繰り返し呼ばれても1ジェスチャーにつき1回だけ挿入されるよう
      // touchstartでリアームする（arrowFlick.resetと同じパターン）。
      let newlineArmed = true;
      enterEl.value.addEventListener("touchstart", () => { newlineArmed = true; }, { passive: true });

      const enterFlickResolver = makeFlickResolver((dx, dy, threshold) => {
        if (hasDraft.value && Math.abs(dx) > Math.abs(dy) && dx < -threshold) return { _clear: true };
        if (hasDraft.value && Math.abs(dy) > Math.abs(dx) && dy > threshold) return { _newline: true };
        return inputFocused.value && hasDraft.value ? true : false;
      });
      setupFlickRepeat(enterEl.value, enterFlickResolver, onEnter, {
        accelerateRepeat: true,
        onFlick: (resolved) => {
          if (resolved?._clear) { draft.value = ""; return true; }
          if (resolved?._newline) {
            if (newlineArmed) { keyboardInput.value?.appendChar?.("\n"); newlineArmed = false; }
            return true;
          }
        },
      });
    }
  });
}
