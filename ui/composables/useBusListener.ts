import { getCurrentScope, onScopeDispose } from "vue";
import { on } from "../app-bridge.ts";

/**
 * app-bridge の購読を、呼び出し元の effect scope（コンポーネント / composable）
 * の破棄時に自動解除する。scope 外から呼んだ場合は解除されない（アプリ全体で
 * 生きるシングルトン購読用）。
 */
export function useBusListener(event: string, handler: (detail: any) => void): () => void {
  const off = on(event, handler);
  if (getCurrentScope()) onScopeDispose(off);
  return off;
}
