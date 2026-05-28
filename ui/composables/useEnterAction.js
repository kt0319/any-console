import { enterResolver } from "../utils/flick-resolvers.js";

/**
 * Enterキーの動作を一元管理する。
 * draft があれば送信、なければターミナルへ \r を送る。
 */
export function useEnterAction({ hasDraft, keyboardInput, sendKeyToTerminal }) {
  function onEnter() {
    if (hasDraft.value) {
      keyboardInput.value?.submit?.();
    } else {
      sendKeyToTerminal({ key: "Enter" });
    }
  }

  function makeFlickResolver(extraGuard = null) {
    return (dx, dy, threshold) => {
      if (extraGuard?.(dx, dy, threshold)) return null;
      return enterResolver(dx, dy, threshold);
    };
  }

  return { onEnter, makeFlickResolver };
}
