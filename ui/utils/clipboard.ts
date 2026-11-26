/** Ctrl/Cmd+C（Shift/Alt 無し）の keydown か。useGlobalShortcuts / useTerminalInput 共用。 */
export function isCopyShortcut(e: KeyboardEvent) {
  return e.type === "keydown"
    && (e.ctrlKey || e.metaKey)
    && !e.shiftKey
    && !e.altKey
    && (e.key === "c" || e.key === "C");
}

/** 選択があればコピーして true、無ければ false（呼び出し側が標準動作に委ねる）。 */
export function copyTerminalSelection(term: { hasSelection?: () => boolean, getSelection?: () => string } | null | undefined) {
  if (!term?.hasSelection?.()) return false;
  const text = term.getSelection?.();
  if (text) copyText(text);
  return true;
}

/** 非 secure context（Tailscale 経由の HTTP 等）や権限拒否では textarea + execCommand("copy") を使う。 */
export async function copyText(text: string): Promise<boolean> {
  if (!text) return false;
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch { /* 権限拒否・非 secure context はフォールバックへ */ }
  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "0";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
