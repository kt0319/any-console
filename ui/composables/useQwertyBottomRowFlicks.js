import { onMounted } from "vue";
import { arrowResolver } from "../utils/flick-resolvers.js";
import { useEnterAction } from "./useEnterAction.js";

/**
 * QWERTY パネル下段 (input 横) の矢印キー・Enter キーのフリック設定。
 * KeyboardBar 版 (useKeyboardBarFlicks) と異なり、左フリックでの draft クリアは行わない。
 */
export function useQwertyBottomRowFlicks({
  arrowEl, enterEl,
  inputFocused, hasDraft,
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
      setupFlickRepeat(arrowEl.value, arrowResolver, dismissKeyboard, { accelerateRepeat: true, onFlick: onArrowFlick });
    }
    if (enterEl.value) {
      setupFlickRepeat(enterEl.value, makeFlickResolver((_, __, ___) => inputFocused.value && hasDraft.value), onEnter, { accelerateRepeat: true });
    }
  });
}
