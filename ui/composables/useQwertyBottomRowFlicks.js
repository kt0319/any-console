import { onMounted } from "vue";
import { arrowResolver } from "../utils/flick-resolvers.js";
import { createArrowFlickHandler } from "../utils/arrow-flick.js";
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
      const arrowFlick = createArrowFlickHandler({
        isInputFocused: () => inputFocused.value,
        cycleSnippet, historyPrev, historyNext,
      });
      arrowEl.value.addEventListener("touchstart", () => arrowFlick.reset(), { passive: true });
      setupFlickRepeat(arrowEl.value, arrowResolver, dismissKeyboard, { accelerateRepeat: true, onFlick: arrowFlick.onFlick });
    }
    if (enterEl.value) {
      setupFlickRepeat(enterEl.value, makeFlickResolver((_, __, ___) => inputFocused.value && hasDraft.value), onEnter, { accelerateRepeat: true });
    }
  });
}
