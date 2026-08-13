/**
 * Ctrl/Cmd+C（修飾は Shift/Alt 無し）の keydown か。ターミナル選択コピーの
 * ショートカット判定を useGlobalShortcuts / useTerminalInput で共有する。
 */
export function isCopyShortcut(e: KeyboardEvent) {
  return e.type === "keydown"
    && (e.ctrlKey || e.metaKey)
    && !e.shiftKey
    && !e.altKey
    && (e.key === "c" || e.key === "C");
}

/**
 * ターミナルの選択テキストをコピーする。選択があれば copyText して true、
 * 無ければ false（呼び出し側は false なら標準動作へフォールバックする）。
 */
export function copyTerminalSelection(term: { hasSelection?: () => boolean, getSelection?: () => string } | null | undefined) {
  if (!term?.hasSelection?.()) return false;
  const text = term.getSelection?.();
  if (text) copyText(text);
  return true;
}

/**
 * テキストをクリップボードへコピーする。
 * secure context（HTTPS / localhost）では navigator.clipboard を使い、使えない環境
 * （Tailscale 経由の HTTP など非 secure context や権限拒否）では textarea +
 * execCommand("copy") にフォールバックする。
 * @returns コピーに成功したら true
 */
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
