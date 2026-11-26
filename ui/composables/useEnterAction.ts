import { type Ref } from "vue";
import { enterResolver } from "../utils/flick-resolvers.ts";

/** draft があれば送信、なければターミナルへ \r を送る。 */
export function useEnterAction({ keyboardInput, sendKeyToTerminal }: {
  keyboardInput: Ref<any>,
  sendKeyToTerminal: (keyDef: { key: string }) => void,
}) {
  function onEnter() {
    // hasDraft は IME 変換中に反映が遅れるため、判定は実 DOM 値を見る submit() に委ねる。
    if (keyboardInput.value?.submit) {
      keyboardInput.value.submit();
      return;
    }
    sendKeyToTerminal({ key: "Enter" });
  }

  function makeFlickResolver(extraGuard: ((dx: number, dy: number, threshold: number) => any) | null = null) {
    return (dx: number, dy: number, threshold: number) => {
      if (extraGuard) {
        const result = extraGuard(dx, dy, threshold);
        if (result) return typeof result === "object" ? result : null;
      }
      return enterResolver(dx, dy, threshold);
    };
  }

  return { onEnter, makeFlickResolver };
}
