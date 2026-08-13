import { enterResolver } from "../utils/flick-resolvers.ts";

/**
 * Enterキーの動作を一元管理する。
 * draft があれば送信、なければターミナルへ \r を送る。
 */
export function useEnterAction({ keyboardInput, sendKeyToTerminal }) {
  function onEnter() {
    // hasDraft（v-model経由）はIME変換中に反映が遅れることがあるため、
    // ここでは判定せず常にsubmit()へ委ねる。空/非空の分岐はsubmit()側が
    // 実際のDOM値を見て行う。
    if (keyboardInput.value?.submit) {
      keyboardInput.value.submit();
      return;
    }
    sendKeyToTerminal({ key: "Enter" });
  }

  /** @param {((dx: number, dy: number, threshold: number) => any)|null} [extraGuard] */
  function makeFlickResolver(extraGuard = null) {
    return (dx, dy, threshold) => {
      if (extraGuard) {
        const result = extraGuard(dx, dy, threshold);
        if (result) return typeof result === "object" ? result : null;
      }
      return enterResolver(dx, dy, threshold);
    };
  }

  return { onEnter, makeFlickResolver };
}
