import { onMounted } from "vue";
import { arrowResolver } from "../utils/flick-resolvers.js";
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
      let arrowFlickHandled = false;
      arrowEl.value.addEventListener("touchstart", () => { arrowFlickHandled = false; }, { passive: true });
      const onArrowFlick = (key) => {
        if (!inputFocused.value) return false;
        if (key.key === "ArrowLeft" || key.key === "ArrowRight") {
          if (!arrowFlickHandled) { arrowFlickHandled = true; cycleSnippet(key.key === "ArrowLeft" ? 1 : -1); }
          return true;
        }
        if (arrowFlickHandled) return true;
        arrowFlickHandled = true;
        if (key.key === "ArrowUp") historyPrev();
        else if (key.key === "ArrowDown") historyNext();
        return true;
      };
      setupFlickRepeat(arrowEl.value, arrowResolver, dismissKeyboard, {
        accelerateRepeat: true,
        onFlick: onArrowFlick,
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
