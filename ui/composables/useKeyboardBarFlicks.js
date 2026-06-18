import { onMounted } from "vue";
import { arrowResolver } from "../utils/flick-resolvers.js";
import { createArrowFlickHandler } from "../utils/arrow-flick.js";
import { useEnterAction } from "./useEnterAction.js";

export function useKeyboardBarFlicks({
  arrowEl, enterEl,
  inputFocused, hasDraft, draft,
  keyboardInput,
  cycleSnippet, historyPrev, historyNext,
  setupFlickRepeat, sendKeyToTerminal,
  dismissKeyboard,
}) {
  const { onEnter, makeFlickResolver } = useEnterAction({ hasDraft, keyboardInput, sendKeyToTerminal });
  onMounted(() => {
    if (arrowEl.value) {
      const arrowFlick = createArrowFlickHandler({
        isInputFocused: () => inputFocused.value,
        cycleSnippet, historyPrev, historyNext,
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
