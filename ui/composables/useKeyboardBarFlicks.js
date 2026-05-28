import { onMounted } from "vue";
import { arrowResolver, enterResolver } from "../utils/flick-resolvers.js";

export function useKeyboardBarFlicks({
  arrowEl, enterEl,
  inputFocused, hasDraft, draft,
  keyboardInput,
  cycleSnippet, historyPrev, historyNext,
  setupFlickRepeat, sendKeyToTerminal,
  dismissKeyboard,
}) {
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
      const enterFlickResolver = (dx, dy, threshold) => {
        if (hasDraft.value && Math.abs(dx) > Math.abs(dy) && dx < -threshold) return { _clear: true };
        if (inputFocused.value && hasDraft.value) return null;
        return enterResolver(dx, dy, threshold);
      };
      setupFlickRepeat(enterEl.value, enterFlickResolver, () => {
        if (inputFocused.value) {
          if (hasDraft.value) { keyboardInput.value?.submit?.(); return; }
        }
        sendKeyToTerminal({ key: "Enter" });
      }, {
        accelerateRepeat: true,
        onFlick: (resolved) => {
          if (resolved?._clear) { draft.value = ""; return true; }
        },
      });
    }
  });
}
