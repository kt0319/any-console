/**
 * タブ閉じ確認ダイアログを表示する。
 *
 * @param {(msg: string, opts?: object) => Promise<boolean | string>} confirm
 *   - `useConfirm()` から取得した confirm 関数。
 * @param {{ workspace?: string, label?: string }} tab
 * @returns {Promise<boolean | string>}
 *   - true: 閉じる確定 / "refresh": 再接続を選択 / false: キャンセル
 */
export function confirmCloseTab(confirm, tab) {
  const label = tab?.workspace || tab?.label || "terminal";
  return confirm(`Close "${label}" tab?`, {
    extra: {
      label: "Refresh",
      value: "refresh",
      icon: "mdi-refresh",
      desc: "Refresh: reconnects and redraws the terminal. The running session is preserved. Use this when the display looks broken.",
    },
    ok: { label: "Close", icon: "mdi-close", danger: true },
  });
}
