type ConfirmFn = (msg: string, opts?: object) => Promise<boolean | string>;

/**
 * タブ閉じ確認ダイアログの共通コア。メッセージ文言（`Close "<label>" tab?`）と
 * danger な Close ボタンをターミナルタブ・ブラウザタブで共有し、タブ種別ごとの
 * 追加選択肢（Refresh / Detach 等）だけを extras で渡す。
 */
function confirmCloseTabDialog(
  confirm: ConfirmFn,
  label: string,
  extras: object = {},
): Promise<boolean | string> {
  return confirm(`Close "${label}" tab?`, {
    ...extras,
    ok: { label: "Close", icon: "mdi-close", danger: true },
  });
}

/**
 * タブ閉じ確認ダイアログを表示する。
 *
 * @param confirm `useConfirm()` から取得した confirm 関数。
 * @returns true: 閉じる確定 / "refresh": 再接続を選択 / "detach": デタッチを選択 / false: キャンセル
 */
export function confirmCloseTab(
  confirm: ConfirmFn,
  tab: { workspace?: string | null; label?: string },
): Promise<boolean | string> {
  const label = tab?.workspace || tab?.label || "terminal";
  return confirmCloseTabDialog(confirm, label, {
    extra: {
      label: "Refresh",
      value: "refresh",
      icon: "mdi-refresh",
      desc: "Refresh: reconnects and redraws the terminal. The running session is preserved. Use this when the display looks broken.",
    },
    extra2: {
      label: "Detach",
      value: "detach",
      icon: "mdi-minus-circle-outline",
      desc: "Detach: hides the tab without ending the session.",
    },
  });
}

/**
 * ブラウザタブ（dev serverプレビュー用のiframeタブ）を閉じる前の確認。
 * ターミナルタブと違いRefresh/Detachに相当する選択肢は無い（tmuxセッション
 * を持たず、閉じる＝そのままタブが消えるだけのため）。
 *
 * @param confirm `useConfirm()` から取得した confirm 関数。
 */
export function confirmCloseBrowserTab(
  confirm: ConfirmFn,
  tab: { label?: string },
): Promise<boolean | string> {
  return confirmCloseTabDialog(confirm, tab?.label || "browser");
}
