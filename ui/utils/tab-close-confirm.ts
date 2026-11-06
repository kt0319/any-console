/**
 * タブ閉じ確認ダイアログを表示する。
 *
 * @param confirm `useConfirm()` から取得した confirm 関数。
 * @param canRemoveWorktree true のとき、worktree ごと削除する選択肢を足す（worktree のタブ用）。
 * @returns true: 閉じる確定 / "detach": デタッチを選択 / "worktree": worktree ごと削除を選択 / false: キャンセル
 */
export function confirmCloseTab(
  confirm: (msg: string, opts?: object) => Promise<boolean | string>,
  tab: { workspace?: string | null; label?: string },
  canRemoveWorktree = false,
): Promise<boolean | string> {
  const label = tab?.workspace || tab?.label || "terminal";
  return confirm(`Close "${label}" tab?`, {
    extra: {
      label: "Detach",
      value: "detach",
      icon: "mdi-minus-circle-outline",
      desc: "Detach: hides the tab without ending the session.",
    },
    ...(canRemoveWorktree && {
      extra2: {
        label: "Remove worktree",
        value: "worktree",
        icon: "mdi-file-tree",
        desc: "Remove worktree: closes the tab and deletes the worktree directory.",
      },
    }),
    ok: { label: "Close", icon: "mdi-close", danger: true },
  });
}
